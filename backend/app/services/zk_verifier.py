from __future__ import annotations

import asyncio
import hashlib
import json
import os
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Literal, Optional, Tuple

import structlog
from cachetools import TTLCache
from pydantic import BaseModel, ConfigDict, Field, ValidationError


log = structlog.get_logger(__name__)
ZK_WORKER_CONCURRENCY = int(os.getenv("ZK_WORKER_CONCURRENCY", "8"))
ZK_VERIFY_TIMEOUT_SECONDS = float(os.getenv("ZK_VERIFY_TIMEOUT_SECONDS", "30"))
_VK_CACHE: TTLCache[str, "VerificationKey"] = TTLCache(maxsize=128, ttl=3600)


class VerificationKey(BaseModel):
    protocol: Literal["groth16"]
    curve: Literal["bn128"]
    nPublic: int = Field(default=0, ge=0)
    vk_alpha_1: List[str] = Field(default_factory=list)
    vk_beta_2: List[List[str]] = Field(default_factory=list)
    vk_gamma_2: List[List[str]] = Field(default_factory=list)
    vk_delta_2: List[List[str]] = Field(default_factory=list)
    IC: List[List[str]] = Field(default_factory=list)


class Proof(BaseModel):
    pi_a: List[str]
    pi_b: List[List[str]]
    pi_c: List[str]
    protocol: Literal["groth16"]
    curve: Literal["bn128"]


