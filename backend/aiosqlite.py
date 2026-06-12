from __future__ import annotations

import asyncio
import sqlite3
from types import TracebackType
from typing import Any, Iterable, Optional, Type


class Cursor:
    def __init__(self, cursor: sqlite3.Cursor) -> None:
        self._cursor = cursor

    async def __aenter__(self) -> "Cursor":
        return self

    async def __aexit__(
        self,
        exc_type: Optional[Type[BaseException]],
        exc: Optional[BaseException],
        tb: Optional[TracebackType],
    ) -> None:
        self._cursor.close()

    def __aiter__(self) -> "Cursor":
        return self

    async def __anext__(self) -> Any:
        row = await asyncio.to_thread(self._cursor.fetchone)
        if row is None:
            raise StopAsyncIteration
        return row


class ExecuteContext:
    def __init__(self, conn: sqlite3.Connection, sql: str, params: Iterable[Any]) -> None:
        self._conn = conn
        self._sql = sql
        self._params = tuple(params)
        self._cursor: Optional[Cursor] = None

    def __await__(self) -> Any:
        async def _run() -> Cursor:
            return Cursor(await asyncio.to_thread(self._conn.execute, self._sql, self._params))

        return _run().__await__()

    async def __aenter__(self) -> Cursor:
        self._cursor = await self
        return self._cursor

    async def __aexit__(
        self,
        exc_type: Optional[Type[BaseException]],
        exc: Optional[BaseException],
        tb: Optional[TracebackType],
    ) -> None:
        if self._cursor is not None:
            await self._cursor.__aexit__(exc_type, exc, tb)


class Connection:
    def __init__(self, path: str) -> None:
        self._conn = sqlite3.connect(path, check_same_thread=False)

    async def __aenter__(self) -> "Connection":
        return self

    async def __aexit__(
        self,
        exc_type: Optional[Type[BaseException]],
        exc: Optional[BaseException],
        tb: Optional[TracebackType],
    ) -> None:
        await asyncio.to_thread(self._conn.close)

    def execute(self, sql: str, params: Iterable[Any] = ()) -> ExecuteContext:
        return ExecuteContext(self._conn, sql, params)

    async def commit(self) -> None:
        await asyncio.to_thread(self._conn.commit)


def connect(path: str) -> Connection:
    return Connection(path)

