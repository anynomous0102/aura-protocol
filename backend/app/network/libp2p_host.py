from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import os
import re
import sqlite3
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Awaitable, Callable, ClassVar, Dict, List, Optional, Sequence, Set, Tuple

import structlog
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from pydantic import BaseModel, Field, ValidationError

try:
    import msgpack  # type: ignore[import-untyped]
except Exception:  # pragma: no cover - msgpack is optional at runtime.
    msgpack = None


log = structlog.get_logger(__name__)

TOPIC_COMPUTE_TASKS = "/aura/compute/1.0.0"
TOPIC_BIDDING = "/aura/bidding/1.0.0"
TOPIC_HEARTBEAT = "/aura/heartbeat/1.0.0"

_MULTIADDR_RE = re.compile(r"^/ip4/[^/]+/tcp/\d+/p2p/[A-Za-z0-9_\-=+/]+$")
_LOCAL_HOSTS_BY_PEER_ID: Dict[str, "LibP2PHost"] = {}
_LOCAL_HOSTS_BY_PORT: Dict[int, "LibP2PHost"] = {}
_DIRECT_LINKS: Dict[str, Set[str]] = {}
_TOPIC_QUEUES: Dict[str, Dict[str, List[asyncio.Queue[bytes]]]] = {}
_DHT_PROVIDERS: Dict[str, Dict[str, bytes]] = {}


class NodeCapability(BaseModel):
    model_ids: List[str]
    vram_gb: float = Field(ge=0.0)
    tflops: float = Field(ge=0.0)
    load_pct: float = Field(ge=0.0, le=1.0)
    reputation_score: float = Field(ge=0.0, le=1.0)
    stake_amount: int = Field(ge=0)


class ComputeTask(BaseModel):
    task_id: str
    query_hash: str
    required_capability: str
    max_bid_tokens: int = Field(ge=1)
    deadline_utc: datetime
    requester_peer_id: str
    requester_signature: str


class ComputeBid(BaseModel):
    task_id: str
    bid_tokens: int = Field(ge=0)
    bidder_peer_id: str
    hardware_spec: Dict[str, Any]
    reputation_score: float = Field(ge=0.0, le=1.0)
    bidder_signature: str


class PeerInfo(BaseModel):
    peer_id: str
    multiaddrs: List[str]


def _urlsafe_b64encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _urlsafe_b64decode(value: str) -> bytes:
    padded = value + ("=" * (-len(value) % 4))
    return base64.urlsafe_b64decode(padded.encode("ascii"))


def _task_signature_payload(task_id: str, query_hash: str) -> bytes:
    return f"{task_id}{query_hash}".encode("utf-8")


def _bid_signature_payload(task_id: str, bid_tokens: int) -> bytes:
    return f"{task_id}{bid_tokens}".encode("utf-8")


def _public_key_from_peer_id(peer_id: str) -> Ed25519PublicKey:
    return Ed25519PublicKey.from_public_bytes(_urlsafe_b64decode(peer_id))


def _peer_id_from_public_key(public_key: Ed25519PublicKey) -> str:
    return _urlsafe_b64encode(
        public_key.public_bytes(
            encoding=serialization.Encoding.Raw,
            format=serialization.PublicFormat.Raw,
        )
    )


def sign_compute_task(private_key: Ed25519PrivateKey, task_id: str, query_hash: str) -> str:
    return _urlsafe_b64encode(private_key.sign(_task_signature_payload(task_id, query_hash)))


def sign_compute_bid(private_key: Ed25519PrivateKey, task_id: str, bid_tokens: int) -> str:
    return _urlsafe_b64encode(private_key.sign(_bid_signature_payload(task_id, bid_tokens)))


def verify_compute_task_signature(task: ComputeTask) -> bool:
    try:
        _public_key_from_peer_id(task.requester_peer_id).verify(
            _urlsafe_b64decode(task.requester_signature),
            _task_signature_payload(task.task_id, task.query_hash),
        )
        return True
    except (InvalidSignature, ValueError, TypeError):
        log.warning("compute_task_signature_invalid", task_id=task.task_id)
        return False


