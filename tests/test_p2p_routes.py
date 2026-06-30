from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import create_app


def test_p2p_routes_work_without_redis_or_hmac(monkeypatch, tmp_path):
    monkeypatch.setenv("AURA_DATA_DIR", str(tmp_path))
    client = TestClient(create_app())

    node_response = client.post(
        "/api/nodes",
        json={
            "user_id": "anonymous",
            "name": "local-node",
            "provider": "custom",
            "address": "http://127.0.0.1:9000",
        },
    )
    assert node_response.status_code == 200

    peers_response = client.get("/api/p2p/peers", params={"user_id": "anonymous"})
    assert peers_response.status_code == 200
    assert peers_response.json()["transport"] == "local-memory"
    assert peers_response.json()["peers"][0]["name"] == "local-node"

    gossip_response = client.post(
        "/api/p2p/gossip",
        json={"topic": "test.topic", "payload": {"ok": True}},
    )
    assert gossip_response.status_code == 200
    assert gossip_response.json() == {"status": "queued", "transport": "local-memory"}
