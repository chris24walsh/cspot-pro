from datetime import date

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.core.database import Base
from app.modules.identity.auth import list_authorization_role_names, list_role_names
from app.modules.identity.models import (
    Role,
    ServingArea,
    User,
    UserRole,
    VolunteerPreference,
    VolunteerUnavailability,
)
from app.modules.identity.permissions import permissions_for_roles
from app.modules.identity.routes import (
    add_user_unavailability,
    list_user_unavailability,
    remove_user_unavailability,
    set_user_roles,
    update_user_unavailability,
    user_to_member_read,
)
from app.modules.identity.schemas import VolunteerUnavailabilityCreate


def test_member_directory_exposes_team_fields_without_admin_fields() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(
        engine,
        tables=[
            User.__table__,
            Role.__table__,
            UserRole.__table__,
            ServingArea.__table__,
            VolunteerPreference.__table__,
            VolunteerUnavailability.__table__,
        ],
    )

    with Session(engine) as session:
        user = User(
            email="leader@example.com",
            username="leader",
            name="Worship Leader",
            password_hash=None,
            start_page=None,
            calendar_color="teacher-b",
            calendar_avatar=None,
            worship_max_sundays_per_month=2,
            sunday_school_max_sundays_per_month=None,
            email_confirmed=True,
            active=True,
        )
        role = Role(name="worship_leader", description=None, system_role=True)
        session.add_all([user, role])
        session.flush()
        session.add(UserRole(user_id=user.id, role_id=role.id))
        session.flush()

        member = user_to_member_read(session, user)

    assert member.roles == ["worship_leader"]
    assert member.username == "leader"
    assert member.calendar_color == "teacher-b"
    assert member.worship_max_sundays_per_month == 2
    assert member.approved_serving_areas == []
    assert "password_set" not in member.model_dump()


def test_admin_can_manage_availability_for_any_user() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(
        engine,
        tables=[User.__table__, VolunteerUnavailability.__table__],
    )
    with Session(engine) as session:
        admin = User(email="admin@example.com", username="admin", name="Admin")
        volunteer = User(email="volunteer@example.com", username="volunteer", name="Volunteer")
        session.add_all([admin, volunteer])
        session.commit()

        created = add_user_unavailability(
            volunteer.id,
            VolunteerUnavailabilityCreate(
                starts_on=date(2026, 9, 1),
                ends_on=date(2026, 9, 3),
                note="Away",
                role_keys=None,
            ),
            admin,
            session,
        )
        assert list_user_unavailability(volunteer.id, admin, session) == [created]

        updated = update_user_unavailability(
            volunteer.id,
            created.id,
            VolunteerUnavailabilityCreate(
                starts_on=date(2026, 9, 2),
                ends_on=date(2026, 9, 4),
                note="Holiday",
                role_keys=["worship", "sunday_school"],
            ),
            admin,
            session,
        )
        assert updated.starts_on == date(2026, 9, 2)
        assert updated.note == "Holiday"
        assert updated.role_keys == ["worship", "sunday_school"]

        response = remove_user_unavailability(volunteer.id, created.id, admin, session)
        assert response.status_code == 204
        assert list_user_unavailability(volunteer.id, admin, session) == []


def test_worship_and_sunday_school_roles_can_read_the_member_directory() -> None:
    for role in ["musician", "worship_leader", "sunday_school_teacher", "sunday_school_leader"]:
        permissions = permissions_for_roles([role])
        assert "team:read" in permissions
        assert "users:manage" not in permissions


def test_viewer_has_the_read_permissions_required_for_broadcast() -> None:
    permissions = permissions_for_roles(["viewer"])

    assert permissions == {"plans:read", "songs:read", "library:read"}


def test_serving_rotation_mode_is_exposed_without_changing_access() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(
        engine,
        tables=[
            User.__table__,
            Role.__table__,
            UserRole.__table__,
            ServingArea.__table__,
            VolunteerPreference.__table__,
            VolunteerUnavailability.__table__,
        ],
    )
    with Session(engine) as session:
        user = User(
            email="tablet@example.com",
            username="tablet",
            name="Worship Tablet",
            password_hash=None,
            start_page=None,
            calendar_color=None,
            calendar_avatar=None,
            email_confirmed=True,
            active=True,
        )
        area = ServingArea(key="worship", name="Worship Leader", category="Worship", description=None, active=True)
        session.add_all([user, area])
        session.flush()
        session.add(VolunteerPreference(user_id=user.id, serving_area_id=area.id, status="approved", frequency_count=1, frequency_period="month", rotation_mode="manual"))
        session.flush()

        member = user_to_member_read(session, user)
        authorization_roles = list_authorization_role_names(session, user.id)

    assert member.serving_rotation_modes == {"worship": "manual"}
    assert member.worship_max_sundays_per_month == 0
    assert "worship_leader" in authorization_roles


def test_approved_serving_area_provides_matching_workspace_role() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(
        engine,
        tables=[
            User.__table__,
            Role.__table__,
            UserRole.__table__,
            ServingArea.__table__,
            VolunteerPreference.__table__,
        ],
    )
    with Session(engine) as session:
        user = User(
            email="volunteer@example.com",
            username="volunteer",
            name="Volunteer",
            password_hash=None,
            start_page=None,
            calendar_color=None,
            calendar_avatar=None,
            email_confirmed=True,
            active=True,
        )
        area = ServingArea(
            key="worship_musician",
            name="Musician",
            category="Worship",
            description=None,
            active=True,
        )
        session.add_all([user, area])
        session.flush()
        session.add(
            VolunteerPreference(
                user_id=user.id,
                serving_area_id=area.id,
                status="approved",
                preferred_frequency="monthly",
            )
        )
        session.flush()
        assert "musician" in list_authorization_role_names(session, user.id)


def test_live_worship_and_teacher_service_permissions_match_role_workflows() -> None:
    musician_permissions = permissions_for_roles(["musician"])
    worship_leader_permissions = permissions_for_roles(["worship_leader"])
    teacher_permissions = permissions_for_roles(["teacher"])
    presenter_permissions = permissions_for_roles(["presenter"])

    assert {"plans:read", "songs:read", "team:read"} <= musician_permissions
    assert {"plans:read", "songs:read", "team:read"} <= worship_leader_permissions
    assert "presentation:use" in worship_leader_permissions
    assert {"plans:create", "plans:edit", "library:create"} <= teacher_permissions
    assert "plans:delete" not in teacher_permissions
    assert "library:delete" not in teacher_permissions
    assert {
        "plans:create",
        "plans:edit",
        "plans:delete",
        "songs:create",
        "songs:edit",
        "library:create",
        "library:edit",
        "presentation:use",
    } <= presenter_permissions
    assert "songs:delete" not in presenter_permissions
    assert "users:manage" not in presenter_permissions


def test_every_non_viewer_role_also_assigns_viewer() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine, tables=[User.__table__, Role.__table__, UserRole.__table__])

    with Session(engine) as session:
        user = User(
            email="presenter@example.com",
            username="presenter",
            name="Presenter",
            password_hash=None,
            start_page=None,
            calendar_color=None,
            calendar_avatar=None,
            email_confirmed=True,
            active=True,
        )
        session.add(user)
        session.flush()

        set_user_roles(session, user, ["presenter"])
        session.flush()

        assert list_role_names(session, user.id) == ["viewer", "presenter"]
