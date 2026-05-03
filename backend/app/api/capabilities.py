from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()


class Capability(BaseModel):
    module: str
    feature: str
    legacy_reference: str
    status: str
    next_step: str


CAPABILITIES = [
    Capability(
        module="identity",
        feature="Users, roles, permissions, social login",
        legacy_reference="users, roles, role_user, social_logins",
        status="domain-scaffolded",
        next_step="Implement password auth, first-admin bootstrap, and role policies.",
    ),
    Capability(
        module="planning",
        feature="Plans, calendar, running order, default items, notes, history",
        legacy_reference="plans, items, default_items, notes, item_notes, histories",
        status="domain-scaffolded",
        next_step="Persist plans and expose CRUD endpoints for plan editing.",
    ),
    Capability(
        module="music",
        feature="Songs, lyrics, chords, OnSong sections, sheet music",
        legacy_reference="songs, song_parts, on_songs",
        status="domain-scaffolded",
        next_step="Build song library CRUD and import review workflow.",
    ),
    Capability(
        module="people",
        feature="Teams, instruments, availability, participation confirmation",
        legacy_reference="instruments, instrument_user, plan_team",
        status="domain-scaffolded",
        next_step="Add team assignment screens and reminder tokens.",
    ),
    Capability(
        module="library",
        feature="Resources, files, file categories, Bible versions/books/verses",
        legacy_reference="resources, files, file_categories, bibleversions, biblebooks, bibles",
        status="domain-scaffolded",
        next_step="Add upload storage and Bible passage lookup endpoints.",
    ),
    Capability(
        module="presentation",
        feature="Presenter view, controller sync, offline plan cache",
        legacy_reference="presentation routes, plan_caches",
        status="domain-scaffolded",
        next_step="Generate slide payloads from plans and songs.",
    ),
    Capability(
        module="communication",
        feature="Messages, notifications, reminders",
        legacy_reference="threads, participants, messages, mailers",
        status="domain-scaffolded",
        next_step="Implement message threads and email delivery adapters.",
    ),
    Capability(
        module="imports",
        feature="Review-first lyrics and content import providers",
        legacy_reference="new feature",
        status="api-demo",
        next_step="Add manual paste save flow, then provider-specific importers.",
    ),
]


@router.get("/capabilities", response_model=list[Capability])
def list_capabilities() -> list[Capability]:
    return CAPABILITIES
