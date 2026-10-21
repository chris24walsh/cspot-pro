"""Exercise delegation through HTTP, including dependencies and object scope checks."""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_session
from app.modules.identity.auth import get_current_user
from app.modules.identity.models import (
    AuthToken,
    Role,
    ServingArea,
    ServingAreaManager,
    User,
    UserRole,
    VolunteerPreference,
    VolunteerUnavailability,
)
from app.modules.identity.routes import router, set_user_roles


@pytest.fixture
def management():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(
        engine,
        tables=[
            model.__table__
            for model in (
                User,
                Role,
                UserRole,
                AuthToken,
                ServingArea,
                ServingAreaManager,
                VolunteerPreference,
                VolunteerUnavailability,
            )
        ],
    )
    with Session(engine) as session:
        users = {}
        for name, roles in (
            ("admin", ["administrator"]),
            ("accounts", ["user_administrator"]),
            ("approver", ["registration_approver"]),
            ("manager", ["viewer"]),
            ("member", ["viewer"]),
            ("pending", ["viewer"]),
            ("viewer", ["viewer"]),
        ):
            user = User(
                name=name,
                username=name,
                email=f"{name}@example.com",
                active=name != "pending",
                registration_pending=name == "pending",
                email_confirmed=True,
            )
            session.add(user)
            session.flush()
            set_user_roles(session, user, roles)
            users[name] = user
        areas = [
            ServingArea(key=key, name=key, category="Teams", active=True)
            for key in ("chores", "welcome")
        ]
        session.add_all(areas)
        session.flush()
        session.add(ServingAreaManager(user_id=users["manager"].id, serving_area_id=areas[0].id))
        preferences = [
            VolunteerPreference(
                user_id=users["member"].id,
                serving_area_id=area.id,
                status="pending",
                initiated_by="volunteer",
            )
            for area in areas
        ]
        session.add_all(preferences)
        session.commit()
        actor = [users["admin"]]
        app = FastAPI()
        app.include_router(router, prefix="/identity")
        app.dependency_overrides[get_current_user] = lambda: actor[0]
        app.dependency_overrides[get_session] = lambda: session
        with TestClient(app) as client:
            yield client, session, users, areas, preferences, actor
    engine.dispose()


def test_approver_can_review_registrations_but_cannot_manage_accounts(management):
    client, _, users, _, _, actor = management
    actor[0] = users["approver"]
    response = client.get("/identity/registrations")
    assert response.status_code == 200
    assert [row["id"] for row in response.json()] == [users["pending"].id]
    assert client.get("/identity/users").status_code == 403
    assert client.get("/identity/serving/management").status_code == 403
    assert (
        client.post(f"/identity/users/{users['pending'].id}/registration/approve").status_code
        == 200
    )
    assert (
        client.patch(f"/identity/users/{users['member'].id}", json={"name": "Changed"}).status_code
        == 403
    )


@pytest.mark.parametrize("role", ["administrator", "user_administrator", "registration_approver"])
def test_user_administrator_cannot_grant_management_roles_on_any_write_path(management, role):
    client, _, users, _, _, actor = management
    actor[0] = users["accounts"]
    assert (
        client.patch(
            f"/identity/users/{users['member'].id}", json={"role_names": [role]}
        ).status_code
        == 403
    )
    payload = {"name": "Escalation", "email": "escalate@example.com", "role_names": [role]}
    assert client.post("/identity/users", json=payload).status_code == 403
    assert client.post("/identity/users/invite", json=payload).status_code == 403


@pytest.mark.parametrize("target", ["admin", "accounts", "approver", "manager"])
def test_user_administrator_cannot_take_over_protected_accounts(management, target):
    client, _, users, _, _, actor = management
    actor[0] = users["accounts"]
    url = f"/identity/users/{users[target].id}"
    assert client.get(url).status_code == 403
    assert client.patch(url, json={"email": "takeover@example.com"}).status_code == 403
    assert client.delete(url).status_code == 403
    assert client.post(url + "/password-reset").status_code == 403
    assert client.post(url + "/invite").status_code == 403
    assert client.put(url + "/managed-serving-areas", json={"area_ids": []}).status_code == 403


