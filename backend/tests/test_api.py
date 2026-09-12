import httpx
import pytest

from app.main import create_app, simulation_termination_enabled
from app.services.auth_service import AuthService
from research_support import FakeAuthRepository


LANGUAGE_HEADERS = {"Accept-Language": "en-US"}


@pytest.mark.parametrize(
    ("raw_value", "expected"),
    [(None, False), ("false", False), ("true", True)],
)
def test_simulation_termination_setting(
    monkeypatch: pytest.MonkeyPatch,
    raw_value: str | None,
    expected: bool,
) -> None:
    if raw_value is None:
        monkeypatch.delenv("SIMULATION_TERMINATION_ENABLED", raising=False)
    else:
        monkeypatch.setenv("SIMULATION_TERMINATION_ENABLED", raw_value)

    assert simulation_termination_enabled() is expected


def test_simulation_termination_setting_rejects_invalid_value(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("SIMULATION_TERMINATION_ENABLED", "TRUE")

    with pytest.raises(
        RuntimeError,
        match="SIMULATION_TERMINATION_ENABLED must be true or false",
    ):
        simulation_termination_enabled()


@pytest.fixture
async def client():
    repository = FakeAuthRepository()
    user = await repository.add_user("template-reader")
    user.locale = "en-US"
    app = create_app(auth_service=AuthService(repository))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
    ) as api_client:
        await api_client.post("/api/auth/login", json={
            "username": "template-reader", "password": "Research-Password-01!",
        })
        yield api_client


@pytest.mark.asyncio
async def test_default_template(client: httpx.AsyncClient) -> None:
    missing = await client.get("/api/templates/default")
    assert missing.status_code == 200
    assert missing.headers["content-language"] == "en-US"
    assert missing.json()["title"] == "Common Prosperity Perception Survey"

    response = await client.get(
        "/api/templates/default",
        headers=LANGUAGE_HEADERS,
    )

    assert response.status_code == 200
    assert response.headers["content-language"] == "en-US"
    assert response.json()["title"] == "Common Prosperity Perception Survey"

    unsupported = await client.get(
        "/api/templates/default",
        headers={"Accept-Language": "fr-FR"},
    )
    assert unsupported.status_code == 200
    assert unsupported.headers["content-language"] == "en-US"
    assert unsupported.json()["title"] == "Common Prosperity Perception Survey"

    chinese = await client.get(
        "/api/templates/default",
        headers={"Accept-Language": "zh-CN"},
    )
    assert chinese.status_code == 200
    assert chinese.headers["content-language"] == "zh-CN"
    assert chinese.json()["title"] == "共同富裕可感可知问卷"


@pytest.mark.asyncio
async def test_default_template_can_be_selected_by_mode(
    client: httpx.AsyncClient,
) -> None:
    survey = await client.get(
        "/api/templates/default",
        headers={"Accept-Language": "zh-CN"},
        params={"mode": "survey"},
    )
    interview = await client.get(
        "/api/templates/default",
        headers={"Accept-Language": "zh-CN"},
        params={"mode": "interview"},
    )
    english_interview = await client.get(
        "/api/templates/default",
        headers=LANGUAGE_HEADERS,
        params={"mode": "interview"},
    )

    assert survey.status_code == 200
    assert survey.json()["title"] == "共同富裕可感可知问卷"
    assert (
        survey.json()["questions"][0]["question"]
        == "您多大程度上认为您所在县（市、区）经济是快速发展的？"
    )
    assert interview.status_code == 200
    assert interview.json()["title"] == "共同富裕可感可知访谈"
    assert (
        interview.json()["questions"][0]["question"]
        == "您觉得什么是共同富裕？"
    )
    assert english_interview.status_code == 200
    assert (
        english_interview.json()["title"]
        == "Common Prosperity Perception Interview"
    )
    assert (
        english_interview.json()["questions"][0]["question"]
        == "What does common prosperity mean to you?"
    )


@pytest.mark.asyncio
async def test_round_exports_require_authentication() -> None:
    application = create_app(
        auth_service=AuthService(FakeAuthRepository()),
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=application),
        base_url="http://test",
    ) as client:
        response = await client.get(
            "/api/rounds/00000000-0000-0000-0000-000000000000/exports"
        )

    assert response.status_code == 401
    assert response.json()["code"] == "AUTH_SESSION_EXPIRED"
