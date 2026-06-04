from sqlalchemy import Boolean, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.model_mixins import IdMixin, TimestampMixin


class SiteContentBlock(IdMixin, TimestampMixin, Base):
    __tablename__ = "site_content_blocks"

    key: Mapped[str] = mapped_column(String(160), unique=True, index=True)
    label: Mapped[str] = mapped_column(String(220))
    block_type: Mapped[str] = mapped_column(String(40), default="text")
    value: Mapped[str] = mapped_column(Text)
    draft_value: Mapped[str | None] = mapped_column(Text)
    published: Mapped[bool] = mapped_column(Boolean, default=True)
