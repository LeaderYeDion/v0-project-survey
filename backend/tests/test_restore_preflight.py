from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest


def test_restore_preflight_validates_five_users_without_database(tmp_path: Path) -> None:
    payload = [
        {"username": f"researcher0{i}", "password": f"private-seed-password-{i}", "locale": "zh-CN"}
        for i in range(1, 6)
    ]
    seed = tmp_path / "seed.json"
    seed.write_text(json.dumps(payload))
    result = subprocess.run(
        [sys.executable, "-m", "app.restore_preflight", "--file", str(seed)],
        cwd=Path(__file__).resolve().parents[1],
        env={**os.environ, "DATABASE_URL": "invalid-must-not-be-read"},
        capture_output=True, text=True,
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "SURVEY_RESTORE_PREFLIGHT_V1 prepare-only seed-valid"
    assert "private-seed" not in result.stdout + result.stderr


@pytest.mark.parametrize("invalid", ["malformed", "count", "duplicate", "password", "locale"])
def test_restore_preflight_rejects_invalid_seed_without_exposing_values(tmp_path: Path, invalid: str) -> None:
    payload = [
        {"username": f"researcher0{i}", "password": f"private-seed-password-{i}", "locale": "zh-CN"}
        for i in range(1, 6)
    ]
    if invalid == "count":
        payload.pop()
    elif invalid == "duplicate":
        payload[-1]["username"] = "researcher01"
    elif invalid == "password":
        payload[-1]["password"] = "secret-short"
    elif invalid == "locale":
        payload[-1]["locale"] = "en-US"
    seed = tmp_path / "seed.json"
    seed.write_text("private-seed-malformed" if invalid == "malformed" else json.dumps(payload))
    result = subprocess.run(
        [sys.executable, "-m", "app.restore_preflight", "--file", str(seed)],
        cwd=Path(__file__).resolve().parents[1],
        env={**os.environ, "DATABASE_URL": "invalid-must-not-be-read"},
        capture_output=True, text=True,
    )
    assert result.returncode != 0
    assert "Invalid restore seed" in result.stderr
    assert "SURVEY_RESTORE_PREFLIGHT_V1" not in result.stdout
    assert "private-seed" not in result.stdout + result.stderr
    assert "secret-short" not in result.stdout + result.stderr
