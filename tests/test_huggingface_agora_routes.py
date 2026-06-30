from __future__ import annotations

import httpx
from fastapi.testclient import TestClient

from app.api.routes import huggingface
from app.main import create_app


def test_hf_models_falls_back_when_huggingface_is_unreachable(monkeypatch):
    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return None

        async def get(self, *args, **kwargs):
            raise httpx.ConnectError("offline")

    monkeypatch.setattr(huggingface.httpx, "AsyncClient", FakeClient)
    client = TestClient(create_app())

    response = client.post("/api/hf-models", json={"search": "qwen", "limit": 10})

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "success"
    assert body["source"] == "fallback"
    assert body["models"][0]["url"].startswith("huggingface:")


def test_agora_heal_records_repair_path(monkeypatch, tmp_path):
    monkeypatch.setenv("AURA_DATA_DIR", str(tmp_path))
    client = TestClient(create_app())

    response = client.post(
        "/api/agora/heal",
        json={
            "pipeline_id": "financial-data-feed-v2",
            "target_endpoint": "api.marketdata.com/v1/assets",
            "failed_key": "['price_usd']",
            "extraction_goal": "Extract current USD price",
        },
    )

    assert response.status_code == 200
    assert response.json() == {"status": "success", "new_path": "$.data.market.price_usd"}