def test_user_admin_can_grant_standard_roles_without_system_access(management):
    client, _, users, _, _, actor = management
    actor[0] = users["accounts"]
    response = client.patch(
        f"/identity/users/{users['member'].id}", json={"role_names": ["presenter"]}
    )
    assert response.status_code == 200
    assert response.json()["roles"] == ["presenter"]
    assert {row["name"] for row in client.get("/identity/roles").json()}.isdisjoint(
        {"administrator", "user_administrator", "registration_approver"}
    )
    assert (
        client.post("/identity/email/test", json={"email": "test@example.com"}).status_code == 403
    )
    assert (
        client.post("/identity/serving/admin/categories", json={"name": "New"}).status_code == 403
    )


def test_scoped_manager_can_review_only_assigned_teams(management):
    client, _, users, areas, preferences, actor = management
    actor[0] = users["manager"]
    response = client.get("/identity/serving/management")
    assert response.status_code == 200
    assert [area["key"] for area in response.json()["areas"]] == ["chores"]
    assert all(
        set(member) == {"id", "name", "direct_area_keys"} for member in response.json()["members"]
    )
    assert client.get("/identity/users").status_code == 403
    assert client.get("/identity/registrations").status_code == 403
    response = client.get("/identity/serving/admin/volunteers")
    assert [row["preference"]["id"] for row in response.json()] == [preferences[0].id]
    assert (
        client.patch(
            f"/identity/serving/admin/volunteers/{preferences[0].id}", json={"status": "approved"}
        ).status_code
        == 200
    )
    other = f"/identity/serving/admin/volunteers/{preferences[1].id}"
    assert client.patch(other, json={"status": "approved"}).status_code == 403
    assert client.patch(other + "/suspension", json={"suspended": True}).status_code == 403
    assert client.delete(other).status_code == 403
    assert (
        client.put(
            f"/identity/serving/admin/users/{users['viewer'].id}/preferences/welcome", json={}
        ).status_code
        == 403
    )
    assert (
        client.get(f"/identity/serving/admin/users/{users['member'].id}/unavailability").status_code
        == 403
    )


def test_scope_revocation_takes_effect_on_next_request(management):
    client, _, users, areas, _, actor = management
    actor[0] = users["admin"]
    path = f"/identity/users/{users['viewer'].id}/managed-serving-areas"
    assert client.put(path, json={"area_ids": [areas[1].id]}).status_code == 200
    actor[0] = users["viewer"]
    assert client.get("/identity/serving/management").json()["areas"][0]["key"] == "welcome"
    actor[0] = users["admin"]
    assert client.put(path, json={"area_ids": []}).status_code == 200
    actor[0] = users["viewer"]
    assert client.get("/identity/serving/management").status_code == 403


def test_unknown_roles_and_unknown_scopes_are_rejected(management):
    client, _, users, _, _, _ = management
    assert (
        client.patch(
            f"/identity/users/{users['member'].id}", json={"role_names": ["made_up"]}
        ).status_code
        == 422
    )
    assert (
        client.put(
            f"/identity/users/{users['member'].id}/managed-serving-areas",
            json={"area_ids": ["missing"]},
        ).status_code
        == 422
    )


def test_managing_a_team_does_not_grant_its_workspace_role(management):
    client, session, users, _, _, actor = management
    area = ServingArea(key="worship", name="Worship", category="Worship", active=True)
    session.add(area)
    session.commit()
    actor[0] = users["admin"]
    assert (
        client.put(
            f"/identity/users/{users['viewer'].id}/managed-serving-areas",
            json={"area_ids": [area.id]},
        ).status_code
        == 200
    )
    from app.modules.identity.auth import list_authorization_role_names, list_permissions

    assert list_authorization_role_names(session, users["viewer"].id) == ["viewer"]
    permissions = list_permissions(session, users["viewer"].id)
    assert "serving:manage" in permissions
    assert "plans:edit" not in permissions
    assert "users:approve" not in permissions


@pytest.mark.parametrize(
    ("role", "mixer_status"),
    [
        ("worship_leader", 403),
        ("mixer_operator", 200),
        ("broadcast_operator", 200),
        ("administrator", 200),
        ("viewer", 403),
        ("musician", 403),
        ("presenter", 403),
    ],
)
def test_mixer_access_is_independent_of_broadcast_management(management, role, mixer_status):
    from app.modules.broadcast.routes import router as broadcast_router
    from app.modules.identity.permissions import permissions_for_roles
    from app.modules.mixer.routes import router as mixer_router

    client, session, users, _, _, actor = management
    set_user_roles(session, users["member"], [role])
    session.commit()
    actor[0] = users["member"]
    client.app.include_router(mixer_router, prefix="/mixer")
    client.app.include_router(broadcast_router, prefix="/broadcast")

    assert client.get("/mixer/catalog").status_code == mixer_status
    permissions = permissions_for_roles([role])
    if role in {"administrator", "broadcast_operator"}:
        assert "broadcast:use" in permissions
    else:
        assert "broadcast:use" not in permissions
        assert client.patch("/broadcast/viewer-settings", json={}).status_code == 403
        assert client.post("/broadcast/recordings/missing/publish").status_code == 403


