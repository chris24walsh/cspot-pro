from datetime import datetime

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.model_mixins import IdMixin, TimestampMixin


class OAuthConnection(IdMixin, TimestampMixin, Base):
    __tablename__ = "oauth_connections"

    provider: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    provider_user_id: Mapped[str | None] = mapped_column(String(255), index=True)
    account_email: Mapped[str | None] = mapped_column(String(320), index=True)
    account_name: Mapped[str | None] = mapped_column(String(255))
    scope: Mapped[str | None] = mapped_column(Text)
    access_token_encrypted: Mapped[str] = mapped_column(Text)
    refresh_token_encrypted: Mapped[str | None] = mapped_column(Text)
    expires_at: Mapped[datetime | None]
    connected_by_user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), index=True)
