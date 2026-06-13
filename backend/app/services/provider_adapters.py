from __future__ import annotations

import os
import asyncio
import re
from abc import ABC, abstractmethod
from typing import Dict, List

import httpx


class AIProviderError(RuntimeError):
    def __init__(self, provider: str, message: str) -> None:
        super().__init__(f"{provider} adapter failed: {message}")
        self.provider = provider


class AIProviderAdapter(ABC):
    provider_name: str

    @abstractmethod
    async def generate_response(self, prompt: str, conversation_history: List[Dict[str, str]]) -> str:
        raise NotImplementedError

    async def complete(self, prompt: str, conversation_history: List[Dict[str, str]]) -> str:
        return await self.generate_response(prompt, conversation_history)

    def _messages(self, prompt: str, conversation_history: List[Dict[str, str]]) -> list[dict[str, str]]:
        return [*conversation_history, {"role": "user", "content": prompt}]


def env_key_pool(name: str) -> list[str]:
    values: list[tuple[int, str]] = []
    direct = os.getenv(name, "").strip()
    if direct:
        values.append((0, direct))
    for key, value in os.environ.items():
        match = re.fullmatch(rf"{re.escape(name)}_(\d+)", key)
        if match and value.strip():
            values.append((int(match.group(1)), value.strip()))
    return [value for _, value in sorted(values, key=lambda item: item[0])]


class OpenAICompatibleAdapter(AIProviderAdapter):
    provider_name = "openai-compatible"

    def __init__(
        self,
        *,
        base_url: str,
        api_key: str = "",
        api_keys: list[str] | None = None,
        model: str,
        provider_name: str,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_keys = api_keys or ([api_key] if api_key else [])
        self.model = model
        self.provider_name = provider_name

    async def generate_response(self, prompt: str, conversation_history: List[Dict[str, str]]) -> str:
        if not self.api_keys:
            raise AIProviderError(self.provider_name, "API key is not configured")
        payload = {"model": self.model, "messages": self._messages(prompt, conversation_history)}
        last_error: Exception | None = None
        async with httpx.AsyncClient(timeout=60.0) as client:
            for api_key in self.api_keys:
                headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
                try:
                    response = await client.post(f"{self.base_url}/chat/completions", headers=headers, json=payload)
                    response.raise_for_status()
                    data = response.json()
                    return str(data["choices"][0]["message"]["content"])
                except (KeyError, IndexError, TypeError, httpx.HTTPError) as exc:
                    last_error = exc
                    continue
        raise AIProviderError(self.provider_name, str(last_error or "all configured keys failed"))

    async def complete_with_key(self, api_key: str, prompt: str, conversation_history: List[Dict[str, str]]) -> str:
        headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
        payload = {"model": self.model, "messages": self._messages(prompt, conversation_history)}
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                response = await client.post(f"{self.base_url}/chat/completions", headers=headers, json=payload)
                response.raise_for_status()
                data = response.json()
            return str(data["choices"][0]["message"]["content"])
        except (KeyError, IndexError, TypeError, httpx.HTTPError) as exc:
            raise AIProviderError(self.provider_name, str(exc)) from exc


class OpenAIAdapter(OpenAICompatibleAdapter):
    def __init__(self) -> None:
        super().__init__(
            base_url=os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1"),
            api_keys=env_key_pool("OPENAI_API_KEY"),
            model=os.getenv("OPENAI_MODEL", "gpt-4o"),
            provider_name="openai",
        )


class GroqAdapter(OpenAICompatibleAdapter):
    def __init__(self) -> None:
        super().__init__(
            base_url=os.getenv("GROQ_BASE_URL", "https://api.groq.com/openai/v1"),
            api_keys=env_key_pool("GROQ_API_KEY"),
            model=os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile"),
            provider_name="groq",
        )


class HuggingFaceAdapter(OpenAICompatibleAdapter):
    def __init__(self) -> None:
        super().__init__(
            base_url=os.getenv("HUGGINGFACE_BASE_URL", "https://router.huggingface.co/v1"),
            api_keys=env_key_pool("HUGGINGFACE_API_KEY"),
            model=os.getenv("HUGGINGFACE_MODEL", "meta-llama/Llama-3.1-8B-Instruct"),
            provider_name="huggingface",
        )


class AnthropicAdapter(AIProviderAdapter):
    provider_name = "anthropic"

    def __init__(self) -> None:
        self.api_key = os.getenv("ANTHROPIC_API_KEY", "")
        self.model = os.getenv("ANTHROPIC_MODEL", "claude-3-5-sonnet-20241022")

    async def generate_response(self, prompt: str, conversation_history: List[Dict[str, str]]) -> str:
        if not self.api_key:
            raise AIProviderError(self.provider_name, "API key is not configured")
        try:
            from anthropic import AsyncAnthropic

            client = AsyncAnthropic(api_key=self.api_key)
            system_messages = [item["content"] for item in conversation_history if item.get("role") == "system"]
            non_system = [item for item in conversation_history if item.get("role") != "system"]
            response = await client.messages.create(
                model=self.model,
                max_tokens=4096,
                system="\n".join(system_messages) if system_messages else None,
                messages=[*non_system, {"role": "user", "content": prompt}],
            )
            return "".join(block.text for block in response.content if getattr(block, "type", "") == "text")
        except Exception as exc:
            raise AIProviderError(self.provider_name, str(exc)) from exc


class GeminiAdapter(AIProviderAdapter):
    provider_name = "gemini"

    def __init__(self) -> None:
        self.api_keys = env_key_pool("GEMINI_API_KEY")
        self.model = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")

    async def generate_response(self, prompt: str, conversation_history: List[Dict[str, str]]) -> str:
        if not self.api_keys:
            raise AIProviderError(self.provider_name, "API key is not configured")
        last_error: Exception | None = None
        for api_key in self.api_keys:
            try:
                import google.generativeai as genai

                genai.configure(api_key=api_key)
                model = genai.GenerativeModel(self.model)
                history = "\n".join(f"{item.get('role', 'user')}: {item.get('content', '')}" for item in conversation_history)
                response = await asyncio.to_thread(model.generate_content, f"{history}\nuser: {prompt}")
                return str(getattr(response, "text", response))
            except Exception as exc:
                last_error = exc
                continue
        raise AIProviderError(self.provider_name, str(last_error or "all configured keys failed"))


class GroqPersonaAdapter(OpenAICompatibleAdapter):
    def __init__(self) -> None:
        super().__init__(
            base_url=os.getenv("GROQ_BASE_URL", "https://api.groq.com/openai/v1"),
            api_keys=env_key_pool("GROQ_CLAUDE_PERSONA_API_KEY") or env_key_pool("GROQ_API_KEY"),
            model=os.getenv("GROQ_CLAUDE_PERSONA_MODEL", os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")),
            provider_name="groq-persona",
        )
