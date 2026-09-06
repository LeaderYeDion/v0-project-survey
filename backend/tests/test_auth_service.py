from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest

from app.api.errors import ApiError
from app.security.passwords import hash_password, verify_password
from app.security.sessions import hash_token
from app.services.auth_service import AuthService


class FakeAuthRepository:
    def __init__(self) -> None:
        self.users: dict[str, SimpleNamespace] = {}
        self.sessions: dict[str, SimpleNamespace] = {}

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

    async def get_user(self, user_id: UUID) -> SimpleNamespace | None:
        return next(
            (user for user in self.users.values() if user.id == user_id),
            None,
        )

    async def create_session(
        self,
        user_id: UUID,
        token_hash: str,
        csrf_token_hash: str,
        expires_at: datetime,
    ) -> SimpleNamespace:
        session = SimpleNamespace(
            id=uuid4(),
            user_id=user_id,
            token_hash=token_hash,
            csrf_token_hash=csrf_token_hash,
            expires_at=expires_at,
            revoked_at=None,
        )
        self.sessions[token_hash] = session
        return session

    async def get_session_by_token_hash(
        self,
        token_hash: str,
    ) -> SimpleNamespace | None:
        return self.sessions.get(token_hash)

    async def revoke_session(self, token_hash: str) -> None:
        session = self.sessions.get(token_hash)
        if session is not None:
            session.revoked_at = datetime.now(UTC)


@pytest.fixture
def auth_repository() -> FakeAuthRepository:
    return FakeAuthRepository()


@pytest.fixture
def clock() -> dict[str, datetime]:
    return {"now": datetime(2026, 9, 5, 12, 0, tzinfo=UTC)}


@pytest.fixture
def auth_service(
    auth_repository: FakeAuthRepository,
    clock: dict[str, datetime],
) -> AuthService:
    return AuthService(
        auth_repository,
        session_ttl=timedelta(hours=8),
        now=lambda: clock["now"],
    )


@pytest.mark.asyncio
async def test_login_stores_only_hashes(
    auth_service: AuthService,
    auth_repository: FakeAuthRepository,
) -> None:
    await auth_repository.create_user(
        "researcher01",
        hash_password("Initial-01!"),
        "zh-CN",
    )

    created = await auth_service.login("researcher01", "Initial-01!")

    stored = await auth_repository.get_session_by_token_hash(
        hash_token(created.token)
    )
    assert stored is not None
    assert stored.token_hash != created.token
    assert stored.csrf_token_hash != created.csrf_token
    assert created.cookie.http_only is True
    assert created.cookie.same_site == "strict"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("username", "password"),
    [("missing", "Initial-01!"), ("researcher01", "wrong-password")],
)
async def test_login_rejects_bad_credentials_with_stable_error(
    auth_service: AuthService,
    auth_repository: FakeAuthRepository,
    username: str,
    password: str,
) -> None:
    await auth_repository.create_user(
        "researcher01",
        hash_password("Initial-01!"),
        "zh-CN",
    )

    with pytest.raises(ApiError) as caught:
        await auth_service.login(username, password)

    assert caught.value.status_code == 401
    assert caught.value.code == "AUTH_INVALID_CREDENTIALS"


@pytest.mark.asyncio
async def test_authenticate_returns_current_user_and_normalizes_username(
    auth_service: AuthService,
    auth_repository: FakeAuthRepository,
) -> None:
    user = await auth_repository.create_user(
        "researcher01",
        hash_password("Initial-01!"),
        "zh-CN",
    )

    created = await auth_service.login(" Researcher01 ", "Initial-01!")
    current = await auth_service.authenticate(created.token)

    assert current.id == user.id
    assert current.username == "researcher01"
    assert current.locale == "zh-CN"


@pytest.mark.asyncio
async def test_expired_revoked_and_inactive_sessions_share_stable_error(
    auth_service: AuthService,
    auth_repository: FakeAuthRepository,
    clock: dict[str, datetime],
) -> None:
    user = await auth_repository.create_user(
        "researcher01",
        hash_password("Initial-01!"),
        "zh-CN",
    )
    expired = await auth_service.login("researcher01", "Initial-01!")
    clock["now"] += timedelta(hours=9)

    with pytest.raises(ApiError) as expired_error:
        await auth_service.authenticate(expired.token)
    assert expired_error.value.code == "AUTH_SESSION_EXPIRED"

    clock["now"] -= timedelta(hours=9)
    revoked = await auth_service.login("researcher01", "Initial-01!")
    await auth_service.logout(revoked.token)
    with pytest.raises(ApiError) as revoked_error:
        await auth_service.authenticate(revoked.token)
    assert revoked_error.value.code == "AUTH_SESSION_EXPIRED"

    inactive = await auth_service.login("researcher01", "Initial-01!")
    user.is_active = False
    with pytest.raises(ApiError) as inactive_error:
        await auth_service.authenticate(inactive.token)
    assert inactive_error.value.code == "AUTH_SESSION_EXPIRED"


@pytest.mark.asyncio
async def test_csrf_validation_uses_the_stored_hash(
    auth_service: AuthService,
    auth_repository: FakeAuthRepository,
) -> None:
    await auth_repository.create_user(
        "researcher01",
        hash_password("Initial-01!"),
        "en-US",
    )
    created = await auth_service.login("researcher01", "Initial-01!")

    await auth_service.validate_csrf(created.token, created.csrf_token)
    with pytest.raises(ApiError) as caught:
        await auth_service.validate_csrf(created.token, "wrong-token")

    assert caught.value.status_code == 403
    assert caught.value.code == "AUTH_CSRF_INVALID"
