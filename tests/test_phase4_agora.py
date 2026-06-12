from __future__ import annotations

import pytest

from app.services import agora_healer
from app.services.agora_healer import HealingRequest, execute_healing_query


@pytest.mark.asyncio
async def test_valid_jmespath_extraction(monkeypatch):
    async def query(req):
        return "org.departments[0].lead.email"

    monkeypatch.setattr(agora_healer, "generate_healing_query", query)
    response = await agora_healer.heal_payload(
        HealingRequest(
            payload={"org": {"departments": [{"name": "Engineering", "lead": {"email": "cto@aura.io"}}]}},
            target_field="email",
        )
    )
    assert response.healed
    assert response.value == "cto@aura.io"


def test_malicious_import_blocked(tmp_path):
    sentinel = tmp_path / "sentinel.txt"
    sentinel.write_text("safe", encoding="utf-8")
    query = "__import__('os').system('rm -rf /')"
    assert agora_healer._is_query_safe(query) is False
    assert execute_healing_query(query, {"x": 1}) is None
    assert sentinel.exists()


def test_invalid_jmespath_syntax():
    assert execute_healing_query("[[[invalid{{query", {"x": 1}) is None


def test_parenthesis_keyword_injection_blocked():
    assert execute_healing_query("foo.bar.exec(rm -rf /)", {"foo": {"bar": 1}}) is None


def test_valid_filter_expression():
    payload = {"users": [{"role": "user", "email": "u@aura.io"}, {"role": "admin", "email": "a@aura.io"}]}
    assert agora_healer._is_query_safe("users[?role=='admin'].email")
    assert execute_healing_query("users[?role=='admin'].email", payload) == ["a@aura.io"]


@pytest.mark.asyncio
async def test_llm_error_propagation(monkeypatch):
    async def broken(req):
        raise RuntimeError("api")

    monkeypatch.setattr(agora_healer, "generate_healing_query", broken)
    response = await agora_healer.heal_payload(HealingRequest(payload={"x": 1}, target_field="x"))
    assert response.reason == "llm_error"

