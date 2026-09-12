import os
import sys
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from sqlalchemy import text

from app.api import (
    analytics,
    auth,
    exceptions,
    exports,
    projects,
    questionnaires,
    runs,
    templates,
)
from app.api.errors import (
    ApiError,
    api_error_handler,
    request_validation_error_handler,
    storage_error_handler,
)
from app.db.errors import STORAGE_ERRORS
from app.db.session import DatabaseSettings, create_session_factory
from app.mocks.catalog import MockCatalog
from app.mocks.engine import MockEngine
from app.repositories.auth import AuthRepository
from app.repositories.exports import ExportRepository
from app.repositories.memory import MemoryRepository
from app.repositories.research import ResearchRepository
from app.repositories.rounds import RoundRepository
from app.services.analytics_service import AnalyticsService
from app.services.auth_service import AuthService
from app.services.export_service import ExportService
from app.services.inference_analysis_service import InferenceAnalysisService
from app.services.inference_service import InferenceService
from app.services.run_service import RunService
from app.services.research_service import ResearchService


HEAD_MIGRATION_REVISION = "20260905_0001"


def simulation_termination_enabled() -> bool:
    value = os.environ.get("SIMULATION_TERMINATION_ENABLED", "false")
    if value not in {"true", "false"}:
        raise RuntimeError(
            "SIMULATION_TERMINATION_ENABLED must be true or false"
        )
    return value == "true"


def create_app(
    repository: MemoryRepository | RoundRepository | None = None,
    run_service: RunService | None = None,
    auth_service: AuthService | None = None,
    research_service: ResearchService | None = None,
) -> FastAPI:
    mock_catalog = MockCatalog()
    analytics_service = AnalyticsService(mock_catalog)
    inference_service = InferenceService()
    inference_analysis_service = InferenceAnalysisService()
    database_url = os.environ.get("DATABASE_URL", "").strip()
    session_factory = None
    if database_url:
        settings = DatabaseSettings.from_env()
        session_factory = create_session_factory(settings.url)
    configured_research = research_service or (
        ResearchService(ResearchRepository(session_factory))
        if session_factory is not None
        else None
    )
    store = repository or (
        RoundRepository(session_factory)
        if session_factory is not None
        else MemoryRepository()
    )
    service = run_service
    if service is None and configured_research is not None:
        service = RunService(
            repository=store,
            research=configured_research,
            engine=MockEngine(
                mock_catalog,
                termination_enabled=simulation_termination_enabled(),
            ),
            analytics=analytics_service,
            inference=inference_service,
            inference_analysis=inference_analysis_service,
        )

    @asynccontextmanager
    async def lifespan(_application: FastAPI):
        if service is not None:
            await service.executor.reconcile_interrupted_rounds()
        try:
            yield
        finally:
            if service is not None:
                await service.executor.shutdown()

    application = FastAPI(
        title="Survey Mock Backend",
        version="0.1.0",
        lifespan=lifespan,
    )
    application.state.repository = store
    application.state.analytics = analytics_service
    application.state.inference_service = inference_service
    application.state.inference_analysis = inference_analysis_service
    application.state.template_provider = mock_catalog
    application.state.run_service = service
    application.state.export_service = (
        ExportService(
            repository=ExportRepository(
                session_factory=session_factory,
                round_repository=store,
            ),
            run_service=service,
        )
        if service is not None
        else None
    )
    application.state.auth_service = auth_service or (
        AuthService(AuthRepository(session_factory))
        if session_factory is not None
        else None
    )
    application.state.research_service = configured_research
    application.add_exception_handler(ApiError, api_error_handler)
    for storage_error in STORAGE_ERRORS:
        application.add_exception_handler(storage_error, storage_error_handler)
    application.add_exception_handler(
        RequestValidationError,
        request_validation_error_handler,
    )

    @application.middleware("http")
    async def echo_content_language(request: Request, call_next):
        response = await call_next(request)
        locale = getattr(request.state, "locale", None)
        if locale is not None:
            response.headers["Content-Language"] = locale
        return response

    @application.get("/api/health")
    async def health(response: Response) -> dict[str, str]:
        response.headers["Content-Language"] = "zh-CN"
        payload = {
            "status": "ok",
            "service": "survey-mock-backend",
            "pythonVersion": ".".join(map(str, sys.version_info[:3])),
        }
        if session_factory is None:
            return payload

        try:
            async with session_factory() as session:
                revision = await session.scalar(
                    text("SELECT version_num FROM alembic_version")
                )
        except Exception:
            response.status_code = 503
            return {
                **payload,
                "status": "error",
                "database": "unavailable",
            }

        payload["migrationRevision"] = str(revision or "")
        if revision != HEAD_MIGRATION_REVISION:
            response.status_code = 503
            return {
                **payload,
                "status": "error",
                "database": "migration_pending",
            }
        payload["database"] = "ready"
        return payload

    application.include_router(auth.router)
    application.include_router(projects.router)
    application.include_router(questionnaires.router)
    application.include_router(templates.router)
    application.include_router(runs.router)
    application.include_router(analytics.router)
    application.include_router(exceptions.router)
    application.include_router(exports.router)
    return application
app = create_app()
