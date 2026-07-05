from datetime import UTC, datetime

from fastapi import HTTPException, Request

from app.repositories.memory import MemoryRepository
from app.schemas.survey import RunSnapshot, SurveyHistoryRecord
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


def history_as_snapshot(record: SurveyHistoryRecord) -> RunSnapshot:
    return RunSnapshot(
        id=record.runId,
        mode=record.mode,
        locale=record.locale,
        status="completed",
        config=record.config,
        respondents=record.respondents,
        sessions=record.sessions,
        progress=record.progress,
        sentiment=record.sentiment,
        questionAnalysis=record.questionAnalysis,
        demographicAnalysis=record.demographicAnalysis,
        responses=record.responses,
        activeRespondentId=None,
        createdAt=record.savedAt,
        startedAt=None,
        finishedAt=datetime.now(UTC),
        error=None,
    )
