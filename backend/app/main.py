import sys

from fastapi import FastAPI

from app.api import analytics, exports, history, runs, templates
from app.repositories.memory import MemoryRepository
from app.services.analytics_service import AnalyticsService
from app.services.export_service import ExportService
from app.services.mock_engine import MockEngine
from app.services.run_service import RunService


def create_app(
    repository: MemoryRepository | None = None,
    run_service: RunService | None = None,
) -> FastAPI:
    application = FastAPI(title="Survey Mock Backend", version="0.1.0")
    store = repository or MemoryRepository()
    analytics_service = AnalyticsService()
    service = run_service or RunService(
        repository=store,
        engine=MockEngine(),
        analytics=analytics_service,
    )
    application.state.repository = store
    application.state.analytics = analytics_service
    application.state.run_service = service
    application.state.exporter = ExportService()

    @application.get("/api/health")
    async def health() -> dict[str, str]:
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
