from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_session
from app.modules.identity.models import User
from app.modules.identity.auth import CurrentUser, require_any_permission, require_permission
from app.modules.music.models import Song, SongPart
from app.modules.music.schemas import SongCreate, SongPartRead, SongRead, SongUpdate

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
        lyrics_status=lyrics_status,
    )


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
    _current_user: User = Depends(require_permission("songs:create")),
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
