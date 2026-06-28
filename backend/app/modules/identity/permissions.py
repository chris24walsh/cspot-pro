from collections.abc import Iterable
from typing import TypedDict

PermissionName = str


class RoleDefinition(TypedDict):
    description: str
    permissions: set[PermissionName]


READ_PERMISSIONS: set[PermissionName] = {
    "plans:read",
    "songs:read",
    "library:read",
    "messages:read",
}

TEAM_READ_PERMISSIONS: set[PermissionName] = {
    "team:read",
}

SERVICE_PLANNING_PERMISSIONS: set[PermissionName] = {
    "plans:create",
    "plans:edit",
}

SERVICE_ARCHIVE_PERMISSIONS: set[PermissionName] = {
    "plans:delete",
}

SONG_EDIT_PERMISSIONS: set[PermissionName] = {
    "songs:create",
    "songs:edit",
    "songs:delete",
}

LIBRARY_EDIT_PERMISSIONS: set[PermissionName] = {
    "library:create",
    "library:edit",
    "library:delete",
}

TEAM_EDIT_PERMISSIONS: set[PermissionName] = {
    "team:edit",
    "team:delete",
}

COMMUNICATION_EDIT_PERMISSIONS: set[PermissionName] = {
    "messages:write",
    "messages:delete",
}

PRESENTATION_CONTROL_PERMISSIONS: set[PermissionName] = {
    "presentation:use",
}

BROADCAST_CONTROL_PERMISSIONS: set[PermissionName] = {
    "broadcast:use",
}

ADMIN_PERMISSIONS: set[PermissionName] = {
    "users:manage",
    "site:edit",
}

ALL_PERMISSIONS: set[PermissionName] = (
    READ_PERMISSIONS
    | TEAM_READ_PERMISSIONS
    | SERVICE_PLANNING_PERMISSIONS
    | SERVICE_ARCHIVE_PERMISSIONS
    | SONG_EDIT_PERMISSIONS
    | LIBRARY_EDIT_PERMISSIONS
    | TEAM_EDIT_PERMISSIONS
    | COMMUNICATION_EDIT_PERMISSIONS
    | PRESENTATION_CONTROL_PERMISSIONS
    | BROADCAST_CONTROL_PERMISSIONS
    | ADMIN_PERMISSIONS
)

ROLE_DEFINITIONS: dict[str, RoleDefinition] = {
    "viewer": {
        "description": "Church member remote-viewer access for the livestream broadcast.",
        "permissions": READ_PERMISSIONS,
    },
    "musician": {
        "description": "Read-only worship access for musicians who need the worship plan and live musician view.",
        "permissions": READ_PERMISSIONS | TEAM_READ_PERMISSIONS,
    },
    "worship_leader": {
        "description": "Manage worship songs, files, and worship set planning.",
        "permissions": READ_PERMISSIONS
        | TEAM_READ_PERMISSIONS
        | SERVICE_PLANNING_PERMISSIONS
        | SERVICE_ARCHIVE_PERMISSIONS
        | SONG_EDIT_PERMISSIONS
        | LIBRARY_EDIT_PERMISSIONS
        | TEAM_EDIT_PERMISSIONS
        | COMMUNICATION_EDIT_PERMISSIONS,
    },
    "sunday_school_teacher": {
        "description": "Read Sunday school lessons and resources without changing them.",
        "permissions": READ_PERMISSIONS | TEAM_READ_PERMISSIONS,
    },
    "sunday_school_leader": {
        "description": "Manage Sunday school lessons and imported classroom resources.",
        "permissions": READ_PERMISSIONS | TEAM_READ_PERMISSIONS | SERVICE_PLANNING_PERMISSIONS,
    },
    "teacher": {
        "description": "Prepare upcoming services and update service content without managing songs or users.",
        "permissions": READ_PERMISSIONS | SERVICE_PLANNING_PERMISSIONS | PRESENTATION_CONTROL_PERMISSIONS,
    },
    "presenter": {
        "description": "Operate the live service computer and presentation flow.",
        "permissions": READ_PERMISSIONS | SERVICE_PLANNING_PERMISSIONS | PRESENTATION_CONTROL_PERMISSIONS,
    },
    "administrator": {
        "description": "Full access across users, planning, worship, Sunday school, broadcast, and site settings.",
        "permissions": ALL_PERMISSIONS,
    },
}

LEGACY_ROLE_ALIASES: dict[str, str] = {
    "user": "viewer",
    "leader": "teacher",
    "service_leader": "teacher",
    "worship_team": "worship_leader",
    "author": "worship_leader",
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
