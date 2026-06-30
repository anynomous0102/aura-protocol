from __future__ import annotations

from typing import Any

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services.provider_adapters import env_key_pool


router = APIRouter(prefix="/api", tags=["huggingface"])
HF_MODELS_URL = "https://huggingface.co/api/models"


class HuggingFaceModelsRequest(BaseModel):
    api_key: str = Field(default="", max_length=4096)
    search: str = Field(default="", max_length=256)
    limit: int = Field(default=50, ge=1, le=200)
    task: str = Field(default="all", max_length=80)


def _server_hf_key() -> str:
    keys = env_key_pool("HUGGINGFACE_API_KEY")
    return keys[0] if keys else ""


def _normalize_model(item: dict[str, Any]) -> dict[str, Any]:
    model_id = str(item.get("id") or item.get("modelId") or "")
    task = str(item.get("pipeline_tag") or "text-generation")
    author = str(item.get("author") or (model_id.split("/", 1)[0] if "/" in model_id else "community"))
    return {
        "id": model_id,
        "name": model_id,
        "author": author,
        "url": f"huggingface:{model_id}",
        "task": task,
        "downloads": int(item.get("downloads") or 0),
        "likes": int(item.get("likes") or 0),
        "gated": bool(item.get("gated")),
        "private": bool(item.get("private")),
        "is_free": True,
    }


def _fallback_models(search: str, limit: int) -> list[dict[str, Any]]:
    seeds = [
        {"id": "mistralai/Mistral-7B-Instruct-v0.3", "author": "mistralai", "pipeline_tag": "text-generation"},
        {"id": "Qwen/Qwen2.5-7B-Instruct", "author": "Qwen", "pipeline_tag": "text-generation"},
        {"id": "google/gemma-2-2b-it", "author": "google", "pipeline_tag": "text-generation"},
        {"id": "TinyLlama/TinyLlama-1.1B-Chat-v1.0", "author": "TinyLlama", "pipeline_tag": "text-generation"},
    ]
    query = search.strip().lower()
    models = [_normalize_model(item) for item in seeds]
    if query:
        models = [model for model in models if query in model["id"].lower()]
    return models[:limit]


@router.post("/hf-models")
async def hf_models(request: HuggingFaceModelsRequest) -> dict[str, Any]:
    token = request.api_key.strip() or _server_hf_key()
    params: dict[str, Any] = {"limit": request.limit, "sort": "downloads", "direction": -1}
    if request.search.strip():
        params["search"] = request.search.strip()
    if request.task.strip() and request.task != "all":
        params["pipeline_tag"] = request.task.strip()

    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.get(HF_MODELS_URL, params=params, headers=headers)
            response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=exc.response.status_code, detail="Hugging Face rejected the request. Check the token and try again.") from exc
    except httpx.HTTPError:
        return {
            "status": "success",
            "models": _fallback_models(request.search, request.limit),
            "token_configured": bool(token),
            "source": "fallback",
            "message": "Hugging Face is unreachable from the backend; showing built-in model suggestions.",
        }

    raw_models = response.json()
    if not isinstance(raw_models, list):
        raw_models = []
    return {
        "status": "success",
        "models": [_normalize_model(item) for item in raw_models if isinstance(item, dict) and (item.get("id") or item.get("modelId"))],
        "token_configured": bool(token),
        "source": "huggingface",
    }
