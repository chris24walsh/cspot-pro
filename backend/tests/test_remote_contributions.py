"""Invitation boundaries and temporary program routing for remote speakers."""

import hashlib
import json
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.core.database import Base, get_session
from app.modules.broadcast import contributions as remote
from app.modules.broadcast.audio_mix import audio_mix_inputs
from app.modules.broadcast.contribution_state import active_contribution, stream_name
from app.modules.broadcast.models import BroadcastContribution, BroadcastViewerSettings
from app.modules.broadcast.routes import playback_authorized, settings_read, update_viewer_settings
from app.modules.broadcast.schemas import BroadcastViewerSettingsUpdate


@pytest.fixture()
def setup(monkeypatch):
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    session = Session(engine)
    settings = BroadcastViewerSettings(
        stream_title="Service",
        camera_url="/app/camera/api/stream.m3u8?src=church",
        active_camera_id="lectern",
        camera_cycle_seconds=30,
        audio_sources_json=json.dumps(
            [
                {"id": "desk", "label": "Desk", "url": "http://church/desk.mp3", "role": "desk"},
            ]
        ),
        mixer_program_source_id="desk",
        live_audio_source="desk",
        manual_live_audience="public",
    )
    session.add(settings)
    session.commit()
    monkeypatch.setattr(remote.config, "camera_proxy_upstream", "http://gateway:1984/")
    monkeypatch.setattr(remote.config, "remote_ice_servers_json", "[]")
    monkeypatch.setattr(remote.config, "remote_turn_urls", "")
    monkeypatch.setattr(remote.config, "remote_turn_secret", "")
    monkeypatch.setattr(remote, "reconfigure_recording", lambda session: None)
    monkeypatch.setattr(remote, "gateway_available", lambda: True)
    app = FastAPI()
    app.include_router(remote.router, prefix="/remote")
    app.dependency_overrides[get_session] = lambda: session
    app.dependency_overrides[remote.operator] = lambda: SimpleNamespace(id="operator")
    client = TestClient(app)
    yield session, settings, client
    client.close()
    session.close()
    engine.dispose()


def invite(client):
    result = client.post("/remote", json={"label": "Pastor", "return_source_id": "desk"})
    assert result.status_code == 201, result.text
    return result.json()


def authorization(invitation):
    return {"Authorization": f"Bearer {invitation['token']}"}


def connected_guest(session, client):
    invitation = invite(client)
    guest = session.get(BroadcastContribution, invitation["id"])
    guest.last_seen_at = datetime.now(UTC)
    guest.publisher_session = "publisher-session"
    session.commit()
    return invitation, guest


def test_invitation_stores_only_hash_and_guest_is_backstage(setup):
    session, settings, client = setup
    invitation = invite(client)
    guest = session.scalar(select(BroadcastContribution))
    assert guest.token_hash == hashlib.sha256(invitation["token"].encode()).hexdigest()
    assert guest.token_hash != invitation["token"]
    result = client.get("/remote/guest", headers=authorization(invitation))
    assert result.status_code == 200
    assert result.headers["cache-control"] == "no-store"
    assert result.json()["live"] is False
    assert "token" not in result.json()
    assert "token_hash" not in client.get("/remote").text
    assert settings.remote_contribution_id is None


@pytest.mark.parametrize("header", [None, "Bearer wrong", "Basic abc", "Bearer " + "x" * 43])
def test_guest_requires_valid_invitation(setup, header):
    _, _, client = setup
    assert (
        client.get("/remote/guest", headers={"Authorization": header} if header else {}).status_code
        == 401
    )


def test_expired_and_revoked_invites_cannot_signal(setup):
    session, _, client = setup
    invitation = invite(client)
    guest = session.get(BroadcastContribution, invitation["id"])
    guest.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    session.commit()
    assert (
        client.post(
            "/remote/guest/publish",
            json={"sdp": "v=0\r\ninvalid"},
            headers=authorization(invitation),
        ).status_code
        == 401
    )
    guest.expires_at = datetime.now(UTC) + timedelta(hours=1)
    guest.revoked_at = datetime.now(UTC)
    session.commit()
    assert client.get("/remote/guest", headers=authorization(invitation)).status_code == 401


