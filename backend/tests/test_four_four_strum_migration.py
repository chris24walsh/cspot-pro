import importlib.util
from copy import deepcopy
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

from app.modules.music.schemas import RhythmPresetCreate, SongRhythm


def test_migration_preserves_strokes_markers_bars_and_timing_and_can_restore():
    path = Path(__file__).parents[1] / "migrations/versions/0071_four_four_strum_grids.py"
    spec = importlib.util.spec_from_file_location("four_four_migration", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    original = {
        "numerator": 8,
        "denominator": 8,
        "bpm": 180,
        "patterns": [
            {
                "section": "Default",
                "name": "Saved groove",
                "bars": 1,
                "subdivision": 2,
                "strokes": ["D", "U", "S", "s"] * 4,
            }
        ],
        "markers": [{"id": "bar", "section": "V1", "lineIndex": 0, "anchorIndex": 3}],
        "arrangements": [{"section": "V1", "chart": "C@1 G@5 | Am@3"}],
        "notes": "Keep gently",
    }
    untouched = deepcopy(original)
    untouched.update(numerator=4, denominator=4)
    untouched["patterns"][0]["bars"] = 2
    metadata = sa.MetaData()
    songs = sa.Table(
        "songs",
        metadata,
        sa.Column("id", sa.String, primary_key=True),
        sa.Column("rhythm", sa.JSON),
    )
    presets = sa.Table(
        "rhythm_presets",
        metadata,
        sa.Column("id", sa.String, primary_key=True),
        sa.Column("kind", sa.String),
        sa.Column("name", sa.String),
        sa.Column("numerator", sa.Integer),
        sa.Column("denominator", sa.Integer),
        sa.Column("subdivision", sa.Integer),
        sa.Column("strokes", sa.JSON),
    )
    engine = sa.create_engine("sqlite://")
    metadata.create_all(engine)
    with engine.begin() as connection:
        connection.execute(
            songs.insert(),
            [{"id": "convert", "rhythm": original}, {"id": "keep", "rhythm": untouched}],
        )
        connection.execute(
            presets.insert().values(
                id="strum",
                kind="strum",
                name="Saved groove",
                numerator=8,
                denominator=8,
                subdivision=2,
                strokes=original["patterns"][0]["strokes"],
            )
        )
        migration.op = Operations(MigrationContext.configure(connection))
        migration.upgrade()
        converted = connection.execute(
            sa.select(songs.c.rhythm).where(songs.c.id == "convert")
        ).scalar_one()
        SongRhythm(**converted)
        assert converted["patterns"][0]["strokes"] == original["patterns"][0]["strokes"]
        assert converted["patterns"][0]["subdivision"] == 4
        assert converted["patterns"][0]["bars"] == 1
        assert converted["markers"] == original["markers"]
        assert converted["bpm"] == 90
        assert (
            60 * original["numerator"] / original["bpm"]
            == 60 * converted["numerator"] / converted["bpm"]
        )
        assert converted["arrangements"][0]["chart"] == "C@1 G@3 | Am@2"
        assert (
            connection.execute(sa.select(songs.c.rhythm).where(songs.c.id == "keep")).scalar_one()
            == untouched
        )
        preset = dict(connection.execute(sa.select(presets)).mappings().one())
        assert preset.pop("id") == "strum"
        RhythmPresetCreate(**preset)
        assert preset["name"] == "Saved groove" and preset["subdivision"] == 4
        migration.downgrade()
        assert (
            connection.execute(
                sa.select(songs.c.rhythm).where(songs.c.id == "convert")
            ).scalar_one()
            == original
        )
        assert connection.execute(sa.select(presets.c.subdivision)).scalar_one() == 2
    engine.dispose()
