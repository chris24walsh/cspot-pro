from datetime import UTC, datetime
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.core.database import Base
from app.modules.library.models import ItemFile, StoredFile
from app.modules.planning.models import ItemNote, Plan, PlanItem, PlanType
from app.modules.planning.routes import move_plan_item
from app.modules.planning.schemas import PlanItemMove


@pytest.fixture
def rail():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(
        engine,
        tables=[
            PlanType.__table__,
            Plan.__table__,
            PlanItem.__table__,
            ItemNote.__table__,
            StoredFile.__table__,
            ItemFile.__table__,
        ],
    )
    with Session(engine) as session:
        service_type = PlanType(name="Service", active=True)
        worship_type = PlanType(name="Worship Set", active=True)
        session.add_all([service_type, worship_type])
        session.flush()
        service = Plan(
            plan_type_id=service_type.id,
            service_date=datetime(2026, 10, 25, tzinfo=UTC),
            title="Service",
        )
        worship = Plan(
            plan_type_id=worship_type.id, service_date=service.service_date, title="Worship"
        )
        session.add_all([service, worship])
        session.flush()
        first = PlanItem(plan_id=service.id, title="First", item_type="custom", sequence=10)
        second = PlanItem(plan_id=service.id, title="Second", item_type="custom", sequence=20)
        session.add_all([first, second])
        session.flush()
        song = PlanItem(
            plan_id=service.id,
            parent_item_id=first.id,
            title="Song",
            item_type="song",
            sequence=10,
            presentation_options={"fit_mode": "contain"},
        )
        other = PlanItem(
            plan_id=service.id,
            parent_item_id=second.id,
            title="Reading",
            item_type="reading",
            sequence=10,
        )
        session.add_all([song, other])
        session.flush()
        note = ItemNote(plan_item_id=song.id, body="Keep this note")
        stored = StoredFile(
            display_name="Slides", storage_path="slides.pdf", content_type="application/pdf"
        )
        session.add_all([note, stored])
        session.flush()
        attached = ItemFile(plan_item_id=song.id, file_id=stored.id, sort_order=3)
        session.add(attached)
        session.commit()
        with (
            patch("app.modules.planning.routes.require_plan_editable") as editable,
            patch(
                "app.modules.planning.routes.presenter_cannot_change_outline", return_value=False
            ),
            patch(
                "app.modules.planning.routes.plan_item_to_read",
                side_effect=lambda session, item: item,
            ),
        ):
            yield SimpleNamespace(
                session=session,
                service=service,
                worship=worship,
                first=first,
                second=second,
                song=song,
                other=other,
                note=note,
                attached=attached,
                editable=editable,
            )
    engine.dispose()


def move(rail, **position):
    return move_plan_item(
        rail.song.id, PlanItemMove(**position), SimpleNamespace(id="user"), rail.session
    )


def test_moves_between_sections_and_back_out_with_stable_identity(rail):
    original_id = rail.song.id
    move(rail, plan_id=rail.service.id, parent_item_id=rail.second.id, after_item_id=rail.other.id)
    assert rail.song.parent_item_id == rail.second.id
    assert rail.song.sequence > rail.other.sequence
    move(rail, plan_id=rail.service.id, after_item_id=rail.first.id)
    assert rail.song.parent_item_id is None
    assert rail.first.sequence < rail.song.sequence < rail.second.sequence
    assert rail.song.id == original_id
    assert rail.note.plan_item_id == original_id
    assert rail.song.presentation_options["fit_mode"] == "contain"
    assert rail.song.presentation_options["service_placement"] is True


def test_moves_into_empty_section_and_transfers_to_worship_and_back(rail):
    move(rail, plan_id=rail.worship.id)
    assert rail.song.plan_id == rail.worship.id
    assert rail.song.parent_item_id is None
    assert rail.editable.call_count == 2
    move(rail, plan_id=rail.service.id, parent_item_id=rail.first.id)
    assert rail.song.plan_id == rail.service.id
    assert rail.song.parent_item_id == rail.first.id
    assert rail.song.sequence == Decimal(10)
    assert rail.note.plan_item_id == rail.song.id
    assert rail.attached.plan_item_id == rail.song.id
    assert rail.attached.sort_order == 3


@pytest.mark.parametrize("invalid", ["self", "nested", "foreign", "stale"])
def test_rejects_invalid_moves_without_changing_order(rail, invalid):
    position = dict(plan_id=rail.service.id, parent_item_id=rail.second.id)
    if invalid == "self":
        position["parent_item_id"] = rail.song.id
    elif invalid == "nested":
        position["parent_item_id"] = rail.other.id
    elif invalid == "foreign":
        position.update(plan_id=rail.worship.id, parent_item_id=rail.second.id)
    else:
        position["after_item_id"] = rail.first.id
    with pytest.raises(HTTPException) as error:
        move(rail, **position)
    assert error.value.status_code == 422
    assert rail.song.plan_id == rail.service.id
    assert rail.song.parent_item_id == rail.first.id
    assert rail.song.sequence == Decimal(10)


def test_cannot_nest_group_with_children(rail):
    with pytest.raises(HTTPException) as error:
        move_plan_item(
            rail.first.id,
            PlanItemMove(plan_id=rail.service.id, parent_item_id=rail.second.id),
            SimpleNamespace(id="user"),
            rail.session,
        )
    assert error.value.status_code == 422
    assert rail.first.parent_item_id is None


def test_destination_edit_permission_is_required(rail):
    rail.editable.side_effect = [None, HTTPException(status_code=403, detail="Locked")]
    with pytest.raises(HTTPException) as error:
        move(rail, plan_id=rail.worship.id)
    assert error.value.status_code == 403
    assert rail.song.plan_id == rail.service.id


def test_cannot_transfer_to_another_date(rail):
    rail.worship.service_date = datetime(2026, 11, 1, tzinfo=UTC)
    rail.session.commit()
    with pytest.raises(HTTPException) as error:
        move(rail, plan_id=rail.worship.id)
    assert error.value.status_code == 422
    assert rail.song.plan_id == rail.service.id


def test_cannot_transfer_non_song_to_worship_plan(rail):
    with pytest.raises(HTTPException) as error:
        move_plan_item(
            rail.other.id,
            PlanItemMove(plan_id=rail.worship.id),
            SimpleNamespace(id="user"),
            rail.session,
        )
    assert error.value.status_code == 422
    assert rail.other.plan_id == rail.service.id
