import json
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.core.database import Base
from app.modules.music.models import Song
from app.modules.planning.models import Plan, PlanItem, PlanType
from app.modules.presentation.models import PresentationPosition, PresentationSession
from app.modules.presentation.routes import (
    WorshipMusicTiming,
    get_worship_music_timing,
    update_worship_music_timing,
)


@pytest.fixture
def timing_context():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        kind = PlanType(name="Timing test", active=True)
        song = Song(title="Timing song")
        session.add_all([kind, song])
        session.flush()
        plan = Plan(
            plan_type_id=kind.id,
            service_date=datetime.now(UTC),
            title="Timing test",
            status="draft",
        )
        session.add(plan)
        session.flush()
        item = PlanItem(
            plan_id=plan.id, sequence=10, item_type="song", title=song.title, song_id=song.id
        )
        session.add(item)
        session.flush()
        live = PresentationSession(plan_id=plan.id, status="ready")
        session.add(live)
        session.flush()
        position = PresentationPosition(
            session_id=live.id,
            payload_json=json.dumps(
                {"index": 7, "slide_offset": 2, "updated_at": 123, "worship_coupled": True}
            ),
        )
        session.add(position)
        session.commit()
        payload = WorshipMusicTiming(
            owner_id="host",
            song_id=song.id,
            plan_item_id=item.id,
            start_index=3,
            position=0.25,
            bar_duration_ms=2000,
            total_bars=8,
        )
        yield session, plan, position, payload
    engine.dispose()


@pytest.mark.parametrize("role", ["administrator", "worship_leader"])
def test_shared_clock_preserves_service_state_and_stops(timing_context, role):
    session, plan, position, payload = timing_context
    with patch("app.modules.presentation.routes.list_role_names", return_value=[role]):
        response = update_worship_music_timing(
            plan.id, payload, SimpleNamespace(id="admin"), session
        )
        assert response.timing.position == 0.25
        assert response.timing.updated_at == response.server_now
        data = json.loads(position.payload_json)
        assert data["index"] == 7
        assert data["updated_at"] == 123
        assert data["worship_coupled"] is True
        read = get_worship_music_timing(plan.id, None, session)
        assert read.timing.start_index == 3
        payload.active = False
        update_worship_music_timing(plan.id, payload, SimpleNamespace(id="admin"), session)
        assert get_worship_music_timing(plan.id, None, session).timing is None


def test_sharing_rejects_musicians_and_has_one_controller(timing_context):
    session, plan, _position, payload = timing_context
    with patch("app.modules.presentation.routes.list_role_names", return_value=["musician"]):
        with pytest.raises(HTTPException) as error:
            update_worship_music_timing(plan.id, payload, SimpleNamespace(id="musician"), session)
        assert error.value.status_code == 403
    with patch("app.modules.presentation.routes.list_role_names", return_value=["administrator"]):
        update_worship_music_timing(plan.id, payload, SimpleNamespace(id="admin"), session)
        payload.owner_id = "other-device"
        with pytest.raises(HTTPException) as error:
            update_worship_music_timing(plan.id, payload, SimpleNamespace(id="admin"), session)
        assert error.value.status_code == 409


def test_disconnected_clock_expires_without_changing_slides(timing_context):
    session, plan, position, payload = timing_context
    payload.updated_at = int(datetime.now(UTC).timestamp() * 1000) - 13000
    data = json.loads(position.payload_json)
    data["music_timing"] = payload.model_dump()
    position.payload_json = json.dumps(data)
    session.commit()
    assert get_worship_music_timing(plan.id, None, session).timing is None
    assert json.loads(position.payload_json)["index"] == 7


def test_band_selection_is_independent_and_last_writer_wins(timing_context):
    from app.modules.presentation.routes import (
        BandSelection,
        get_band_selection,
        update_band_selection,
    )

    session, plan, position, _payload = timing_context
    assert get_band_selection(plan.id, None, session).selection is None
    first = update_band_selection(
        plan.id, BandSelection(slide_id="first"), SimpleNamespace(id="musician"), session
    )
    second = update_band_selection(
        plan.id, BandSelection(slide_id="second"), SimpleNamespace(id="another"), session
    )
    assert second.selection.updated_at > first.selection.updated_at
    assert get_band_selection(plan.id, None, session).selection.slide_id == "second"
    data = json.loads(position.payload_json)
    assert data["index"] == 7
    assert data["slide_offset"] == 2
    assert data["updated_at"] == 123
    assert data["worship_coupled"] is True
