from __future__ import annotations

from typing import Any

import structlog
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.api.routes.auth import get_current_user
from app.enterprise.database import regional_uuidv7
from app.enterprise.normalized_database import append_message, list_sessions
from app.enterprise.redis_runtime import redis_runtime
from app.enterprise.tracing import get_tracer, inject_trace_metadata
from app.services.provider_adapters import AIProviderError
from app.services.router import dispatch_model_id, dispatch_to_node, get_supervisor_routing_decision


router = APIRouter(prefix="/api", tags=["chat"])
tracer = get_tracer(__name__)
log = structlog.get_logger(__name__)


class ChatMessage(BaseModel):
    role: str = Field(default="user", max_length=32)
    content: str | None = None
    text: str | None = None

    @property
    def normalized_content(self) -> str:
        return self.content or self.text or ""


class ChatRequest(BaseModel):
    model_id: str = Field(default="aura", max_length=128)
    api_key: str = Field(default="", max_length=4096)
    messages: list[ChatMessage] = Field(default_factory=list)
    user_id: str = Field(default="anonymous", max_length=256)
    session_id: str = Field(default_factory=regional_uuidv7, max_length=128)
    override_system: str = Field(default="", max_length=12000)


async def _persist_chat_side_effects(
    *,
    current_user: str,
    session_id: str,
    prompt: str,
    response_text: str,
    request_model_id: str,
    provider: str,
    metadata: dict[str, Any],
) -> None:
    try:
        await append_message(user_id=current_user, session_id=session_id, role="user", content=prompt, provider=request_model_id)
        await append_message(user_id=current_user, session_id=session_id, role="model", content=response_text, provider=provider)
        await redis_runtime.rpush_json(
            "aura:p2p:gossip",
            {
                "topic": "aura.chat.observed",
                "payload": {
                    "session_id": session_id,
                    "user_id": current_user,
                    "provider": provider,
                },
                "metadata": metadata,
            },
        )
    except Exception as exc:
        log.warning("chat_side_effects_failed", session_id=session_id, provider=provider, error=str(exc))


@router.post("/chat")
async def chat(
    request: ChatRequest,
    background_tasks: BackgroundTasks,
    current_user: str = Depends(get_current_user),
) -> dict[str, Any]:
    with tracer.start_as_current_span("api.chat") as span:
        history = [{"role": item.role, "content": item.normalized_content} for item in request.messages]
        prompt = next((item["content"] for item in reversed(history) if item["role"] == "user"), "")
        if request.model_id == "aura":
            try:
                decision = await get_supervisor_routing_decision(prompt, history)
                response_text = await dispatch_to_node(decision, prompt, history)
                provider = decision.target.value
            except (AIProviderError, RuntimeError) as exc:
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail=f"Provider request failed: {exc}",
                ) from exc
        else:
            try:
                response_text, provider = await dispatch_model_id(request.model_id, prompt, history, api_key=request.api_key)
            except AIProviderError as exc:
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail=f"Provider request failed: {exc}",
                ) from exc
        metadata = inject_trace_metadata({"source": "api.chat"})
        if span is not None:
            span.set_attribute("messaging.system", "redis")
            span.set_attribute("messaging.destination.name", "aura:p2p:gossip")
            span.set_attribute("aura.chat.session_id", request.session_id)
            span.set_attribute("aura.chat.provider", provider)
        background_tasks.add_task(
            _persist_chat_side_effects,
            current_user=current_user,
            session_id=request.session_id,
            prompt=prompt,
            response_text=response_text,
            request_model_id=request.model_id,
            provider=provider,
            metadata=metadata,
        )
        return {"text": response_text, "provider": provider}


@router.get("/chats/sessions")
async def sessions(current_user: str = Depends(get_current_user)) -> dict[str, Any]:
    return {"sessions": await list_sessions(current_user)}
