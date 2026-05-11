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

DELETE_PERMISSIONS: set[PermissionName] = {
    "plans:delete",
    "songs:delete",
    "library:delete",
    "team:delete",
    "messages:delete",
}

ALL_PERMISSIONS: set[PermissionName] = READ_PERMISSIONS | EDIT_PERMISSIONS | CREATE_PERMISSIONS | {
    "users:manage",
} | DELETE_PERMISSIONS

ROLE_DEFINITIONS: dict[str, RoleDefinition] = {
    "viewer": {
        "description": "Read-only library and song access. Cannot control slides or make changes.",
        "permissions": VIEWER_PERMISSIONS,
    },
    "musician": {
        "description": "Use worship song, chord, team, and live musician tools. Cannot edit or delete content.",
        "permissions": PARTICIPANT_PERMISSIONS,
    },
    "worship_team": {
        "description": "Add/edit songs and build worship sets for existing services. Cannot archive/delete songs, services, users, or integrations.",
        "permissions": PARTICIPANT_PERMISSIONS | {"plans:edit", "songs:edit", "songs:create"},
    },
    "service_leader": {
        "description": "Own service plans and team assignments. Cannot archive/delete songs, users, or integrations.",
        "permissions": PARTICIPANT_PERMISSIONS | {"plans:edit", "plans:create", "plans:delete", "team:edit", "team:delete", "messages:write"},
    },
    "worship_leader": {
        "description": "Own worship songs, files, and service flow. Cannot manage users or disconnect integrations.",
        "permissions": PARTICIPANT_PERMISSIONS
        | EDIT_PERMISSIONS
        | {"plans:create", "plans:delete", "songs:create", "songs:delete", "library:create", "library:delete"},
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
