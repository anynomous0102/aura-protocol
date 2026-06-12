from __future__ import annotations

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from app.enterprise.redis_runtime import redis_runtime
from app.enterprise.tracing import get_tracer, inject_trace_metadata


router = APIRouter(prefix="/api/p2p", tags=["p2p"])
tracer = get_tracer(__name__)


class GossipEnvelope(BaseModel):
    topic: str = Field(..., min_length=1, max_length=128)
    payload: dict
    metadata: dict = Field(default_factory=dict)


@router.post("/handshake")
async def handshake() -> dict[str, str]:
    return {"status": "accepted", "transport": "redis-broker"}


@router.get("/peers")
async def peers() -> dict[str, list[str]]:
    return {"peers": []}


@router.post("/gossip")
async def gossip(envelope: GossipEnvelope) -> dict[str, str]:
    await redis_runtime.ensure_connected()
    if redis_runtime.client is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="P2P broker is unavailable.",
        )
    with tracer.start_as_current_span("api.p2p.enqueue_gossip") as span:
        payload = envelope.model_dump()
        payload["metadata"] = inject_trace_metadata(payload.get("metadata"))
        if span is not None:
            span.set_attribute("messaging.system", "redis")
            span.set_attribute("messaging.destination.name", "aura:p2p:gossip")
            span.set_attribute("messaging.message.conversation_id", envelope.topic)
        await redis_runtime.rpush_json("aura:p2p:gossip", payload)
        return {"status": "queued", "transport": "redis-broker"}
