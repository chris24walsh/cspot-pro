import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.core.database import Base
from app.modules.identity.models import User
from app.modules.music.models import RhythmPreset
from app.modules.music.routes import create_rhythm_preset, list_rhythm_presets
from app.modules.music.schemas import RhythmPresetCreate, SongRhythm


def test_named_custom_meter_and_strum_are_reusable_by_other_players() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine, tables=[RhythmPreset.__table__])
    with Session(engine) as session:
        author = User(id="author")
        other_player = User(id="reader")
        meter = create_rhythm_preset(
            RhythmPresetCreate(kind="meter", name=" Seven ", numerator=7, denominator=8),
            author,
            session,
        )
        strum = create_rhythm_preset(
            RhythmPresetCreate(
                kind="strum",
                name="Seven groove",
                numerator=7,
                denominator=8,
                subdivision=1,
                strokes=["D", "-", "U", "D", "-", "U", "D"],
            ),
            author,
            session,
        )
        session.expire_all()
        shared = list_rhythm_presets(other_player, session)
        assert {preset.id for preset in shared} == {meter.id, strum.id}
        assert shared[0].name == "Seven"
        assert strum.strokes == ["D", "-", "U", "D", "-", "U", "D"]
        with pytest.raises(HTTPException) as error:
            create_rhythm_preset(
                RhythmPresetCreate(kind="meter", name="seven", numerator=5, denominator=4),
                author,
                session,
            )
        assert error.value.status_code == 409
        assert len(list_rhythm_presets(other_player, session)) == 2


@pytest.mark.parametrize(
    "payload",
    [
        {"kind": "strum", "name": "", "numerator": 4, "denominator": 4},
        {"kind": "strum", "name": "   ", "numerator": 4, "denominator": 4},
        {
            "kind": "strum",
            "name": "Wrong length",
            "numerator": 4,
            "denominator": 4,
            "subdivision": 2,
            "strokes": ["D"],
        },
        {
            "kind": "meter",
            "name": "Unexpected pattern",
            "numerator": 4,
            "denominator": 4,
            "subdivision": 1,
            "strokes": ["D"] * 4,
        },
    ],
)
def test_shared_presets_reject_empty_names_and_invalid_data(payload: dict) -> None:
    with pytest.raises(ValidationError):
        RhythmPresetCreate.model_validate(payload)


def test_bar_charts_tempo_and_pattern_names_round_trip_and_old_metadata_gets_defaults() -> None:
    rhythm = SongRhythm.model_validate({"numerator": 7, "denominator": 8, "patterns": []})
    assert rhythm.bpm == 90
    assert rhythm.arrangements == []
    upgraded = SongRhythm.model_validate(
        {
            **rhythm.model_dump(),
            "bpm": 110,
            "arrangements": [{"section": "V1", "chart": "C | G *2"}],
        }
    )
    assert upgraded.model_dump()["arrangements"] == [{"section": "V1", "chart": "C | G *2"}]
    with pytest.raises(ValidationError):
        SongRhythm.model_validate(
            {
                **rhythm.model_dump(),
                "arrangements": [{"section": "V1", "chart": "C"}, {"section": "v1", "chart": "G"}],
            }
        )
