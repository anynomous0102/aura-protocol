from __future__ import annotations

import os
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, File, Form, UploadFile


router = APIRouter(prefix="/api", tags=["upload"])


@router.post("/upload")
async def upload(user_id: Annotated[str, Form()] = "anonymous", files: list[UploadFile] = File(default_factory=list)) -> dict[str, object]:
    data_dir = Path(os.getenv("AURA_DATA_DIR", Path(__file__).resolve().parents[3] / "data"))
    upload_dir = data_dir / "uploads" / user_id.replace("/", "_").replace("\\", "_")
    upload_dir.mkdir(parents=True, exist_ok=True)
    saved: list[str] = []
    for item in files:
        target = upload_dir / Path(item.filename or "upload.bin").name
        target.write_bytes(await item.read())
        saved.append(target.name)
    return {"status": "success", "files": saved}
