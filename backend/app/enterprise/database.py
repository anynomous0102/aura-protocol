from __future__ import annotations

import os
import secrets
import time
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator, Dict, Iterable, List, Mapping, Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine, create_async_engine


def _database_url() -> str:
    raw = os.getenv("COCKROACH_DATABASE_URL", "").strip() or os.getenv("DATABASE_URL", "").strip()
    if raw.startswith("postgres://"):
        raw = "postgresql+asyncpg://" + raw.removeprefix("postgres://")
    if raw.startswith("postgresql://"):
        raw = "postgresql+asyncpg://" + raw.removeprefix("postgresql://")
    if raw:
        return raw
    data_dir = os.getenv("AURA_DATA_DIR", os.path.dirname(os.path.dirname(os.path.dirname(__file__))))
    os.makedirs(data_dir, exist_ok=True)
    return f"sqlite+aiosqlite:///{os.path.join(data_dir, 'aura_network.db')}"


DATABASE_URL = _database_url()
IS_POSTGRES = DATABASE_URL.startswith("postgresql+asyncpg://")
IS_COCKROACH = os.getenv("DATABASE_ENGINE", "").lower() == "cockroach" or bool(os.getenv("COCKROACH_DATABASE_URL", "").strip())
REGION = os.getenv("AURA_REGION", "global").lower().replace("_", "-")[:16]


def regional_uuidv7(prefix: str | None = None) -> str:
    region = (prefix or REGION or "global").lower().replace("_", "-")[:16]
    timestamp_ms = int(time.time() * 1000)
    random_bits = secrets.randbits(74)
    value = (timestamp_ms << 80) | (0x7 << 76) | random_bits
    encoded = f"{value:032x}"
    uuid_text = f"{encoded[:8]}-{encoded[8:12]}-{encoded[12:16]}-{encoded[16:20]}-{encoded[20:]}"
    return f"{region}_{uuid_text}"


def _connect_args() -> dict[str, Any]:
    if not IS_POSTGRES:
        return {}
    return {
        "server_settings": {
            "application_name": f"aura-{REGION}",
            "timezone": "UTC",
        }
    }


def _engine_kwargs() -> dict[str, Any]:
    kwargs: dict[str, Any] = {
        "pool_pre_ping": True,
        "pool_recycle": int(os.getenv("DB_POOL_RECYCLE_SECONDS", "1800")),
        "connect_args": _connect_args(),
    }
    if IS_POSTGRES:
        kwargs.update(
            {
                "pool_size": int(os.getenv("DB_POOL_SIZE", "10")),
                "max_overflow": int(os.getenv("DB_MAX_OVERFLOW", "20")),
                "isolation_level": os.getenv("DB_ISOLATION_LEVEL", "SERIALIZABLE" if IS_COCKROACH else "READ COMMITTED"),
            }
        )
    return kwargs


engine: AsyncEngine = create_async_engine(DATABASE_URL, **_engine_kwargs())


@asynccontextmanager
async def db_connection() -> AsyncIterator[AsyncConnection]:
    async with engine.begin() as conn:
        yield conn


async def execute(statement: str, params: Optional[Mapping[str, Any]] = None) -> None:
    async with db_connection() as conn:
        await conn.execute(text(statement), dict(params or {}))


async def fetch_one(statement: str, params: Optional[Mapping[str, Any]] = None) -> Optional[Dict[str, Any]]:
    async with db_connection() as conn:
        result = await conn.execute(text(statement), dict(params or {}))
        row = result.mappings().first()
        return dict(row) if row else None


async def fetch_all(statement: str, params: Optional[Mapping[str, Any]] = None) -> List[Dict[str, Any]]:
    async with db_connection() as conn:
        result = await conn.execute(text(statement), dict(params or {}))
        return [dict(row) for row in result.mappings().all()]


async def execute_many(statement: str, params: Iterable[Mapping[str, Any]]) -> None:
    async with db_connection() as conn:
        await conn.execute(text(statement), [dict(item) for item in params])


async def init_enterprise_schema() -> None:
    row_id_pk = "TEXT PRIMARY KEY"
    async with db_connection() as conn:
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS nodes (
                id TEXT PRIMARY KEY,
                user_id TEXT,
                name TEXT,
                provider TEXT,
                address TEXT
            )
        """))
        await conn.execute(text(f"""
            CREATE TABLE IF NOT EXISTS chats (
                id {row_id_pk},
                user_id TEXT,
                session_id TEXT,
                node_id TEXT,
                role TEXT,
                content TEXT,
                created_at TEXT,
                metadata_hash TEXT
            )
        """))
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS oapin_ledger (
                tx_hash TEXT PRIMARY KEY,
                session_id TEXT,
                node TEXT,
                tokens INTEGER,
                verified BOOLEAN
            )
        """))
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS healing_memory (
                pipeline_id TEXT,
                target_endpoint TEXT,
                new_path TEXT,
                timestamp DOUBLE PRECISION
            )
        """))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_chats_user_session ON chats(user_id, session_id)"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_nodes_user_name ON nodes(user_id, name)"))


async def close_engine() -> None:
    await engine.dispose()
