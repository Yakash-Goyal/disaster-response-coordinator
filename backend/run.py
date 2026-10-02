#!/usr/bin/env python3
"""Start the API (and the built frontend, if present).

    python run.py                 # http://localhost:8000
    python run.py --reload        # auto-reload for development
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import uvicorn  # noqa: E402

from app.config import settings  # noqa: E402

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Disaster Response Resource Coordinator")
    parser.add_argument("--host", default=settings.HOST)
    parser.add_argument("--port", type=int, default=settings.PORT)
    parser.add_argument("--reload", action="store_true", help="reload on code changes")
    args = parser.parse_args()

    uvicorn.run(
        "app.main:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
        log_level="info",
    )
