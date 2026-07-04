import sys

from fastapi import FastAPI

app = FastAPI(title="Survey Mock Backend", version="0.1.0")


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {
        "status": "ok",
        "service": "survey-mock-backend",
        "pythonVersion": ".".join(map(str, sys.version_info[:3])),
    }
