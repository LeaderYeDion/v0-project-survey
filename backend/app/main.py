import os
import sys

from fastapi import FastAPI, Request, Response

from app.api import analytics, auth, exports, history, runs, templates
from app.api.errors import ApiError, api_error_handler
from app.db.session import DatabaseSettings, create_session_factory
from app.mocks.catalog import MockCatalog
from app.mocks.engine import MockEngine
from app.repositories.auth import AuthRepository
from app.repositories.memory import MemoryRepository
from app.services.analytics_service import AnalyticsService
from app.services.auth_service import AuthService
from app.services.export_service import ExportService
from app.services.inference_analysis_service import InferenceAnalysisService
from app.services.inference_service import InferenceService
from app.services.run_service import RunService


def simulation_termination_enabled() -> bool:
    value = os.environ.get("SIMULATION_TERMINATION_ENABLED", "false")
    if value not in {"true", "false"}:
        raise RuntimeError(
            "SIMULATION_TERMINATION_ENABLED must be true or false"
        )
    return value == "true"


def create_app(
    repository: MemoryRepository | None = None,
    run_service: RunService | None = None,
    auth_service: AuthService | None = None,
) -> FastAPI:
    application = FastAPI(title="Survey Mock Backend", version="0.1.0")
    store = repository or MemoryRepository()
    mock_catalog = MockCatalog()
    analytics_service = AnalyticsService(mock_catalog)
    inference_service = InferenceService()
    inference_analysis_service = InferenceAnalysisService()
    service = run_service or RunService(
        repository=store,
        engine=MockEngine(
            mock_catalog,
            termination_enabled=simulation_termination_enabled(),
        ),
        analytics=analytics_service,
        inference=inference_service,
        inference_analysis=inference_analysis_service,
    )
    application.state.repository = store
    application.state.analytics = analytics_service
    application.state.inference_service = inference_service
    application.state.inference_analysis = inference_analysis_service
    application.state.template_provider = mock_catalog
    application.state.run_service = service
    application.state.exporter = ExportService()
    application.state.auth_service = auth_service or _auth_service_from_env()
    application.add_exception_handler(ApiError, api_error_handler)

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
        return {
            "status": "ok",
            "service": "survey-mock-backend",
            "pythonVersion": ".".join(map(str, sys.version_info[:3])),
        }

    application.include_router(auth.router)
    application.include_router(templates.router)
    application.include_router(runs.router)
    application.include_router(history.router)
    application.include_router(analytics.router)
    application.include_router(exports.router)
    return application


def _auth_service_from_env() -> AuthService | None:
    if not os.environ.get("DATABASE_URL", "").strip():
        return None
    settings = DatabaseSettings.from_env()
    repository = AuthRepository(create_session_factory(settings.url))
    return AuthService(repository)


app = create_app()
