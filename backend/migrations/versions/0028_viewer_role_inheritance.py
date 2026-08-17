"""assign viewer alongside every other role

Revision ID: 0028_viewer_inheritance
Revises: 0027_worship_learning
Create Date: 2026-08-17
"""

from collections.abc import Sequence
from uuid import uuid4

import sqlalchemy as sa
from alembic import op

revision: str = "0028_viewer_inheritance"
down_revision: str | None = "0027_worship_learning"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    connection = op.get_bind()
    roles = sa.table("roles", sa.column("id", sa.String), sa.column("name", sa.String))
    user_roles = sa.table(
        "user_roles",
        sa.column("id", sa.String),
        sa.column("user_id", sa.String),
        sa.column("role_id", sa.String),
    )

    viewer_role_id = connection.scalar(sa.select(roles.c.id).where(roles.c.name == "viewer"))
    if viewer_role_id is None:
        return

    users_with_other_roles = set(
        connection.scalars(
            sa.select(user_roles.c.user_id)
            .where(user_roles.c.role_id != viewer_role_id)
            .distinct()
        )
    )
    users_with_viewer = set(
        connection.scalars(
            sa.select(user_roles.c.user_id).where(user_roles.c.role_id == viewer_role_id)
        )
    )
    missing_user_ids = users_with_other_roles - users_with_viewer
    if missing_user_ids:
        connection.execute(
            sa.insert(user_roles),
            [
                {"id": str(uuid4()), "user_id": user_id, "role_id": viewer_role_id}
                for user_id in sorted(missing_user_ids)
            ],
        )


def downgrade() -> None:
    # Viewer may have been assigned explicitly before this migration, so it is
    # not safe to infer which viewer assignments should be removed.
    pass
