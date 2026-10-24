"""The backend artifact must boot without files outside its build context."""

import os
from pathlib import Path
import shutil
import subprocess
import sys


def test_backend_app_imports_with_only_packaged_application(tmp_path: Path) -> None:
    source = Path(__file__).resolve().parents[1] / "app"
    artifact = tmp_path / "standalone" / "app"
    artifact.mkdir(parents=True)
    shutil.copytree(source, artifact / "app", ignore=shutil.ignore_patterns("__pycache__"))
    environment = {**os.environ, "PYTHONPATH": str(artifact), "DATABASE_URL": ""}
    probe = "\n".join([
        "from app.main import app",
        "from app.mocks.catalog import MockCatalog",
        "assert MockCatalog().default_template('zh-CN', 'survey').questions",
        "assert MockCatalog().default_template('en-US', 'interview').questions",
    ])
    result = subprocess.run(
        [sys.executable, "-c", probe],
        cwd=artifact,
        env=environment,
        capture_output=True,
        text=True,
        timeout=20,
    )
    assert result.returncode == 0, result.stderr