def verify_compute_bid_signature(bid: ComputeBid) -> bool:
    try:
        _public_key_from_peer_id(bid.bidder_peer_id).verify(
            _urlsafe_b64decode(bid.bidder_signature),
            _bid_signature_payload(bid.task_id, bid.bid_tokens),
        )
        return True
    except (InvalidSignature, ValueError, TypeError):
        log.warning("compute_bid_signature_invalid", task_id=bid.task_id, bidder_peer_id=bid.bidder_peer_id)
        return False


def validate_multiaddr(multiaddr: str) -> str:
    if not _MULTIADDR_RE.match(multiaddr):
        raise ValueError(f"Invalid libp2p multiaddr: {multiaddr}")
    return multiaddr


def parse_peer_id(multiaddr: str) -> Optional[str]:
    parts = [part for part in multiaddr.split("/") if part]
    try:
        return parts[parts.index("p2p") + 1]
    except (ValueError, IndexError):
        return None


def parse_port(multiaddr: str) -> Optional[int]:
    parts = [part for part in multiaddr.split("/") if part]
    try:
        return int(parts[parts.index("tcp") + 1])
    except (ValueError, IndexError):
        return None


def _default_key_path(port: int) -> Path:
    explicit = os.getenv("AURA_NODE_KEY_PATH")
    if explicit:
        return Path(explicit).expanduser()
    key_dir = Path(os.getenv("AURA_NODE_KEY_DIR", str(Path.home() / ".aura"))).expanduser()
    key_dir.mkdir(parents=True, exist_ok=True)
    return key_dir / f"node_key_{port}.pem"


def load_or_create_node_key(port: int) -> Ed25519PrivateKey:
    key_path = _default_key_path(port)
    key_path.parent.mkdir(parents=True, exist_ok=True)
    if key_path.exists():
        return serialization.load_pem_private_key(
            key_path.read_bytes(),
            password=None,
        )

    private_key = Ed25519PrivateKey.generate()
    key_path.write_bytes(
        private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        )
    )
    try:
        os.chmod(key_path, 0o600)
    except OSError:
        log.debug("node_key_chmod_unavailable", path=str(key_path))
    return private_key


def _serialize_capability(capability: NodeCapability) -> bytes:
    payload = capability.model_dump(mode="json")
    if msgpack is not None:
        return msgpack.packb(payload, use_bin_type=True)
    return json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")


def capability_cid(capability: str) -> str:
    return hashlib.sha256(capability.encode("utf-8")).hexdigest()


def _reachable_peer_ids(start_peer_id: str) -> Set[str]:
    visited: Set[str] = set()
    pending: List[str] = [start_peer_id]
    while pending:
        peer_id = pending.pop(0)
        if peer_id in visited:
            continue
        visited.add(peer_id)
        pending.extend(sorted(_DIRECT_LINKS.get(peer_id, set()) - visited))
    return visited


def _validate_pubsub_message(topic: str, data: bytes) -> bool:
    try:
        raw = json.loads(data.decode("utf-8"))
        if topic == TOPIC_COMPUTE_TASKS:
            return verify_compute_task_signature(ComputeTask.model_validate(raw))
        if topic == TOPIC_BIDDING:
            return verify_compute_bid_signature(ComputeBid.model_validate(raw))
        return True
    except (json.JSONDecodeError, UnicodeDecodeError, ValidationError) as exc:
        log.warning("gossipsub_message_rejected", topic=topic, error=str(exc))
        return False


