from __future__ import annotations

import re
from typing import Any, Dict, List, Literal, Optional, Sequence

import structlog
from pydantic import BaseModel, Field

try:
    import jmespath
    from jmespath.exceptions import JMESPathError
except Exception:  # pragma: no cover - fallback parser is used only when dependency is absent.
    jmespath = None

    class JMESPathError(Exception):
        """Fallback exception when jmespath is unavailable."""


log = structlog.get_logger(__name__)

HEALING_SYSTEM_PROMPT = """
You are a precise data navigation assistant for the AURA system.

Your ONLY job: Given a JSON schema description and a target field name, output a single valid JMESPath query string that retrieves that field.

OUTPUT RULES (strictly enforced):
- Output ONLY the JMESPath query string. Nothing else.
- No explanation, no markdown, no code blocks, no quotes around the result.
- No Python, JavaScript, or any executable code.
- Valid JMESPath examples: `users[0].profile.email`, `org.departments[?name=='Eng'].lead.email | [0]`

INVALID outputs (will be rejected and will cause system failure):
- data['users'][0]          <- Python syntax, INVALID
- users.map(u => u.email)  <- JavaScript, INVALID
- __import__('os').system() <- Code injection, INVALID
- eval(...)                 <- NEVER output this
"""

INJECTION_BLOCKLIST: List[str] = [
    "__",
    "import",
    "eval",
    "exec",
    "open",
    "os.",
    "sys.",
    "subprocess",
    "compile",
    "globals",
    "locals",
    "getattr",
    "setattr",
    "delattr",
    "vars",
    "dir(",
]


class HealingRequest(BaseModel):
    payload: Dict[str, Any]
    target_field: str = Field(..., max_length=200)
    schema_hint: Optional[str] = Field(default=None, max_length=500)


class HealingResponse(BaseModel):
    healed: bool
    value: Optional[Any] = None
    query_used: Optional[str] = None
    reason: Optional[Literal["query_rejected", "query_failed", "llm_error", "field_not_found"]] = None


def _is_query_safe(query: str) -> bool:
    query_lower = query.lower().strip()
    if not query_lower or len(query_lower) > 500:
        return False
    if (";" in query_lower) or ("=>" in query_lower):
        return False
    if re.search(r"\[['\"][^'\"]+['\"]\]", query_lower):
        return False
    if "(" in query_lower or ")" in query_lower:
        for pattern in INJECTION_BLOCKLIST:
            if pattern in query_lower:
                return False
    for pattern in INJECTION_BLOCKLIST:
        if pattern in query_lower:
            return False
    return True


def _fallback_dotted_search(query: str, payload: Dict[str, Any]) -> Optional[Any]:
    current: Any = payload
    for part in [item.strip() for item in query.split(".") if item.strip()]:
        filter_match = re.fullmatch(r"([A-Za-z_][\w-]*)\[\?([A-Za-z_][\w-]*)=='([^']+)'\]", part)
        index_match = re.fullmatch(r"([A-Za-z_][\w-]*)\[(\d+)\]", part)
        if filter_match:
            key, filter_key, filter_value = filter_match.groups()
            collection = current.get(key) if isinstance(current, dict) else None
            if not isinstance(collection, list):
                return None
            current = [item for item in collection if isinstance(item, dict) and item.get(filter_key) == filter_value]
            continue
        if index_match:
            key, index_text = index_match.groups()
            collection = current.get(key) if isinstance(current, dict) else None
            if not isinstance(collection, list):
                return None
            index = int(index_text)
            if index >= len(collection):
                return None
            current = collection[index]
            continue
        if isinstance(current, list):
            current = [item.get(part) for item in current if isinstance(item, dict) and part in item]
        elif isinstance(current, dict):
            current = current.get(part)
        else:
            return None
    return current


def execute_healing_query(query: str, payload: Dict[str, Any]) -> Optional[Any]:
    """
    Safely runs a JMESPath query against a payload.

    SECURITY INVARIANT: this function delegates to the JMESPath parser or a
    minimal dotted-path fallback. It never evaluates generated program text.
    """
    if not _is_query_safe(query):
        log.warning("healing_query_rejected", query=query[:100])
        return None
    try:
        if jmespath is not None:
            return jmespath.search(query, payload)
        return _fallback_dotted_search(query, payload)
    except JMESPathError as exc:
        log.warning("jmespath_parse_error", error=str(exc), query=query[:100])
        return None
    except Exception as exc:
        log.error("healing_unexpected_error", error=str(exc))
        return None


def _payload_schema_summary(value: Any, depth: int = 0) -> Any:
    if depth > 4:
        return "..."
    if isinstance(value, dict):
        return {str(key): _payload_schema_summary(child, depth + 1) for key, child in value.items()}
    if isinstance(value, list):
        return [_payload_schema_summary(value[0], depth + 1)] if value else []
    return type(value).__name__


def _find_field_paths(payload: Any, target_field: str, prefix: str = "") -> List[str]:
    paths: List[str] = []
    if isinstance(payload, dict):
        for key, value in payload.items():
            child_path = f"{prefix}.{key}" if prefix else str(key)
            if key == target_field:
                paths.append(child_path)
            paths.extend(_find_field_paths(value, target_field, child_path))
    elif isinstance(payload, list):
        for index, value in enumerate(payload[:1]):
            paths.extend(_find_field_paths(value, target_field, f"{prefix}[{index}]"))
    return paths


async def generate_healing_query(request: HealingRequest) -> str:
    direct_paths = _find_field_paths(request.payload, request.target_field)
    if direct_paths:
        return direct_paths[0]
    try:
        from openai import AsyncOpenAI

        client = AsyncOpenAI()
        response = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": HEALING_SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": (
                        f"Schema: {_payload_schema_summary(request.payload)}\n"
                        f"Target field: {request.target_field}\n"
                        f"Hint: {request.schema_hint or ''}"
                    ),
                },
            ],
            temperature=0,
        )
        return (response.choices[0].message.content or "").strip().strip("`").strip()
    except Exception as exc:
        log.warning("healing_llm_error", error=str(exc))
        raise


async def heal_payload(request: HealingRequest) -> HealingResponse:
    try:
        query = await generate_healing_query(request)
    except Exception:
        return HealingResponse(healed=False, reason="llm_error")
    if not _is_query_safe(query):
        return HealingResponse(healed=False, query_used=query, reason="query_rejected")
    value = execute_healing_query(query, request.payload)
    if value is None:
        return HealingResponse(healed=False, query_used=query, reason="field_not_found")
    return HealingResponse(healed=True, value=value, query_used=query)
