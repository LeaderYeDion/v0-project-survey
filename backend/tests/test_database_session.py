import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import DatabaseSettings, create_session_factory


@pytest.mark.parametrize(
    "value",
    [None, "", "postgresql://db/survey", "sqlite+aiosqlite:///survey.db"],
)
def test_database_settings_require_asyncpg_url(
    monkeypatch: pytest.MonkeyPatch,
    value: str | None,
) -> None:
    if value is None:
        monkeypatch.delenv("DATABASE_URL", raising=False)
    else:
        monkeypatch.setenv("DATABASE_URL", value)

    with pytest.raises(
        RuntimeError,
        match="DATABASE_URL must use postgresql\\+asyncpg",
    ):
        DatabaseSettings.from_env()


def test_database_settings_strip_surrounding_whitespace(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv(
        "DATABASE_URL",
        "  postgresql+asyncpg://user:pass@db:5432/survey  ",
    )

    assert DatabaseSettings.from_env().url == (
        "postgresql+asyncpg://user:pass@db:5432/survey"
    )


def test_session_factory_creates_non_expiring_async_sessions() -> None:
    factory = create_session_factory(
        "postgresql+asyncpg://user:pass@db:5432/survey"
    )

    assert factory.class_ is AsyncSession
    assert factory.kw["expire_on_commit"] is False
    assert factory.kw["bind"].pool._pre_ping is True