def test_operator_permission_required_without_override(setup):
    _, _, client = setup
    client.app.dependency_overrides.pop(remote.operator)
    assert client.get("/remote").status_code == 401
    assert client.post("/remote", json={"label": "Pastor"}).status_code == 401
    assert client.post("/remote/random/on-air", json={"live": True}).status_code == 401


def test_guest_token_does_not_grant_operator_access(setup):
    _, _, client = setup
    invitation = invite(client)
    client.app.dependency_overrides.pop(remote.operator)
    assert client.get("/remote", headers=authorization(invitation)).status_code == 401


def test_on_air_override_preserves_church_configuration_and_falls_back(setup, monkeypatch):
    session, settings, client = setup
    invitation, guest = connected_guest(session, client)
    monkeypatch.setattr(
        remote,
        "gateway",
        lambda *a, **k: SimpleNamespace(json=lambda: {"producers": [{"bytes_recv": 1024}]}),
    )
    result = client.post(f"/remote/{guest.id}/on-air", json={"live": True})
    assert result.status_code == 200, result.text
    assert result.json()["live"]
    read = settings_read(settings)
    assert read.remote_contribution.stream_name == stream_name(guest)
    assert read.active_camera_id == "lectern"
    assert read.camera_cycle_seconds == 30
    assert read.live_audio_source == "desk"
    assert read.camera_sources[0].id == "lectern"
    assert audio_mix_inputs(settings)[0].source_id == f"guest-{guest.id}"
    assert settings.mixer_program_source_id == "desk"
    assert settings.camera_sources_json is None
    # An unrelated settings save must never persist guest feeds or change routing.
    monkeypatch.setattr("app.modules.broadcast.routes.reconfigure_active_recording", lambda s: None)
    monkeypatch.setattr("app.modules.broadcast.routes.reconcile_audio_sources", lambda s: None)
    update_viewer_settings(
        BroadcastViewerSettingsUpdate(stream_title="Updated"), SimpleNamespace(id="op"), session
    )
    assert settings.live_audio_source == "desk"
    assert len(json.loads(settings.audio_sources_json)) == 1
    guest.last_seen_at = datetime.now(UTC) - timedelta(seconds=26)
    session.commit()
    assert active_contribution(settings) is None
    assert settings_read(settings).remote_contribution is None
    assert audio_mix_inputs(settings)[0].url == "http://church/desk.mp3"


def test_off_air_and_missing_media_cannot_be_selected(setup, monkeypatch):
    session, _, client = setup
    invitation = invite(client)
    guest_id = invitation["id"]
    assert client.post(f"/remote/{guest_id}/on-air", json={"live": True}).status_code == 409
    guest = session.get(BroadcastContribution, guest_id)
    guest.last_seen_at = datetime.now(UTC)
    session.commit()
    monkeypatch.setattr(
        remote, "gateway", lambda *a, **k: SimpleNamespace(json=lambda: {"producers": []})
    )
    assert client.post(f"/remote/{guest_id}/on-air", json={"live": True}).status_code == 409


def test_heartbeat_from_replaced_connection_is_rejected(setup):
    session, _, client = setup
    invitation, guest = connected_guest(session, client)
    response = client.post(
        "/remote/guest/heartbeat",
        json={"publisher_session": "old-device"},
        headers=authorization(invitation),
    )
    assert response.status_code == 409
    assert guest.publisher_session == "publisher-session"


