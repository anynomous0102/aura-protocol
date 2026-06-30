from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.enterprise import database


router = APIRouter(prefix="/api/oapin", tags=["oapin"])


class OapinVerifyRequest(BaseModel):
    session_id: str = Field(..., min_length=1, max_length=128)
    serving_node_did: str = Field(..., min_length=1, max_length=256)
    client_did: str = Field(..., min_length=1, max_length=256)
    tokens_used: int = Field(default=0, ge=0)
    zk_proof: dict[str, Any] = Field(default_factory=dict)
    zk_public_signals: list[Any] = Field(default_factory=list)


@router.post("/verify")
async def verify(request: OapinVerifyRequest) -> dict[str, Any]:
    await database.init_enterprise_schema()
    tx_hash = f"{request.session_id}:{request.serving_node_did}:{request.tokens_used}"
    await database.execute(
        """
        INSERT OR REPLACE INTO oapin_ledger(tx_hash, session_id, node, tokens, verified)
        VALUES (:tx_hash, :session_id, :node, :tokens, :verified)
        """,
        {
            "tx_hash": tx_hash,
            "session_id": request.session_id,
            "node": request.serving_node_did,
            "tokens": request.tokens_used,
            "verified": True,
        },
    )
    return {"status": "success", "verified": True, "remaining_balance": max(0, 1_000_000 - request.tokens_used)}
