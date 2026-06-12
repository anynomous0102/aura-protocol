from __future__ import annotations

import asyncio
import json
import os
import random
import time
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Any, AsyncIterator, Dict, Iterable, Optional

from fastapi import HTTPException

try:
    import redis.asyncio as redis
    from redis.exceptions import RedisError
except Exception:  # pragma: no cover
    redis = None  # type: ignore[assignment]

    class RedisError(Exception):
        pass


@dataclass(frozen=True)
class RedisEndpoint:
    url: str
    region: str


class RedisRuntime:
    def __init__(self) -> None:
        self.region = os.getenv("AURA_REGION", "global")
        self.endpoints = self._load_endpoints()
        self.client: Optional["redis.Redis"] = None
        self.active_endpoint: RedisEndpoint | None = None
        self._failure_count = 0
        self._local_locks: Dict[str, asyncio.Semaphore] = {}
        self._connect_lock = asyncio.Lock()

    def _load_endpoints(self) -> list[RedisEndpoint]:
        raw_global = os.getenv("GLOBAL_REDIS_URLS", "").strip()
        if raw_global:
            endpoints: list[RedisEndpoint] = []
            for item in raw_global.split(","):
                value = item.strip()
                if not value:
                    continue
                if "|" in value:
                    region, url = value.split("|", 1)
                else:
                    region, url = "global", value
                endpoints.append(RedisEndpoint(url=url.strip(), region=region.strip() or "global"))
            if endpoints:
                return endpoints
        return [RedisEndpoint(url=os.getenv("REDIS_URL", "redis://localhost:6379/0"), region=self.region)]

    async def connect(self) -> None:
        if redis is None:
            return
        async with self._connect_lock:
            if self.client is not None:
                return
            last_error: BaseException | None = None
            attempts = int(os.getenv("REDIS_CONNECT_ATTEMPTS", "6"))
            for attempt in range(attempts):
                ordered = self._region_first(self.endpoints)
                endpoint = ordered[attempt % len(ordered)]
                try:
                    candidate = redis.from_url(
                        endpoint.url,
                        encoding="utf-8",
                        decode_responses=True,
                        socket_connect_timeout=float(os.getenv("REDIS_CONNECT_TIMEOUT_SECONDS", "3")),
                        socket_timeout=float(os.getenv("REDIS_SOCKET_TIMEOUT_SECONDS", "5")),
                        health_check_interval=int(os.getenv("REDIS_HEALTH_CHECK_SECONDS", "30")),
                    )
                    await candidate.ping()
                    self.client = candidate
                    self.active_endpoint = endpoint
                    self._failure_count = 0
                    return
                except BaseException as exc:
                    last_error = exc
                    await asyncio.sleep(self._backoff(attempt))
            raise RuntimeError(f"Unable to connect to any Redis endpoint: {last_error}") from last_error

    def _region_first(self, endpoints: Iterable[RedisEndpoint]) -> list[RedisEndpoint]:
        values = list(endpoints)
        return sorted(values, key=lambda endpoint: 0 if endpoint.region == self.region else 1)

    async def ensure_connected(self) -> None:
        if self.client is None:
            await self.connect()
            return
        try:
            await self.client.ping()
        except RedisError:
            await self.close()
            await self.connect()

    def _backoff(self, attempt: int) -> float:
        base = float(os.getenv("REDIS_RECONNECT_BACKOFF_SECONDS", "0.25"))
        cap = float(os.getenv("REDIS_RECONNECT_BACKOFF_MAX_SECONDS", "8"))
        return min(base * (2 ** min(attempt, 8)), cap) + random.uniform(0, base)

    async def _execute(self, operation: str, *args: Any, retries: int | None = None, **kwargs: Any) -> Any:
        if redis is None:
            return None
        max_retries = retries if retries is not None else int(os.getenv("REDIS_OPERATION_RETRIES", "3"))
        last_error: BaseException | None = None
        for attempt in range(max_retries + 1):
            await self.ensure_connected()
            if self.client is None:
                return None
            try:
                return await getattr(self.client, operation)(*args, **kwargs)
            except RedisError as exc:
                last_error = exc
                self._failure_count += 1
                await self.close()
                await asyncio.sleep(self._backoff(attempt))
        raise RuntimeError(f"Redis operation failed after reconnect attempts: {operation}") from last_error

    async def close(self) -> None:
        if self.client is not None:
            await self.client.aclose()
            self.client = None
            self.active_endpoint = None

    async def rpush_json(self, queue: str, payload: dict[str, Any]) -> None:
        envelope = dict(payload)
        metadata = dict(envelope.get("metadata") or {})
        metadata.setdefault("origin_region", self.region)
        metadata.setdefault("redis_endpoint_region", self.active_endpoint.region if self.active_endpoint else self.region)
        metadata.setdefault("queued_at_ms", int(time.time() * 1000))
        envelope["metadata"] = metadata
        await self._execute("rpush", queue, json.dumps(envelope, separators=(",", ":")))
        await self._execute("set", f"aura:sync:{queue}:{self.region}", metadata["queued_at_ms"], ex=int(os.getenv("REDIS_SYNC_WATERMARK_TTL_SECONDS", "900")))

    async def blpop_json(self, queue: str, timeout: int = 30) -> dict[str, Any] | None:
        await self.ensure_connected()
        if self.client is None:
            return None
        try:
            item = await self._execute("blpop", queue, timeout=timeout, retries=1)
        except RedisError:
            await self.close()
            await asyncio.sleep(self._backoff(0))
            return None
        except RuntimeError:
            return None
        if item is None:
            return None
        _, raw = item
        return json.loads(raw)

    async def incr_metric(self, name: str, amount: int = 1, expire_seconds: int = 300) -> None:
        await self.ensure_connected()
        if self.client is None:
            return
        key = f"aura:metrics:{self.region}:{name}"
        try:
            pipe = self.client.pipeline()
            pipe.incrby(key, amount)
            pipe.expire(key, expire_seconds)
            await pipe.execute()
        except RedisError:
            await self.close()
            await self._execute("incrby", key, amount)
            await self._execute("expire", key, expire_seconds)

    async def get_int(self, key: str) -> int:
        await self.ensure_connected()
        if self.client is None:
            return 0
        value = await self._execute("get", key)
        return int(value or 0)

    async def rate_limit(self, subject: str, max_calls: int, window_seconds: int) -> None:
        await self.ensure_connected()
        if self.client is None:
            return
        bucket = int(time.time() // window_seconds)
        key = f"aura:ratelimit:{subject}:{bucket}"
        count = await self._execute("incr", key)
        if count == 1:
            await self._execute("expire", key, window_seconds + int(os.getenv("REDIS_CRDT_GRACE_SECONDS", "10")))
        if count > max_calls:
            raise HTTPException(status_code=429, detail="Rate limit exceeded")

    @asynccontextmanager
    async def distributed_gate(self, name: str, limit: int, ttl_seconds: int = 45) -> AsyncIterator[None]:
        await self.ensure_connected()
        if self.client is None:
            semaphore = self._local_locks.setdefault(name, asyncio.Semaphore(limit))
            async with semaphore:
                yield
            return

        token = str(uuid.uuid4())
        key = f"aura:lock:{name}"
        acquired = False
        attempts = int(os.getenv("REDIS_GATE_ATTEMPTS", "100"))
        for attempt in range(attempts):
            try:
                count = await self._execute("incr", key)
                if count == 1:
                    await self._execute("expire", key, ttl_seconds)
                if count <= limit:
                    acquired = True
                    break
                await self._execute("decr", key)
            except (RedisError, RuntimeError):
                await self.close()
                await self.ensure_connected()
            await asyncio.sleep(min(0.025 * (2 ** min(attempt, 6)), 1.0) + random.uniform(0, 0.025))
        if not acquired:
            raise HTTPException(status_code=503, detail=f"Provider gate saturated: {name}")
        try:
            await self._execute("set", f"{key}:holder:{token}", self.region, ex=ttl_seconds)
            yield
        finally:
            try:
                await self._execute("delete", f"{key}:holder:{token}", retries=1)
                await self._execute("decr", key, retries=1)
            except (RedisError, RuntimeError):
                await self.close()


redis_runtime = RedisRuntime()


async def distributed_rate_limit(user_id: str, max_calls: int, window_seconds: int) -> None:
    await redis_runtime.rate_limit(user_id, max_calls=max_calls, window_seconds=window_seconds)


@asynccontextmanager
async def provider_gate(provider: str, limit: int) -> AsyncIterator[None]:
    async with redis_runtime.distributed_gate(f"provider:{provider}", limit=limit):
        yield