def test_disconnect_immediately_restores_church_feed(setup):
    session, settings, client = setup
    invitation, guest = connected_guest(session, client)
    settings.remote_contribution_id = guest.id
    session.commit()
    result = client.post(
        "/remote/guest/heartbeat",
        json={"publisher_session": guest.publisher_session, "connected": False},
        headers=authorization(invitation),
    )
    assert result.status_code == 200
    assert settings.remote_contribution_id is None
    assert not result.json()["connected"]


def test_return_audio_is_independent_of_remote_program(setup, monkeypatch):
    session, settings, client = setup
    invitation, guest = connected_guest(session, client)
    settings.remote_contribution_id = guest.id
    session.commit()
    calls = []
    monkeypatch.setattr(remote, "register_stream", lambda *args: calls.append(args))
    monkeypatch.setattr(remote, "exchange", lambda *args: {"sdp": "answer"})
    result = client.post(
        "/remote/guest/return",
        json={"sdp": "v=0\r\nreturn-offer"},
        headers=authorization(invitation),
    )
    assert result.status_code == 200
    assert calls[0][1] == "ffmpeg:http://church/desk.mp3#audio=opus"
    guest.return_source_id = f"guest-{guest.id}"
    session.commit()
    assert (
        client.post(
            "/remote/guest/return",
            json={"sdp": "v=0\r\nreturn-offer"},
            headers=authorization(invitation),
        ).status_code
        == 409
    )


def test_revocation_survives_gateway_failure(setup, monkeypatch):
    session, settings, client = setup
    invitation, guest = connected_guest(session, client)
    settings.remote_contribution_id = guest.id
    session.commit()

    def failed_gateway(*a, **k):
        raise HTTPException(502, "Gateway offline")

    monkeypatch.setattr(remote, "gateway", failed_gateway)
    assert client.delete(f"/remote/{guest.id}").status_code == 502
    assert session.get(BroadcastContribution, guest.id).revoked_at is not None
    assert settings.remote_contribution_id is None
    assert client.get("/remote/guest", headers=authorization(invitation)).status_code == 401


def test_expired_publisher_cleanup_is_scoped(setup, monkeypatch):
    session, settings, client = setup
    _, guest = connected_guest(session, client)
    guest.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    settings.remote_contribution_id = guest.id
    session.commit()
    calls = []
    monkeypatch.setattr(remote, "gateway", lambda *args, **kwargs: calls.append((args, kwargs)))
    remote.cleanup_contributions(session)
    assert settings.remote_contribution_id is None
    assert session.get(BroadcastContribution, guest.id) is None
    assert len(calls) == 4
    assert all(
        call[1]["params"].get("src", "cspot-guest-").startswith("cspot-guest-") for call in calls
    )


def test_temporary_stream_registration_never_persists_config(setup, monkeypatch):
    session, _, client = setup
    _, guest = connected_guest(session, client)
    calls = []

    def gateway(*args, **kwargs):
        calls.append((args, kwargs))
        return SimpleNamespace(json=lambda: {})

    monkeypatch.setattr(remote, "gateway", gateway)
    remote.prepare_streams(guest)
    assert [c[0][0] for c in calls] == ["GET", "PATCH", "PATCH"]
    assert calls[1][1]["params"]["name"].startswith("cspot-guest-raw-")
    assert "#video=h264#audio=aac" in calls[2][1]["params"]["src"]


def test_gateway_session_delete_is_idempotent(setup, monkeypatch):
    _, _, _client = setup
    monkeypatch.setattr(
        remote.requests,
        "request",
        lambda *a, **k: SimpleNamespace(
            status_code=404, raise_for_status=lambda: (_ for _ in ()).throw(AssertionError())
        ),
    )
    assert remote.gateway("DELETE", "api/webrtc", missing_ok=True).status_code == 404


