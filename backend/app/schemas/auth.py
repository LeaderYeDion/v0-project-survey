from __future__ import annotations

from datetime import datetime
from typing import Literal, Self
from uuid import UUID

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    RootModel,
    field_validator,
    model_validator,
)

from app.locales import Locale


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=1, max_length=1024)


class CurrentUser(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: UUID
    username: str
    locale: Locale


class SessionCookie(BaseModel):
    model_config = ConfigDict(frozen=True)

    http_only: bool = True
    same_site: Literal["strict"] = "strict"
    path: str = "/"
    max_age: int


class CreatedSession(BaseModel):
    model_config = ConfigDict(frozen=True)

    token: str
    csrf_token: str
    expires_at: datetime
    user: CurrentUser
    cookie: SessionCookie


class SeedUser(BaseModel):
    username: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=20, max_length=1024)
    locale: Literal["zh-CN"]

    @field_validator("username", mode="before")
    @classmethod
    def normalize_username(cls, value: object) -> object:
        return value.strip().casefold() if isinstance(value, str) else value


class SeedUsers(RootModel[list[SeedUser]]):
    @model_validator(mode="after")
    def require_exact_users(self) -> Self:
        expected = {f"researcher0{index}" for index in range(1, 6)}
        usernames = [user.username for user in self.root]
        if len(usernames) != 5 or set(usernames) != expected:
            raise ValueError(
                "Seed file must contain exactly researcher01 through "
                "researcher05"
            )
        return self
