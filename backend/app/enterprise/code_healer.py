from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import traceback
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field, ValidationError
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.enterprise.database import IS_COCKROACH, IS_POSTGRES, execute, fetch_all, fetch_one


class SentinelPatchRequest(BaseModel):
    diagnostic_id: int | None = None
    relative_path: str = Field(..., max_length=260)
    old_text: str = Field(..., min_length=1, max_length=20000)
    new_text: str = Field(..., min_length=1, max_length=20000)
    reason: str = Field(..., min_length=3, max_length=1000)


class SentinelPatchResult(BaseModel):
    status: Literal["staged", "committed", "rejected"]
    relative_path: str
    reason: str


class SentinelDiagnosis(BaseModel):
    root_cause: str = Field(default="Manual review required.", max_length=1000)
    suggested_code: str = Field(default="Manual review required.", max_length=20000)


class SentinelApprovalRequest(BaseModel):
    diagnostic_id: int
    admin_id: str = Field(..., min_length=3, max_length=128)
    staged_patch_sha256: str = Field(..., min_length=64, max_length=64)
    expires_at: int = Field(..., gt=0)
    signature: str = Field(..., min_length=32, max_length=512)


@dataclass(frozen=True)
class SentinelPolicy:
    repo_root: Path
    allowed_roots: tuple[Path, ...]
    mutation_enabled: bool

    @classmethod
    def from_env(cls) -> "SentinelPolicy":
        repo_root = Path(os.getenv("AURA_REPO_ROOT", Path(__file__).resolve().parents[3])).resolve()
        raw_roots = os.getenv("AURA_SENTINEL_ALLOWED_ROOTS", "backend/app")
        allowed_roots = tuple((repo_root / item.strip()).resolve() for item in raw_roots.split(",") if item.strip())
        mutation_enabled = os.getenv("AURA_SENTINEL_MUTATION_ENABLED", "").lower() in {"1", "true", "yes"}
        return cls(repo_root=repo_root, allowed_roots=allowed_roots, mutation_enabled=mutation_enabled)

    def resolve_allowed_path(self, relative_path: str) -> Path:
        if Path(relative_path).is_absolute() or ".." in Path(relative_path).parts:
            raise PermissionError("Sentinel patch path must be relative and cannot traverse parents.")
        target = (self.repo_root / relative_path).resolve()
        if target.suffix != ".py":
            raise PermissionError("Sentinel can only mutate Python source files.")
        if not any(target == root or root in target.parents for root in self.allowed_roots):
            raise PermissionError("Sentinel patch target is outside allowed roots.")
        return target


async def init_sentinel_schema() -> None:
    if IS_COCKROACH:
        serial_pk = "INT8 PRIMARY KEY DEFAULT unique_rowid()"
    else:
        serial_pk = "BIGSERIAL PRIMARY KEY" if IS_POSTGRES else "INTEGER PRIMARY KEY AUTOINCREMENT"
    await execute(
        f"""
        CREATE TABLE IF NOT EXISTS code_diagnostics (
            id {serial_pk},
            endpoint TEXT NOT NULL,
            error_message TEXT NOT NULL,
            traceback TEXT NOT NULL,
            ai_root_cause TEXT,
            ai_suggested_code TEXT,
            staged_patch_ciphertext TEXT,
            staged_patch_nonce TEXT,
            staged_patch_sha256 TEXT,
            status TEXT DEFAULT 'PENDING_REVIEW',
            created_at TEXT NOT NULL
        )
        """
    )
    for statement in (
        "ALTER TABLE code_diagnostics ADD COLUMN staged_patch_ciphertext TEXT",
        "ALTER TABLE code_diagnostics ADD COLUMN staged_patch_nonce TEXT",
        "ALTER TABLE code_diagnostics ADD COLUMN staged_patch_sha256 TEXT",
        "ALTER TABLE code_diagnostics ADD COLUMN approved_by TEXT",
        "ALTER TABLE code_diagnostics ADD COLUMN approved_at TEXT",
    ):
        try:
            await execute(statement)
        except Exception:
            pass
    await execute(
        f"""
        CREATE TABLE IF NOT EXISTS sentinel_patch_log (
            id {serial_pk},
            diagnostic_id INTEGER,
            relative_path TEXT NOT NULL,
            reason TEXT NOT NULL,
            status TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
        """
    )


