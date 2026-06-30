from __future__ import annotations

from pathlib import Path

import uvicorn
from dotenv import load_dotenv


ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env", override=True)


if __name__ == "__main__":
    uvicorn.run("main:app", host="127.0.0.1", port=8000)
