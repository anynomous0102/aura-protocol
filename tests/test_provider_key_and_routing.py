from __future__ import annotations

from app.services.provider_adapters import env_key_pool
from app.services.router import create_provider_adapter_for_model


def test_env_key_pool_loads_numbered_suffixes(monkeypatch):
    monkeypatch.delenv("AURA_TEST_PROVIDER_API_KEY", raising=False)
    monkeypatch.setenv("AURA_TEST_PROVIDER_API_KEY_2", "second")
    monkeypatch.setenv("AURA_TEST_PROVIDER_API_KEY_1", "first")

    assert env_key_pool("AURA_TEST_PROVIDER_API_KEY") == ["first", "second"]


def test_slash_model_ids_route_to_openrouter():
    adapter = create_provider_adapter_for_model("meta-llama/llama-3.3-70b-instruct:free")

    assert adapter.provider_name == "openrouter"
    assert adapter.model == "meta-llama/llama-3.3-70b-instruct:free"


def test_groq_prefixed_model_strips_internal_prefix():
    adapter = create_provider_adapter_for_model("groq:llama-3.3-70b-versatile", api_key="gsk_test")

    assert adapter.provider_name == "groq"
    assert adapter.model == "llama-3.3-70b-versatile"
