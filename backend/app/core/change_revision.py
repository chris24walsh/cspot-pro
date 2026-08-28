from threading import Lock
from time import time_ns
from typing import Literal

ChangeDomain = Literal["planning", "music", "identity"]
CHANGE_DOMAINS: tuple[ChangeDomain, ...] = ("planning", "music", "identity")


class ChangeRevision:
    """Process-local revisions for durable application data domains."""

    def __init__(self) -> None:
        initial = current_milliseconds()
        self._lock = Lock()
        self._values = {domain: initial for domain in CHANGE_DOMAINS}

    def snapshot(self) -> dict[ChangeDomain, int]:
        with self._lock:
            return dict(self._values)

    def bump(self, domain: ChangeDomain) -> int:
        with self._lock:
            value = max(self._values[domain] + 1, current_milliseconds())
            self._values[domain] = value
            return value


def current_milliseconds() -> int:
    return time_ns() // 1_000_000


change_revision = ChangeRevision()
