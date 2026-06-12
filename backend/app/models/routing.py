from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field, field_validator


class TargetNode(str, Enum):
    GPT4 = "gpt4"
    GEMINI = "gemini"
    DEEPSEEK = "deepseek"
    MISTRAL = "mistral"
    CLAUDE = "claude"


class NodeHealth(BaseModel):
    node: TargetNode
    latency_ms: float = Field(ge=0.0)
    availability: float = Field(ge=0.0, le=1.0)
    current_load: float = Field(ge=0.0, le=1.0)


class RoutingDecision(BaseModel):
    target: TargetNode = Field(..., description="The LLM node best suited for this task.")
    rationale: str = Field(..., max_length=280, description="One-sentence justification.")
    confidence: float = Field(..., ge=0.0, le=1.0, description="Confidence score.")
    fallback: TargetNode = Field(default=TargetNode.MISTRAL, description="Fallback model.")
    estimated_tokens: Optional[int] = Field(default=None, ge=1, le=128000)

    @field_validator("rationale")
    @classmethod
    def rationale_must_be_plain(cls, value: str) -> str:
        normalized = " ".join(value.strip().split())
        if not normalized:
            raise ValueError("rationale must not be empty")
        return normalized


SAFE_DEFAULT_DECISION = RoutingDecision(
    target=TargetNode.MISTRAL,
    rationale="Fallback: supervisor failed to produce valid routing decision.",
    confidence=0.0,
    fallback=TargetNode.MISTRAL,
)

