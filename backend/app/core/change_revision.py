from threading import Lock
from time import time_ns


def current_milliseconds() -> int:
    return time_ns() // 1_000_000

from sqlalchemy import event
from sqlalchemy.orm import Session


class ChangeRevision:
    """Process-local revision for durable application data changes."""

    def __init__(self) -> None:
        self._lock = Lock()
        self._value = current_milliseconds()

    @property
    def value(self) -> int:
        with self._lock:
            return self._value

    def bump(self) -> int:
        with self._lock:
            self._value = max(self._value + 1, current_milliseconds())
            return self._value


change_revision = ChangeRevision()


@event.listens_for(Session, "after_flush")
def note_durable_change(session: Session, _flush_context) -> None:
    durable_modules = (
        "app.modules.identity.",
        "app.modules.music.",
        "app.modules.planning.",
    )
    changed = (*session.new, *session.dirty, *session.deleted)
    if any(item.__class__.__module__.startswith(durable_modules) for item in changed):
        session.info["durable_change"] = True


@event.listens_for(Session, "after_commit")
def publish_durable_change(session: Session) -> None:
    if session.info.pop("durable_change", False):
        change_revision.bump()


@event.listens_for(Session, "after_rollback")
def discard_durable_change(session: Session) -> None:
    session.info.pop("durable_change", None)
