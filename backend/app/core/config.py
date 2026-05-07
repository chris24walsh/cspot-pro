from functools import cached_property

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_env: str = "local"
    app_name: str = "cspot-pro"
    public_app_url: str | None = None
    api_cors_origins: str = Field(default="http://localhost:5173")
    database_url: str = "postgresql+psycopg://cspot:cspot@db:5432/cspot"
    auth_secret_key: str = "change-me-before-public-hosting"
    session_hours: int = 12
    session_cookie_secure: bool = False
    auth_invite_hours: int = 72
    auth_reset_hours: int = 2
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_username: str | None = None
    smtp_password: str | None = None
    smtp_from_email: str | None = None
    smtp_from_name: str | None = None
    smtp_use_starttls: bool = True
    smtp_use_ssl: bool = False

    @cached_property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.api_cors_origins.split(",") if origin.strip()]


settings = Settings()
