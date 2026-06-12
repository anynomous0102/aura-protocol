from __future__ import annotations

import asyncio
import os

from app.enterprise.code_healer import SentinelCodeHealer, SentinelPatchRequest, init_sentinel_schema
from app.enterprise.database import close_engine
from app.enterprise.redis_runtime import redis_runtime
from app.enterprise.tracing import configure_tracing, start_worker_span


async def run() -> None:
    configure_tracing("aura-sentinel-core")
    await init_sentinel_schema()
    await redis_runtime.connect()
    healer = SentinelCodeHealer(api_key=os.getenv("GEMINI_API_KEY", ""))
    if redis_runtime.client is None:
        await asyncio.Event().wait()
        return

    while True:
        envelope = await redis_runtime.blpop_json("aura:sentinel:patches")
        if envelope is None:
            continue
        with start_worker_span("worker.sentinel.stage_patch", envelope.get("metadata")) as span:
            request = SentinelPatchRequest.model_validate(envelope.get("payload", envelope))
            if span is not None:
                span.set_attribute("messaging.destination.name", "aura:sentinel:patches")
                span.set_attribute("aura.sentinel.relative_path", request.relative_path)
                if request.diagnostic_id is not None:
                    span.set_attribute("aura.sentinel.diagnostic_id", request.diagnostic_id)
            await healer.stage_patch(request)


def main() -> None:
    try:
        asyncio.run(run())
    finally:
        asyncio.run(close_engine())


if __name__ == "__main__":
    main()
