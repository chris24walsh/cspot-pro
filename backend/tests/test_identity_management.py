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
    [("worship_leader", 403), ("mixer_operator", 200), ("broadcast_operator", 200),
     ("administrator", 200), ("viewer", 403), ("musician", 403), ("presenter", 403)],
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
