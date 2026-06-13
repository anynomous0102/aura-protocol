from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.main import create_app
from app.enterprise.permission_guard import RuntimePermissionError, assert_python_tree_read_only
from app.middleware.hmac_verifier import HMACVerificationMiddleware


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _token(sub: str) -> str:
    header = _b64url(json.dumps({"alg": "none"}).encode())
    payload = _b64url(json.dumps({"sub": sub}).encode())
    return f"{header}.{payload}.sig"


def _signature(method: str, path: str, timestamp: str, body: bytes, secret: str) -> str:
    body_hash = hashlib.sha256(body).hexdigest()
    return hmac.new(secret.encode(), f"{method}:{path}:{timestamp}:{body_hash}".encode(), hashlib.sha256).hexdigest()


def _client() -> TestClient:
    app = FastAPI()
    app.add_middleware(HMACVerificationMiddleware)

    @app.post("/protected")
    async def protected(payload: dict[str, str]):
        return {"ok": True, "payload": payload}

    @app.post("/health")
    async def health():
        return {"ok": True}

    return TestClient(app)


def test_encryption_round_trip_python_equivalent():
    key = hashlib.pbkdf2_hmac("sha256", b"user-secret", b"aura-v1", 100_000, dklen=32)
    aesgcm = AESGCM(key)
    iv = b"123456789012"
    value = {"hello": "world"}
    ciphertext = aesgcm.encrypt(iv, json.dumps(value).encode(), None)
    stored = iv + ciphertext
    try:
        json.loads(stored.decode())
        assert False
    except UnicodeDecodeError:
        pass
    assert json.loads(aesgcm.decrypt(stored[:12], stored[12:], None).decode()) == value


def test_valid_hmac_accepted():
    client = _client()
    body = b'{"x":"1"}'
    secret = "user-1"
    timestamp = str(int(time.time() * 1000))
    response = client.post(
        "/protected",
        content=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {_token(secret)}",
            "X-AURA-Timestamp": timestamp,
            "X-AURA-Signature": _signature("POST", "/protected", timestamp, body, secret),
        },
    )
    assert response.status_code == 200


def test_modified_body_rejected():
    client = _client()
    secret = "user-1"
    timestamp = str(int(time.time() * 1000))
    response = client.post(
        "/protected",
        content=b'{"x":"2"}',
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {_token(secret)}",
            "X-AURA-Timestamp": timestamp,
            "X-AURA-Signature": _signature("POST", "/protected", timestamp, b'{"x":"1"}', secret),
        },
    )
    assert response.status_code == 403


def test_replay_timestamp_rejected():
    client = _client()
    secret = "user-1"
    body = b'{"x":"1"}'
    timestamp = str(int((time.time() - 400) * 1000))
    response = client.post(
        "/protected",
        content=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {_token(secret)}",
            "X-AURA-Timestamp": timestamp,
            "X-AURA-Signature": _signature("POST", "/protected", timestamp, body, secret),
        },
    )
    assert response.status_code == 403
    assert response.json()["detail"] == "Request timestamp expired"


def test_missing_signature_rejected():
    response = _client().post("/protected", json={"x": "1"}, headers={"Authorization": f"Bearer {_token('user-1')}"})
    assert response.status_code == 403


def test_exempt_path_bypasses_middleware():
    assert _client().post("/health").status_code == 200


def test_permission_guard_uses_effective_process_writability(tmp_path, monkeypatch):
    source = tmp_path / "owned_by_someone_else.py"
    source.write_text("VALUE = 1\n")
    monkeypatch.setattr("app.enterprise.permission_guard._is_windows", lambda: False)
    monkeypatch.setattr("app.enterprise.permission_guard._can_current_process_write", lambda path: False)

    assert_python_tree_read_only(tmp_path)

    monkeypatch.setattr("app.enterprise.permission_guard._can_current_process_write", lambda path: True)
    try:
        assert_python_tree_read_only(tmp_path)
        assert False
    except RuntimePermissionError as exc:
        assert str(source) in str(exc)


def test_vercel_origin_is_allowed_by_default(monkeypatch):
    monkeypatch.delenv("AURA_ALLOWED_ORIGINS", raising=False)
    monkeypatch.delenv("AURA_ALLOWED_ORIGIN_REGEX", raising=False)
    monkeypatch.setenv("AURA_SKIP_PERMISSION_GUARD", "true")
    app = create_app()
    client = TestClient(app)

    response = client.options(
        "/api/chat",
        headers={
            "Origin": "https://aura-web.vercel.app",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type,authorization,x-aura-signature,x-aura-timestamp",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "https://aura-web.vercel.app"


def test_render_origin_is_allowed_by_default(monkeypatch):
    monkeypatch.delenv("AURA_ALLOWED_ORIGINS", raising=False)
    monkeypatch.delenv("AURA_ALLOWED_ORIGIN_REGEX", raising=False)
    monkeypatch.setenv("AURA_SKIP_PERMISSION_GUARD", "true")
    app = create_app()
    client = TestClient(app)

    response = client.options(
        "/api/chat",
        headers={
            "Origin": "https://aura-protocol.onrender.com",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type,authorization,x-aura-signature,x-aura-timestamp",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "https://aura-protocol.onrender.com"