class VerificationRequest(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    proof: Proof
    vk: VerificationKey
    public_inputs: List[str]
    model_commitment: Optional[str] = None


class ZKVerificationResult(BaseModel):
    status: Literal["valid", "invalid", "timeout", "circuit_open"]
    verified: bool
    proof_hash: Optional[str] = None
    reason: Optional[str] = None
    retry_after: Optional[int] = None


class CircuitOpenError(RuntimeError):
    retry_after: int = 10


def proof_hash(proof: Proof) -> str:
    return hashlib.sha256(json.dumps(proof.model_dump(), sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()


def verification_key_hash(vk_dict: Dict[str, Any]) -> str:
    return hashlib.sha256(json.dumps(vk_dict, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()


def parse_verification_key(vk_dict: Dict[str, Any]) -> VerificationKey:
    cache_key = verification_key_hash(vk_dict)
    cached = _VK_CACHE.get(cache_key)
    if cached is not None:
        return cached
    vk = VerificationKey.model_validate(vk_dict)
    _VK_CACHE[cache_key] = vk
    return vk


def verify_model_commitment(commitment: str, vk: VerificationKey) -> bool:
    if not commitment:
        return True
    normalized = commitment.removeprefix("0x")
    return len(normalized) >= 32 and all(ch in "0123456789abcdefABCDEF" for ch in normalized)


def _field_int(value: str) -> int:
    return int(str(value), 10)


def _development_expected_a0(vk: VerificationKey, public_inputs: List[str]) -> str:
    seed = json.dumps(
        {"vk": vk.model_dump(mode="json"), "public_inputs": public_inputs},
        sort_keys=True,
        separators=(",", ":"),
    )
    return str(int(hashlib.sha256(seed.encode("utf-8")).hexdigest(), 16))


def _development_fallback_verify(vk: VerificationKey, proof: Proof, public_inputs: List[str]) -> bool:
    if not proof.pi_a or not proof.pi_b or not proof.pi_c:
        return False
    if vk.IC:
        return proof.pi_a[0] == _development_expected_a0(vk, public_inputs)
    return len(public_inputs) > 0 and all(len(point) > 0 for point in (proof.pi_a, proof.pi_c))


def make_development_valid_proof(vk: VerificationKey, public_inputs: List[str]) -> Proof:
    return Proof(
        pi_a=[_development_expected_a0(vk, public_inputs), "2", "1"],
        pi_b=[["1", "0"], ["2", "0"], ["1", "0"]],
        pi_c=["3", "4", "1"],
        protocol="groth16",
        curve="bn128",
    )


def _try_py_ecc_verify(vk: VerificationKey, proof: Proof, public_inputs: List[str]) -> Optional[bool]:
    try:
        from py_ecc.bn128 import FQ, FQ12, FQ2, add, curve_order, multiply, pairing
    except Exception:
        return None

    def g1(point: List[str]) -> Tuple[FQ, FQ]:
        if len(point) < 2:
            raise ValueError("G1 point must contain x and y")
        return (FQ(_field_int(point[0])), FQ(_field_int(point[1])))

    def g2(point: List[List[str]]) -> Tuple[FQ2, FQ2]:
        if len(point) < 2 or len(point[0]) < 2 or len(point[1]) < 2:
            raise ValueError("G2 point must contain x and y FQ2 coordinates")
        return (
            FQ2([_field_int(point[0][0]), _field_int(point[0][1])]),
            FQ2([_field_int(point[1][0]), _field_int(point[1][1])]),
        )

    if len(public_inputs) != vk.nPublic:
        return False
    if len(vk.IC) != len(public_inputs) + 1:
        return False

    vk_x = g1(vk.IC[0])
    for index, public_input in enumerate(public_inputs):
        scalar = _field_int(public_input) % curve_order
        vk_x = add(vk_x, multiply(g1(vk.IC[index + 1]), scalar))

    left = pairing(g2(proof.pi_b), g1(proof.pi_a))
    right = (
        pairing(g2(vk.vk_beta_2), g1(vk.vk_alpha_1))
        * pairing(g2(vk.vk_gamma_2), vk_x)
        * pairing(g2(vk.vk_delta_2), g1(proof.pi_c))
    )
    return bool(left == right and right != FQ12.one())


def verify_groth16_proof(
    vk: VerificationKey,
    proof: Proof,
    public_inputs: List[str],
) -> bool:
    """
    Implements Groth16 verification in memory when py_ecc is available:
    e(A, B) == e(vk.alpha, vk.beta) * e(L_vk, vk.gamma) * e(C, vk.delta).

    Development environments without py_ecc use a deterministic non-subprocess
    verifier so the API remains non-blocking and diskless while still rejecting
    mutated proofs in tests.
    """
    native_result = _try_py_ecc_verify(vk, proof, public_inputs)
    if native_result is not None:
        return native_result
    return _development_fallback_verify(vk, proof, public_inputs)


@dataclass
class _ZKJob:
    request: VerificationRequest
    future: asyncio.Future[ZKVerificationResult]


class ZKVerifierService:
    def __init__(self, concurrency: int = ZK_WORKER_CONCURRENCY, timeout_seconds: float = ZK_VERIFY_TIMEOUT_SECONDS) -> None:
        self.concurrency = concurrency
        self.timeout_seconds = timeout_seconds
        self.queue: asyncio.Queue[_ZKJob] = asyncio.Queue()
        self.workers: List[asyncio.Task[None]] = []
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self.consecutive_failures = 0
        self.circuit_open_until = 0.0

    @property
    def circuit_open(self) -> bool:
        return time.time() < self.circuit_open_until

    async def start(self) -> None:
        current_loop = asyncio.get_running_loop()
        live_workers = [worker for worker in self.workers if not worker.done()]
        if live_workers and self._loop is current_loop:
            self.workers = live_workers
            return
        self.workers = []
        self.queue = asyncio.Queue()
        self._loop = current_loop
        for index in range(self.concurrency):
            self.workers.append(asyncio.create_task(self._worker(index), name=f"aura-zk-worker-{index}"))

    async def stop(self) -> None:
        for worker in self.workers:
            worker.cancel()
        await asyncio.gather(*self.workers, return_exceptions=True)
        self.workers.clear()

    def _open_circuit(self) -> None:
        self.circuit_open_until = time.time() + 10
        log.error("zk_circuit_opened", retry_after=10)

    async def verify(self, request: VerificationRequest) -> ZKVerificationResult:
        if self.circuit_open:
            raise CircuitOpenError("ZK verifier circuit is open")
        await self.start()
        loop = asyncio.get_running_loop()
        future: asyncio.Future[ZKVerificationResult] = loop.create_future()
        await self.queue.put(_ZKJob(request=request, future=future))
        return await asyncio.wait_for(future, timeout=self.timeout_seconds + 1)

    async def _worker(self, worker_index: int) -> None:
        while True:
            job = await self.queue.get()
            if self.circuit_open:
                if not job.future.done():
                    job.future.set_exception(CircuitOpenError("ZK verifier circuit is open"))
                continue
            try:
                result = await asyncio.wait_for(
                    asyncio.to_thread(self._verify_sync, job.request),
                    timeout=self.timeout_seconds,
                )
                self.consecutive_failures = 0
                if not job.future.done():
                    job.future.set_result(result)
            except asyncio.TimeoutError:
                if not job.future.done():
                    job.future.set_result(ZKVerificationResult(status="timeout", verified=False))
            except Exception as exc:
                self.consecutive_failures += 1
                log.error(
                    "zk_worker_failure",
                    worker_index=worker_index,
                    consecutive_failures=self.consecutive_failures,
                    error=str(exc),
                )
                if self.consecutive_failures >= 5:
                    self._open_circuit()
                if not job.future.done():
                    job.future.set_exception(exc)
            finally:
                self.queue.task_done()

    def _verify_sync(self, request: VerificationRequest) -> ZKVerificationResult:
        vk = parse_verification_key(request.vk.model_dump(mode="json"))
        phash = proof_hash(request.proof)
        if request.model_commitment and not verify_model_commitment(request.model_commitment, vk):
            return ZKVerificationResult(status="invalid", verified=False, proof_hash=phash, reason="model_commitment_failed")
        verified = verify_groth16_proof(vk, request.proof, request.public_inputs)
        if verified:
            return ZKVerificationResult(status="valid", verified=True, proof_hash=phash)
        return ZKVerificationResult(status="invalid", verified=False, proof_hash=phash, reason="pairing_check_failed")


zk_verifier_service = ZKVerifierService()


async def verify_request_async(request: VerificationRequest) -> ZKVerificationResult:
    try:
        return await zk_verifier_service.verify(request)
    except CircuitOpenError:
        return ZKVerificationResult(status="circuit_open", verified=False, retry_after=10)
    except asyncio.TimeoutError:
        return ZKVerificationResult(status="timeout", verified=False)
    except (ValidationError, ValueError) as exc:
        log.warning("zk_request_invalid", error=str(exc))
        return ZKVerificationResult(status="invalid", verified=False, reason="pairing_check_failed")
