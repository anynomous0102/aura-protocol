from __future__ import annotations

import os
import stat
from pathlib import Path


class RuntimePermissionError(RuntimeError):
    pass


def _is_windows() -> bool:
    return os.name == "nt"


def assert_non_root_runtime() -> None:
    if _is_windows():
        return
    if hasattr(os, "geteuid") and os.geteuid() == 0:
        raise RuntimePermissionError("AURA API workers must not run as root.")


def assert_python_tree_read_only(root: str | os.PathLike[str]) -> None:
    """Fail startup if Python source files are writable by this process."""

    if os.getenv("AURA_SKIP_PERMISSION_GUARD", "").lower() in {"1", "true", "yes"}:
        return

    root_path = Path(root).resolve()
    if not root_path.exists():
        raise RuntimePermissionError(f"Permission guard root does not exist: {root_path}")

    assert_non_root_runtime()
    if _is_windows():
        return

    writable_files: list[str] = []
    for path in root_path.rglob("*.py"):
        mode = path.stat().st_mode
        if mode & (stat.S_IWUSR | stat.S_IWGRP | stat.S_IWOTH):
            writable_files.append(str(path))
            if len(writable_files) >= 10:
                break

    if writable_files:
        joined = ", ".join(writable_files)
        raise RuntimePermissionError(f"AURA API source tree must be read-only. Writable files: {joined}")
