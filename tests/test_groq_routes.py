from __future__ import annotations

from fastapi.testclient import TestClient

from app.api.routes import groq
from app.main import create_app


def test_groq_models_returns_normalized_models_without_hmac(monkeypatch):
    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, object]:
            return {"data": [{"id": "llama-3.3-70b-versatile", "owned_by": "groq"}]}

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return None

        async def get(self, url, headers):
            assert url == groq.GROQ_MODELS_URL
            assert headers["Authorization"] == "Bearer gsk_test_key"
            return FakeResponse()

    monkeypatch.setattr(groq.httpx, "AsyncClient", FakeClient)
    client = TestClient(create_app())

    response = client.post("/api/groq/models", json={"api_key": "gsk_test_key"})

    assert response.status_code == 200
    assert response.json() == {
        "status": "success",
        "models": [
            {
                "id": "llama-3.3-70b-versatile",
                "name": "llama-3.3-70b-versatile",
                "owned_by": "groq",
                "category": "chat",
            }
        ],
    }
