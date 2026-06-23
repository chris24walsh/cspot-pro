"""add stable user calendar identity

Revision ID: 0013_user_calendar_identity
Revises: 0012_ss_resource_pages
Create Date: 2026-06-23
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0013_user_calendar_identity"
down_revision: str | None = "0012_ss_resource_pages"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

COLORS = ("teacher-a", "teacher-b", "teacher-c", "teacher-d", "teacher-e", "teacher-f")


def upgrade() -> None:
    op.add_column("users", sa.Column("calendar_color", sa.String(length=24), nullable=True))
    op.add_column("users", sa.Column("calendar_avatar", sa.String(length=16), nullable=True))

    connection = op.get_bind()
    users = connection.execute(sa.text("SELECT id FROM users")).mappings()
    for user in users:
        color = COLORS[sum(user["id"].encode("utf-8")) % len(COLORS)]
        connection.execute(
            sa.text("UPDATE users SET calendar_color = :color WHERE id = :user_id"),
            {"color": color, "user_id": user["id"]},
        )


def downgrade() -> None:
    op.drop_column("users", "calendar_avatar")
    op.drop_column("users", "calendar_color")
