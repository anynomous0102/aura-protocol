from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import create_app


def test_nodes_upsert_list_and_delete_without_hmac(monkeypatch, tmp_path):
    monkeypatch.setenv("AURA_DATA_DIR", str(tmp_path))
    client = TestClient(create_app())

    create_response = client.post(
        "/api/nodes",
        json={
            "user_id": "user-1",
            "name": "openrouter-key",
            "provider": "openrouter",
            "address": "sk-or-test-key-value",
            "key_hash": "abc123",
        },
    )

    assert create_response.status_code == 200
    node_id = create_response.json()["node_id"]

    update_response = client.post(
        "/api/nodes",
        json={
            "user_id": "user-1",
            "name": "openrouter-key",
            "provider": "openrouter",
            "address": "sk-or-new-key-value",
            "key_hash": "def456",
        },
    )

    assert update_response.status_code == 200
    assert update_response.json()["node_id"] == node_id

    list_response = client.get("/api/nodes", params={"user_id": "user-1"})
    assert list_response.status_code == 200
    assert list_response.json()["nodes"][0]["address"] == "sk-or-new-key-value"

    delete_response = client.delete(f"/api/nodes/{node_id}")
    assert delete_response.status_code == 200
    assert client.get("/api/nodes", params={"user_id": "user-1"}).json()["nodes"] == []
