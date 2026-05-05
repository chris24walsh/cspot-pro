from collections.abc import Iterable
from typing import TypedDict

PermissionName = str


class RoleDefinition(TypedDict):
    description: str
    permissions: set[PermissionName]

READ_PERMISSIONS: set[PermissionName] = {
    "plans:read",
    "songs:read",
    "team:read",
    "library:read",
    "messages:read",
    "presentation:use",
}

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
        "description": "Read-only access across plans, songs, library, team, and presentation.",
        "permissions": READ_PERMISSIONS,
    },
    "musician": {
        "description": "Use plans, songs, library, and presentation tools for rehearsal and service participation.",
        "permissions": READ_PERMISSIONS,
    },
    "service_leader": {
        "description": "Lead a service, update plan flow, coordinate team members, and communicate with the team.",
        "permissions": READ_PERMISSIONS | {"plans:edit", "plans:create", "team:edit", "messages:write"},
    },
    "worship_leader": {
        "description": "Lead worship, maintain songs and library content, and shape service plans with the team.",
        "permissions": READ_PERMISSIONS | EDIT_PERMISSIONS | {"plans:create", "songs:create", "library:create"},
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
    "author": "service_leader",
    "editor": "worship_leader",
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
