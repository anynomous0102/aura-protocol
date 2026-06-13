from __future__ import annotations

import asyncio
import hashlib
import json
import os
import time
from collections import defaultdict
from typing import Awaitable, Callable, Dict, List, Optional

import aiosqlite
import structlog
from pydantic import ValidationError

from app.models.routing import NodeHealth, RoutingDecision, SAFE_DEFAULT_DECISION, TargetNode
from app.services.provider_adapters import (
    AIProviderAdapter,
    AnthropicAdapter,
    GeminiAdapter,
    GroqAdapter,
    GroqPersonaAdapter,
    HuggingFaceAdapter,
    OpenAIAdapter,
    OpenAICompatibleAdapter,
    env_key_pool,
)


log = structlog.get_logger(__name__)
NodeCaller = Callable[[str, List[Dict[str, str]]], Awaitable[str]]
_NODE_CALLERS: Dict[TargetNode, NodeCaller] = {}
_PROVIDER_ADAPTER_OVERRIDES: Dict[TargetNode, AIProviderAdapter] = {}


def create_provider_adapter(node: TargetNode) -> AIProviderAdapter:
    if node == TargetNode.GPT4:
        return OpenAIAdapter()
    if node == TargetNode.GEMINI:
        return GeminiAdapter()
    if node == TargetNode.CLAUDE:
        return AnthropicAdapter()
    if node == TargetNode.GROQ:
        return GroqAdapter()
    if node == TargetNode.DEEPSEEK:
        return OpenAICompatibleAdapter(
            base_url=os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1"),
            api_keys=env_key_pool("DEEPSEEK_API_KEY"),
            model=os.getenv("DEEPSEEK_MODEL", "deepseek-chat"),
            provider_name="deepseek",
        )
    if node == TargetNode.MISTRAL:
        return OpenAICompatibleAdapter(
            base_url=os.getenv("MISTRAL_BASE_URL", "https://api.mistral.ai/v1"),
            api_keys=env_key_pool("MISTRAL_API_KEY"),
            model=os.getenv("MISTRAL_MODEL", "mistral-large-latest"),
            provider_name="mistral",
        )
    raise ValueError(f"No provider adapter registered for {node.value}")


def create_provider_adapter_for_model(model_id: str) -> AIProviderAdapter:
    normalized = model_id.lower().strip()
    if normalized == "groq-sonnet-4-6-persona":
        return GroqPersonaAdapter()
    if normalized.startswith("groq:") or normalized.startswith("llama"):
        return GroqAdapter()
    if normalized.startswith("openai/") or normalized.startswith("anthropic/") or normalized.startswith("google/"):
        return OpenAICompatibleAdapter(
            base_url=os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"),
            api_keys=env_key_pool("OPENROUTER_API_KEY") or env_key_pool("OPENROUTER_DEFAULT_KEY"),
            model=model_id,
            provider_name="openrouter",
        )
    if normalized.startswith("meta-llama/") or normalized.startswith("huggingface:"):
        return HuggingFaceAdapter()
    return create_provider_adapter(model_id_to_target_node(model_id))


def model_id_to_target_node(model_id: str) -> TargetNode:
    normalized = model_id.lower().strip()
    if normalized in {"aura", "supervisor", "gemini"}:
        return TargetNode.GEMINI
    if normalized in {"gpt4", "gpt-4o", "openai"}:
        return TargetNode.GPT4
    if normalized.startswith("claude"):
        return TargetNode.CLAUDE
    if normalized.startswith("deepseek"):
        return TargetNode.DEEPSEEK
    if normalized.startswith("mistral"):
        return TargetNode.MISTRAL
    if normalized.startswith("groq") or normalized.startswith("llama"):
        return TargetNode.GROQ
    return TargetNode.MISTRAL


async def dispatch_model_id(
    model_id: str,
    prompt: str,
    conversation_history: List[Dict[str, str]],
) -> tuple[str, str]:
    adapter = create_provider_adapter_for_model(model_id)
    response = await adapter.generate_response(prompt, conversation_history)
    return response, adapter.provider_name


def _db_path() -> str:
    return os.getenv("AURA_ROUTING_DB", os.getenv("AURA_DB_PATH", "aura_network.db"))


async def ensure_routing_schema() -> None:
    async with aiosqlite.connect(_db_path()) as db:
        await db.execute(
            "CREATE TABLE IF NOT EXISTS routing_log ("
            "id INTEGER PRIMARY KEY, "
            "ts REAL NOT NULL, "
            "query_hash TEXT NOT NULL, "
            "routed_to TEXT NOT NULL, "
            "latency_ms REAL NOT NULL, "
            "success INTEGER NOT NULL, "
            "confidence REAL NOT NULL)"
        )
        await db.commit()


def parse_routing_decision(raw_response_text: str) -> RoutingDecision:
    try:
        return RoutingDecision.model_validate_json(raw_response_text)
    except (ValidationError, json.JSONDecodeError, Exception) as exc:
        log.warning("routing_decision_parse_failed", error=str(exc), raw_response=raw_response_text[:1000])
        return SAFE_DEFAULT_DECISION