def test_mixer_and_worship_access_can_be_granted_independently(management):
    from app.modules.identity.auth import list_authorization_role_names, list_permissions

    _, session, users, _, _, _ = management
    member = users["member"]
    set_user_roles(session, member, ["mixer_operator"])
    session.commit()
    assert list_authorization_role_names(session, member.id) == ["mixer_operator"]
    assert list_permissions(session, member.id) == ["mixer:use"]

    set_user_roles(session, member, ["worship_leader"])
    session.commit()
    assert "songs:edit" in list_permissions(session, member.id)
    assert "mixer:use" not in list_permissions(session, member.id)

    area = ServingArea(key="worship", name="Worship", category="Worship", active=True)
    session.add(area)
    session.flush()
    set_user_roles(session, member, ["viewer"])
    session.add(VolunteerPreference(user_id=member.id, serving_area_id=area.id, status="approved"))
    session.commit()
    assert "worship_leader" in list_authorization_role_names(session, member.id)
    assert "mixer:use" not in list_permissions(session, member.id)

    set_user_roles(session, member, ["mixer_operator"])
    session.commit()
    assert "songs:edit" in list_permissions(session, member.id)
    assert "mixer:use" in list_permissions(session, member.id)


@pytest.fixture
def notification_mail(monkeypatch):
    from app.core.config import settings

    sent = []
    monkeypatch.setattr(settings, "public_app_url", "https://church.example/app/")
    monkeypatch.setattr("app.modules.identity.routes.smtp_enabled", lambda: True)
    monkeypatch.setattr(
        "app.modules.identity.routes.send_email", lambda **message: sent.append(message) or True
    )
    return sent


def test_verified_registration_notifies_all_approval_roles_once(management, notification_mail):
    from app.modules.identity.routes import issue_auth_token

    client, session, users, _, _, _ = management
    # Multiple qualifying roles must not result in duplicate mail.
    set_user_roles(session, users["accounts"], ["user_administrator", "registration_approver"])
    # SQLite drops timezone information on reload; retain the issued UTC value.
    session.expire_on_commit = False
    auth_token, raw_token = issue_auth_token(
        session,
        user=users["pending"],
        purpose="verify",
        created_by_user_id=None,
        lifetime_hours=24,
    )
    session.commit()
    response = client.post("/identity/auth/email-verification/complete", json={"token": raw_token})
    assert response.status_code == 200
    assert auth_token.used_at is not None
    assert {mail["to_email"] for mail in notification_mail} == {
        users["admin"].email,
        users["accounts"].email,
        users["approver"].email,
    }
    assert len(notification_mail) == 3
    assert all(
        f"/app/?admin_user={users['pending'].id}" in mail["text_body"] for mail in notification_mail
    )
    assert (
        client.post(
            "/identity/auth/email-verification/complete", json={"token": raw_token}
        ).status_code
        >= 400
    )
    assert len(notification_mail) == 3


def test_inactive_approvers_are_not_notified(management, notification_mail):
    from app.modules.identity.routes import send_registration_review_emails

    _, session, users, _, _, _ = management
    users["accounts"].active = False
    session.commit()
    send_registration_review_emails(session, user=users["pending"])
    assert {mail["to_email"] for mail in notification_mail} == {
        users["admin"].email,
        users["approver"].email,
    }


