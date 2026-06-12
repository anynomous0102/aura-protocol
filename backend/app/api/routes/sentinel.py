from __future__ import annotations

import os

from fastapi import APIRouter, Header, HTTPException

from app.enterprise.code_healer import SentinelApprovalRequest, SentinelCodeHealer, SentinelPatchRequest


router = APIRouter(prefix="/api/sentinel", tags=["sentinel"])


def _require_sentinel_token(x_sentinel_token: str | None) -> None:
    expected = os.getenv("AURA_SENTINEL_TOKEN", "")
    if not expected or x_sentinel_token != expected:
        raise HTTPException(status_code=403, detail="Sentinel token required")


@router.get("/diagnostics")
async def diagnostics(x_sentinel_token: str | None = Header(default=None)) -> dict:
    _require_sentinel_token(x_sentinel_token)
    return {"diagnostics": await SentinelCodeHealer(api_key=os.getenv("GEMINI_API_KEY", "")).diagnostics()}


@router.post("/patch")
async def patch(request: SentinelPatchRequest, x_sentinel_token: str | None = Header(default=None)) -> dict:
    _require_sentinel_token(x_sentinel_token)
    result = await SentinelCodeHealer(api_key=os.getenv("GEMINI_API_KEY", "")).commit_patch(request)
    return result.model_dump()


@router.post("/approve-patch")
async def approve_patch(request: SentinelApprovalRequest, x_sentinel_token: str | None = Header(default=None)) -> dict:
    _require_sentinel_token(x_sentinel_token)
    try:
        result = await SentinelCodeHealer(api_key=os.getenv("GEMINI_API_KEY", "")).approve_patch(request)
        return result.model_dump()
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
