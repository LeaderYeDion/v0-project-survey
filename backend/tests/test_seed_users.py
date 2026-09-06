from __future__ import annotations

import json
import shutil
import stat
import subprocess
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.cli import reset_user_password, synchronize_seed_users
from app.security.passwords import hash_password, verify_password


ROOT = Path(__file__).resolve().parents[2]
EXPECTED_USERNAMES = [f"researcher0{i}" for i in range(1, 6)]


class FakeSeedRepository:
    def __init__(self) -> None:
        self.users: dict[str, SimpleNamespace] = {}

    async def create_user(
        self,
        username: str,
        password_hash: str,
        locale: str,
    ) -> SimpleNamespace:
        user = SimpleNamespace(
            id=uuid4(),
            username=username.strip().casefold(),
            password_hash=password_hash,
            locale=locale,
            is_active=True,
        )
        self.users[user.username] = user
        return user

    async def get_user_by_username(
        self,
        username: str,
    ) -> SimpleNamespace | None:
        return self.users.get(username.strip().casefold())

    async def update_password_hash(
        self,
        username: str,
        password_hash: str,
    ) -> bool:
        user = await self.get_user_by_username(username)
        if user is None:
            return False
        user.password_hash = password_hash
        return True


@pytest.fixture
def generated_deploy(tmp_path: Path) -> Path:
    project = tmp_path / "project"
    _copy_public_deploy_tree(project)
    subprocess.run(
        ["bash", "deploy/scripts/init-config.sh"],
        cwd=project,
        check=True,
        capture_output=True,
        text=True,
    )
    return project / "deploy"


@pytest.fixture
def seed_payload(generated_deploy: Path) -> list[dict[str, str]]:
    return json.loads(
        (generated_deploy / "config" / "seed-users.json").read_text()
    )


def test_seed_file_has_exactly_five_named_users(
    seed_payload: list[dict[str, str]],
) -> None:
    assert [item["username"] for item in seed_payload] == EXPECTED_USERNAMES
    assert all(len(item["password"]) >= 20 for item in seed_payload)
    assert len({item["password"] for item in seed_payload}) == 5
    assert {item["locale"] for item in seed_payload} == {"zh-CN"}


def test_generated_seed_file_is_private(generated_deploy: Path) -> None:
    seed_file = generated_deploy / "config" / "seed-users.json"
    mode = stat.S_IMODE(seed_file.stat().st_mode)

    assert mode == 0o600


def test_init_refuses_to_overwrite_an_existing_seed_file(
    tmp_path: Path,
) -> None:
    project = tmp_path / "project"
    _copy_public_deploy_tree(project)
    seed_file = project / "deploy" / "config" / "seed-users.json"
    seed_file.write_text("do-not-overwrite")

    result = subprocess.run(
        ["bash", "deploy/scripts/init-config.sh"],
        cwd=project,
        capture_output=True,
        text=True,
    )

    assert result.returncode != 0
    assert "refusing to overwrite credentials" in result.stderr
    assert seed_file.read_text() == "do-not-overwrite"
    assert not (project / "deploy" / "config" / "deploy.env").exists()


def test_example_seed_file_contains_only_non_secret_placeholders() -> None:
    payload = json.loads(
        (ROOT / "deploy" / "config" / "seed-users.example.json").read_text()
    )

    assert payload == [
        {
            "username": username,
            "password": "generated-at-init",
            "locale": "zh-CN",
        }
        for username in EXPECTED_USERNAMES
    ]


@pytest.mark.asyncio
async def test_seed_synchronization_is_idempotent_and_preserves_passwords(
    tmp_path: Path,
) -> None:
    repository = FakeSeedRepository()
    seed_file = tmp_path / "seed-users.json"
    seed_file.write_text(
        json.dumps(
            [
                {
                    "username": "researcher01",
                    "password": "first-generated-password",
                    "locale": "zh-CN",
                }
            ]
        )
    )

    assert await synchronize_seed_users(repository, seed_file) == 1
    original_hash = repository.users["researcher01"].password_hash
    seed_file.write_text(
        json.dumps(
            [
                {
                    "username": "researcher01",
                    "password": "different-generated-password",
                    "locale": "en-US",
                }
            ]
        )
    )

    assert await synchronize_seed_users(repository, seed_file) == 0
    assert repository.users["researcher01"].password_hash == original_hash
    assert verify_password("first-generated-password", original_hash)
    assert repository.users["researcher01"].locale == "zh-CN"


@pytest.mark.asyncio
async def test_reset_password_replaces_only_the_named_users_hash() -> None:
    repository = FakeSeedRepository()
    await repository.create_user(
        "researcher01",
        hash_password("original-password-value"),
        "zh-CN",
    )

    await reset_user_password(
        repository,
        username="researcher01",
        password="replacement-password-value",
    )

    stored = repository.users["researcher01"].password_hash
    assert verify_password("replacement-password-value", stored)
    assert not verify_password("original-password-value", stored)


def _copy_public_deploy_tree(project: Path) -> None:
    shutil.copytree(
        ROOT / "deploy",
        project / "deploy",
        ignore=shutil.ignore_patterns(
            "deploy.env",
            "seed-users.json",
            "runtime",
        ),
    )
