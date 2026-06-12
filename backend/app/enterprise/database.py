from __future__ import annotations

import os
import secrets
import time
import uuid
from asyncio import sleep as asyncio_sleep
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator, Awaitable, Callable, Dict, Iterable, List, Mapping, Optional, TypeVar

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine, create_async_engine
from sqlalchemy.exc import DBAPIError, OperationalError


T = TypeVar("T")


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
REGION_ID_PREFIX = os.getenv("AURA_REGION_ID_PREFIX", REGION).lower().replace("_", "-")[:16]


def regional_uuidv7(prefix: str | None = None) -> str:
    region = (prefix or REGION_ID_PREFIX or "global").lower().replace("_", "-")[:16]
    timestamp_ms = int(time.time() * 1000)
    value = (timestamp_ms & ((1 << 48) - 1)) << 80
    value |= 0x7 << 76
    value |= secrets.randbits(12) << 64
    value |= 0b10 << 62
    value |= secrets.randbits(62)
    uuid_text = str(uuid.UUID(int=value))
    return f"{region}_{uuid_text}"


def _connect_args() -> dict[str, Any]:
    if not IS_POSTGRES:
        return {}
    settings = {
        "server_settings": {
            "application_name": f"aura-{REGION}",
            "timezone": "UTC",
        }
    }
    options = os.getenv("DB_SESSION_OPTIONS", "").strip()
    if options:
        settings["server_settings"]["options"] = options
    return settings


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


def _is_retryable_transaction_error(exc: BaseException) -> bool:
    if not IS_COCKROACH:
        return False
    if isinstance(exc, (OperationalError, DBAPIError)):
        code = getattr(getattr(exc, "orig", None), "sqlstate", "") or getattr(getattr(exc, "orig", None), "pgcode", "")
        text_value = str(exc).lower()
        return code == "40001" or "restart transaction" in text_value or "serialization failure" in text_value
    return False


async def run_transaction(work: Callable[[AsyncConnection], Awaitable[T]]) -> T:
    async def _run(_: int) -> T:
        async with engine.begin() as conn:
            return await work(conn)

    return await retry_database_operation(_run)


async def retry_database_operation(work: Callable[[int], Awaitable[T]]) -> T:
    max_retries = int(os.getenv("DB_TRANSACTION_RETRIES", "5" if IS_COCKROACH else "1"))
    last_error: BaseException | None = None
    for attempt in range(max_retries):
        try:
            return await work(attempt)
        except BaseException as exc:
            if not _is_retryable_transaction_error(exc) or attempt == max_retries - 1:
                raise
            last_error = exc
            await asyncio_sleep(min(0.05 * (2 ** attempt), 1.0) + secrets.randbelow(25) / 1000)
    raise RuntimeError("Database transaction retries exhausted.") from last_error


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
