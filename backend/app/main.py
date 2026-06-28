from __future__ import annotations

import logging
import os
import sys
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.enterprise.tracing import configure_tracing

logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    stream=sys.stdout,
    force=True,
)
logger = logging.getLogger("aura.startup")

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
from app.services.provider_adapters import env_key_pool


db_connected = False
redis_connected = False
keypool_initialized = False


def _cors_origins() -> list[str]:
    raw = os.getenv(
        "AURA_ALLOWED_ORIGINS",
        "http://localhost:3000,http://127.0.0.1:3000,https://aura-protocol.onrender.com,https://aura-protocol.vercel.app",
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


def _require_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"Required environment variable is not set: {name}")
    return value


def _provider_key_count(*names: str) -> int:
    return sum(len(env_key_pool(name)) for name in names)


def _validate_key_pools() -> None:
    required_pools = {
        "OPENROUTER_API_KEY": ("OPENROUTER_API_KEY", "OPENROUTER_DEFAULT_KEY"),
        "GOOGLE_API_KEY": ("GOOGLE_API_KEY", "GEMINI_API_KEY"),
        "MISTRAL_API_KEY": ("MISTRAL_API_KEY",),
        "GROQ_API_KEY": ("GROQ_API_KEY",),
    }
    missing: list[str] = []
    for display_name, env_names in required_pools.items():
        count = _provider_key_count(*env_names)
        logger.debug("Key pool validated: %s aliases=%s count=%s", display_name, ",".join(env_names), count)
        if count == 0:
            missing.append(display_name)
    if missing:
        joined = ", ".join(missing)
        raise RuntimeError(f"Required API key pools are empty: {joined}")


async def _test_database_connection() -> None:
    global db_connected

    db_connected = False
    _require_env("DATABASE_URL")
    logger.debug("Testing database connection with configured DATABASE_URL")
    async with database.engine.connect() as conn:
        await conn.execute(text("SELECT 1"))
    db_connected = True
    logger.info("Database connection test succeeded")


async def _test_redis_connection() -> None:
    global redis_connected

    redis_connected = False
    _require_env("UPSTASH_REDIS_URL")
    logger.debug("Testing Upstash Redis connection")
    await redis_runtime.connect()
    if redis_runtime.client is None:
        raise RuntimeError("Redis client was not initialized after connect()")
    await redis_runtime.client.ping()
    redis_connected = True
    logger.info("Redis connection test succeeded")


def _initialize_key_pools() -> None:
    global keypool_initialized

    keypool_initialized = False
    _require_env("JWT_SECRET")
    logger.debug("Validating JWT_SECRET and provider API key pools")
    _validate_key_pools()
    keypool_initialized = True
    logger.info("KeyPool validation succeeded")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    logger.info("AURA startup begin")
    try:
        logger.debug("Checking runtime source permissions")
        assert_python_tree_read_only(Path(__file__).resolve().parents[1])

        try:
            await _test_database_connection()
        except Exception:
            logger.exception("Database startup check failed")
            raise

        try:
            await _test_redis_connection()
        except Exception:
            logger.exception("Redis startup check failed")
            raise

        try:
            _initialize_key_pools()
        except Exception:
            logger.exception("KeyPool startup check failed")
            raise

        try:
            logger.debug("Initializing database schemas")
            await _init_database_schemas()
            logger.info("Database schema initialization succeeded")
        except Exception:
            logger.exception("Database schema initialization failed")
            raise

        logger.info("AURA startup complete")
        yield
    except Exception:
        logger.exception("AURA startup failed; shutting down gracefully")
        try:
            await redis_runtime.close()
        except Exception:
            logger.exception("Redis cleanup failed after startup error")
        try:
            await close_engine()
        except Exception:
            logger.exception("Database cleanup failed after startup error")
        raise
    finally:
        logger.info("AURA shutdown begin")
        try:
            await redis_runtime.close()
            logger.debug("Redis shutdown complete")
        except Exception:
            logger.exception("Redis shutdown failed")
        try:
            await close_engine()
            logger.debug("Database shutdown complete")
        except Exception:
            logger.exception("Database shutdown failed")
        logger.info("AURA shutdown complete")


def create_app() -> FastAPI:
    configure_tracing("aura-api-gateway")
    logger.debug("Creating FastAPI application")
    app = FastAPI(title="AURA Decentralized Aggregator Bridge", lifespan=lifespan)
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
    async def health() -> dict[str, object]:
        return {"status": "ok", "timestamp": datetime.utcnow()}

    @app.get("/api/v1/debug/status")
    async def debug_status() -> dict[str, object]:
        return {
            "database": "✅" if db_connected else "❌",
            "redis": "✅" if redis_connected else "❌",
            "keys_loaded": "✅" if keypool_initialized else "❌",
            "timestamp": datetime.utcnow(),
        }

    return app


try:
    app = create_app()
except Exception:
    logger.exception("FastAPI application creation failed")
    raise
