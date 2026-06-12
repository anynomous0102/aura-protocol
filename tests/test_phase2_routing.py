from __future__ import annotations

import pytest

from app.models.routing import SAFE_DEFAULT_DECISION, NodeHealth, RoutingDecision, TargetNode
from app.services import router


def test_happy_path_parse():
    decision = router.parse_routing_decision(
        '{"target":"gpt4","rationale":"Best for reasoning.","confidence":0.92,"fallback":"mistral"}'
    )
    assert decision.target == TargetNode.GPT4
    assert decision.confidence == 0.92


def test_plain_text_fallback():
    assert router.parse_routing_decision("Just use gpt4 for this") == SAFE_DEFAULT_DECISION


def test_invalid_enum_fallback():
    assert router.parse_routing_decision('{"target":"gpt5","rationale":"x","confidence":0.8}') == SAFE_DEFAULT_DECISION


def test_out_of_range_confidence_fallback():
    assert router.parse_routing_decision('{"target":"gemini","rationale":"x","confidence":2.5}') == SAFE_DEFAULT_DECISION


@pytest.mark.asyncio
async def test_dispatcher_retry_and_fallback(tmp_path, monkeypatch):
    monkeypatch.setenv("AURA_ROUTING_DB", str(tmp_path / "routing.db"))
    calls = {"gpt4": 0, "mistral": 0}

    async def failing_primary(prompt, history):
        calls["gpt4"] += 1
        raise TimeoutError("slow")

    async def fallback(prompt, history):
        calls["mistral"] += 1
        return "fallback response"

    router.register_node_caller(TargetNode.GPT4, failing_primary)
    router.register_node_caller(TargetNode.MISTRAL, fallback)
    decision = RoutingDecision(target=TargetNode.GPT4, fallback=TargetNode.MISTRAL, rationale="x", confidence=0.9)
    assert await router.dispatch_to_node(decision, "prompt", []) == "fallback response"
    assert calls == {"gpt4": 2, "mistral": 1}


@pytest.mark.asyncio
async def test_node_health_gate(tmp_path, monkeypatch):
    monkeypatch.setenv("AURA_ROUTING_DB", str(tmp_path / "routing.db"))
    calls = {"deepseek": 0, "mistral": 0}

    async def deepseek(prompt, history):
        calls["deepseek"] += 1
        return "bad"

    async def mistral(prompt, history):
        calls["mistral"] += 1
        return "ok"

    async def unhealthy(node):
        return NodeHealth(node=node, latency_ms=10, availability=0.1, current_load=0.9)

    router.register_node_caller(TargetNode.DEEPSEEK, deepseek)
    router.register_node_caller(TargetNode.MISTRAL, mistral)
    monkeypatch.setattr(router, "get_node_health", unhealthy)
    decision = RoutingDecision(target=TargetNode.DEEPSEEK, fallback=TargetNode.MISTRAL, rationale="x", confidence=0.9)
    assert await router.dispatch_to_node(decision, "prompt", []) == "ok"
    assert calls == {"deepseek": 0, "mistral": 1}

