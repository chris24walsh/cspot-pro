import json

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.core.database import Base
from app.modules.identity.models import User
from app.modules.music.anchors import validate_song_anchors
from app.modules.music.models import Song
from app.modules.music.routes import create_song, update_song
from app.modules.music.schemas import SongCreate, SongUpdate
from app.modules.planning.models import HistoryEntry


def chart(position):
    return json.dumps({"version": 3, "annotations": [position]})


@pytest.mark.parametrize(
    "changes",
    [
        {"anchorIndex": 36},
        {"anchorIndex": -1},
        {"anchorIndex": 1.5},
        {"section": "C"},
        {"lineIndex": 1},
        {"lineIndex": -1},
    ],
)
def test_rejects_hidden_chords_and_bars(changes):
    position = {"id": "stale", "section": "V1", "lineIndex": 0, "anchorIndex": 3, **changes}
    for chords, rhythm in [(chart(position), None), (None, {"markers": [position]})]:
        with pytest.raises(ValueError, match="outside the lyrics"):
            validate_song_anchors("[V1]\nShort", chords, rhythm)


def test_visible_padding_and_blank_lines_match_editor():
    for column in [0, 3, 12]:
        position = {"section": "V1", "lineIndex": 0, "anchorIndex": column}
        validate_song_anchors("\n[Verse 1]\n\nShort  \n", chart(position), None)
    validate_song_anchors(None, "Legacy text", None)


def test_song_writes_reject_hidden_anchors_and_lyric_edits_that_orphan_stops():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(
        engine, tables=[User.__table__, Song.__table__, HistoryEntry.__table__]
    )
    with Session(engine) as session:
        actor = User(id="player", username="player", name="Player", email="player@example.com")
        session.add(actor)
        session.commit()
        position = {"id": "stop", "section": "V1", "lineIndex": 0, "anchorIndex": 20, "chord": "C"}
        with pytest.raises(HTTPException) as error:
            create_song(
                SongCreate(title="Invalid", lyrics="[V1]\nShort", chords=chart(position)),
                actor,
                session,
            )
        assert error.value.status_code == 422
        song = create_song(
            SongCreate(title="Valid", lyrics="[V1]\nA longer lyric line", chords=chart(position)),
            actor,
            session,
        )
        with pytest.raises(HTTPException) as error:
            update_song(song.id, SongUpdate(lyrics="[V1]\nShort"), actor, session)
        assert error.value.status_code == 422
        session.rollback()
        assert session.get(Song, song.id).lyrics == "[V1]\nA longer lyric line"
        saved = update_song(
            song.id,
            SongUpdate(lyrics="[V1]\nShort", chords=chart({**position, "anchorIndex": 3})),
            actor,
            session,
        )
        assert saved.lyrics == "[V1]\nShort"
