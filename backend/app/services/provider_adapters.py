from __future__ import annotations

import os
import asyncio
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


class OpenAICompatibleAdapter(AIProviderAdapter):
    provider_name = "openai-compatible"

    def __init__(self, *, base_url: str, api_key: str, model: str, provider_name: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model
        self.provider_name = provider_name

    async def generate_response(self, prompt: str, conversation_history: List[Dict[str, str]]) -> str:
        if not self.api_key:
            raise AIProviderError(self.provider_name, "API key is not configured")
        headers = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}
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
            api_key=os.getenv("OPENAI_API_KEY", ""),
            model=os.getenv("OPENAI_MODEL", "gpt-4o"),
            provider_name="openai",
        )


class GroqAdapter(OpenAICompatibleAdapter):
    def __init__(self) -> None:
        super().__init__(
            base_url=os.getenv("GROQ_BASE_URL", "https://api.groq.com/openai/v1"),
            api_key=os.getenv("GROQ_API_KEY", ""),
            model=os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile"),
            provider_name="groq",
        )


class HuggingFaceAdapter(OpenAICompatibleAdapter):
    def __init__(self) -> None:
        super().__init__(
            base_url=os.getenv("HUGGINGFACE_BASE_URL", "https://router.huggingface.co/v1"),
            api_key=os.getenv("HUGGINGFACE_API_KEY", ""),
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
        self.api_key = os.getenv("GEMINI_API_KEY", "")
        self.model = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")

    async def generate_response(self, prompt: str, conversation_history: List[Dict[str, str]]) -> str:
        if not self.api_key:
            raise AIProviderError(self.provider_name, "API key is not configured")
        try:
            import google.generativeai as genai

            genai.configure(api_key=self.api_key)
            model = genai.GenerativeModel(self.model)
            history = "\n".join(f"{item.get('role', 'user')}: {item.get('content', '')}" for item in conversation_history)
            response = await asyncio.to_thread(model.generate_content, f"{history}\nuser: {prompt}")
            return str(getattr(response, "text", response))
        except Exception as exc:
            raise AIProviderError(self.provider_name, str(exc)) from exc
