from __future__ import annotations

import asyncio
import os
import time
from typing import Any, Dict

import psutil

from app.enterprise.redis_runtime import redis_runtime


async def snapshot_metrics() -> Dict[str, Any]:
    errors_5xx = await redis_runtime.get_int("aura:metrics:http_5xx")
    total = await redis_runtime.get_int("aura:metrics:http_total")
    return {
        "cpu_percent": psutil.cpu_percent(interval=None),
        "memory_percent": psutil.virtual_memory().percent,
        "http_total_5m": total,
        "http_5xx_5m": errors_5xx,
        "http_5xx_rate": (errors_5xx / total) if total else 0.0,
        "timestamp": time.time(),
    }


async def sentinel_watchdog_worker(interval_seconds: int | None = None) -> None:
    interval = interval_seconds or int(os.getenv("SENTINEL_INTERVAL_SECONDS", "15"))
    cpu_threshold = float(os.getenv("SENTINEL_CPU_THRESHOLD", "90"))
    memory_threshold = float(os.getenv("SENTINEL_MEMORY_THRESHOLD", "90"))
    error_threshold = float(os.getenv("SENTINEL_5XX_RATE_THRESHOLD", "0.05"))
    while True:
        metrics = await snapshot_metrics()
        unhealthy = (
            metrics["cpu_percent"] >= cpu_threshold
            or metrics["memory_percent"] >= memory_threshold
            or metrics["http_5xx_rate"] >= error_threshold
        )
        if redis_runtime.client is not None:
            await redis_runtime.client.hset("aura:sentinel:latest", mapping={k: str(v) for k, v in metrics.items()})
            await redis_runtime.client.set("aura:sentinel:status", "degraded" if unhealthy else "healthy", ex=interval * 4)
        await asyncio.sleep(interval)

