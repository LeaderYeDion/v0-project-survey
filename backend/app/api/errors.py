from __future__ import annotations

import logging
from typing import Any
from uuid import UUID, uuid4

from fastapi import Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


class ApiError(Exception):
    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        details: Any = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.details = details


async def api_error_handler(
    _request: Request,
    error: ApiError,
) -> JSONResponse:
    headers = {}
    if error.code == "STORAGE_UNAVAILABLE":
        request_id = str(uuid4())
        resources = [str(value) for value in _request.path_params.values() if isinstance(value, UUID)]
        logging.getLogger(__name__).warning(
            "STORAGE_UNAVAILABLE request_id=%s resource_ids=%s",
            request_id, ",".join(resources),
        )
        headers["X-Request-Id"] = request_id
    return JSONResponse(
        status_code=error.status_code,
        headers=headers,
        content={
            "code": error.code,
            "message": error.message,
            "details": error.details,
        },
    )


async def storage_error_handler(request: Request, _error: Exception) -> JSONResponse:
    from app.db.errors import storage_unavailable

    return await api_error_handler(request, storage_unavailable())


async def request_validation_error_handler(
    _request: Request,
    error: RequestValidationError,
) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content={
            "code": "REQUEST_VALIDATION_ERROR",
            "message": "Request validation failed",
            "details": jsonable_encoder(error.errors()),
        },
    )
