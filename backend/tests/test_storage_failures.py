from contextlib import asynccontextmanager
from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
from asyncpg import PostgresError
from sqlalchemy import create_engine, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.api.errors import ApiError
from app.main import create_app
from app.repositories.auth import AuthRepository
from app.repositories.exports import ExportRepository
from app.repositories.rounds import RoundRepository


SECRET = "password=session-token csrf-token sensitive-answer"


class FailingDatabaseSession:
    """Inject driver faults while retaining real SQL transaction rollback."""

    def __init__(self, error):
        self.engine = create_engine("sqlite://")
        with self.engine.begin() as connection:
            connection.execute(text("CREATE TABLE checkpoint (value TEXT)"))
            connection.execute(text("INSERT INTO checkpoint VALUES ('last complete')"))
        self.session = Session(self.engine)
        self.error = error

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        self.session.close()

    @asynccontextmanager
    async def begin(self):
        with self.session.begin():
            yield

    def add(self, _row):
        pass

    async def scalar(self, _statement):
        self.session.execute(text("UPDATE checkpoint SET value = 'uncommitted'"))
        raise self.error

    async def flush(self):
        await self.scalar(None)

    async def rollback(self):
        self.session.rollback()

    def saved_value(self):
        with self.engine.connect() as connection:
            return connection.scalar(text("SELECT value FROM checkpoint"))


@pytest.mark.asyncio
@pytest.mark.parametrize("operation", ["read", "write", "checkpoint", "export_finalize"])
@pytest.mark.parametrize("error", [
    OperationalError("SELECT sensitive-answer", {"secret": SECRET}, Exception(SECRET)),
    PostgresError(SECRET),
    ConnectionRefusedError(SECRET),
])
async def test_repository_storage_faults_are_safe_and_rollback(operation, error, caplog):
    session = FailingDatabaseSession(error)
    factory = lambda: session
    owner_id, resource_id = uuid4(), uuid4()
    with pytest.raises(ApiError) as captured:
        if operation == "read":
            await AuthRepository(factory).get_user_by_username("alice")
        elif operation == "write":
            await AuthRepository(factory).create_user("alice", SECRET, "en-US")
        elif operation == "export_finalize":
            await ExportRepository(factory).mark_succeeded(owner_id, resource_id, "out.json", datetime.now(UTC))
        else:
            checkpoint = SimpleNamespace(
                status="running", active_respondent_id=None, total_respondents=1,
                completed_respondents=0, terminated_respondents=0,
                failed_respondents=0, incomplete_respondents=1,
                pause_requested_at=None, lease_owner="worker", lease_expires_at=datetime.now(UTC),
                error_code=None, error_message=None,
            )
            await RoundRepository(factory).checkpoint(owner_id, resource_id, 1, checkpoint)
    assert captured.value.status_code == 503
    assert captured.value.code == "STORAGE_UNAVAILABLE"
    assert session.saved_value() == "last complete"
    assert SECRET not in str(captured.value)
    assert SECRET not in caplog.text
    assert "STORAGE_UNAVAILABLE" in caplog.text


@pytest.mark.asyncio
@pytest.mark.parametrize("error", [OperationalError(SECRET, {}, Exception(SECRET)), PostgresError(SECRET)])
async def test_api_storage_faults_return_safe_503_with_trace_id(error, caplog):
    class FailedAuth:
        async def authenticate(self, _token):
            raise error

    application = create_app(auth_service=FailedAuth())
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=application, raise_app_exceptions=False),
        base_url="https://survey.test",
    ) as client:
        response = await client.get("/api/auth/me")
    assert response.status_code == 503
    assert response.json() == {"code": "STORAGE_UNAVAILABLE", "message": "Storage is temporarily unavailable. Please retry.", "details": None}
    assert response.headers["x-request-id"] in caplog.text
    assert SECRET not in response.text + caplog.text
