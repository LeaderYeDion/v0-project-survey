from __future__ import annotations

import hmac
from collections.abc import Callable
from datetime import UTC, datetime, timedelta

from app.api.errors import ApiError
from app.repositories.protocols import AuthRepositoryProtocol
from app.schemas.auth import CreatedSession, CurrentUser, SessionCookie
from app.security.passwords import verify_password
from app.security.sessions import hash_token, new_session_token


SESSION_TTL = timedelta(hours=8)


def _utc_now() -> datetime:
    return datetime.now(UTC)


class AuthService:
    def __init__(
        self,
        repository: AuthRepositoryProtocol,
        *,
        session_ttl: timedelta = SESSION_TTL,
        now: Callable[[], datetime] = _utc_now,
    ) -> None:
        self._repository = repository
        self._session_ttl = session_ttl
        self._now = now

    async def login(self, username: str, password: str) -> CreatedSession:
        user = await self._repository.get_user_by_username(
            _normalize_username(username)
        )
        if (
            user is None
            or not user.is_active
            or not verify_password(password, user.password_hash)
        ):
            raise ApiError(
                401,
                "AUTH_INVALID_CREDENTIALS",
                "Invalid username or password",
            )

        token = new_session_token()
        csrf_token = new_session_token()
        expires_at = self._now() + self._session_ttl
        await self._repository.create_session(
            user.id,
            hash_token(token),
            hash_token(csrf_token),
            expires_at,
        )
        return CreatedSession(
            token=token,
            csrf_token=csrf_token,
            expires_at=expires_at,
            user=_current_user(user),
            cookie=SessionCookie(
                max_age=max(0, int(self._session_ttl.total_seconds()))
            ),
        )

    async def logout(self, token: str) -> None:
        if token:
            await self._repository.revoke_session(hash_token(token))

    async def authenticate(self, token: str | None) -> CurrentUser:
        session = await self._active_session(token)
        user = await self._repository.get_user(session.user_id)
        if user is None or not user.is_active:
            raise _expired_session_error()
        return _current_user(user)

    async def validate_csrf(
        self,
        token: str | None,
        csrf_token: str | None,
    ) -> None:
        session = await self._active_session(token)
        if csrf_token is None or not hmac.compare_digest(
            session.csrf_token_hash,
            hash_token(csrf_token),
        ):
            raise ApiError(
                403,
                "AUTH_CSRF_INVALID",
                "CSRF validation failed",
            )

    async def _active_session(self, token: str | None):
        if not token:
            raise _expired_session_error()
        session = await self._repository.get_session_by_token_hash(
            hash_token(token)
        )
        if (
            session is None
            or session.revoked_at is not None
            or _as_utc(session.expires_at) <= self._now()
        ):
            raise _expired_session_error()
        return session


def _normalize_username(username: str) -> str:
    return username.strip().casefold()


def _current_user(user) -> CurrentUser:
    return CurrentUser(
        id=user.id,
        username=user.username,
        locale=user.locale,
    )


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _expired_session_error() -> ApiError:
    return ApiError(
        401,
        "AUTH_SESSION_EXPIRED",
        "Session is missing, expired, or no longer valid",
    )
