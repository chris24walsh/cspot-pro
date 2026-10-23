from sqlalchemy import String, Text
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base


class MixerConfiguration(Base):
    __tablename__ = "mixer_configuration"
    id: Mapped[str] = mapped_column(String(20), primary_key=True, default="xr18")
    host: Mapped[str | None] = mapped_column(String(45), nullable=True)
    automation_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    snapshots_json: Mapped[str] = mapped_column(Text, default="[]")
