"""add pending self registration state

Revision ID: 0039_self_registration
Revises: 0038_rotation_modes
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0039_self_registration"
down_revision: str | None = "0038_rotation_modes"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "registration_pending", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
    )
    op.add_column(
        "users",
        sa.Column("registration_requested_at", sa.DateTime(), nullable=True),
    )
    op.create_index(
        op.f("ix_users_registration_pending"),
        "users",
        ["registration_pending"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_users_registration_pending"), table_name="users")
    op.drop_column("users", "registration_requested_at")
    op.drop_column("users", "registration_pending")
