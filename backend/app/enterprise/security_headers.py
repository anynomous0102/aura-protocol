from __future__ import annotations

from typing import Iterable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Adds browser hardening headers similar to Helmet's secure defaults."""

    def __init__(
        self,
        app,
        *,
        allowed_frame_ancestors: Iterable[str] | None = None,
    ) -> None:
        super().__init__(app)
        frame_ancestors = " ".join(allowed_frame_ancestors or ("'none'",))
        self.content_security_policy = (
            "default-src 'self'; "
            "script-src 'self' https://accounts.google.com; "
            "style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data: https:; "
            "connect-src 'self' https: wss:; "
            "frame-ancestors "
            f"{frame_ancestors}; "
            "base-uri 'self'; "
            "form-action 'self'"
        )

    async def dispatch(self, request: Request, call_next) -> Response:
        response = await call_next(request)
        response.headers.setdefault("Content-Security-Policy", self.content_security_policy)
        response.headers.setdefault("Cross-Origin-Opener-Policy", "same-origin")
        response.headers.setdefault("Cross-Origin-Resource-Policy", "same-origin")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("X-Permitted-Cross-Domain-Policies", "none")
        response.headers.setdefault("X-XSS-Protection", "0")
        return response
