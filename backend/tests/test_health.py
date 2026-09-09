import sys

import httpx
import pytest

from app.main import app, create_app


@pytest.mark.asyncio
async def test_health_reports_service_and_python_version() -> None:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport,
        base_url="http://test",
    ) as client:
        response = await client.get("/api/health")

    assert response.status_code == 200
    assert response.headers["content-language"] == "zh-CN"
    assert response.json() == {
        "status": "ok",
        "service": "survey-mock-backend",
        "pythonVersion": ".".join(map(str, sys.version_info[:3])),
    }


class FakeHealthSession:
    def __init__(self, revision: str | Exception) -> None:
        self.revision = revision

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None

    async def scalar(self, _statement):
        if isinstance(self.revision, Exception):
            raise self.revision
        return self.revision


class FakeHealthSessionFactory:
    def __init__(self, revision: str | Exception) -> None:
        self.revision = revision

    def __call__(self):
        return FakeHealthSession(self.revision)


@pytest.mark.asyncio
async def test_database_health_reports_the_applied_migration(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv(
        "DATABASE_URL",
        "postgresql+asyncpg://survey:password@db:5432/survey",
    )
    monkeypatch.setattr(
        "app.main.create_session_factory",
        lambda _url: FakeHealthSessionFactory("20260905_0001"),
    )
    application = create_app()
    transport = httpx.ASGITransport(app=application)
    async with httpx.AsyncClient(
        transport=transport,
        base_url="http://test",
    ) as client:
        response = await client.get("/api/health")

    assert response.status_code == 200
    assert response.json()["database"] == "ready"
    assert response.json()["migrationRevision"] == "20260905_0001"


@pytest.mark.asyncio
async def test_database_health_fails_closed_when_the_migration_is_unreadable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv(
        "DATABASE_URL",
        "postgresql+asyncpg://survey:password@db:5432/survey",
    )
    monkeypatch.setattr(
        "app.main.create_session_factory",
        lambda _url: FakeHealthSessionFactory(RuntimeError("database down")),
    )
    application = create_app()
    transport = httpx.ASGITransport(app=application)
    async with httpx.AsyncClient(
        transport=transport,
        base_url="http://test",
    ) as client:
        response = await client.get("/api/health")

    assert response.status_code == 503
    assert response.json()["status"] == "error"
    assert response.json()["database"] == "unavailable"
    assert "database down" not in response.text


@pytest.mark.asyncio
async def test_database_health_rejects_an_outdated_migration(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv(
        "DATABASE_URL",
        "postgresql+asyncpg://survey:password@db:5432/survey",
    )
    monkeypatch.setattr(
        "app.main.create_session_factory",
        lambda _url: FakeHealthSessionFactory("outdated_revision"),
    )
    application = create_app()
    transport = httpx.ASGITransport(app=application)
    async with httpx.AsyncClient(
        transport=transport,
        base_url="http://test",
    ) as client:
        response = await client.get("/api/health")

    assert response.status_code == 503
    assert response.json()["status"] == "error"
    assert response.json()["database"] == "migration_pending"
    assert response.json()["migrationRevision"] == "outdated_revision"
