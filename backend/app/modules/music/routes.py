from datetime import UTC, datetime
import json
import math
import secrets

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.core.database import get_session
from app.modules.identity.models import User
from app.modules.identity.auth import require_any_permission, require_permission
from app.modules.music.models import Song, SongPart
from app.modules.music.schemas import (
    SongCreate,
    SongPartRead,
    SongRead,
    SongUpdate,
    WorshipSetSuggestionRead,
    WorshipSongUsageRead,
    WorshipSuggestedSongRead,
)
from app.modules.music.text import normalize_song_sequence
from app.modules.planning.models import HistoryEntry, Plan, PlanItem, PlanType

router = APIRouter()
SONG_HISTORY_ACTION = "item_snapshot"
SONG_HISTORY_ENTITY_TYPE = "song"


def _short_value(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    return text if len(text) <= 80 else f"{text[:77]}..."


def _song_change_summary(field: str, before: object, after: object) -> str:
    if field in {"lyrics", "chords"}:
        return f"{field} changed"
    before_text = _short_value(before)
    after_text = _short_value(after)
    if before_text is None and after_text is not None:
        return f"{field} set to {after_text}"
    if before_text is not None and after_text is None:
        return f"{field} cleared"
    return f"{field} changed"


def _record_song_history(session: Session, song: Song, actor: User, changes: list[str]) -> None:
    if not changes:
        return
    details = {
        "label": f'editing "{song.title}"',
        "affected": f"{song.title}: {', '.join(changes[:4])}{'...' if len(changes) > 4 else ''}",
        "change_type": "song",
        "restorable": False,
        "before": [],
        "after": [],
    }
    session.add(
        HistoryEntry(
            actor_id=actor.id,
            entity_type=SONG_HISTORY_ENTITY_TYPE,
            entity_id=song.id,
            action=SONG_HISTORY_ACTION,
            details=json.dumps(details, separators=(",", ":")),
        )
    )


def song_to_read(song: Song) -> SongRead:
    lyrics_status = "available" if song.lyrics else "empty"
    return SongRead(
        id=song.id,
        title=song.title,
        alternate_title=song.alternate_title,
        author=song.author,
        lyrics=song.lyrics,
        chords=song.chords,
        ccli_number=song.ccli_number,
        book_reference=song.book_reference,
        license=song.license,
        sequence=song.sequence,
        youtube_id=song.youtube_id,
        external_link=song.external_link,
        worship_role=song.worship_role,
        energy=song.energy,
        tempo=song.tempo,
        theme_tags=song.theme_tags,
        lyrics_status=lyrics_status,
    )


_suggestion_random = secrets.SystemRandom()


def _song_usage(session: Session) -> dict[str, dict[str, object]]:
    rows = session.execute(
        text(
            """
            with worship_items as (
                select
                    songs.id as song_id,
                    plans.service_date,
                    row_number() over (
                        partition by plans.id
                        order by plan_items.sequence, plan_items.created_at, plan_items.id
                    ) as item_number,
                    count(*) over (partition by plans.id) as item_count
                from songs
                join plan_items on plan_items.song_id = songs.id
                join plans on plans.id = plan_items.plan_id
                join plan_types on plan_types.id = plans.plan_type_id
                where
                    songs.deleted_at is null
                    and plan_items.deleted_at is null
                    and plans.deleted_at is null
                    and plan_items.item_type = 'song'
                    and plan_types.name = 'Worship Set'
            )
            select
                song_id,
                service_date,
                case
                    when item_number = 1 then 'opener'
                    when item_number = item_count then 'closer'
                    else 'middle'
                end as slot
            from worship_items
            """
        )
    ).all()
    usage: dict[str, dict[str, object]] = {}
    for song_id, service_date, slot in rows:
        entry = usage.setdefault(
            song_id,
            {
                "use_count": 0,
                "last_used": None,
                "used_dates": [],
                "slot_counts": {"opener": 0, "middle": 0, "closer": 0},
            },
        )
        entry["use_count"] = int(entry["use_count"]) + 1
        slot_counts = entry["slot_counts"]
        if isinstance(slot_counts, dict) and slot in slot_counts:
            slot_counts[slot] = int(slot_counts[slot]) + 1
        if isinstance(service_date, datetime):
            used_dates = entry["used_dates"]
            if isinstance(used_dates, list):
                used_dates.append(service_date)
        last_used = entry["last_used"]
        if last_used is None or service_date > last_used:
            entry["last_used"] = service_date
    return usage


def _role_matches(song: Song, slot: str) -> bool:
    role = (song.worship_role or "any").strip().lower()
    return role in {"", "any", slot}


def _aware_datetime(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value


def _days_between(now: datetime, used_at: datetime) -> int:
    return max((_aware_datetime(now) - _aware_datetime(used_at)).days, 0)


def _recent_use_count(usage: dict[str, object], now: datetime, days: int) -> int:
    used_dates = usage.get("used_dates")
    if not isinstance(used_dates, list):
        return 0
    count = 0
    for used_at in used_dates:
        if isinstance(used_at, datetime) and _days_between(now, used_at) <= days:
            count += 1
    return count


def _historical_slot_fit(usage: dict[str, object], slot: str) -> tuple[float, int, float]:
    slot_counts = usage.get("slot_counts")
    if not isinstance(slot_counts, dict):
        return 0.0, 0, 0.0

    slot_count = int(slot_counts.get(slot) or 0)
    total = sum(int(slot_counts.get(candidate) or 0) for candidate in ("opener", "middle", "closer"))
    if total <= 0:
        return 0.0, slot_count, 0.0

    share = slot_count / total
    bonus = min(slot_count * 3.5, 16) + share * 12
    if slot_count == 0 and total >= 3:
        bonus -= 8
    return bonus, slot_count, share


def _song_score(song: Song, slot: str, usage: dict[str, object], now: datetime) -> tuple[float, str]:
    use_count = int(usage.get("use_count") or 0)
    last_used = usage.get("last_used")
    days_since = 9999
    if isinstance(last_used, datetime):
        days_since = _days_between(now, last_used)

    energy = song.energy if song.energy is not None else 3
    target_energy = {"opener": 5, "middle": 3, "closer": 2}.get(slot, 3)
    recent_count = _recent_use_count(usage, now, 35)
    historical_bonus, historical_slot_count, historical_slot_share = _historical_slot_fit(usage, slot)
    role_bonus = 18 if _role_matches(song, slot) else -22
    favourite_bonus = min(math.log1p(use_count) * 5.0, 12)
    recent_favourite_bonus = 0.0
    if 7 <= days_since <= 35:
        recent_favourite_bonus = 8 - abs(21 - days_since) / 4
    elif 0 <= days_since < 7:
        recent_favourite_bonus = 3

    freshness_bonus = min(days_since / 9, 14)
    stale_recent_penalty = 0.0
    if recent_count >= 3:
        stale_recent_penalty = 10 + (recent_count - 3) * 3
    elif 36 <= days_since <= 70:
        stale_recent_penalty = 7

    rotation_penalty = min(use_count * 0.8, 10)
    energy_penalty = abs(energy - target_energy) * 2.8
    score = (
        50
        + role_bonus
        + historical_bonus
        + favourite_bonus
        + recent_favourite_bonus
        + freshness_bonus
        - stale_recent_penalty
        - rotation_penalty
        - energy_penalty
    )

    if use_count == 0:
        reason = "new to the rotation"
    elif historical_slot_count >= 2 and historical_slot_share >= 0.45:
        reason = f"historically strong {slot} song"
    elif 7 <= days_since <= 35:
        reason = "recent favourite with room to repeat"
    elif days_since >= 90:
        reason = f"not used for {days_since} days"
    elif _role_matches(song, slot):
        reason = f"fits the {slot} slot"
    else:
        reason = "balanced rotation pick"
    return score, reason


def _weighted_pick(candidates: list[tuple[float, str, Song, dict[str, object]]]) -> tuple[float, str, Song, dict[str, object]]:
    if len(candidates) == 1:
        return candidates[0]
    floor = min(score for score, _reason, _song, _usage in candidates)
    weights = [math.exp((score - floor) / 18) for score, _reason, _song, _usage in candidates]
    total = sum(weights)
    marker = _suggestion_random.uniform(0, total)
    running = 0.0
    for candidate, weight in zip(candidates, weights, strict=True):
        running += weight
        if marker <= running:
            return candidate
    return candidates[-1]


def get_song_or_404(session: Session, song_id: str) -> Song:
    song = session.get(Song, song_id)
    if song is None or song.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Song not found")
    return song


@router.get("/songs", response_model=list[SongRead])
def list_songs(
    session: Session = Depends(get_session),
    _current_user: User = Depends(require_permission("songs:read")),
    search: str | None = None,
) -> list[SongRead]:
    statement = select(Song).where(Song.deleted_at.is_(None)).order_by(Song.title)
    if search:
        statement = statement.where(Song.title.ilike(f"%{search}%"))

    return [song_to_read(song) for song in session.scalars(statement).all()]


@router.get("/worship-suggestions", response_model=WorshipSetSuggestionRead)
def suggest_worship_set(
    _current_user: User = Depends(require_permission("songs:read")),
    session: Session = Depends(get_session),
    limit: int = 5,
) -> WorshipSetSuggestionRead:
    songs = session.scalars(
        select(Song).where(Song.deleted_at.is_(None), Song.lyrics.is_not(None)).order_by(Song.title)
    ).all()
    usage = _song_usage(session)
    now = datetime.now(UTC)
    safe_limit = max(min(limit, 8), 1)
    slots = (["opener"] + ["middle"] * max(safe_limit - 2, 0) + ["closer"])[:safe_limit]
    selected_ids: set[str] = set()
    suggested: list[WorshipSuggestedSongRead] = []

    for slot in slots:
        candidates = []
        for song in songs:
            if song.id in selected_ids:
                continue
            song_usage = usage.get(
                song.id,
                {
                    "use_count": 0,
                    "last_used": None,
                    "used_dates": [],
                    "slot_counts": {"opener": 0, "middle": 0, "closer": 0},
                },
            )
            score, reason = _song_score(song, slot, song_usage, now)
            candidates.append((score, reason, song, song_usage))
        if not candidates:
            break
        score, reason, song, song_usage = _weighted_pick(candidates)
        selected_ids.add(song.id)
        last_used = song_usage.get("last_used")
        suggested.append(
            WorshipSuggestedSongRead(
                song=song_to_read(song),
                slot=slot,
                score=round(score, 2),
                reason=reason,
                usage=WorshipSongUsageRead(
                    use_count=int(song_usage.get("use_count") or 0),
                    last_used=last_used.isoformat() if isinstance(last_used, datetime) else None,
                ),
            )
        )

    return WorshipSetSuggestionRead(songs=suggested)


@router.post("/songs", response_model=SongRead, status_code=status.HTTP_201_CREATED)
def create_song(
    payload: SongCreate,
    current_user: User = Depends(require_permission("songs:create")),
    session: Session = Depends(get_session),
) -> SongRead:
    values = payload.model_dump()
    values["sequence"] = normalize_song_sequence(values.get("sequence"))
    song = Song(**values)
    session.add(song)
    session.flush()
    session.add(
        HistoryEntry(
            actor_id=current_user.id,
            entity_type=SONG_HISTORY_ENTITY_TYPE,
            entity_id=song.id,
            action=SONG_HISTORY_ACTION,
            details=json.dumps(
                {
                    "label": f'creating "{song.title}"',
                    "affected": song.title,
                    "change_type": "song",
                    "restorable": False,
                    "before": [],
                    "after": [],
                },
                separators=(",", ":"),
            ),
        )
    )
    session.commit()
    session.refresh(song)
    return song_to_read(song)


@router.get("/songs/{song_id}", response_model=SongRead)
def get_song(
    song_id: str,
    _current_user: User = Depends(require_permission("songs:read")),
    session: Session = Depends(get_session),
) -> SongRead:
    return song_to_read(get_song_or_404(session, song_id))


@router.patch("/songs/{song_id}", response_model=SongRead)
def update_song(
    song_id: str,
    payload: SongUpdate,
    current_user: User = Depends(require_any_permission("songs:edit", "songs:create")),
    session: Session = Depends(get_session),
) -> SongRead:
    song = get_song_or_404(session, song_id)
    changes: list[str] = []
    values = payload.model_dump(exclude_unset=True)
    if "sequence" in values:
        values["sequence"] = normalize_song_sequence(values["sequence"])
    for field, value in values.items():
        before = getattr(song, field)
        if before != value:
            changes.append(_song_change_summary(field, before, value))
        setattr(song, field, value)

    _record_song_history(session, song, current_user, changes)
    session.commit()
    session.refresh(song)
    return song_to_read(song)


@router.delete("/songs/{song_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_song(
    song_id: str,
    current_user: User = Depends(require_permission("songs:delete")),
    session: Session = Depends(get_session),
) -> Response:
    song = get_song_or_404(session, song_id)
    song.deleted_at = datetime.now(UTC)
    session.add(
        HistoryEntry(
            actor_id=current_user.id,
            entity_type=SONG_HISTORY_ENTITY_TYPE,
            entity_id=song.id,
            action=SONG_HISTORY_ACTION,
            details=json.dumps(
                {
                    "label": f'archiving "{song.title}"',
                    "affected": song.title,
                    "change_type": "song",
                    "restorable": False,
                    "before": [],
                    "after": [],
                },
                separators=(",", ":"),
            ),
        )
    )
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/song-parts", response_model=list[SongPartRead])
def list_song_parts(
    _current_user: User = Depends(require_permission("songs:read")),
    session: Session = Depends(get_session),
) -> list[SongPartRead]:
    song_parts = session.scalars(select(SongPart).order_by(SongPart.sort_order, SongPart.name)).all()
    return [
        SongPartRead(
            id=song_part.id,
            name=song_part.name,
            abbreviation=song_part.abbreviation,
            sort_order=song_part.sort_order,
        )
        for song_part in song_parts
    ]
