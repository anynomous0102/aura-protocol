from __future__ import annotations

from fastapi.testclient import TestClient

from app.api.routes import openrouter
from app.main import create_app


def test_openrouter_models_filters_free_models_without_hmac(monkeypatch):
    async def fake_fetch(api_key: str = ""):
        return [
            {
                "id": "meta-llama/llama-3.1-free",
                "name": "Llama Free",
                "pricing": {"prompt": "0", "completion": "0"},
                "category": "chat",
            },
            {
                "id": "anthropic/claude-paid",
                "name": "Claude Paid",
                "pricing": {"prompt": "1", "completion": "1"},
                "category": "chat",
            },
        ]

    monkeypatch.setattr(openrouter, "_fetch_openrouter_models", fake_fetch)
    client = TestClient(create_app())

    response = client.post("/api/openrouter/models", json={"free_only": True, "search": "llama"})

    assert response.status_code == 200
    assert response.json() == {
        "status": "success",
        "models": [
            {
                "id": "meta-llama/llama-3.1-free",
                "name": "Llama Free",
                "pricing": {"prompt": "0", "completion": "0"},
                "category": "chat",
            }
        ],
    }


def test_openrouter_free_models_returns_free_subset(monkeypatch):
    async def fake_fetch(api_key: str = ""):
        return [
            {
                "id": "z/model-paid",
                "name": "Paid",
                "pricing": {"prompt": "1", "completion": "1"},
                "category": "chat",
            },
            {
                "id": "a/model-free",
                "name": "Free",
                "pricing": {"prompt": "0", "completion": "0"},
                "category": "code",
            },
        ]

    monkeypatch.setattr(openrouter, "_fetch_openrouter_models", fake_fetch)
    client = TestClient(create_app())

    response = client.get("/api/openrouter/free-models")

    assert response.status_code == 200
    assert response.json()["models"] == [
        {
            "id": "a/model-free",
            "name": "Free",
            "pricing": {"prompt": "0", "completion": "0"},
            "category": "code",
        }
    ]
