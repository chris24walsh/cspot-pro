from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_session
from app.modules.identity.models import User
from app.modules.identity.auth import CurrentUser, require_any_permission, require_permission
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
from app.modules.planning.models import Plan, PlanItem, PlanType

router = APIRouter()


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


def _song_usage(session: Session) -> dict[str, dict[str, object]]:
    rows = session.execute(
        select(Song.id, Plan.service_date)
        .join(PlanItem, PlanItem.song_id == Song.id)
        .join(Plan, Plan.id == PlanItem.plan_id)
        .join(PlanType, PlanType.id == Plan.plan_type_id)
        .where(
            Song.deleted_at.is_(None),
            PlanItem.deleted_at.is_(None),
            Plan.deleted_at.is_(None),
            PlanType.name == "Worship Set",
        )
    ).all()
    usage: dict[str, dict[str, object]] = {}
    for song_id, service_date in rows:
        entry = usage.setdefault(song_id, {"use_count": 0, "last_used": None})
        entry["use_count"] = int(entry["use_count"]) + 1
        last_used = entry["last_used"]
        if last_used is None or service_date > last_used:
            entry["last_used"] = service_date
    return usage


def _role_matches(song: Song, slot: str) -> bool:
    role = (song.worship_role or "any").strip().lower()
    return role in {"", "any", slot}


def _song_score(song: Song, slot: str, usage: dict[str, object], now: datetime) -> tuple[float, str]:
    use_count = int(usage.get("use_count") or 0)
    last_used = usage.get("last_used")
    days_since = 9999
    if isinstance(last_used, datetime):
        days_since = max((now - last_used).days, 0)

    energy = song.energy if song.energy is not None else 3
    target_energy = {"opener": 5, "middle": 3, "closer": 2}.get(slot, 3)
    role_bonus = 20 if _role_matches(song, slot) else -18
    freshness_bonus = min(days_since / 7, 16)
    rotation_penalty = use_count * 2.2
    energy_penalty = abs(energy - target_energy) * 2.5
    score = 50 + role_bonus + freshness_bonus - rotation_penalty - energy_penalty

    if use_count == 0:
        reason = "new to the rotation"
    elif days_since >= 90:
        reason = f"not used for {days_since} days"
    elif _role_matches(song, slot):
        reason = f"fits the {slot} slot"
    else:
        reason = "balanced rotation pick"
    return score, reason


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
            song_usage = usage.get(song.id, {"use_count": 0, "last_used": None})
            score, reason = _song_score(song, slot, song_usage, now)
            candidates.append((score, reason, song, song_usage))
        if not candidates:
            break
        score, reason, song, song_usage = max(candidates, key=lambda candidate: candidate[0])
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
    _current_user: User = Depends(require_permission("songs:create")),
    session: Session = Depends(get_session),
) -> SongRead:
    song = Song(**payload.model_dump())
    session.add(song)
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
    _current_user: User = Depends(require_any_permission("songs:edit", "songs:create")),
    session: Session = Depends(get_session),
) -> SongRead:
    song = get_song_or_404(session, song_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(song, field, value)

    session.commit()
    session.refresh(song)
    return song_to_read(song)


@router.delete("/songs/{song_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_song(
    song_id: str,
    _current_user: User = Depends(require_permission("songs:delete")),
    session: Session = Depends(get_session),
) -> Response:
    song = get_song_or_404(session, song_id)
    song.deleted_at = datetime.now(UTC)
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
