from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from app.enterprise import database
from app.enterprise.database import regional_uuidv7


router = APIRouter(prefix="/api/nodes", tags=["nodes"])


class NodeRequest(BaseModel):
    user_id: str = Field(default="anonymous", max_length=256)
    name: str = Field(..., min_length=1, max_length=256)
    provider: str = Field(..., min_length=1, max_length=128)
    address: str = Field(default="", max_length=4096)
    key_hash: str = Field(default="", max_length=128)


@router.post("")
async def upsert_node(request: NodeRequest) -> dict[str, Any]:
    await database.init_enterprise_schema()
    existing = await database.fetch_one(
        "SELECT id FROM nodes WHERE user_id = :user_id AND name = :name",
        {"user_id": request.user_id, "name": request.name},
    )
    node_id = str(existing["id"]) if existing else regional_uuidv7("node")
    if existing:
        await database.execute(
            "UPDATE nodes SET provider = :provider, address = :address WHERE id = :id",
            {"id": node_id, "provider": request.provider, "address": request.address},
        )
    else:
        await database.execute(
            "INSERT INTO nodes (id, user_id, name, provider, address) VALUES (:id, :user_id, :name, :provider, :address)",
            {
                "id": node_id,
                "user_id": request.user_id,
                "name": request.name,
                "provider": request.provider,
                "address": request.address,
            },
        )
    return {"status": "success", "node_id": node_id, "key_hash": request.key_hash}


@router.delete("/{node_id}")
async def delete_node(node_id: str) -> dict[str, str]:
    await database.init_enterprise_schema()
    await database.execute("DELETE FROM nodes WHERE id = :id OR name = :id", {"id": node_id})
    return {"status": "success"}


@router.get("")
async def list_nodes(user_id: str = "anonymous") -> dict[str, Any]:
    await database.init_enterprise_schema()
    rows = await database.fetch_all(
        "SELECT id, user_id, name, provider, address FROM nodes WHERE user_id = :user_id ORDER BY name",
        {"user_id": user_id},
    )
    if rows is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to load nodes.")
    return {"status": "success", "nodes": rows}
