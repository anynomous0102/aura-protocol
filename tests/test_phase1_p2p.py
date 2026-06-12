from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

import pytest

from app.network.libp2p_host import (
    ComputeBid,
    ComputeTask,
    TOPIC_COMPUTE_TASKS,
    build_compute_task,
    create_libp2p_host,
    reset_local_network_for_tests,
    select_winning_bid,
)


@pytest.mark.asyncio
async def test_peer_discovery_via_routing(tmp_path, monkeypatch):
    monkeypatch.setenv("AURA_NODE_KEY_DIR", str(tmp_path))
    reset_local_network_for_tests()
    host1 = create_libp2p_host(9000, [])
    host2 = create_libp2p_host(9001, [])
    host3 = create_libp2p_host(9002, [])
    await asyncio.gather(host1.start(), host2.start(), host3.start())
    await host2.connect(host1.get_addrs()[0])
    await host3.connect(host2.get_addrs()[0])

    peer = await asyncio.wait_for(host3.dht.find_peer(host1.get_id()), timeout=10)
    assert peer is not None
    assert host1.get_addrs()[0] in peer.multiaddrs


@pytest.mark.asyncio
async def test_gossipsub_propagation(tmp_path, monkeypatch):
    monkeypatch.setenv("AURA_NODE_KEY_DIR", str(tmp_path))
    reset_local_network_for_tests()
    host1 = create_libp2p_host(9000, [])
    host2 = create_libp2p_host(9001, [])
    host3 = create_libp2p_host(9002, [])
    await asyncio.gather(host1.start(), host2.start(), host3.start())
    await host2.connect(host1.get_addrs()[0])
    await host3.connect(host2.get_addrs()[0])
    queue = await host3.pubsub.subscribe(TOPIC_COMPUTE_TASKS)
    task = build_compute_task(
        host1,
        "task-1",
        "hello",
        "compute/cpu",
        100,
        datetime.now(timezone.utc) + timedelta(minutes=1),
    )
    await host1.pubsub.publish(TOPIC_COMPUTE_TASKS, task.model_dump_json().encode("utf-8"))
    received = ComputeTask.model_validate_json(await asyncio.wait_for(queue.get(), timeout=5))
    assert received.task_id == "task-1"


@pytest.mark.asyncio
async def test_peer_id_stability(tmp_path, monkeypatch):
    monkeypatch.setenv("AURA_NODE_KEY_DIR", str(tmp_path))
    reset_local_network_for_tests()
    original = create_libp2p_host(9000, [])
    original_peer_id = original.get_id()
    reloaded = create_libp2p_host(9000, [])
    assert reloaded.get_id() == original_peer_id


@pytest.mark.asyncio
async def test_signature_validation_drops_forged_messages(tmp_path, monkeypatch):
    monkeypatch.setenv("AURA_NODE_KEY_DIR", str(tmp_path))
    reset_local_network_for_tests()
    host1 = create_libp2p_host(9000, [])
    host3 = create_libp2p_host(9002, [])
    await asyncio.gather(host1.start(), host3.start())
    await host3.connect(host1.get_addrs()[0])
    queue = await host3.pubsub.subscribe(TOPIC_COMPUTE_TASKS)
    task = build_compute_task(
        host1,
        "task-bad",
        "hello",
        "compute/cpu",
        100,
        datetime.now(timezone.utc) + timedelta(minutes=1),
    ).model_copy(update={"requester_signature": "corrupted"})
    await host1.pubsub.publish(TOPIC_COMPUTE_TASKS, task.model_dump_json().encode("utf-8"))
    with pytest.raises(asyncio.TimeoutError):
        await asyncio.wait_for(queue.get(), timeout=0.2)


def test_vickrey_auction():
    bids = [
        ComputeBid(
            task_id="task",
            bid_tokens=value,
            bidder_peer_id=f"peer-{value}",
            hardware_spec={},
            reputation_score=0.5,
            bidder_signature="sig",
        )
        for value in [100, 80, 60, 90, 70]
    ]
    winner, price_paid = select_winning_bid(bids)
    assert winner.bid_tokens == 60
    assert price_paid == 70

