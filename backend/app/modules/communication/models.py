from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.model_mixins import IdMixin, TimestampMixin


class MessageThread(IdMixin, TimestampMixin, Base):
    __tablename__ = "message_threads"

    subject: Mapped[str] = mapped_column(String(220))
    creator_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), index=True)


class MessageParticipant(IdMixin, TimestampMixin, Base):
    __tablename__ = "message_participants"

    thread_id: Mapped[str] = mapped_column(
        ForeignKey("message_threads.id", ondelete="CASCADE"),
        index=True,
    )
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    last_read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Message(IdMixin, TimestampMixin, Base):
    __tablename__ = "messages"

    thread_id: Mapped[str] = mapped_column(
        ForeignKey("message_threads.id", ondelete="CASCADE"),
        index=True,
    )
    sender_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), index=True)
    body: Mapped[str] = mapped_column(Text)
