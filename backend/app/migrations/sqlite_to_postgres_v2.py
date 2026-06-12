from __future__ import annotations

import argparse
import asyncio
import json
import sqlite3
from pathlib import Path

from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

from app.models.chat import Base, Message, Session, User


async def migrate(sqlite_path: Path, postgres_url: str) -> None:
    engine = create_async_engine(postgres_url)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    source = sqlite3.connect(sqlite_path)
    source.row_factory = sqlite3.Row
    users = source.execute("SELECT id, name, email, photo, cards_data, wallet_balance, is_premium FROM users").fetchall()

    async with session_factory() as db:
        async with db.begin():
            for row in users:
                user_id = row["id"]
                db.merge(
                    User(
                        id=user_id,
                        name=row["name"],
                        email=row["email"],
                        photo=row["photo"],
                        wallet_balance=int(float(row["wallet_balance"] or 1000)),
                        is_premium=bool(row["is_premium"]),
                    )
                )
                try:
                    cards = json.loads(row["cards_data"] or "[]")
                except json.JSONDecodeError:
                    cards = []
                if not isinstance(cards, list):
                    cards = []
                for card_index, card in enumerate(cards):
                    session_id = f"{user_id}:legacy:{card_index}"
                    db.merge(Session(id=session_id, user_id=user_id, title=str(card.get("name") or "Legacy Session")[:255]))
                    for message in card.get("messages", []) if isinstance(card, dict) else []:
                        if not isinstance(message, dict):
                            continue
                        db.add(
                            Message(
                                session_id=session_id,
                                role=str(message.get("role", "model"))[:32],
                                content=str(message.get("text") or message.get("content") or ""),
                                provider=str(card.get("provider") or card.get("name") or "legacy")[:128],
                                token_count=0,
                            )
                        )

    source.close()
    await engine.dispose()


def main() -> None:
    parser = argparse.ArgumentParser(description="Migrate legacy AURA SQLite cards_data into normalized Postgres tables.")
    parser.add_argument("--sqlite-path", required=True)
    parser.add_argument("--postgres-url", required=True)
    args = parser.parse_args()
    asyncio.run(migrate(Path(args.sqlite_path), args.postgres_url))


if __name__ == "__main__":
    main()
