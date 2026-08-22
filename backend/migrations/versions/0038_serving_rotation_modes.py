"""split manual and disabled serving rotation modes

Revision ID: 0038_rotation_modes
Revises: 0037_migrate_roles
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0038_rotation_modes"
down_revision: str | None = "0037_migrate_roles"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "volunteer_preferences",
        sa.Column("rotation_mode", sa.String(length=16), nullable=False, server_default="auto"),
    )
    op.create_index(
        op.f("ix_volunteer_preferences_rotation_mode"),
        "volunteer_preferences",
        ["rotation_mode"],
        unique=False,
    )
    # Zero previously meant "never in automatic rotation". Its established
    # behavior was still manually assignable, so preserve it as Manual.
    op.execute(sa.text("""
        UPDATE volunteer_preferences
        SET rotation_mode = 'manual', frequency_count = 1, updated_at = CURRENT_TIMESTAMP
        WHERE frequency_count = 0
    """))


def downgrade() -> None:
    op.execute(sa.text("""
        UPDATE volunteer_preferences SET frequency_count = 0
        WHERE rotation_mode IN ('manual', 'disabled')
    """))
    op.drop_index(op.f("ix_volunteer_preferences_rotation_mode"), table_name="volunteer_preferences")
    op.drop_column("volunteer_preferences", "rotation_mode")
