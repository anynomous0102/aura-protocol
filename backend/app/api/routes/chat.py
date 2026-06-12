from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.api.routes.auth import get_current_user
from app.enterprise.database import regional_uuidv7
from app.enterprise.normalized_database import append_message, list_sessions
from app.enterprise.redis_runtime import redis_runtime
from app.enterprise.tracing import get_tracer, inject_trace_metadata
from app.models.routing import SAFE_DEFAULT_DECISION
from app.services.router import dispatch_to_node, get_supervisor_routing_decision


router = APIRouter(prefix="/api", tags=["chat"])
tracer = get_tracer(__name__)


class ChatMessage(BaseModel):
    role: str = Field(default="user", max_length=32)
    content: str | None = None
    text: str | None = None

    @property
    def normalized_content(self) -> str:
        return self.content or self.text or ""


class ChatRequest(BaseModel):
    model_id: str = Field(default="aura", max_length=128)
    messages: list[ChatMessage] = Field(default_factory=list)
    user_id: str = Field(default="anonymous", max_length=256)
    session_id: str = Field(default_factory=regional_uuidv7, max_length=128)
    override_system: str = Field(default="", max_length=12000)


@router.post("/chat")
async def chat(request: ChatRequest, current_user: str = Depends(get_current_user)) -> dict[str, Any]:
    with tracer.start_as_current_span("api.chat") as span:
        history = [{"role": item.role, "content": item.normalized_content} for item in request.messages]
        prompt = next((item["content"] for item in reversed(history) if item["role"] == "user"), "")
        decision = await get_supervisor_routing_decision(prompt, history) if request.model_id == "aura" else SAFE_DEFAULT_DECISION
        response_text = await dispatch_to_node(decision, prompt, history)
        await append_message(user_id=current_user, session_id=request.session_id, role="user", content=prompt, provider=request.model_id)
        await append_message(user_id=current_user, session_id=request.session_id, role="model", content=response_text, provider=decision.target.value)
        metadata = inject_trace_metadata({"source": "api.chat"})
        if span is not None:
            span.set_attribute("messaging.system", "redis")
            span.set_attribute("messaging.destination.name", "aura:p2p:gossip")
            span.set_attribute("aura.chat.session_id", request.session_id)
            span.set_attribute("aura.chat.provider", decision.target.value)
        await redis_runtime.rpush_json(
            "aura:p2p:gossip",
            {
                "topic": "aura.chat.observed",
                "payload": {
                    "session_id": request.session_id,
                    "user_id": current_user,
                    "provider": decision.target.value,
                },
                "metadata": metadata,
            },
        )
        return {"text": response_text, "provider": decision.target.value}


@router.get("/chats/sessions")
async def sessions(current_user: str = Depends(get_current_user)) -> dict[str, Any]:
    return {"sessions": await list_sessions(current_user)}
