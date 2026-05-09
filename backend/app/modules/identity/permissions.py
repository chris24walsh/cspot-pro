from collections.abc import Iterable
from typing import TypedDict

PermissionName = str


class RoleDefinition(TypedDict):
    description: str
    permissions: set[PermissionName]

VIEWER_PERMISSIONS: set[PermissionName] = {
    "plans:read",
    "songs:read",
    "library:read",
    "messages:read",
}

PARTICIPANT_PERMISSIONS: set[PermissionName] = VIEWER_PERMISSIONS | {
    "team:read",
    "presentation:use",
}

READ_PERMISSIONS: set[PermissionName] = PARTICIPANT_PERMISSIONS

EDIT_PERMISSIONS: set[PermissionName] = {
    "plans:edit",
    "songs:edit",
    "team:edit",
    "library:edit",
    "messages:write",
}

CREATE_PERMISSIONS: set[PermissionName] = {
    "plans:create",
    "songs:create",
    "library:create",
}

ALL_PERMISSIONS: set[PermissionName] = READ_PERMISSIONS | EDIT_PERMISSIONS | CREATE_PERMISSIONS | {
    "users:manage",
}

ROLE_DEFINITIONS: dict[str, RoleDefinition] = {
    "viewer": {
        "description": "Read-only library and song access. Best for people who should not control service slides.",
        "permissions": VIEWER_PERMISSIONS,
    },
    "musician": {
        "description": "Use service, song, chord, team, and presentation tools for rehearsal and participation.",
        "permissions": PARTICIPANT_PERMISSIONS,
    },
    "worship_team": {
        "description": "Maintain songs and add songs to existing services without owning the whole service plan.",
        "permissions": PARTICIPANT_PERMISSIONS | {"plans:edit", "songs:edit", "songs:create"},
    },
    "service_leader": {
        "description": "Lead a service, update plan flow, coordinate team members, and communicate with the team.",
        "permissions": PARTICIPANT_PERMISSIONS | {"plans:edit", "plans:create", "team:edit", "messages:write"},
    },
    "worship_leader": {
        "description": "Lead worship, maintain songs and library content, and shape service plans with the team.",
        "permissions": PARTICIPANT_PERMISSIONS | EDIT_PERMISSIONS | {"plans:create", "songs:create", "library:create"},
    },
    "administrator": {
        "description": "Manage users, roles, and all planning, music, library, and presentation content.",
        "permissions": ALL_PERMISSIONS,
    },
}

LEGACY_ROLE_ALIASES: dict[str, str] = {
    "user": "viewer",
    "leader": "service_leader",
    "teacher": "service_leader",
    "author": "worship_team",
    "editor": "worship_team",
    "creator": "worship_leader",
}

ROLE_PERMISSIONS: dict[str, set[PermissionName]] = {
    role_name: definition["permissions"]
    for role_name, definition in ROLE_DEFINITIONS.items()
}


def normalize_role_name(role_name: str) -> str:
    return LEGACY_ROLE_ALIASES.get(role_name, role_name)


def canonical_role_names(role_names: Iterable[str]) -> list[str]:
    names = {normalize_role_name(role_name) for role_name in role_names}
    return [role_name for role_name in ROLE_DEFINITIONS if role_name in names]


def permissions_for_roles(role_names: Iterable[str]) -> set[PermissionName]:
    granted: set[PermissionName] = set()
    for role_name in role_names:
        granted.update(ROLE_PERMISSIONS.get(normalize_role_name(role_name), set()))
    return granted