def test_new_serving_request_notifies_only_its_managers_and_global_admins(
    management, notification_mail
):
    client, session, users, areas, _, actor = management
    session.add_all(
        [
            ServingAreaManager(user_id=users["approver"].id, serving_area_id=areas[1].id),
            ServingAreaManager(user_id=users["accounts"].id, serving_area_id=areas[0].id),
        ]
    )
    session.commit()
    actor[0] = users["viewer"]
    response = client.put("/identity/serving/preferences/chores", json={})
    assert response.status_code == 200
    assert {mail["to_email"] for mail in notification_mail} == {
        users["admin"].email,
        users["accounts"].email,
        users["manager"].email,
    }
    assert len(notification_mail) == 3
    assert all("chores" in mail["subject"] for mail in notification_mail)
    assert all(
        f"/app/?admin_user={users['viewer'].id}&admin_area=chores" in mail["text_body"]
        for mail in notification_mail
    )
    # Editing an outstanding request is not another request.
    assert (
        client.put(
            "/identity/serving/preferences/chores", json={"availability_notes": "Updated"}
        ).status_code
        == 200
    )
    assert len(notification_mail) == 3
    actor[0] = users["manager"]
    assert (
        client.patch(
            f"/identity/serving/admin/volunteers/{response.json()['id']}",
            json={"status": "declined"},
        ).status_code
        == 200
    )
    actor[0] = users["viewer"]
    assert client.put("/identity/serving/preferences/chores", json={}).status_code == 200
    assert len(notification_mail) == 6


def test_inactive_team_manager_is_not_notified(management, notification_mail):
    client, session, users, _, _, actor = management
    users["manager"].active = False
    session.commit()
    actor[0] = users["viewer"]
    assert client.put("/identity/serving/preferences/chores", json={}).status_code == 200
    assert {mail["to_email"] for mail in notification_mail} == {
        users["admin"].email,
        users["accounts"].email,
    }


def test_registration_mail_failure_does_not_skip_remaining_approvers(
    management, monkeypatch, notification_mail
):
    from app.modules.identity.routes import send_registration_review_emails

    _, session, users, _, _, _ = management
    attempted = []

    def deliver(**message):
        attempted.append(message["to_email"])
        if message["to_email"] == users["accounts"].email:
            raise RuntimeError("SMTP recipient failure")
        return True

    monkeypatch.setattr("app.modules.identity.routes.send_email", deliver)
    send_registration_review_emails(session, user=users["pending"])
    assert set(attempted) == {users[name].email for name in ("accounts", "admin", "approver")}


def test_serving_request_is_saved_and_other_managers_notified_after_mail_failure(
    management, monkeypatch, notification_mail
):
    client, _, users, _, _, actor = management
    attempted = []

    def deliver(**message):
        attempted.append(message["to_email"])
        if message["to_email"] == users["accounts"].email:
            raise RuntimeError("SMTP recipient failure")
        return True

    monkeypatch.setattr("app.modules.identity.routes.send_email", deliver)
    actor[0] = users["viewer"]
    response = client.put("/identity/serving/preferences/chores", json={})
    assert response.status_code == 200
    assert response.json()["status"] == "pending"
    assert set(attempted) == {users[name].email for name in ("accounts", "admin", "manager")}


def test_serving_invitation_response_notifies_its_managers(management, notification_mail):
    client, _, users, _, _, actor = management
    actor[0] = users["manager"]
    assert (
        client.put(
            f"/identity/serving/admin/users/{users['viewer'].id}/preferences/chores", json={}
        ).status_code
        == 200
    )
    assert notification_mail == []
    actor[0] = users["viewer"]
    assert (
        client.patch(
            "/identity/serving/preferences/chores/decision", json={"status": "approved"}
        ).status_code
        == 200
    )
    assert {mail["to_email"] for mail in notification_mail} == {
        users["admin"].email,
        users["accounts"].email,
        users["manager"].email,
    }
    assert all("accepted" in mail["text_body"] for mail in notification_mail)


def test_reapplying_after_declining_an_invitation_becomes_a_reviewable_request(
    management, notification_mail
):
    client, _, users, _, _, actor = management
    actor[0] = users["manager"]
    response = client.put(
        f"/identity/serving/admin/users/{users['viewer'].id}/preferences/chores", json={}
    )
    preference_id = response.json()["id"]
    actor[0] = users["viewer"]
    assert client.patch(
        "/identity/serving/preferences/chores/decision", json={"status": "declined"}
    ).status_code == 200
    notification_mail.clear()
    response = client.put("/identity/serving/preferences/chores", json={})
    assert response.status_code == 200
    assert response.json()["initiated_by"] == "volunteer"
    assert len(notification_mail) == 3
    actor[0] = users["manager"]
    assert client.patch(
        f"/identity/serving/admin/volunteers/{preference_id}", json={"status": "approved"}
    ).status_code == 200
