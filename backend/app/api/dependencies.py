from __future__ import annotations

import hmac
from urllib.parse import urlsplit

from fastapi import Depends, Request

from app.api.errors import ApiError
from app.schemas.auth import CurrentUser
from app.services.auth_service import AuthService
from app.services.export_service import ExportService
from app.services.research_service import ResearchService
from app.services.run_service import RunService


SESSION_COOKIE = "survey_session"
CSRF_COOKIE = "survey_csrf"
CSRF_HEADER = "X-CSRF-Token"


def auth_service(request: Request) -> AuthService:
    service = getattr(request.app.state, "auth_service", None)
    if service is None:
        raise ApiError(
            503,
            "AUTH_UNAVAILABLE",
            "Authentication storage is not configured",
        )
    return service


def research_service(request: Request) -> ResearchService:
    service = getattr(request.app.state, "research_service", None)
    if service is None:
        raise ApiError(
            503,
            "STORAGE_UNAVAILABLE",
            "Research storage is not configured",
        )
    return service


def run_service(request: Request) -> RunService:
    service = getattr(request.app.state, "run_service", None)
    if service is None:
        raise ApiError(
            503,
            "STORAGE_UNAVAILABLE",
            "Round storage is not configured",
        )
    return service


def export_service(request: Request) -> ExportService:
    service = getattr(request.app.state, "export_service", None)
    if service is None:
        raise ApiError(
            503,
            "STORAGE_UNAVAILABLE",
            "Export storage is not configured",
        )
    return service


async def get_current_user(
    request: Request,
    service: AuthService = Depends(auth_service),
) -> CurrentUser:
    current_user = await service.authenticate(
        request.cookies.get(SESSION_COOKIE)
    )
    request.state.locale = current_user.locale
    return current_user


async def require_csrf(
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
    service: AuthService = Depends(auth_service),
) -> CurrentUser:
    _validate_same_origin(request)
    csrf_cookie = request.cookies.get(CSRF_COOKIE)
    csrf_header = request.headers.get(CSRF_HEADER)
    if (
        csrf_cookie is None
        or csrf_header is None
        or not hmac.compare_digest(csrf_cookie, csrf_header)
    ):
        raise _csrf_error()
    await service.validate_csrf(
        request.cookies.get(SESSION_COOKIE),
        csrf_header,
    )
    return current_user


def _validate_same_origin(request: Request) -> None:
    origin = request.headers.get("origin")
    forwarded_host = request.headers.get("x-forwarded-host")
    forwarded_proto = request.headers.get("x-forwarded-proto")
    host = _first_forwarded_value(forwarded_host) or request.headers.get("host")
    scheme = _first_forwarded_value(forwarded_proto) or request.url.scheme
    if origin is None or host is None:
        raise _origin_error()

    parsed = urlsplit(origin)
    if (
        parsed.scheme.casefold() != scheme.casefold()
        or parsed.netloc.casefold() != host.casefold()
        or parsed.path not in {"", "/"}
        or parsed.query
        or parsed.fragment
    ):
        raise _origin_error()


def _first_forwarded_value(value: str | None) -> str | None:
    if value is None:
        return None
    return value.split(",", maxsplit=1)[0].strip()


def _origin_error() -> ApiError:
    return ApiError(
        403,
        "AUTH_ORIGIN_INVALID",
        "Request origin does not match the application origin",
    )


def _csrf_error() -> ApiError:
    return ApiError(
        403,
        "AUTH_CSRF_INVALID",
        "CSRF validation failed",
    )
