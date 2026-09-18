"""Validate restore inputs without importing database configuration or clients."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

from app.schemas.auth import SeedUsers


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--file", type=Path, required=True)
    args = parser.parse_args()
    try:
        SeedUsers.model_validate(json.loads(args.file.read_text(encoding="utf-8")))
    except (OSError, ValueError):
        # Pydantic's detailed error can include submitted passwords. Never print it.
        print("Invalid restore seed: require exactly researcher01–researcher05, valid passwords and zh-CN locale", file=sys.stderr)
        return 1
    print("SURVEY_RESTORE_PREFLIGHT_V1 prepare-only seed-valid")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
