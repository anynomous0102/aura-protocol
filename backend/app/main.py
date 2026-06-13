from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.enterprise.tracing import configure_tracing

configure_tracing("aura-api-gateway")

from app.api.routes import auth, chat, p2p, sentinel
from app.enterprise.code_healer import SentinelCodeHealerMiddleware, init_sentinel_schema
from app.enterprise import database
from app.enterprise.database import close_engine, init_enterprise_schema
from app.enterprise.normalized_database import init_normalized_schema, refresh_session_factory
from app.enterprise.permission_guard import assert_python_tree_read_only
from app.enterprise.redis_runtime import redis_runtime
from app.enterprise.security_headers import SecurityHeadersMiddleware
from app.middleware.hmac_verifier import HMACVerificationMiddleware


def _cors_origins() -> list[str]:
    raw = os.getenv(
        "AURA_ALLOWED_ORIGINS",
        "http://localhost:3000,http://127.0.0.1:3000,https://aura-protocol.onrender.com",
    )
    return [item.strip() for item in raw.split(",") if item.strip()]


def _cors_origin_regex() -> str | None:
    return os.getenv("AURA_ALLOWED_ORIGIN_REGEX", r"https://.*\.vercel\.app").strip() or None


def _database_fallback_enabled() -> bool:
    return os.getenv("AURA_DB_FALLBACK_TO_SQLITE", "true").lower() in {"1", "true", "yes"}


async def _init_database_schemas() -> None:
    try:
        await init_enterprise_schema()
        await init_normalized_schema()
        await init_sentinel_schema()
    except Exception:
        if not _database_fallback_enabled() or not database.IS_POSTGRES:
            raise
        await database.switch_to_sqlite_fallback()
        refresh_session_factory()
        await init_enterprise_schema()
        await init_normalized_schema()
        await init_sentinel_schema()


def create_app() -> FastAPI:
    configure_tracing("aura-api-gateway")
    app = FastAPI(title="AURA Decentralized Aggregator Bridge")
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_cors_origins(),
        allow_origin_regex=_cors_origin_regex(),
        allow_credentials=True,
        allow_methods=["GET", "POST", "DELETE"],
        allow_headers=["Authorization", "Content-Type", "X-AURA-Signature", "X-AURA-Timestamp", "X-Sentinel-Token"],
    )
    app.add_middleware(HMACVerificationMiddleware)
    app.add_middleware(
        SentinelCodeHealerMiddleware,
        api_key=os.getenv("GEMINI_API_KEY", ""),
        enabled=os.getenv("AURA_SENTINEL_DIAGNOSTICS_ENABLED", "true").lower() in {"1", "true", "yes"},
    )

    app.include_router(auth.router)
    app.include_router(chat.router)
    app.include_router(p2p.router)
    app.include_router(sentinel.router)

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.on_event("startup")
    async def startup() -> None:
        assert_python_tree_read_only(Path(__file__).resolve().parents[1])
        await redis_runtime.connect()
        await _init_database_schemas()

    @app.on_event("shutdown")
    async def shutdown() -> None:
        await redis_runtime.close()
        await close_engine()

    return app


app = create_app()
