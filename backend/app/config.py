from __future__ import annotations

import secrets
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(".env", "../.env"), extra="ignore", case_sensitive=False)

    app_name: str = "StockPulse AI"
    app_env: str = "development"
    app_url: str = "http://localhost:5173"
    api_url: str = "http://localhost:8000"
    allowed_origins: str = "http://localhost:5173"
    secret_key: str = "change-me-development-only"
    database_url: str = "sqlite:///./stockpulse.db"
    cookie_secure: bool = False
    session_days: int = 7

    market_data_provider: str = "yahoo"
    data_cache_minutes: int = 20
    max_upload_mb: int = 8
    background_jobs: bool = True
    auto_create_schema: bool = True

    news_api_key: str = ""
    broker_adapter: str = ""
    broker_api_key: str = ""
    broker_api_secret: str = ""

    paper_starting_cash: float = 100_000.0
    paper_commission_bps: float = 2.0
    paper_slippage_bps: float = 5.0

    @property
    def is_production(self) -> bool:
        return self.app_env.lower() == "production"

    @property
    def origins(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]

    def validate_runtime(self) -> None:
        if self.is_production:
            if self.secret_key == "change-me-development-only" or len(self.secret_key) < 32:
                raise RuntimeError("SECRET_KEY must be set to a strong value in production")
            if not self.cookie_secure:
                raise RuntimeError("COOKIE_SECURE must be true in production")
            if self.database_url.startswith("sqlite"):
                raise RuntimeError("SQLite is not supported in production; set DATABASE_URL to PostgreSQL")
            if self.auto_create_schema:
                raise RuntimeError("Set AUTO_CREATE_SCHEMA=false in production and run: alembic upgrade head")


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()

# Used only for dev convenience when no SECRET_KEY is supplied; opaque session
# tokens do not depend on it, but production explicitly requires a real value.
if settings.secret_key == "change-me-development-only":
    settings.secret_key = settings.secret_key + "-" + secrets.token_hex(16)
