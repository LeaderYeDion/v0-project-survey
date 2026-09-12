from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from uuid import UUID, uuid4

import httpx
import pytest

from app.main import create_app
from app.security.passwords import hash_password
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
async def client(auth_repository: FakeAuthRepository):
    await auth_repository.create_user(
        "researcher01",
        hash_password("Initial-01!"),
        "zh-CN",
    )
    application = create_app(auth_service=AuthService(auth_repository))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=application),
        base_url="https://survey.test",
    ) as api_client:
        yield api_client


@pytest.mark.asyncio
async def test_login_sets_private_session_and_double_submit_cookies(
    client: httpx.AsyncClient,
) -> None:
    response = await client.post(
        "/api/auth/login",
        json={"username": "researcher01", "password": "Initial-01!"},
    )

    assert response.status_code == 200
    assert response.json()["username"] == "researcher01"
    assert "token" not in response.json()
    cookies = response.headers.get_list("set-cookie")
    session_cookie = next(
        value for value in cookies if value.startswith("survey_session=")
    )
    csrf_cookie = next(
        value for value in cookies if value.startswith("survey_csrf=")
    )
    assert "HttpOnly" in session_cookie
    assert "SameSite=strict" in session_cookie
    assert "Secure" in session_cookie
    assert "HttpOnly" not in csrf_cookie
    assert "SameSite=strict" in csrf_cookie

    me = await client.get("/api/auth/me")
    assert me.status_code == 200
    assert me.json()["locale"] == "zh-CN"


@pytest.mark.asyncio
async def test_bad_credentials_use_the_stable_error_shape(
    client: httpx.AsyncClient,
) -> None:
    response = await client.post(
        "/api/auth/login",
        json={"username": "researcher01", "password": "wrong"},
    )

    assert response.status_code == 401
    assert response.json() == {
        "code": "AUTH_INVALID_CREDENTIALS",
        "message": "Invalid username or password",
        "details": None,
    }


@pytest.mark.asyncio
async def test_login_request_validation_uses_the_stable_error_shape(
    client: httpx.AsyncClient,
) -> None:
    missing_password = await client.post(
        "/api/auth/login",
        json={"username": "researcher01"},
    )
    malformed_json = await client.post(
        "/api/auth/login",
        content="{",
        headers={"Content-Type": "application/json"},
    )

    for response in (missing_password, malformed_json):
        assert response.status_code == 422
        payload = response.json()
        assert payload["code"] == "REQUEST_VALIDATION_ERROR"
        assert payload["message"] == "Request validation failed"
        assert isinstance(payload["details"], list)
        assert payload["details"]
        assert "detail" not in payload


@pytest.mark.asyncio
async def test_missing_session_uses_the_stable_expired_error(
    client: httpx.AsyncClient,
) -> None:
    response = await client.get("/api/auth/me")

    assert response.status_code == 401
    assert response.json()["code"] == "AUTH_SESSION_EXPIRED"


@pytest.mark.asyncio
async def test_authenticated_logout_requires_csrf_and_same_origin(
    client: httpx.AsyncClient,
) -> None:
    logged_in = await client.post(
        "/api/auth/login",
        json={"username": "researcher01", "password": "Initial-01!"},
    )
    csrf_token = logged_in.cookies["survey_csrf"]

    missing_header = await client.post(
        "/api/auth/logout",
        headers={"Origin": "https://survey.test"},
    )
    assert missing_header.status_code == 403
    assert missing_header.json()["code"] == "CSRF_INVALID"

    wrong_origin = await client.post(
        "/api/auth/logout",
        headers={
            "Origin": "https://attacker.test",
            "X-CSRF-Token": csrf_token,
        },
    )
    assert wrong_origin.status_code == 403
    assert wrong_origin.json()["code"] == "CSRF_INVALID"

    logged_out = await client.post(
        "/api/auth/logout",
        headers={
            "Origin": "https://survey.test",
            "X-CSRF-Token": csrf_token,
        },
    )
    assert logged_out.status_code == 204
    assert client.cookies.get("survey_session") is None
    assert client.cookies.get("survey_csrf") is None

    expired = await client.get("/api/auth/me")
    assert expired.status_code == 401
    assert expired.json()["code"] == "AUTH_SESSION_EXPIRED"


@pytest.mark.asyncio
async def test_authenticated_mutation_requires_matching_csrf_cookie(
    client: httpx.AsyncClient,
) -> None:
    logged_in = await client.post(
        "/api/auth/login",
        json={"username": "researcher01", "password": "Initial-01!"},
    )
    csrf_token = logged_in.cookies["survey_csrf"]
    client.cookies.set("survey_csrf", "different-cookie-value")

    response = await client.post(
        "/api/auth/logout",
        headers={
            "Origin": "https://survey.test",
            "X-CSRF-Token": csrf_token,
        },
    )

    assert response.status_code == 403
    assert response.json()["code"] == "CSRF_INVALID"


@pytest.mark.asyncio
async def test_default_template_requires_a_session(client: httpx.AsyncClient) -> None:
    response = await client.get("/api/templates/default")
    assert response.status_code == 401
    assert response.json()["code"] == "AUTH_SESSION_EXPIRED"


@pytest.mark.asyncio
async def test_forwarded_origin_and_inactive_user_handling(
    client: httpx.AsyncClient,
    auth_repository: FakeAuthRepository,
) -> None:
    logged_in = await client.post(
        "/api/auth/login",
        json={"username": "researcher01", "password": "Initial-01!"},
    )
    csrf_token = logged_in.cookies["survey_csrf"]

    forwarded_logout = await client.post(
        "/api/auth/logout",
        headers={
            "Origin": "https://public.example",
            "X-CSRF-Token": csrf_token,
            "X-Forwarded-Host": "public.example",
            "X-Forwarded-Proto": "https",
        },
    )
    assert forwarded_logout.status_code == 204

    await client.post(
        "/api/auth/login",
        json={"username": "researcher01", "password": "Initial-01!"},
    )
    auth_repository.users["researcher01"].is_active = False
    inactive = await client.get("/api/auth/me")
    assert inactive.status_code == 401
    assert inactive.json()["code"] == "AUTH_SESSION_EXPIRED"
