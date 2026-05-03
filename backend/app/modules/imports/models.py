from sqlalchemy import String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.model_mixins import IdMixin, TimestampMixin


class ImportProvider(IdMixin, TimestampMixin, Base):
    __tablename__ = "import_providers"

    name: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(160))
    provider_type: Mapped[str] = mapped_column(String(80), default="manual")
    enabled: Mapped[bool] = mapped_column(default=True)
    notes: Mapped[str | None] = mapped_column(Text)


class ImportRun(IdMixin, TimestampMixin, Base):
    __tablename__ = "import_runs"

    provider_name: Mapped[str] = mapped_column(String(120), index=True)
    source_url: Mapped[str | None] = mapped_column(String(1000))
    status: Mapped[str] = mapped_column(String(80), default="draft")
    raw_text: Mapped[str | None] = mapped_column(Text)
    normalized_text: Mapped[str | None] = mapped_column(Text)
    review_notes: Mapped[str | None] = mapped_column(Text)
