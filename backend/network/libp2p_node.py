from __future__ import annotations

import json
from typing import Any, Dict, List

from app.network.libp2p_host import (
    ComputeBid,
    ComputeTask,
    Host,
    LibP2PHost,
    TOPIC_BIDDING,
    TOPIC_COMPUTE_TASKS,
    TOPIC_HEARTBEAT,
    anp_bidding_worker as _anp_bidding_worker,
    bootstrap_p2p_network,
    build_compute_task,
    create_libp2p_host,
    reset_local_network_for_tests,
    select_winning_bid,
    sign_compute_bid,
    sign_compute_task,
    verify_compute_bid_signature,
    verify_compute_task_signature,
)

DEFAULT_BID_TOPIC = TOPIC_COMPUTE_TASKS


async def gossip_broadcast(host: Host, topic: str, payload: Dict[str, Any]) -> None:
    await host.pubsub.publish(topic, json.dumps(payload, sort_keys=True).encode("utf-8"))


async def anp_bidding_worker(host: Host, topic: str = DEFAULT_BID_TOPIC) -> None:
    await _anp_bidding_worker(host, node_capabilities=["research", "llm-routing", "compute/cpu"])


__all__ = [
    "ComputeBid",
    "ComputeTask",
    "DEFAULT_BID_TOPIC",
    "Host",
    "LibP2PHost",
    "TOPIC_BIDDING",
    "TOPIC_COMPUTE_TASKS",
    "TOPIC_HEARTBEAT",
    "anp_bidding_worker",
    "bootstrap_p2p_network",
    "build_compute_task",
    "create_libp2p_host",
    "gossip_broadcast",
    "reset_local_network_for_tests",
    "select_winning_bid",
    "sign_compute_bid",
    "sign_compute_task",
    "verify_compute_bid_signature",
    "verify_compute_task_signature",
]

