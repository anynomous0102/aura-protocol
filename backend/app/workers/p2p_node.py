from __future__ import annotations

import asyncio
import os

from app.enterprise.redis_runtime import redis_runtime
from app.enterprise.tracing import configure_tracing, start_worker_span
from network.libp2p_node import DEFAULT_BID_TOPIC, LibP2PHost, bootstrap_p2p_network, gossip_broadcast


async def run() -> None:
    configure_tracing("aura-p2p-node")
    await redis_runtime.connect()
    port = int(os.getenv("AURA_P2P_PORT", "9000"))
    bootstrap = [item.strip() for item in os.getenv("AURA_P2P_BOOTSTRAP", "").split(",") if item.strip()]
    host: LibP2PHost = await bootstrap_p2p_network(port=port, known_peers=bootstrap)
    if redis_runtime.client is None:
        await asyncio.Event().wait()
        return

    while True:
        envelope = await redis_runtime.blpop_json("aura:p2p:gossip")
        if envelope is None:
            continue
        topic = envelope.get("topic") or DEFAULT_BID_TOPIC
        payload = envelope.get("payload", {})
        with start_worker_span("worker.p2p.gossip", envelope.get("metadata")) as span:
            if span is not None:
                span.set_attribute("messaging.destination.name", "aura:p2p:gossip")
                span.set_attribute("aura.p2p.topic", topic)
            await gossip_broadcast(host, topic, payload)


def main() -> None:
    asyncio.run(run())


if __name__ == "__main__":
    main()
