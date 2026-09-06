from fastapi import APIRouter, Depends, Request, Response, status

from app.api.dependencies import (
    CSRF_COOKIE,
    SESSION_COOKIE,
    auth_service,
    get_current_user,
    require_csrf,
)
from app.schemas.auth import CurrentUser, LoginRequest
from app.services.auth_service import AuthService


router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login", response_model=CurrentUser)
async def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    service: AuthService = Depends(auth_service),
) -> CurrentUser:
    created = await service.login(payload.username, payload.password)
    secure = _is_https(request)
    response.set_cookie(
        SESSION_COOKIE,
        created.token,
        max_age=created.cookie.max_age,
        expires=created.expires_at,
        path=created.cookie.path,
        secure=secure,
        httponly=created.cookie.http_only,
        samesite=created.cookie.same_site,
    )
    response.set_cookie(
        CSRF_COOKIE,
        created.csrf_token,
        max_age=created.cookie.max_age,
        expires=created.expires_at,
        path=created.cookie.path,
        secure=secure,
        httponly=False,
        samesite=created.cookie.same_site,
    )
    request.state.locale = created.user.locale
    return created.user


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    request: Request,
    response: Response,
    _current_user: CurrentUser = Depends(require_csrf),
    service: AuthService = Depends(auth_service),
) -> None:
    await service.logout(request.cookies.get(SESSION_COOKIE, ""))
    secure = _is_https(request)
    response.delete_cookie(
        SESSION_COOKIE,
        path="/",
        secure=secure,
        httponly=True,
        samesite="strict",
    )
    response.delete_cookie(
        CSRF_COOKIE,
        path="/",
        secure=secure,
        httponly=False,
        samesite="strict",
    )


@router.get("/me", response_model=CurrentUser)
async def me(
    current_user: CurrentUser = Depends(get_current_user),
) -> CurrentUser:
    return current_user


def _is_https(request: Request) -> bool:
    forwarded = request.headers.get("x-forwarded-proto")
    scheme = (
        forwarded.split(",", maxsplit=1)[0].strip()
        if forwarded
        else request.url.scheme
    )
    return scheme.casefold() == "https"
