from datetime import UTC, datetime
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_session
from app.modules.library.models import ItemFile, StoredFile
from app.modules.music.models import Song
from app.modules.planning.models import Plan, PlanItem, PlanType
from app.modules.presentation import tv
from app.modules.presentation.routes import router as presentation_router


@pytest.fixture
def display(monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        service_type = PlanType(id="service", name="Service")
        worship_type = PlanType(id="worship", name="Worship Set")
        session.add_all([service_type, worship_type])
        date = datetime(2026, 11, 8, tzinfo=UTC)
        session.add_all([
            Plan(id="live", plan_type_id="service", title="Live", service_date=date, info="Private"),
            Plan(id="set", plan_type_id="worship", title="Songs", service_date=date),
            Plan(id="private", plan_type_id="service", title="Private", service_date=date),
            Song(id="song", title="Live song", lyrics="Sing"),
            Song(id="private-song", title="Private song", lyrics="Private"),
        ])
        session.flush()
        session.add_all([
            PlanItem(id="item", plan_id="set", item_type="song", title="Live song", song_id="song", sequence=1, comment="Display text"),
            PlanItem(id="private-item", plan_id="private", item_type="song", title="Private", song_id="private-song", sequence=1),
            StoredFile(id="image", display_name="Image", storage_path="/unused"),
            StoredFile(id="private-file", display_name="Private", storage_path="/unused"),
        ])
        session.flush()
        session.add_all([ItemFile(plan_item_id="item", file_id="image"), ItemFile(plan_item_id="private-item", file_id="private-file")])
        session.commit()
        monkeypatch.setattr(tv, "live_services", lambda db: [SimpleNamespace(plan_id="live")])
        app = FastAPI()
        app.include_router(tv.router, prefix="/api/v1/tv")
        app.include_router(presentation_router, prefix="/api/v1/presentation")
        app.dependency_overrides[get_session] = lambda: session
        with TestClient(app) as client:
            yield client, session


def test_anonymous_display_only_reads_active_content(display):
    client, _ = display
    plans = client.get("/api/v1/tv/planning/plans")
    assert plans.status_code == 200
    assert {plan["id"] for plan in plans.json()} == {"live", "set"}
    assert next(plan for plan in plans.json() if plan["id"] == "live")["info"] is None
    assert client.get("/api/v1/tv/planning/plans/set").json()["items"][0]["comment"] == "Display text"
    assert client.get("/api/v1/tv/planning/plans/private").status_code == 404
    assert [song["id"] for song in client.get("/api/v1/tv/music/songs").json()] == ["song"]
    assert client.patch("/api/v1/tv/presentation/live/live", json={}).status_code == 405
    assert client.get("/api/v1/tv/presentation/live/private").status_code == 404
    assert client.get("/api/v1/tv/presentation/pointer/private").status_code == 404


def test_public_files_are_scoped_and_rendered_urls_remain_public(display, monkeypatch):
    client, _ = display
    monkeypatch.setattr(tv.library, "list_rendered_slides", lambda *args: [SimpleNamespace(image_url="/api/v1/library/files/image/slides/1.png", index=1)])
    response = client.get("/api/v1/tv/library/files/image/slides")
    assert response.status_code == 200
    assert response.json()[0]["image_url"] == "/api/v1/tv/library/files/image/slides/1.png"
    for path in ["download", "slides", "slides/1.png"]:
        assert client.get(f"/api/v1/tv/library/files/private-file/{path}").status_code == 404


def test_stopping_output_revokes_public_content(display, monkeypatch):
    client, _ = display
    monkeypatch.setattr(tv, "live_services", lambda db: [])
    assert client.get("/api/v1/tv/planning/plans").json() == []
    assert client.get("/api/v1/tv/music/songs").json() == []
    assert client.get("/api/v1/tv/planning/plans/live").status_code == 404
    assert client.get("/api/v1/tv/library/files/image/download").status_code == 404


def test_presenter_api_still_requires_login(display):
    client, _ = display
    assert client.get("/api/v1/presentation/live").status_code == 401
    assert client.patch("/api/v1/presentation/live/live", json={}).status_code == 401