class InMemoryDHT:
    def __init__(self, host: "LibP2PHost") -> None:
        self._host = host

    async def provide(self, cid: str, payload: bytes = b"") -> None:
        _DHT_PROVIDERS.setdefault(cid, {})[self._host.peer_id] = payload
        log.info("dht_provider_announced", peer_id=self._host.peer_id, cid=cid)

    async def find_providers(self, cid: str) -> List[PeerInfo]:
        providers = _DHT_PROVIDERS.get(cid, {})
        reachable = _reachable_peer_ids(self._host.peer_id)
        result: List[PeerInfo] = []
        for peer_id in providers:
            if peer_id in reachable:
                addrs = _LOCAL_HOSTS_BY_PEER_ID.get(peer_id, self._host).get_addrs()
                result.append(PeerInfo(peer_id=peer_id, multiaddrs=addrs))
        return result

    async def find_peer(self, peer_id: str) -> Optional[PeerInfo]:
        if peer_id not in _reachable_peer_ids(self._host.peer_id):
            return None
        host = _LOCAL_HOSTS_BY_PEER_ID.get(peer_id)
        if host is None:
            return None
        return PeerInfo(peer_id=peer_id, multiaddrs=host.get_addrs())


class InMemoryGossipSub:
    def __init__(self, host: "LibP2PHost") -> None:
        self._host = host

    async def subscribe(self, topic: str) -> asyncio.Queue[bytes]:
        queue: asyncio.Queue[bytes] = asyncio.Queue()
        _TOPIC_QUEUES.setdefault(topic, {}).setdefault(self._host.peer_id, []).append(queue)
        return queue

    async def unsubscribe(self, topic: str, queue: asyncio.Queue[bytes]) -> None:
        peer_queues = _TOPIC_QUEUES.get(topic, {}).get(self._host.peer_id, [])
        if queue in peer_queues:
            peer_queues.remove(queue)
        if not peer_queues:
            _TOPIC_QUEUES.get(topic, {}).pop(self._host.peer_id, None)
        if not _TOPIC_QUEUES.get(topic):
            _TOPIC_QUEUES.pop(topic, None)

    async def publish(self, topic: str, data: bytes) -> None:
        if not _validate_pubsub_message(topic, data):
            return
        reachable = _reachable_peer_ids(self._host.peer_id)
        subscribers = _TOPIC_QUEUES.get(topic, {})
        for peer_id, queues in list(subscribers.items()):
            if peer_id not in reachable:
                continue
            for queue in queues:
                await queue.put(data)


@dataclass
class LibP2PHost:
    port: int
    private_key: Ed25519PrivateKey
    known_peers: List[str] = field(default_factory=list)
    transport_security: str = "noise"
    muxer: str = "yamux"
    autonat_enabled: bool = True
    circuit_relay_v2_enabled: bool = True

    def __post_init__(self) -> None:
        self.public_key = self.private_key.public_key()
        self.peer_id = _peer_id_from_public_key(self.public_key)
        self.node_id = f"aura-node-{self.port}"
        self.multiaddr = f"/ip4/127.0.0.1/tcp/{self.port}/p2p/{self.peer_id}"
        self.dht = InMemoryDHT(self)
        self.pubsub = InMemoryGossipSub(self)
        self.started = False

    async def start(self) -> None:
        self.started = True
        _LOCAL_HOSTS_BY_PEER_ID[self.peer_id] = self
        _LOCAL_HOSTS_BY_PORT[self.port] = self
        _DIRECT_LINKS.setdefault(self.peer_id, set())
        for peer in self.known_peers:
            await self.connect(peer)
        log.info(
            "libp2p_host_started",
            peer_id=self.peer_id,
            port=self.port,
            security=self.transport_security,
            muxer=self.muxer,
            autonat=self.autonat_enabled,
            relay_v2=self.circuit_relay_v2_enabled,
        )

    async def stop(self) -> None:
        self.started = False
        _LOCAL_HOSTS_BY_PEER_ID.pop(self.peer_id, None)
        _LOCAL_HOSTS_BY_PORT.pop(self.port, None)
        for links in _DIRECT_LINKS.values():
            links.discard(self.peer_id)
        _DIRECT_LINKS.pop(self.peer_id, None)
        for topic in list(_TOPIC_QUEUES):
            _TOPIC_QUEUES[topic].pop(self.peer_id, None)

    def get_id(self) -> str:
        return self.peer_id

    def get_addrs(self) -> List[str]:
        return [self.multiaddr]

    async def connect(self, multiaddr: str) -> None:
        validate_multiaddr(multiaddr)
        peer_id = parse_peer_id(multiaddr)
        port = parse_port(multiaddr)
        remote = _LOCAL_HOSTS_BY_PEER_ID.get(peer_id or "") or _LOCAL_HOSTS_BY_PORT.get(port or -1)
        if remote is None:
            self.known_peers.append(multiaddr)
            log.warning("bootstrap_peer_unavailable", peer=multiaddr)
            return
        _DIRECT_LINKS.setdefault(self.peer_id, set()).add(remote.peer_id)
        _DIRECT_LINKS.setdefault(remote.peer_id, set()).add(self.peer_id)
        log.info("libp2p_peer_connected", local_peer_id=self.peer_id, remote_peer_id=remote.peer_id)

    async def announce_capabilities(self, capabilities: Sequence[NodeCapability]) -> None:
        for capability in capabilities:
            for model_id in capability.model_ids:
                await self.dht.provide(capability_cid(model_id), _serialize_capability(capability))


