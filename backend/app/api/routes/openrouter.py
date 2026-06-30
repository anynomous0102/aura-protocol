from __future__ import annotations

import os
import time
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from app.services.provider_adapters import env_key_pool


router = APIRouter(prefix="/api/openrouter", tags=["openrouter"])

OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models"
MAX_FREE_MODELS = 120
MODEL_CACHE_TTL_SECONDS = int(os.getenv("AURA_MODEL_CACHE_TTL_SECONDS", "300"))
_MODEL_CACHE: dict[str, tuple[float, list[dict[str, Any]]]] = {}


class OpenRouterModelsRequest(BaseModel):
    api_key: str = Field(default="", max_length=4096)
    key_hash: str = Field(default="", max_length=128)
    free_only: bool = True
    search: str = Field(default="", max_length=256)


def _server_openrouter_key() -> str:
    keys = env_key_pool("OPENROUTER_API_KEY") or env_key_pool("OPENROUTER_DEFAULT_KEY")
    return keys[0] if keys else ""


def _is_free_model(model: dict[str, Any]) -> bool:
    pricing = model.get("pricing") if isinstance(model.get("pricing"), dict) else {}
    return str(pricing.get("prompt", "1")) == "0" and str(pricing.get("completion", "1")) == "0"


def _category_for_model(model: dict[str, Any]) -> str:
    model_id = str(model.get("id", "")).lower()
    name = str(model.get("name", "")).lower()
    text = f"{model_id} {name}"
    architecture = model.get("architecture") if isinstance(model.get("architecture"), dict) else {}
    modality = str(architecture.get("modality", "")).lower()

    if "image" in text or "stable-diffusion" in text or "flux" in text:
        return "image"
    if "vision" in text or "vl" in text or "image" in modality:
        return "vision"
    if "embed" in text:
        return "embedding"
    if "code" in text or "coder" in text:
        return "code"
    return "chat"


def _normalize_models(payload: dict[str, Any]) -> list[dict[str, Any]]:
    raw_models = payload.get("data")
    if not isinstance(raw_models, list):
        raw_models = payload.get("models")
    if not isinstance(raw_models, list):
        return []

    normalized: list[dict[str, Any]] = []
    for item in raw_models:
        if not isinstance(item, dict) or not item.get("id"):
            continue
        normalized.append(
            {
                "id": str(item["id"]),
                "name": str(item.get("name") or item["id"]),
                "pricing": item.get("pricing") if isinstance(item.get("pricing"), dict) else {},
                "architecture": item.get("architecture") if isinstance(item.get("architecture"), dict) else {},
                "context_length": item.get("context_length"),
                "category": _category_for_model(item),
            }
        )
    return normalized


def _cache_key(api_key: str) -> str:
    return f"openrouter:{hash(api_key)}"


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


async def _fetch_openrouter_models(api_key: str = "") -> list[dict[str, Any]]:
    cached_models = _get_cached_models(api_key)
    if cached_models is not None:
        return cached_models

    headers = {
        "Accept": "application/json",
        "HTTP-Referer": os.getenv("AURA_PUBLIC_URL", "https://aura-protocol.vercel.app"),
        "X-Title": "AURA Protocol",
    }
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(8.0, connect=3.0)) as client:
            response = await client.get(OPENROUTER_MODELS_URL, headers=headers)
            response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        status_code = exc.response.status_code
        detail = "OpenRouter rejected the request. Check the API key and try again."
        raise HTTPException(status_code=status_code, detail=detail) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Unable to reach OpenRouter from the AURA backend: {exc.__class__.__name__}. Check internet access, DNS, firewall, or proxy settings.",
        ) from exc

    models = _normalize_models(response.json())
    _set_cached_models(api_key, models)
    return models


@router.post("/models")
async def models(request: OpenRouterModelsRequest) -> dict[str, Any]:
    api_key = request.api_key.strip() or _server_openrouter_key()
    models_list = await _fetch_openrouter_models(api_key)

    if request.free_only:
        models_list = [model for model in models_list if _is_free_model(model)]

    query = request.search.strip().lower()
    if query:
        models_list = [
            model
            for model in models_list
            if query in model["id"].lower() or query in model["name"].lower()
        ]

    return {"status": "success", "models": models_list}


@router.get("/free-models")
async def free_models() -> dict[str, Any]:
    models_list = [model for model in await _fetch_openrouter_models(_server_openrouter_key()) if _is_free_model(model)]
    models_list.sort(key=lambda model: (model["category"], model["name"].lower()))
    return {"status": "success", "models": models_list[:MAX_FREE_MODELS]}
