from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.modules.library.bible_data import BIBLE_BOOKS
from app.modules.communication.models import Message, MessageParticipant, MessageThread
from app.modules.identity.models import Role, User, UserRole
from app.modules.imports.models import ImportProvider
from app.modules.identity.permissions import ROLE_DEFINITIONS
from app.modules.library.models import BibleBook, BibleVerse, BibleVersion, FileCategory, Resource
from app.modules.music.models import Song, SongPart
from app.modules.identity.security import hash_password
from app.modules.people.models import Instrument, TeamAssignment
from app.modules.planning.models import Plan, PlanItem, PlanType
from app.scripts.import_bible import autoload_kjv_if_missing


def get_or_create(session: Session, model: type, defaults: dict | None = None, **filters):
    instance = session.scalar(select(model).filter_by(**filters))
    if instance is not None:
        return instance

    instance = model(**filters, **(defaults or {}))
    session.add(instance)
    session.flush()
    return instance


def seed_roles(session: Session) -> User:
    role_models = [
        get_or_create(
            session,
            Role,
            name=name,
            defaults={"description": str(definition["description"]), "system_role": True},
        )
        for name, definition in ROLE_DEFINITIONS.items()
    ]

    admin = get_or_create(
        session,
        User,
        email="admin@example.com",
        defaults={
            "name": "Demo Admin",
            "password_hash": hash_password("changeme123"),
            "email_confirmed": True,
        },
    )
    admin_role = next(role for role in role_models if role.name == "administrator")
    get_or_create(session, UserRole, user_id=admin.id, role_id=admin_role.id)
    return admin


def seed_reference_data(session: Session) -> PlanType:
    plan_type = get_or_create(
        session,
        PlanType,
        name="Sunday Service",
        defaults={
            "description": "Main weekly worship service.",
            "starts_at": "10:30",
            "default_duration_minutes": 90,
            "active": True,
        },
    )
    for name, starts_at in [
        ("Midweek Meeting", "19:30"),
        ("Prayer Night", "20:00"),
        ("Youth Event", "19:00"),
        ("Worship Set", "10:30"),
    ]:
        get_or_create(
            session,
            PlanType,
            name=name,
            defaults={"description": None, "starts_at": starts_at, "default_duration_minutes": 75},
        )

    for index, (name, abbreviation) in enumerate(
        [
            ("Verse", "V"),
            ("Chorus", "C"),
            ("Pre-Chorus", "PC"),
            ("Bridge", "B"),
            ("Tag", "T"),
            ("Ending", "E"),
        ],
        start=1,
    ):
        get_or_create(
            session,
            SongPart,
            name=name,
            defaults={"abbreviation": abbreviation, "sort_order": index},
        )

    for index, name in enumerate(["Piano", "Acoustic Guitar", "Electric Guitar", "Bass", "Drums", "Vocals"]):
        get_or_create(session, Instrument, name=name, defaults={"sort_order": index})

    for name, resource_type in [("Projector", "equipment"), ("Main Hall", "room")]:
        get_or_create(session, Resource, name=name, defaults={"resource_type": resource_type})

    for name in ["Sheet Music", "Slides", "Images", "Documents", "Audio"]:
        get_or_create(session, FileCategory, name=name)

    bible_versions = {
        code: get_or_create(
            session,
            BibleVersion,
            code=code,
            defaults={"name": name, "language": "en", "license": license_name},
        )
        for code, name, license_name in [
            ("KJV", "King James Version", "Public Domain"),
            ("NKJV", "New King James Version", "User-supplied licensed text"),
            ("NIV", "New International Version", "User-supplied licensed text"),
            ("ESV", "English Standard Version", "User-supplied licensed text"),
            ("WEB", "World English Bible", "Public Domain"),
            ("CUSTOM", "Custom", None),
        ]
    }

    books = {
        book.sort_order: get_or_create(
            session,
            BibleBook,
            sort_order=book.sort_order,
            defaults={
                "name": book.name,
                "abbreviation": book.abbreviation,
                "testament": book.testament,
            },
        )
        for book in BIBLE_BOOKS
    }
    john = books[43]
    get_or_create(
        session,
        BibleVerse,
        version_id=bible_versions["WEB"].id,
        book_id=john.id,
        chapter=3,
        verse=16,
        defaults={"text": "For God so loved the world, that he gave his one and only Son."},
    )
    for provider_name, display_name, provider_type in [
        ("manual-paste", "Manual Paste", "manual"),
        ("url-review", "URL Review", "url"),
        ("public-domain-seed", "Public Domain Seed", "seed"),
    ]:
        get_or_create(
            session,
            ImportProvider,
            name=provider_name,
            defaults={"display_name": display_name, "provider_type": provider_type},
        )

    return plan_type


