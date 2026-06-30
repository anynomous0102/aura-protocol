from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.enterprise import database


router = APIRouter(prefix="/api/history", tags=["history"])


class HistorySyncRequest(BaseModel):
    user_id: str = Field(..., min_length=1, max_length=256)
    cards_data: str = Field(default="[]", max_length=2_000_000)
    wallet_balance: float = 0.0


async def _ensure_schema() -> None:
    await database.execute(
        """
        CREATE TABLE IF NOT EXISTS user_history (
            user_id TEXT PRIMARY KEY,
            cards_data TEXT,
            wallet_balance DOUBLE PRECISION
        )
        """
    )


@router.get("/load/{user_id}")
async def load_history(user_id: str) -> dict[str, Any]:
    await _ensure_schema()
    row = await database.fetch_one(
        "SELECT cards_data, wallet_balance FROM user_history WHERE user_id = :user_id",
        {"user_id": user_id},
    )
    if not row:
        return {"cards_data": "[]", "wallet_balance": 0}
    return {"cards_data": row.get("cards_data") or "[]", "wallet_balance": row.get("wallet_balance") or 0}


@router.post("/sync")
async def sync_history(request: HistorySyncRequest) -> dict[str, str]:
    await _ensure_schema()
    existing = await database.fetch_one("SELECT user_id FROM user_history WHERE user_id = :user_id", {"user_id": request.user_id})
    if existing:
        await database.execute(
            "UPDATE user_history SET cards_data = :cards_data, wallet_balance = :wallet_balance WHERE user_id = :user_id",
            request.model_dump(),
        )
    else:
        await database.execute(
            "INSERT INTO user_history(user_id, cards_data, wallet_balance) VALUES (:user_id, :cards_data, :wallet_balance)",
            request.model_dump(),
        )
    return {"status": "success"}
