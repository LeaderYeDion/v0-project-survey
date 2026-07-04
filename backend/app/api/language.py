from typing import Annotated, Literal

from fastapi import Header, HTTPException, Request, Response

Locale = Literal["zh-CN", "en-US"]


async def require_language(
    request: Request,
    response: Response,
    accept_language: Annotated[
        str | None,
        Header(alias="Accept-Language"),
    ] = None,
) -> Locale:
    if accept_language not in ("zh-CN", "en-US"):
        raise HTTPException(
            status_code=400,
            detail={
                "code": "LANGUAGE_NOT_SUPPORTED",
                "message": "Accept-Language must be zh-CN or en-US",
            },
        )
    request.state.locale = accept_language
    response.headers["Content-Language"] = accept_language
    return accept_language