def test_turn_credentials_are_temporary_and_do_not_reveal_shared_secret(setup, monkeypatch):
    monkeypatch.setattr(
        remote.config, "remote_turn_urls", "turn:relay.example:3478,turns:relay.example:5349"
    )
    monkeypatch.setattr(remote.config, "remote_turn_secret", "private-shared-key")
    servers = remote.ice_servers()
    assert remote.relay_available(servers)
    assert "private-shared-key" not in json.dumps(servers)
    assert int(servers[0]["username"].split(":")[0]) > datetime.now(UTC).timestamp()


def test_guest_slide_does_not_grant_arbitrary_file_access(setup):
    _, _, client = setup
    invitation = invite(client)
    assert (
        client.get(
            "/remote/guest/files/private-file/content", headers=authorization(invitation)
        ).status_code
        == 404
    )
    assert client.get("/remote/guest/slide", headers=authorization(invitation)).status_code == 404


def test_playback_authorization_excludes_backstage_raw_stream(setup, monkeypatch):
    session, settings, client = setup
    _, guest = connected_guest(session, client)
    monkeypatch.setattr(
        "app.modules.broadcast.routes.list_permissions", lambda *_: ["broadcast:use"]
    )
    monkeypatch.setattr("app.modules.broadcast.routes.live_output_exists", lambda *_: True)
    for source in [stream_name(guest), stream_name(guest, raw=True)]:
        with pytest.raises(HTTPException):
            playback_authorized(
                SimpleNamespace(id="op"), session, playback_source=source, playback_uri=None
            )
    settings.remote_contribution_id = guest.id
    session.commit()
    assert (
        playback_authorized(
            SimpleNamespace(id="op"), session, playback_source=stream_name(guest), playback_uri=None
        ).status_code
        == 204
    )
    with pytest.raises(HTTPException):
        playback_authorized(
            SimpleNamespace(id="op"),
            session,
            playback_source=stream_name(guest, raw=True),
            playback_uri=None,
        )


def service_item(session):
    from app.modules.planning.models import ItemNote, Plan, PlanItem, PlanType
    from app.modules.presentation.models import PresentationPosition, PresentationSession

    plan_type = PlanType(name="Sunday Service")
    session.add(plan_type)
    session.flush()
    plan = Plan(title="Sunday", plan_type_id=plan_type.id, service_date=datetime.now(UTC))
    session.add(plan)
    session.flush()
    item = PlanItem(plan_id=plan.id, title="Sermon", sequence=1, comment="Visible slide text")
    session.add(item)
    session.flush()
    session.add(ItemNote(plan_item_id=item.id, body="PRIVATE TEACHING NOTES"))
    live = remote_session = PresentationSession(plan_id=plan.id, status="live")
    session.add(live)
    session.flush()
    position = PresentationPosition(
        session_id=remote_session.id,
        plan_item_id=item.id,
        payload_json=json.dumps(
            {
                "output_heartbeat_at": int(datetime.now(UTC).timestamp() * 1000),
                "slide_offset": 0,
                "updated_at": int(datetime.now(UTC).timestamp() * 1000),
            }
        ),
    )
    session.add(position)
    session.commit()
    return item, position


def test_guest_slide_excludes_private_notes_and_follows_blanking(setup):
    session, _, client = setup
    invitation = invite(client)
    item, position = service_item(session)
    response = client.get("/remote/guest/slide", headers=authorization(invitation))
    assert response.status_code == 200, response.text
    assert response.json()["item"]["id"] == item.id
    assert response.json()["item"]["teacher_notes"] is None
    assert "PRIVATE TEACHING NOTES" not in response.text
    assert "Visible slide text" in response.text
    payload = json.loads(position.payload_json)
    payload["blanked"] = True
    position.payload_json = json.dumps(payload)
    session.commit()
    assert client.get("/remote/guest/slide", headers=authorization(invitation)).status_code == 404


def test_guest_cannot_fetch_unrelated_image_during_live_service(setup):
    session, _, client = setup
    invitation = invite(client)
    service_item(session)
    assert (
        client.get(
            "/remote/guest/files/unrelated/content", headers=authorization(invitation)
        ).status_code
        == 404
    )


