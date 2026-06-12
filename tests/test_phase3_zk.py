from __future__ import annotations

import time
import asyncio

import pytest

from app.services import zk_verifier
from app.services.zk_verifier import VerificationKey, VerificationRequest, ZKVerifierService, make_development_valid_proof


def _vk() -> VerificationKey:
    return VerificationKey(protocol="groth16", curve="bn128", nPublic=1, IC=[["1", "2"], ["3", "4"]])


@pytest.mark.asyncio
async def test_valid_proof():
    vk = _vk()
    proof = make_development_valid_proof(vk, ["7"])
    result = await zk_verifier.verify_request_async(VerificationRequest(proof=proof, vk=vk, public_inputs=["7"]))
    assert result.status == "valid"
    assert result.verified is True


@pytest.mark.asyncio
async def test_invalid_proof():
    vk = _vk()
    proof = make_development_valid_proof(vk, ["7"]).model_copy(update={"pi_a": ["1", "2", "1"]})
    result = await zk_verifier.verify_request_async(VerificationRequest(proof=proof, vk=vk, public_inputs=["7"]))
    assert result.status == "invalid"
    assert result.verified is False


@pytest.mark.asyncio
async def test_concurrent_benchmark():
    vk = _vk()
    proof = make_development_valid_proof(vk, ["7"])
    req = VerificationRequest(proof=proof, vk=vk, public_inputs=["7"])
    started = time.perf_counter()
    results = await asyncio.gather(*[zk_verifier.verify_request_async(req) for _ in range(50)])
    assert all(result.verified for result in results)
    assert time.perf_counter() - started < 60


@pytest.mark.asyncio
async def test_timeout(monkeypatch):
    service = ZKVerifierService(concurrency=1, timeout_seconds=0.01)

    def slow(req):
        time.sleep(0.05)
        raise AssertionError("should time out first")

    monkeypatch.setattr(service, "_verify_sync", slow)
    vk = _vk()
    req = VerificationRequest(proof=make_development_valid_proof(vk, ["7"]), vk=vk, public_inputs=["7"])
    result = await service.verify(req)
    assert result.status == "timeout"
    await service.stop()


@pytest.mark.asyncio
async def test_circuit_breaker(monkeypatch):
    service = ZKVerifierService(concurrency=1, timeout_seconds=1)

    def broken(req):
        raise RuntimeError("boom")

    monkeypatch.setattr(service, "_verify_sync", broken)
    vk = _vk()
    req = VerificationRequest(proof=make_development_valid_proof(vk, ["7"]), vk=vk, public_inputs=["7"])
    for _ in range(5):
        with pytest.raises(RuntimeError):
            await service.verify(req)
    with pytest.raises(zk_verifier.CircuitOpenError):
        await service.verify(req)
    await service.stop()


def test_vk_cache_hit(monkeypatch):
    vk = _vk().model_dump(mode="json")
    zk_verifier._VK_CACHE.clear()
    first = zk_verifier.parse_verification_key(vk)
    second = zk_verifier.parse_verification_key(vk)
    assert first is second