Host = LibP2PHost


def create_libp2p_host(port: int, known_peers: List[str]) -> Host:
    validated_peers = [validate_multiaddr(peer) for peer in known_peers]
    return LibP2PHost(port=port, private_key=load_or_create_node_key(port), known_peers=validated_peers)


async def bootstrap_p2p_network(
    port: int,
    known_peers: List[str],
    capabilities: Optional[Sequence[NodeCapability]] = None,
) -> Host:
    host = create_libp2p_host(port, known_peers)
    await host.start()
    default_capabilities = capabilities or [
        NodeCapability(
            model_ids=["compute/cpu", "inference/mistral"],
            vram_gb=0.0,
            tflops=1.0,
            load_pct=0.1,
            reputation_score=0.9,
            stake_amount=0,
        )
    ]
    await host.announce_capabilities(default_capabilities)
    return host


def build_compute_task(
    host: Host,
    task_id: str,
    query: str,
    required_capability: str,
    max_bid_tokens: int,
    deadline_utc: datetime,
) -> ComputeTask:
    query_hash = hashlib.sha256(query.encode("utf-8")).hexdigest()
    return ComputeTask(
        task_id=task_id,
        query_hash=query_hash,
        required_capability=required_capability,
        max_bid_tokens=max_bid_tokens,
        deadline_utc=deadline_utc,
        requester_peer_id=host.get_id(),
        requester_signature=sign_compute_task(host.private_key, task_id, query_hash),
    )


def build_compute_bid(
    host: Host,
    task_id: str,
    bid_tokens: int,
    hardware_spec: Dict[str, Any],
    reputation_score: float,
) -> ComputeBid:
    return ComputeBid(
        task_id=task_id,
        bid_tokens=bid_tokens,
        bidder_peer_id=host.get_id(),
        hardware_spec=hardware_spec,
        reputation_score=reputation_score,
        bidder_signature=sign_compute_bid(host.private_key, task_id, bid_tokens),
    )


