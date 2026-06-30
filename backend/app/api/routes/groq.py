from __future__ import annotations

import os
import time
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from app.services.provider_adapters import env_key_pool


router = APIRouter(prefix="/api/groq", tags=["groq"])

GROQ_MODELS_URL = "https://api.groq.com/openai/v1/models"
MODEL_CACHE_TTL_SECONDS = int(os.getenv("AURA_MODEL_CACHE_TTL_SECONDS", "300"))
_MODEL_CACHE: dict[str, tuple[float, list[dict[str, Any]]]] = {}


class GroqModelsRequest(BaseModel):
    api_key: str = Field(default="", max_length=4096)
    key_hash: str = Field(default="", max_length=128)


def _server_groq_key() -> str:
    keys = env_key_pool("GROQ_API_KEY") or env_key_pool("GROQ_FREE_MODELS_API_KEY")
    return keys[0] if keys else ""


def _normalize_models(payload: dict[str, Any]) -> list[dict[str, Any]]:
    raw_models = payload.get("data")
    if not isinstance(raw_models, list):
        raw_models = payload.get("models")
    if not isinstance(raw_models, list):
        return []

    models: list[dict[str, Any]] = []
    for item in raw_models:
        if not isinstance(item, dict) or not item.get("id"):
            continue
        model_id = str(item["id"])
        models.append(
            {
                "id": model_id,
                "name": str(item.get("name") or model_id),
                "owned_by": item.get("owned_by"),
                "category": "chat",
            }
        )
    return models


def _cache_key(api_key: str) -> str:
    return f"groq:{hash(api_key)}"


def _get_cached_models(api_key: str) -> list[dict[str, Any]] | None:
    cached = _MODEL_CACHE.get(_cache_key(api_key))
    if cached is None:
        return None
    created_at, models = cached
    if time.monotonic() - created_at > MODEL_CACHE_TTL_SECONDS:
        _MODEL_CACHE.pop(_cache_key(api_key), None)
        return None
    return models


def _set_cached_models(api_key: str, models: list[dict[str, Any]]) -> None:
    _MODEL_CACHE[_cache_key(api_key)] = (time.monotonic(), models)


@router.post("/models")
async def models(request: GroqModelsRequest) -> dict[str, Any]:
    api_key = request.api_key.strip() or _server_groq_key()
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Groq API key is required.",
        )

    cached_models = _get_cached_models(api_key)
    if cached_models is not None:
        return {"status": "success", "models": cached_models}

    headers = {"Authorization": f"Bearer {api_key}", "Accept": "application/json"}
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(8.0, connect=3.0)) as client:
            response = await client.get(GROQ_MODELS_URL, headers=headers)
            response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        detail = "Groq rejected the request. Check the API key and try again."
        raise HTTPException(status_code=exc.response.status_code, detail=detail) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Unable to reach Groq from the AURA backend: {exc.__class__.__name__}. Check internet access, DNS, firewall, or proxy settings.",
        ) from exc

    models_list = _normalize_models(response.json())
    _set_cached_models(api_key, models_list)
    return {"status": "success", "models": models_list}
