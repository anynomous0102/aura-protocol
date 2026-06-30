from __future__ import annotations

import time
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.enterprise import database


router = APIRouter(prefix="/api/agora", tags=["agora"])


class AgoraHealRequest(BaseModel):
    pipeline_id: str = Field(..., min_length=1, max_length=128)
    target_endpoint: str = Field(..., min_length=1, max_length=512)
    failed_key: str = Field(default="", max_length=256)
    extraction_goal: str = Field(default="", max_length=512)


def _derive_path(request: AgoraHealRequest) -> str:
    goal = request.extraction_goal.lower()
    failed = request.failed_key.strip("[]'\" ")
    if "price" in goal or "price" in failed.lower():
        return "$.data.market.price_usd"
    if failed:
        return f"$.data.{failed}"
    return "$.data.value"


@router.post("/heal")
async def heal(request: AgoraHealRequest) -> dict[str, Any]:
    await database.init_enterprise_schema()
    new_path = _derive_path(request)
    await database.execute(
        """
        INSERT INTO healing_memory(pipeline_id, target_endpoint, new_path, timestamp)
        VALUES (:pipeline_id, :target_endpoint, :new_path, :timestamp)
        """,
        {
            "pipeline_id": request.pipeline_id,
            "target_endpoint": request.target_endpoint,
            "new_path": new_path,
            "timestamp": time.time(),
        },
    )
    return {"status": "success", "new_path": new_path}
