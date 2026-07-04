import sys

import httpx
import pytest

from app.main import app


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