def seed_music(session: Session) -> list[Song]:
    songs = [
        {
            "title": "Amazing Grace",
            "author": "John Newton",
            "license": "Public Domain",
            "sequence": "V1 V2 V3 V4",
            "lyrics": "Amazing grace how sweet the sound\nThat saved a soul like me",
            "chords": "[G]Amazing [C]grace how [G]sweet the sound",
        },
        {
            "title": "Be Thou My Vision",
            "author": "Traditional",
            "license": "Public Domain",
            "sequence": "V1 V2 V3",
            "lyrics": "Be thou my vision, O Lord of my heart",
            "chords": "[D]Be Thou my [G]Vision",
        },
        {
            "title": "Build My Life",
            "author": "Housefires",
            "license": "CCLI",
            "sequence": "V1 C V2 C B C",
            "lyrics": None,
            "chords": None,
        },
    ]
    return [
        get_or_create(
            session,
            Song,
            title=song["title"],
            defaults={key: value for key, value in song.items() if key != "title"},
        )
        for song in songs
    ]


def seed_plan(session: Session, plan_type: PlanType, admin: User, songs: list[Song]) -> None:
    plan = get_or_create(
        session,
        Plan,
        title="Sunday Service",
        defaults={
            "plan_type_id": plan_type.id,
            "service_date": datetime(2026, 5, 3, 10, 30, tzinfo=UTC),
            "subtitle": "Demo plan",
            "leader_id": admin.id,
            "teacher_id": admin.id,
            "status": "draft",
            "info": "Initial seeded service plan.",
        },
    )

    existing_items = session.scalar(select(PlanItem.id).where(PlanItem.plan_id == plan.id))
    if existing_items:
        return

    amazing_grace, be_thou, build_my_life = songs
    items = [
        PlanItem(plan_id=plan.id, sequence=Decimal("10.00"), item_type="welcome", title="Welcome"),
        PlanItem(
            plan_id=plan.id,
            sequence=Decimal("20.00"),
            item_type="song",
            title=amazing_grace.title,
            song_id=amazing_grace.id,
            key_signature="G",
        ),
        PlanItem(
            plan_id=plan.id,
            sequence=Decimal("30.00"),
            item_type="song",
            title=be_thou.title,
            song_id=be_thou.id,
            key_signature="D",
        ),
        PlanItem(plan_id=plan.id, sequence=Decimal("40.00"), item_type="reading", title="Reading"),
        PlanItem(plan_id=plan.id, sequence=Decimal("50.00"), item_type="message", title="Message"),
        PlanItem(
            plan_id=plan.id,
            sequence=Decimal("60.00"),
            item_type="song",
            title=build_my_life.title,
            song_id=build_my_life.id,
            key_signature="A",
        ),
    ]
    session.add_all(items)

    get_or_create(
        session,
        TeamAssignment,
        plan_id=plan.id,
        role_label="Leader",
        defaults={"user_id": admin.id, "status": "confirmed"},
    )


def seed_messages(session: Session, admin: User) -> None:
    thread = get_or_create(
        session,
        MessageThread,
        subject="Sunday service reminders",
        defaults={"creator_id": admin.id},
    )
    get_or_create(session, MessageParticipant, thread_id=thread.id, user_id=admin.id)
    existing_message = session.scalar(select(Message.id).where(Message.thread_id == thread.id))
    if existing_message is None:
        session.add(
            Message(
                thread_id=thread.id,
                sender_id=admin.id,
                body="Remember to review the worship set before Sunday morning.",
            )
        )


def main() -> None:
    with SessionLocal() as session:
        admin = seed_roles(session)
        plan_type = seed_reference_data(session)
        songs = seed_music(session)
        seed_plan(session, plan_type, admin, songs)
        seed_messages(session, admin)
        session.commit()
        try:
            autoload_kjv_if_missing(session)
        except Exception:
            session.rollback()
        print("Seeded demo cspot-pro data.")


if __name__ == "__main__":
    main()