async def anp_bidding_worker(
    host: Host,
    node_capabilities: Sequence[str],
    bid_tokens: int = 1,
    reputation_db_path: Optional[str] = None,
) -> None:
    queue = await host.pubsub.subscribe(TOPIC_COMPUTE_TASKS)
    try:
        while host.started:
            data = await queue.get()
            try:
                task = ComputeTask.model_validate_json(data)
            except ValidationError as exc:
                log.warning("compute_task_deserialize_failed", error=str(exc))
                continue
            if not verify_compute_task_signature(task):
                continue
            if task.required_capability not in node_capabilities:
                continue
            reputation = get_reputation_score(reputation_db_path, host.get_id())
            bid = build_compute_bid(
                host=host,
                task_id=task.task_id,
                bid_tokens=min(bid_tokens, task.max_bid_tokens),
                hardware_spec={"capabilities": list(node_capabilities), "secure_channel": "noise/yamux"},
                reputation_score=reputation,
            )
            await host.pubsub.publish(TOPIC_BIDDING, bid.model_dump_json().encode("utf-8"))
    except asyncio.CancelledError:
        raise
    finally:
        await host.pubsub.unsubscribe(TOPIC_COMPUTE_TASKS, queue)


async def collect_bids_for_task(host: Host, task: ComputeTask, window_seconds: float = 5.0) -> List[ComputeBid]:
    queue = await host.pubsub.subscribe(TOPIC_BIDDING)
    await host.pubsub.publish(TOPIC_COMPUTE_TASKS, task.model_dump_json().encode("utf-8"))
    deadline = asyncio.get_running_loop().time() + window_seconds
    bids: List[ComputeBid] = []
    try:
        while True:
            timeout = deadline - asyncio.get_running_loop().time()
            if timeout <= 0:
                return bids
            try:
                data = await asyncio.wait_for(queue.get(), timeout=timeout)
                bid = ComputeBid.model_validate_json(data)
                if bid.task_id == task.task_id and verify_compute_bid_signature(bid):
                    bids.append(bid)
            except (asyncio.TimeoutError, ValidationError):
                return bids
    finally:
        await host.pubsub.unsubscribe(TOPIC_BIDDING, queue)


def select_winning_bid(bids: List[ComputeBid]) -> Tuple[ComputeBid, int]:
    if not bids:
        raise ValueError("At least one bid is required")
    ordered = sorted(bids, key=lambda bid: (bid.bid_tokens, -bid.reputation_score, bid.bidder_peer_id))
    winner = ordered[0]
    price_paid = ordered[1].bid_tokens if len(ordered) > 1 else winner.bid_tokens
    return winner, price_paid


def _reputation_db(db_path_override: Optional[str]) -> str:
    return db_path_override or os.getenv("AURA_REPUTATION_DB", "aura_network.db")


def ensure_reputation_schema(db_path_override: Optional[str] = None) -> None:
    with sqlite3.connect(_reputation_db(db_path_override)) as conn:
        conn.execute(
            "CREATE TABLE IF NOT EXISTS peer_reputation ("
            "peer_id TEXT PRIMARY KEY, "
            "score REAL NOT NULL, "
            "updated_at REAL NOT NULL)"
        )


def get_reputation_score(db_path_override: Optional[str], peer_id: str) -> float:
    ensure_reputation_schema(db_path_override)
    with sqlite3.connect(_reputation_db(db_path_override)) as conn:
        row = conn.execute("SELECT score FROM peer_reputation WHERE peer_id = ?", (peer_id,)).fetchone()
    return float(row[0]) if row else 0.5


def update_reputation_score(db_path_override: Optional[str], peer_id: str, success: bool) -> float:
    old_score = get_reputation_score(db_path_override, peer_id)
    new_score = (0.9 * old_score) + (0.1 * (1.0 if success else 0.0))
    with sqlite3.connect(_reputation_db(db_path_override)) as conn:
        conn.execute(
            "INSERT INTO peer_reputation(peer_id, score, updated_at) VALUES (?, ?, ?) "
            "ON CONFLICT(peer_id) DO UPDATE SET score = excluded.score, updated_at = excluded.updated_at",
            (peer_id, new_score, time.time()),
        )
    return new_score


def reset_local_network_for_tests() -> None:
    _LOCAL_HOSTS_BY_PEER_ID.clear()
    _LOCAL_HOSTS_BY_PORT.clear()
    _DIRECT_LINKS.clear()
    _TOPIC_QUEUES.clear()
    _DHT_PROVIDERS.clear()
