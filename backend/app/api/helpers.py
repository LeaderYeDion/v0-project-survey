from fastapi import HTTPException, Request

from app.repositories.memory import MemoryRepository
from app.services.run_service import RunService


def repository(request: Request) -> MemoryRepository:
    return request.app.state.repository


def runs(request: Request) -> RunService:
    return request.app.state.run_service


def not_found(code: str, message: str) -> HTTPException:
    return HTTPException(
        status_code=404,
        detail={"code": code, "message": message},
    )
