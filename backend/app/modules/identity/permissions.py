from collections.abc import Iterable

PermissionName = str

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

ROLE_PERMISSIONS: dict[str, set[PermissionName]] = {
    "viewer": READ_PERMISSIONS,
    "user": READ_PERMISSIONS,
    "leader": READ_PERMISSIONS | {"plans:edit", "team:edit", "messages:write"},
    "teacher": READ_PERMISSIONS | {"plans:edit", "library:edit", "messages:write"},
    "editor": READ_PERMISSIONS | EDIT_PERMISSIONS,
    "creator": READ_PERMISSIONS | EDIT_PERMISSIONS | CREATE_PERMISSIONS,
    "author": READ_PERMISSIONS | EDIT_PERMISSIONS | CREATE_PERMISSIONS,
    "administrator": ALL_PERMISSIONS,
}


def permissions_for_roles(role_names: Iterable[str]) -> set[PermissionName]:
    granted: set[PermissionName] = set()
    for role_name in role_names:
        granted.update(ROLE_PERMISSIONS.get(role_name, set()))
    return granted
