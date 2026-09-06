from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path
from typing import Protocol, Sequence

from app.db.session import DatabaseSettings, create_session_factory
from app.repositories.auth import AuthRepository
from app.repositories.protocols import AuthRepositoryProtocol
from app.schemas.auth import SeedUsers
from app.security.passwords import hash_password


class PasswordResetRepositoryProtocol(Protocol):
    async def update_password_hash(
        self,
        username: str,
        password_hash: str,
    ) -> bool: ...


async def synchronize_seed_users(
    repository: AuthRepositoryProtocol,
    path: Path,
) -> int:
    payload = json.loads(path.read_text(encoding="utf-8"))
    users = SeedUsers.model_validate(payload).root
    created = 0
    for seed_user in users:
        existing = await repository.get_user_by_username(seed_user.username)
        if existing is not None:
            continue
        await repository.create_user(
            seed_user.username,
            hash_password(seed_user.password),
            seed_user.locale,
        )
        created += 1
    return created


async def reset_user_password(
    repository: PasswordResetRepositoryProtocol,
    *,
    username: str,
    password: str,
) -> None:
    if len(password) < 20:
        raise ValueError("Password must contain at least 20 characters")
    changed = await repository.update_password_hash(
        username,
        hash_password(password),
    )
    if not changed:
        raise ValueError(f"Unknown user: {username}")


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    commands = parser.add_subparsers(dest="command", required=True)

    seed = commands.add_parser("seed-users")
    seed.add_argument("--file", required=True, type=Path)

    reset = commands.add_parser("reset-password")
    reset.add_argument("--username", required=True)
    reset.add_argument("--password", required=True)
    return parser


async def _run(
    argv: Sequence[str] | None = None,
    repository: AuthRepository | None = None,
) -> int:
    args = _parser().parse_args(argv)
    store = repository or AuthRepository(
        create_session_factory(DatabaseSettings.from_env().url)
    )
    if args.command == "seed-users":
        created = await synchronize_seed_users(store, args.file)
        print(f"Created {created} missing user(s)")
        return 0

    await reset_user_password(
        store,
        username=args.username,
        password=args.password,
    )
    print(f"Reset password for {args.username}")
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    return asyncio.run(_run(argv))


if __name__ == "__main__":
    raise SystemExit(main())
