from __future__ import annotations

import os
import sys
from pathlib import Path


def main() -> int:
    if hasattr(os, "geteuid") and os.geteuid() == 0:
        print("AURA runtime permission check failed: process is running as root.", file=sys.stderr)
        return 1

    root = Path(os.getenv("AURA_PERMISSION_ROOT", "/app/backend/app")).resolve()
    writable = []
    for path in root.rglob("*.py"):
        if os.access(path, os.W_OK):
            writable.append(str(path))
            if len(writable) >= 20:
                break

    if writable:
        print("AURA runtime permission check failed: Python files are writable:", file=sys.stderr)
        for item in writable:
            print(item, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
