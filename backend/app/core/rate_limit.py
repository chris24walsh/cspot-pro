from collections import defaultdict, deque
from datetime import UTC, datetime, timedelta
from threading import Lock

from fastapi import HTTPException, Request, status

_attempts: dict[str, deque[datetime]] = defaultdict(deque)
_lock = Lock()


def enforce_rate_limit(
    request: Request | None, bucket: str, *, attempts: int, minutes: int
) -> None:
    """Small per-process guard for low-volume public auth endpoints."""
    forwarded = (
        request.headers.get("x-forwarded-for", "").rsplit(",", 1)[-1].strip()
        if request
        else ""
    )
    address = forwarded or (request.client.host if request and request.client else "unknown")
    key = f"{bucket}:{address}"
    now = datetime.now(UTC)
    cutoff = now - timedelta(minutes=minutes)
    with _lock:
        recent = _attempts[key]
        while recent and recent[0] <= cutoff:
            recent.popleft()
        if len(recent) >= attempts:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many attempts. Please wait and try again.",
            )
        recent.append(now)
