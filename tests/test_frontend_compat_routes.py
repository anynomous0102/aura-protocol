from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import create_app


def test_history_sync_and_load_contract(monkeypatch, tmp_path):
    monkeypatch.setenv("AURA_DATA_DIR", str(tmp_path))
    client = TestClient(create_app())

    sync_response = client.post(
        "/api/history/sync",
        json={"user_id": "user-1", "cards_data": "[{\"id\":\"card-1\"}]", "wallet_balance": 12.5},
    )

    assert sync_response.status_code == 200
    assert sync_response.json() == {"status": "success"}

    load_response = client.get("/api/history/load/user-1")

    assert load_response.status_code == 200
    assert load_response.json() == {"cards_data": "[{\"id\":\"card-1\"}]", "wallet_balance": 12.5}


def test_oapin_verify_contract(monkeypatch, tmp_path):
    monkeypatch.setenv("AURA_DATA_DIR", str(tmp_path))
    client = TestClient(create_app())

    response = client.post(
        "/api/oapin/verify",
        json={
            "session_id": "session-1",
            "serving_node_did": "did:aura:node-1",
            "client_did": "did:aura:client-1",
            "tokens_used": 250,
            "zk_proof": {},
            "zk_public_signals": [],
        },
    )

    assert response.status_code == 200
    assert response.json() == {"status": "success", "verified": True, "remaining_balance": 999750}


def test_upload_contract(monkeypatch, tmp_path):
    monkeypatch.setenv("AURA_DATA_DIR", str(tmp_path))
    client = TestClient(create_app())

    response = client.post(
        "/api/upload",
        data={"user_id": "user-1"},
        files={"files": ("notes.txt", b"hello", "text/plain")},
    )

    assert response.status_code == 200
    assert response.json() == {"status": "success", "files": ["notes.txt"]}
    assert (tmp_path / "uploads" / "user-1" / "notes.txt").read_bytes() == b"hello"


def test_frontend_auth_compat_routes_issue_tokens(monkeypatch, tmp_path):
    monkeypatch.setenv("AURA_DATA_DIR", str(tmp_path))
    client = TestClient(create_app())

    provider_response = client.post("/api/auth/provider-token", json={"provider": "github", "access_token": "token-123"})
    google_response = client.post("/api/auth/google", json={"access_token": "token-123"})
    web3_response = client.post("/api/auth/web3", json={"address": "0xABC123456789", "signature": "", "message": ""})

    for response in (provider_response, google_response, web3_response):
        assert response.status_code == 200
        body = response.json()
        assert body["token_type"] == "bearer"
        assert body["access_token"]
        assert body["user"]["id"]
