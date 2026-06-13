from __future__ import annotations

import json
import hashlib
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.enterprise import database
from app.models.chat import Base, Message, Session, User


SessionLocal = async_sessionmaker(database.engine, expire_on_commit=False, class_=AsyncSession)


def refresh_session_factory() -> None:
    global SessionLocal
    SessionLocal = async_sessionmaker(database.engine, expire_on_commit=False, class_=AsyncSession)


def _canonical_session_id(user_id: str, session_id: str) -> str:
    if "_" in session_id and len(session_id.rsplit("_", 1)[-1]) == 36:
        return session_id
    digest = hashlib.sha256(user_id.encode("utf-8")).hexdigest()[:16]
    return f"legacy-{digest}:{session_id}"[:128]


async def init_normalized_schema() -> None:
    async with database.engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def upsert_user(session: AsyncSession, *, user_id: str, name: str | None = None, email: str | None = None) -> User:
    user = await session.get(User, user_id)
    if user is None:
        user = User(id=user_id, name=name, email=email)
        session.add(user)
    else:
        user.name = name or user.name
        user.email = email or user.email
    return user


async def append_message(
    *,
    user_id: str,
    session_id: str,
    role: str,
    content: str,
    provider: str | None = None,
    token_count: int = 0,
) -> None:
    await init_normalized_schema()
    canonical_session_id = _canonical_session_id(user_id, session_id)
    async def _work(_: int) -> None:
        async with SessionLocal() as db:
            async with db.begin():
                await upsert_user(db, user_id=user_id)
                chat_session = await db.get(Session, canonical_session_id)
                if chat_session is None:
                    chat_session = Session(id=canonical_session_id, user_id=user_id, title=content[:120] or "Session")
                    db.add(chat_session)
                chat_session.updated_at = datetime.now(timezone.utc)
                db.add(Message(session_id=canonical_session_id, role=role, content=content, provider=provider, token_count=token_count))

    await database.retry_database_operation(_work)


async def list_sessions(user_id: str) -> list[dict[str, Any]]:
    await init_normalized_schema()
    async with SessionLocal() as db:
        rows = await db.execute(select(Session).where(Session.user_id == user_id).order_by(Session.updated_at.desc()))
        return [
            {
                "session_id": item.id,
                "title": item.title,
                "ts": item.updated_at.isoformat() if item.updated_at else None,
            }
            for item in rows.scalars().all()
        ]


def parse_legacy_cards(cards_data: str) -> list[dict[str, Any]]:
    try:
        cards = json.loads(cards_data or "[]")
    except json.JSONDecodeError:
        return []
    return cards if isinstance(cards, list) else []
