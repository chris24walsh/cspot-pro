import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.core.database import Base
from app.modules.broadcast.audio_mix import (
    AudioMixInput,
    audio_mix_inputs,
    ffmpeg_recording_mix_command,
)
from app.modules.broadcast.audio_scenes import activate_audio_scene
from app.modules.broadcast.models import BroadcastViewerSettings
from app.modules.broadcast.routes import update_viewer_settings
from app.modules.broadcast.schemas import BroadcastViewerSettingsUpdate
from app.modules.mixer.models import MixerConfiguration


@pytest.mark.parametrize(
    "inputs",
    [
        [],
        [AudioMixInput("desk", "http://desk", -3)],
        [AudioMixInput("desk", "http://desk"), AudioMixInput("room", "http://room")],
    ],
)
def test_recording_rejects_software_mix_graphs(inputs):
    with pytest.raises(ValueError, match="retired"):
        ffmpeg_recording_mix_command(inputs, Path("sermon.ogg"))


def test_software_mode_cannot_be_reenabled():
    with pytest.raises(ValidationError):
        BroadcastViewerSettingsUpdate(audio_mix_mode="software")


def test_program_selection_mute_and_scenes_preserve_unity_stereo(monkeypatch):
    db = create_engine("sqlite://")
    Base.metadata.create_all(
        db, tables=[BroadcastViewerSettings.__table__, MixerConfiguration.__table__]
    )
    monkeypatch.setattr("app.modules.broadcast.routes.reconfigure_active_recording", lambda s: None)
    monkeypatch.setattr(
        "app.modules.broadcast.audio_scenes.reconfigure_active_recording", lambda s: None
    )
    monkeypatch.setattr(
        "app.modules.broadcast.routes.reconcile_audio_sources", lambda sources: None
    )
    with Session(db) as session:
        settings = BroadcastViewerSettings(
            live_audio_source="none",
            audio_sources_json=json.dumps(
                [
                    {
                        "id": "desk",
                        "label": "Desk",
                        "url": "http://desk/program.mp3",
                        "role": "desk",
                        "gain_db": -12,
                        "mix_enabled": False,
                    }
                ]
            ),
        )
        session.add(settings)
        session.commit()
        result = update_viewer_settings(
            BroadcastViewerSettingsUpdate(mixer_program_source_id="desk"),
            SimpleNamespace(id="operator"),
            session,
        )
        assert result.live_audio_source == "desk"
        original_sources = settings.audio_sources_json
        for scene in ["pastor", "media", "pre_service", "worship"]:
            assert activate_audio_scene(session, settings, scene)
            assert settings.audio_sources_json == original_sources
            assert audio_mix_inputs(settings) == [
                AudioMixInput("desk", "http://desk/program.mp3", 0, 2)
            ]
        command = ffmpeg_recording_mix_command(audio_mix_inputs(settings), Path("sermon.ogg"))
        assert "-filter_complex" not in command
        assert command[command.index("-ac") + 1] == "2"
        result = update_viewer_settings(
            BroadcastViewerSettingsUpdate(live_audio_source="none"),
            SimpleNamespace(id="operator"),
            session,
        )
        assert result.live_audio_source == "none"
        assert activate_audio_scene(session, settings, "worship")
        assert audio_mix_inputs(settings) == []
        with pytest.raises(HTTPException) as error:
            update_viewer_settings(
                BroadcastViewerSettingsUpdate(live_audio_source="mix"),
                SimpleNamespace(id="operator"),
                session,
            )
        assert error.value.status_code == 422


def test_migration_preserves_desks_mutes_and_ambiguous_sources(monkeypatch):
    path = Path(__file__).parents[1] / "migrations/versions/0076_retire_software_audio_mix.py"
    spec = importlib.util.spec_from_file_location("retire_mix", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    db = create_engine("sqlite://")
    Base.metadata.create_all(db, tables=[BroadcastViewerSettings.__table__])
    with db.begin() as connection:
        for key, selected, program, sources in [
            (
                "legacy",
                "mix",
                None,
                [{"id": "desk", "role": "desk"}, {"id": "pc", "role": "media"}],
            ),
            ("ambiguous", "mix", None, [{"id": "a", "role": "desk"}, {"id": "b", "role": "desk"}]),
            ("muted", "none", "desk", [{"id": "desk", "role": "desk"}]),
        ]:
            connection.execute(
                BroadcastViewerSettings.__table__.insert().values(
                    id=key,
                    audio_mix_mode="software",
                    live_audio_source=selected,
                    mixer_program_source_id=program,
                    audio_sources_json=json.dumps(sources),
                )
            )
        monkeypatch.setattr(migration.op, "get_bind", lambda: connection)
        migration.upgrade()
        rows = {
            row.id: row
            for row in connection.execute(text("SELECT * FROM broadcast_viewer_settings"))
        }
        assert rows["legacy"].live_audio_source == "desk"
        assert rows["legacy"].mixer_program_source_id == "desk"
        assert rows["ambiguous"].live_audio_source == "none"
        assert rows["muted"].live_audio_source == "none"
        assert all(row.audio_mix_mode == "mixer" for row in rows.values())
        assert json.loads(rows["legacy"].audio_sources_json)[1]["id"] == "pc"
