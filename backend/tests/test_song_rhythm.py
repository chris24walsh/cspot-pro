from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from pydantic import ValidationError
from sqlalchemy import Column, MetaData, String, Table, create_engine, text
from sqlalchemy.orm import Session

from app.core.database import Base
from app.modules.identity.models import User
from app.modules.music.models import Song
from app.modules.music.routes import create_song, get_song, update_song
from app.modules.music.schemas import SongCreate, SongRhythm, SongUpdate
from app.modules.planning.models import HistoryEntry


def rhythm_value() -> dict:
    return {
        "numerator": 6,
        "denominator": 8,
        "notes": "Accent the two main beats",
        "patterns": [
            {"section": "Default", "subdivision": 1, "strokes": ["D", "-", "U", "D", "-", "U"]},
            {"section": "Chorus", "subdivision": 1, "strokes": ["D", "U", "U", "D", "U", "U"]},
        ],
    }


def test_song_rhythm_round_trips_and_can_be_cleared_without_changing_chords() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(
        engine, tables=[User.__table__, Song.__table__, HistoryEntry.__table__]
    )
    with Session(engine) as session:
        actor = User(id="player", username="player", name="Player", email="player@example.com")
        session.add(actor)
        session.commit()
        created = create_song(
            SongCreate(title="Rhythm song", chords="Legacy chords", rhythm=rhythm_value()),
            actor,
            session,
        )
        loaded = get_song(created.id, actor, session)
        assert loaded.rhythm.model_dump() == rhythm_value()
        changed = update_song(
            created.id,
            SongUpdate(rhythm={**rhythm_value(), "notes": "Gentle swing"}),
            actor,
            session,
        )
        assert changed.rhythm.notes == "Gentle swing"
        # Partial edits made elsewhere must not erase rhythm guidance.
        renamed = update_song(created.id, SongUpdate(title="Renamed"), actor, session)
        assert renamed.rhythm.notes == "Gentle swing"
        cleared = update_song(created.id, SongUpdate(rhythm=None), actor, session)
        assert cleared.rhythm is None
        assert cleared.chords == "Legacy chords"


@pytest.mark.parametrize(
    "changes",
    [
        {"numerator": 0},
        {"numerator": 13},
        {"denominator": 3},
        {"patterns": [{"section": "Default", "subdivision": 1, "strokes": ["D"]}]},
        {"patterns": [{"section": "Default", "subdivision": 1, "strokes": ["?"] * 6}]},
        {"patterns": [rhythm_value()["patterns"][0]] * 2},
    ],
)
def test_rejects_invalid_meters_strokes_and_duplicate_patterns(changes: dict) -> None:
    with pytest.raises(ValidationError):
        SongRhythm.model_validate({**rhythm_value(), **changes})


def test_meter_only_and_existing_songs_need_no_pattern() -> None:
    assert SongCreate(title="Existing song").rhythm is None
    assert SongRhythm(numerator=7, denominator=8).patterns == []


def test_rhythm_migration_preserves_existing_song_rows() -> None:
    engine = create_engine("sqlite://")
    songs = Table(
        "songs", MetaData(), Column("id", String, primary_key=True), Column("title", String)
    )
    songs.create(engine)
    spec = spec_from_file_location(
        "song_rhythm_migration",
        Path(__file__).parents[1] / "migrations/versions/0069_song_rhythm.py",
    )
    migration = module_from_spec(spec)
    spec.loader.exec_module(migration)
    with engine.begin() as connection:
        connection.execute(songs.insert().values(id="existing", title="Existing song"))
        with Operations.context(MigrationContext.configure(connection)):
            migration.upgrade()
        row = connection.execute(
            text("SELECT title, rhythm FROM songs WHERE id = 'existing'")
        ).one()
        assert row == ("Existing song", None)
