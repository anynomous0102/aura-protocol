from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from app.enterprise import database
from app.enterprise.redis_runtime import redis_runtime
from app.enterprise.tracing import get_tracer, inject_trace_metadata


router = APIRouter(prefix="/api/p2p", tags=["p2p"])
tracer = get_tracer(__name__)
_LOCAL_GOSSIP_QUEUE: list[dict[str, Any]] = []


class GossipEnvelope(BaseModel):
    topic: str = Field(..., min_length=1, max_length=128)
    payload: dict
    metadata: dict = Field(default_factory=dict)


@router.post("/handshake")
async def handshake() -> dict[str, str]:
    await redis_runtime.ensure_connected()
    transport = "redis-broker" if redis_runtime.client is not None else "local-memory"
    return {"status": "accepted", "transport": transport}


@router.get("/peers")
async def peers(user_id: str = "anonymous") -> dict[str, Any]:
    await database.init_enterprise_schema()
    rows = await database.fetch_all(
        "SELECT id, name, provider, address FROM nodes WHERE user_id = :user_id ORDER BY name",
        {"user_id": user_id},
    )
    return {
        "status": "success",
        "transport": "redis-broker" if redis_runtime.client is not None else "local-memory",
        "peers": [
            {
                "id": row["id"],
                "name": row["name"],
                "provider": row["provider"],
                "address": row["address"],
            }
            for row in rows
        ],
    }


@router.post("/gossip")
async def gossip(envelope: GossipEnvelope) -> dict[str, str]:
    await redis_runtime.ensure_connected()
    with tracer.start_as_current_span("api.p2p.enqueue_gossip") as span:
        payload = envelope.model_dump()
        payload["metadata"] = inject_trace_metadata(payload.get("metadata"))
        if span is not None:
            span.set_attribute("messaging.system", "redis")
            span.set_attribute("messaging.destination.name", "aura:p2p:gossip")
            span.set_attribute("messaging.message.conversation_id", envelope.topic)
        if redis_runtime.client is None:
            _LOCAL_GOSSIP_QUEUE.append(payload)
            return {"status": "queued", "transport": "local-memory"}
        await redis_runtime.rpush_json("aura:p2p:gossip", payload)
        return {"status": "queued", "transport": "redis-broker"}
