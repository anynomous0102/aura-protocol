from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
from typing import Awaitable, Callable, ClassVar, List, Optional

import structlog
from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse


log = structlog.get_logger(__name__)


def _base64url_decode(value: str) -> bytes:
    return base64.urlsafe_b64decode((value + "=" * (-len(value) % 4)).encode("ascii"))


def _extract_jwt_sub(auth_header: str) -> Optional[str]:
    if not auth_header.lower().startswith("bearer "):
        return None
    token = auth_header[7:].strip()
    parts = token.split(".")
    if len(parts) != 3:
        return token or None
    try:
        payload = json.loads(_base64url_decode(parts[1]).decode("utf-8"))
    except (ValueError, UnicodeDecodeError, json.JSONDecodeError):
        return None
    sub = payload.get("sub")
    return str(sub) if sub else None


class HMACVerificationMiddleware(BaseHTTPMiddleware):
    """
    Verifies X-AURA-Signature on non-exempt endpoints.

    The signing key is the authenticated user's JWT `sub` claim. Deployments may
    override this with AURA_HMAC_SECRET for service-to-service traffic.
    hmac.compare_digest is used for constant-time signature comparison.
    """

    MAX_SKEW_SECONDS: ClassVar[int] = 300
    EXEMPT_PATHS: ClassVar[List[str]] = [
        "/api/auth/login",
        "/api/auth/me",
        "/api/auth/google",
        "/api/auth/web3",
        "/api/auth/provider",
        "/api/auth/provider-token",
        "/api/auth/callback/google",
        "/api/auth/did",
        "/api/upload",
        "/health",
        "/api/health",
        "/docs",
        "/redoc",
        "/openapi.json",
    ]

    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        path = request.url.path
        if request.method == "OPTIONS" or self._is_exempt(path):
            return await call_next(request)

        received_sig = request.headers.get("X-AURA-Signature", "")
        timestamp = request.headers.get("X-AURA-Timestamp", "")
        if not received_sig or not timestamp:
            return JSONResponse({"detail": "Missing HMAC signature headers"}, status_code=403)

        try:
            raw_timestamp = int(timestamp)
        except ValueError:
            return JSONResponse({"detail": "Invalid request timestamp"}, status_code=403)

        request_time = raw_timestamp / 1000 if raw_timestamp > 10_000_000_000 else float(raw_timestamp)
        if abs(time.time() - request_time) > self.MAX_SKEW_SECONDS:
            return JSONResponse({"detail": "Request timestamp expired"}, status_code=403)

        session_secret = os.getenv("AURA_HMAC_SECRET", "").strip() or _extract_jwt_sub(
            request.headers.get("Authorization", "")
        )
        if not session_secret:
            return JSONResponse({"detail": "Missing HMAC session secret"}, status_code=403)

        body = await request.body()
        body_hash = hashlib.sha256(body).hexdigest()
        signing_input = f"{request.method.upper()}:{path}:{timestamp}:{body_hash}"
        expected_sig = hmac.new(
            session_secret.encode("utf-8"),
            signing_input.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()

        if not hmac.compare_digest(expected_sig, received_sig):
            log.warning("hmac_signature_rejected", path=path)
            return JSONResponse({"detail": "Invalid HMAC signature"}, status_code=403)

        async def receive() -> dict[str, object]:
            return {"type": "http.request", "body": body, "more_body": False}

        request._receive = receive  # type: ignore[attr-defined]
        return await call_next(request)

    @classmethod
    def _is_exempt(cls, path: str) -> bool:
        return path in cls.EXEMPT_PATHS or path.startswith("/docs/") or path.startswith("/static/")
