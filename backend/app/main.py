import sys

from fastapi import FastAPI, Request, Response

from app.api import analytics, exports, history, runs, templates
from app.mocks.catalog import MockCatalog
from app.mocks.engine import MockEngine
from app.repositories.memory import MemoryRepository
from app.services.analytics_service import AnalyticsService
from app.services.export_service import ExportService
from app.services.run_service import RunService


def create_app(
    repository: MemoryRepository | None = None,
    run_service: RunService | None = None,
) -> FastAPI:
    application = FastAPI(title="Survey Mock Backend", version="0.1.0")
    store = repository or MemoryRepository()
    mock_catalog = MockCatalog()
    analytics_service = AnalyticsService(mock_catalog)
    service = run_service or RunService(
        repository=store,
        engine=MockEngine(mock_catalog),
        analytics=analytics_service,
    )
    application.state.repository = store
    application.state.analytics = analytics_service
    application.state.template_provider = mock_catalog
    application.state.run_service = service
    application.state.exporter = ExportService()

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

    application.include_router(templates.router)
    application.include_router(runs.router)
    application.include_router(history.router)
    application.include_router(analytics.router)
    application.include_router(exports.router)
    return application


app = create_app()
