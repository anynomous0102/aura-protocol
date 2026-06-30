from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from pydantic import BaseModel, Field

from app.enterprise import normalized_database


router = APIRouter(prefix="/api/auth", tags=["auth"])
security = HTTPBearer(auto_error=False)
SECRET_KEY = os.getenv("JWT_SECRET", "aura-super-secret-key-change-in-production-2026")
ALGORITHM = "HS256"


class ProviderAuthRequest(BaseModel):
    provider: str = Field(..., min_length=2, max_length=64)
    provider_user_id: str = Field(..., min_length=2, max_length=256)
    name: str = Field(default="AURA User", max_length=255)
    email: str | None = Field(default=None, max_length=320)
    photo: str | None = None


class ProviderTokenRequest(BaseModel):
    provider: str = Field(..., min_length=2, max_length=64)
    access_token: str = Field(..., min_length=1, max_length=4096)


class GoogleTokenRequest(BaseModel):
    access_token: str = Field(..., min_length=1, max_length=4096)


class Web3AuthRequest(BaseModel):
    address: str = Field(..., min_length=4, max_length=128)
    signature: str = Field(default="", max_length=4096)
    message: str = Field(default="", max_length=4096)


def create_access_token(data: dict[str, Any], expires_delta: timedelta | None = None) -> str:
    expires = datetime.now(timezone.utc) + (expires_delta or timedelta(days=7))
    payload = {**data, "exp": expires}
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> str:
    if credentials is None:
        if os.getenv("AURA_ENVIRONMENT", "development").lower() != "production":
            return "anonymous"
        raise HTTPException(status_code=401, detail="Missing bearer token")
    try:
        payload = jwt.decode(credentials.credentials, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError as exc:
        raise HTTPException(status_code=401, detail="Invalid token") from exc
    subject = payload.get("sub")
    if not isinstance(subject, str) or not subject:
        raise HTTPException(status_code=401, detail="Invalid token subject")
    return subject


@router.get("/me")
async def me(current_user: str = Depends(get_current_user)) -> dict[str, Any]:
    return {"user": {"sub": current_user, "name": current_user}}


@router.post("/provider")
async def provider_login(request: ProviderAuthRequest) -> dict[str, Any]:
    user_id = f"{request.provider}:{request.provider_user_id}"
    await normalized_database.init_normalized_schema()
    async with normalized_database.SessionLocal() as db:
        async with db.begin():
            await normalized_database.upsert_user(db, user_id=user_id, name=request.name, email=request.email)
    token = create_access_token({"sub": user_id, "name": request.name})
    return {"access_token": token, "token_type": "bearer", "user": {"id": user_id, "name": request.name, "email": request.email}}


@router.post("/provider-token")
async def provider_token_login(request: ProviderTokenRequest) -> dict[str, Any]:
    label = request.access_token[-6:] if len(request.access_token) >= 6 else "local"
    user_id = f"{request.provider}:token:{label}"
    name = f"{request.provider.title()} User"
    await normalized_database.init_normalized_schema()
    async with normalized_database.SessionLocal() as db:
        async with db.begin():
            await normalized_database.upsert_user(db, user_id=user_id, name=name, email=user_id)
    token = create_access_token({"sub": user_id, "name": name, "email": user_id})
    return {"access_token": token, "token_type": "bearer", "user": {"id": user_id, "name": name, "email": user_id, "picture": None}}


@router.post("/google")
async def google_login(request: GoogleTokenRequest) -> dict[str, Any]:
    user_id = "google:local"
    name = "Google User"
    await normalized_database.init_normalized_schema()
    async with normalized_database.SessionLocal() as db:
        async with db.begin():
            await normalized_database.upsert_user(db, user_id=user_id, name=name, email=user_id)
    token = create_access_token({"sub": user_id, "name": name, "email": user_id})
    return {"access_token": token, "token_type": "bearer", "user": {"id": user_id, "name": name, "email": user_id, "picture": None}}


@router.post("/web3")
async def web3_login(request: Web3AuthRequest) -> dict[str, Any]:
    normalized_address = request.address.lower()
    user_id = f"did:eth:{normalized_address}"
    name = f"Wallet {normalized_address[:6]}...{normalized_address[-4:]}"
    await normalized_database.init_normalized_schema()
    async with normalized_database.SessionLocal() as db:
        async with db.begin():
            await normalized_database.upsert_user(db, user_id=user_id, name=name, email=user_id)
    token = create_access_token({"sub": user_id, "name": name, "email": user_id})
    return {"access_token": token, "token_type": "bearer", "user": {"id": user_id, "name": name, "email": user_id, "picture": None}}
