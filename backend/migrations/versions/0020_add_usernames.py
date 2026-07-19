"""add unique usernames for account login

Revision ID: 0020_add_usernames
Revises: 0019_add_live_audio_source
Create Date: 2026-07-19
"""

import re
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0020_add_usernames"
down_revision: str | None = "0019_add_live_audio_source"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _base_username(email: str) -> str:
    base = re.sub(r"[^a-z0-9._-]+", "-", email.split("@", 1)[0].strip().lower()).strip(".-_")
    if len(base) < 2:
        base = f"user-{base}".rstrip("-")
    return base[:72]


def upgrade() -> None:
    op.add_column("users", sa.Column("username", sa.String(length=80), nullable=True))

    connection = op.get_bind()
    users = connection.execute(
        sa.text("SELECT id, email FROM users ORDER BY created_at, id")
    ).mappings()
    used: set[str] = set()
    for user in users:
        base = _base_username(str(user["email"]))
        candidate = base
        suffix = 2
        while candidate in used:
            candidate = f"{base[: 79 - len(str(suffix))]}-{suffix}"
            suffix += 1
        used.add(candidate)
        connection.execute(
            sa.text("UPDATE users SET username = :username WHERE id = :user_id"),
            {"username": candidate, "user_id": user["id"]},
        )

    op.alter_column("users", "username", existing_type=sa.String(length=80), nullable=False)
    op.create_index("ix_users_username", "users", ["username"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_users_username", table_name="users")
    op.drop_column("users", "username")
