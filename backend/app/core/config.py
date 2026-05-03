from functools import cached_property

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_env: str = "local"
    app_name: str = "cspot-pro"
    api_cors_origins: str = Field(default="http://localhost:5173")
    database_url: str = "postgresql+psycopg://cspot:cspot@db:5432/cspot"
    auth_secret_key: str = "change-me-before-public-hosting"
    session_hours: int = 12
    session_cookie_secure: bool = False

    @cached_property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.api_cors_origins.split(",") if origin.strip()]


settings = Settings()