async def get_supervisor_routing_decision(
    prompt: str,
    conversation_history: List[Dict[str, str]],
    model: str = "gpt-4o",
) -> RoutingDecision:
    try:
        from openai import AsyncOpenAI

        client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY") or None)
        schema = RoutingDecision.model_json_schema()
        response = await client.chat.completions.create(
            model=model,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "Route the user's task to exactly one AURA target node. "
                        "Return only JSON matching the provided schema."
                    ),
                },
                *conversation_history,
                {"role": "user", "content": prompt},
            ],
            response_format={
                "type": "json_schema",
                "json_schema": {
                    "name": "RoutingDecision",
                    "schema": schema,
                    "strict": True,
                },
            },
        )
        raw = response.choices[0].message.content or ""
        return parse_routing_decision(raw)
    except Exception as exc:
        log.warning("routing_supervisor_failed", error=str(exc))
        return SAFE_DEFAULT_DECISION


async def get_node_health(node: TargetNode) -> NodeHealth:
    return NodeHealth(node=node, latency_ms=50.0, availability=0.99, current_load=0.15)


def register_node_caller(node: TargetNode, caller: NodeCaller) -> None:
    _NODE_CALLERS[node] = caller


def register_provider_adapter(node: TargetNode, adapter: AIProviderAdapter) -> None:
    _PROVIDER_ADAPTER_OVERRIDES[node] = adapter


async def _call_target_node(
    node: TargetNode,
    prompt: str,
    conversation_history: List[Dict[str, str]],
) -> str:
    caller = _NODE_CALLERS.get(node)
    if caller is not None:
        return await caller(prompt, conversation_history)
    adapter = _PROVIDER_ADAPTER_OVERRIDES.get(node) or create_provider_adapter(node)
    return await adapter.generate_response(prompt, conversation_history)


async def _record_routing_telemetry(
    query_hash: str,
    routed_to: TargetNode,
    latency_ms: float,
    success: bool,
    confidence: float,
) -> None:
    await ensure_routing_schema()
    async with aiosqlite.connect(_db_path()) as db:
        await db.execute(
            "INSERT INTO routing_log(ts, query_hash, routed_to, latency_ms, success, confidence) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (time.time(), query_hash, routed_to.value, latency_ms, 1 if success else 0, confidence),
        )
        await db.commit()


async def dispatch_to_node(
    decision: RoutingDecision,
    prompt: str,
    conversation_history: List[Dict[str, str]],
) -> str:
    target = decision.target
    health = await get_node_health(target)
    if health.availability < 0.5:
        log.warning("routing_health_gate_fallback", target=target.value, availability=health.availability)
        target = decision.fallback

    query_hash = hashlib.sha256(prompt.encode("utf-8")).hexdigest()
    last_error: Optional[BaseException] = None
    started = time.perf_counter()

    for attempt in range(2):
        try:
            response = await _call_target_node(target, prompt, conversation_history)
            elapsed_ms = (time.perf_counter() - started) * 1000
            await _record_routing_telemetry(query_hash, target, elapsed_ms, True, decision.confidence)
            return response
        except Exception as exc:
            last_error = exc
            log.warning("routing_primary_attempt_failed", target=target.value, attempt=attempt + 1, error=str(exc))
            await asyncio.sleep(0.1 * (2**attempt))

    fallback_started = time.perf_counter()
    try:
        response = await _call_target_node(decision.fallback, prompt, conversation_history)
        elapsed_ms = (time.perf_counter() - fallback_started) * 1000
        await _record_routing_telemetry(query_hash, decision.fallback, elapsed_ms, True, decision.confidence)
        return response
    except Exception as exc:
        elapsed_ms = (time.perf_counter() - started) * 1000
        await _record_routing_telemetry(query_hash, decision.fallback, elapsed_ms, False, decision.confidence)
        raise RuntimeError(f"routing failed for {target.value} and fallback {decision.fallback.value}") from (last_error or exc)


async def routing_stats() -> Dict[str, Dict[str, float]]:
    await ensure_routing_schema()
    totals: Dict[str, int] = defaultdict(int)
    successes: Dict[str, int] = defaultdict(int)
    latencies: Dict[str, float] = defaultdict(float)
    async with aiosqlite.connect(_db_path()) as db:
        async with db.execute("SELECT routed_to, latency_ms, success FROM routing_log") as cursor:
            async for routed_to, latency_ms, success in cursor:
                node = str(routed_to)
                totals[node] += 1
                successes[node] += int(success)
                latencies[node] += float(latency_ms)
    return {
        node: {
            "requests": float(total),
            "success_rate": successes[node] / total if total else 0.0,
            "avg_latency_ms": latencies[node] / total if total else 0.0,
        }
        for node, total in totals.items()
    }