def _extract_json_object(value: str) -> dict[str, Any]:
    match = re.search(r"\{.*\}", value.strip(), flags=re.DOTALL)
    if not match:
        raise ValueError("AI response did not contain a JSON object.")
    return json.loads(match.group(0))


class SentinelCodeHealer:
    def __init__(self, *, api_key: str = "", policy: SentinelPolicy | None = None) -> None:
        self.api_key = api_key
        self.policy = policy or SentinelPolicy.from_env()

    async def diagnose(self, endpoint: str, error_message: str, traceback_text: str) -> SentinelDiagnosis:
        if not self.api_key:
            return SentinelDiagnosis(root_cause="Sentinel AI key is not configured.", suggested_code="Manual review required.")

        def _call_model() -> SentinelDiagnosis:
            import google.generativeai as genai

            genai.configure(api_key=self.api_key)
            model = genai.GenerativeModel(os.getenv("AURA_SENTINEL_MODEL", "gemini-1.5-pro"))
            prompt = (
                "You are AURA Sentinel, a principal FastAPI reliability engineer. "
                "Analyze this crash and return only JSON with root_cause and suggested_code.\n\n"
                f"ENDPOINT: {endpoint}\nERROR: {error_message}\nTRACEBACK:\n{traceback_text}"
            )
            response = model.generate_content(prompt)
            parsed = _extract_json_object(getattr(response, "text", "") or "")
            return SentinelDiagnosis.model_validate(parsed)

        try:
            return await asyncio.to_thread(_call_model)
        except (ValidationError, ValueError, json.JSONDecodeError) as exc:
            return SentinelDiagnosis(root_cause=f"Sentinel response was invalid JSON: {exc}", suggested_code="Manual review required.")
        except Exception as exc:
            return SentinelDiagnosis(root_cause=f"Sentinel diagnosis failed: {exc}", suggested_code="Manual review required.")

    async def record_diagnostic(self, endpoint: str, error_message: str, traceback_text: str, diagnosis: SentinelDiagnosis) -> None:
        await init_sentinel_schema()
        await execute(
            """
            INSERT INTO code_diagnostics(endpoint, error_message, traceback, ai_root_cause, ai_suggested_code, status, created_at)
            VALUES (:endpoint, :error_message, :traceback, :ai_root_cause, :ai_suggested_code, :status, :created_at)
            """,
            {
                "endpoint": endpoint,
                "error_message": error_message,
                "traceback": traceback_text,
                "ai_root_cause": diagnosis.root_cause,
                "ai_suggested_code": diagnosis.suggested_code,
                "status": "PENDING_APPROVAL",
                "created_at": datetime.now(timezone.utc).isoformat(),
            },
        )

    async def commit_patch(self, request: SentinelPatchRequest) -> SentinelPatchResult:
        return await self.stage_patch(request)

    async def stage_patch(self, request: SentinelPatchRequest) -> SentinelPatchResult:
        await init_sentinel_schema()
        try:
            target = self.policy.resolve_allowed_path(request.relative_path)
            current = target.read_text(encoding="utf-8")
            if request.old_text not in current:
                await self._log_patch(request, "rejected")
                return SentinelPatchResult(status="rejected", relative_path=request.relative_path, reason="old_text was not found.")
            diagnostic_id = await self._ensure_diagnostic_for_patch(request)
            nonce, ciphertext, digest = self._encrypt_patch(request)
            await execute(
                """
                UPDATE code_diagnostics
                SET staged_patch_ciphertext=:ciphertext,
                    staged_patch_nonce=:nonce,
                    staged_patch_sha256=:digest,
                    status='PENDING_APPROVAL'
                WHERE id=:diagnostic_id
                """,
                {
                    "ciphertext": ciphertext,
                    "nonce": nonce,
                    "digest": digest,
                    "diagnostic_id": diagnostic_id,
                },
            )
            staged_request = request.model_copy(update={"diagnostic_id": diagnostic_id})
            await self._log_patch(staged_request, "PENDING_APPROVAL")
            return SentinelPatchResult(status="staged", relative_path=request.relative_path, reason="Patch staged pending admin approval.")
        except PermissionError as exc:
            await self._log_patch(request, "rejected")
            return SentinelPatchResult(status="rejected", relative_path=request.relative_path, reason=str(exc))

    async def approve_patch(self, request: SentinelApprovalRequest) -> SentinelPatchResult:
        await init_sentinel_schema()
        row = await fetch_one(
            """
            SELECT id, staged_patch_ciphertext, staged_patch_nonce, staged_patch_sha256, status
            FROM code_diagnostics
            WHERE id=:diagnostic_id
            """,
            {"diagnostic_id": request.diagnostic_id},
        )
        if not row:
            return SentinelPatchResult(status="rejected", relative_path="", reason="Diagnostic not found.")
        if row.get("status") != "PENDING_APPROVAL":
            return SentinelPatchResult(status="rejected", relative_path="", reason="Patch is not pending approval.")
        staged_digest = str(row.get("staged_patch_sha256") or "")
        if not row.get("staged_patch_ciphertext") or not row.get("staged_patch_nonce") or not staged_digest:
            return SentinelPatchResult(status="rejected", relative_path="", reason="Diagnostic has no staged patch.")
        if not hmac.compare_digest(staged_digest, request.staged_patch_sha256):
            raise PermissionError("Approval digest does not match staged patch.")
        self._verify_admin_signature(request)
        patch = self._decrypt_patch(
            str(row["staged_patch_nonce"]),
            str(row["staged_patch_ciphertext"]),
            staged_digest,
        )
        patch_request = SentinelPatchRequest.model_validate({**patch, "diagnostic_id": request.diagnostic_id})
        if not self.policy.mutation_enabled:
            await self._log_patch(patch_request, "rejected")
            return SentinelPatchResult(status="rejected", relative_path=patch_request.relative_path, reason="Sentinel mutation is disabled.")
        target = self.policy.resolve_allowed_path(patch_request.relative_path)
        current = target.read_text(encoding="utf-8")
        if patch_request.old_text not in current:
            await self._log_patch(patch_request, "rejected")
            return SentinelPatchResult(status="rejected", relative_path=patch_request.relative_path, reason="old_text was not found.")
        self._atomic_replace_once(target, current.replace(patch_request.old_text, patch_request.new_text, 1))
        await execute(
            """
            UPDATE code_diagnostics
            SET status='APPROVED_COMMITTED', approved_by=:approved_by, approved_at=:approved_at
            WHERE id=:diagnostic_id
            """,
            {
                "approved_by": request.admin_id,
                "approved_at": datetime.now(timezone.utc).isoformat(),
                "diagnostic_id": request.diagnostic_id,
            },
        )
        await self._log_patch(patch_request, "committed")
        return SentinelPatchResult(status="committed", relative_path=patch_request.relative_path, reason="Approved patch committed.")

    async def _ensure_diagnostic_for_patch(self, request: SentinelPatchRequest) -> int:
        if request.diagnostic_id is not None:
            return request.diagnostic_id
        row = await fetch_one(
            """
            INSERT INTO code_diagnostics(endpoint, error_message, traceback, ai_root_cause, ai_suggested_code, status, created_at)
            VALUES (:endpoint, :error_message, :traceback, :ai_root_cause, :ai_suggested_code, :status, :created_at)
            RETURNING id
            """,
            {
                "endpoint": "sentinel/manual-patch",
                "error_message": request.reason,
                "traceback": "",
                "ai_root_cause": request.reason,
                "ai_suggested_code": request.new_text,
                "status": "PENDING_APPROVAL",
                "created_at": datetime.now(timezone.utc).isoformat(),
            },
        )
        if row and row.get("id") is not None:
            return int(row["id"])
        row = await fetch_one(
            """
            SELECT id
            FROM code_diagnostics
            WHERE endpoint='sentinel/manual-patch'
              AND error_message=:error_message
              AND created_at=(SELECT MAX(created_at) FROM code_diagnostics WHERE endpoint='sentinel/manual-patch')
            """,
            {"error_message": request.reason},
        )
        return int(row["id"])

    def _encryption_key(self) -> bytes:
        raw = os.getenv("AURA_SENTINEL_PATCH_KEY", "").strip()
        if raw:
            try:
                key = base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4))
                if len(key) == 32:
                    return key
            except Exception:
                pass
        seed = os.getenv("JWT_SECRET", "aura-dev-sentinel-patch-key")
        return hashlib.sha256(seed.encode("utf-8")).digest()

    def _encrypt_patch(self, request: SentinelPatchRequest) -> tuple[str, str, str]:
        payload = request.model_dump_json(exclude={"diagnostic_id"}).encode("utf-8")
        nonce = secrets.token_bytes(12)
        ciphertext = AESGCM(self._encryption_key()).encrypt(nonce, payload, None)
        digest = hashlib.sha256(payload).hexdigest()
        return (
            base64.urlsafe_b64encode(nonce).decode("ascii"),
            base64.urlsafe_b64encode(ciphertext).decode("ascii"),
            digest,
        )

    def _decrypt_patch(self, nonce: str, ciphertext: str, expected_digest: str) -> dict[str, Any]:
        plaintext = AESGCM(self._encryption_key()).decrypt(
            base64.urlsafe_b64decode(nonce),
            base64.urlsafe_b64decode(ciphertext),
            None,
        )
        digest = hashlib.sha256(plaintext).hexdigest()
        if not hmac.compare_digest(digest, expected_digest):
            raise PermissionError("Staged patch digest mismatch.")
        return json.loads(plaintext)

    def _verify_admin_signature(self, request: SentinelApprovalRequest) -> None:
        if request.expires_at < int(datetime.now(timezone.utc).timestamp()):
            raise PermissionError("Approval signature expired.")
        secret = os.getenv("AURA_SENTINEL_ADMIN_HMAC_SECRET", "").encode("utf-8")
        if not secret:
            raise PermissionError("Sentinel admin approval secret is not configured.")
        message = f"approve-patch:{request.diagnostic_id}:{request.staged_patch_sha256}:{request.admin_id}:{request.expires_at}".encode("utf-8")
        expected = hmac.new(secret, message, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, request.signature):
            raise PermissionError("Invalid Sentinel admin approval signature.")

    def _atomic_replace_once(self, target: Path, content: str) -> None:
        temporary = target.with_name(f".{target.name}.{secrets.token_hex(8)}.tmp")
        temporary.write_text(content, encoding="utf-8")
        os.replace(temporary, target)

    async def _log_patch(self, request: SentinelPatchRequest, status: str) -> None:
        await execute(
            """
            INSERT INTO sentinel_patch_log(diagnostic_id, relative_path, reason, status, created_at)
            VALUES (:diagnostic_id, :relative_path, :reason, :status, :created_at)
            """,
            {
                "diagnostic_id": request.diagnostic_id,
                "relative_path": request.relative_path,
                "reason": request.reason,
                "status": status,
                "created_at": datetime.now(timezone.utc).isoformat(),
            },
        )

    async def diagnostics(self) -> list[dict[str, Any]]:
        await init_sentinel_schema()
        return await fetch_all(
            """
            SELECT id, endpoint, error_message, traceback, ai_root_cause, ai_suggested_code,
                   staged_patch_sha256, status, created_at, approved_by, approved_at
            FROM code_diagnostics
            ORDER BY id DESC
            LIMIT 100
            """
        )


class SentinelCodeHealerMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, *, api_key: str = "", enabled: bool = True) -> None:
        super().__init__(app)
        self.enabled = enabled
        self.healer = SentinelCodeHealer(api_key=api_key)

    async def dispatch(self, request: Request, call_next) -> Response:
        try:
            return await call_next(request)
        except Exception as exc:
            if not self.enabled:
                raise
            endpoint = str(request.url.path)
            error_message = str(exc)
            traceback_text = traceback.format_exc()
            diagnosis = await self.healer.diagnose(endpoint, error_message, traceback_text)
            await self.healer.record_diagnostic(endpoint, error_message, traceback_text, diagnosis)
            return JSONResponse(
                status_code=500,
                content={
                    "error": "Internal Server Error",
                    "sentinel_status": "Crash intercepted and diagnostic recorded.",
                },
            )
