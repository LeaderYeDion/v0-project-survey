from typing import Annotated

from fastapi import Header, Request, Response

from app.locales import Locale, normalize_locale


async def require_language(
    request: Request,
    response: Response,
    accept_language: Annotated[
        str | None,
        Header(alias="Accept-Language"),
    ] = None,
) -> Locale:
    locale = normalize_locale(accept_language)
    request.state.locale = locale
    response.headers["Content-Language"] = locale
    return locale