def test_unreachable_gateway_errors_do_not_disclose_source_credentials(setup, monkeypatch):
    def failed_request(*args, **kwargs):
        import requests

        raise requests.ConnectionError("http://secret:password@internal/stream")

    monkeypatch.setattr(remote.requests, "request", failed_request)
    with pytest.raises(HTTPException) as error:
        remote.gateway("GET", "api/streams")
    assert error.value.status_code == 502
    assert "password" not in error.value.detail


def test_invitation_creation_reports_unavailable_webrtc_module(setup, monkeypatch):
    _, _, client = setup
    monkeypatch.setattr(remote, "gateway_available", lambda: False)
    response = client.post("/remote", json={"label": "Pastor"})
    assert response.status_code == 503
    assert "WebRTC listener" in response.json()["detail"]


def signed_in_teacher(session, client, *, name="Teacher", role="teacher"):
    from app.modules.identity.auth import get_current_user
    from app.modules.identity.models import Role, User, UserRole

    user = User(name=name, email=f"{name.lower()}@example.com", username=name.lower(), active=True)
    access = session.scalar(select(Role).where(Role.name == role))
    if not access:
        access = Role(name=role)
        session.add(access)
    session.add(user)
    session.flush()
    session.add(UserRole(user_id=user.id, role_id=access.id))
    session.commit()
    client.app.dependency_overrides[get_current_user] = lambda: user
    return user


def test_teacher_can_enable_own_camera_without_broadcast_admin_access(setup):
    session, settings, client = setup
    teacher = signed_in_teacher(session, client)
    client.app.dependency_overrides.pop(remote.operator)
    result = client.post(
        "/remote/self", json={"label": "Impersonated", "return_source_id": "private"}
    )
    assert result.status_code == 201, result.text
    contribution = result.json()
    guest = session.get(BroadcastContribution, contribution["id"])
    assert guest.owner_user_id == teacher.id
    assert guest.label == teacher.name
    assert guest.return_source_id == "desk"
    assert settings.remote_contribution_id is None
    assert client.get("/remote/guest", headers=authorization(contribution)).status_code == 200
    assert client.post("/remote", json={"label": "Someone else"}).status_code == 403
    assert client.post(f"/remote/{guest.id}/on-air", json={"live": True}).status_code == 403
    assert client.delete(f"/remote/self/{guest.id}").status_code == 200
    assert client.get("/remote/guest", headers=authorization(contribution)).status_code == 401


def test_viewer_cannot_enable_camera_or_microphone(setup):
    session, _, client = setup
    signed_in_teacher(session, client, role="viewer")
    assert client.post("/remote/self").status_code == 403


def test_teacher_can_end_only_their_own_camera_session(setup):
    session, _, client = setup
    signed_in_teacher(session, client, name="First")
    own = client.post("/remote/self").json()
    signed_in_teacher(session, client, name="Second")
    assert client.delete(f"/remote/self/{own['id']}").status_code == 404
    assert session.get(BroadcastContribution, own["id"]).revoked_at is None
    invitation = invite(client)
    assert client.delete(f"/remote/self/{invitation['id']}").status_code == 404


def test_teacher_contribution_permission_does_not_grant_broadcast_control():
    from app.modules.identity.permissions import permissions_for_roles

    teacher = permissions_for_roles(["teacher"])
    assert "broadcast:contribute" in teacher
    assert "broadcast:use" not in teacher
    assert "broadcast:contribute" not in permissions_for_roles(["viewer"])
    assert "broadcast:contribute" in permissions_for_roles(["administrator"])


def test_teacher_return_uses_saved_desk_even_when_broadcast_audio_is_muted(setup):
    session, settings, client = setup
    signed_in_teacher(session, client)
    settings.live_audio_source = "none"
    session.commit()
    result = client.post("/remote/self")
    assert result.status_code == 201
    assert result.json()["return_source_id"] == "desk"
