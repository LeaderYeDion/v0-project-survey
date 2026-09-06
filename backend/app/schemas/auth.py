from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

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
    locale: Locale
