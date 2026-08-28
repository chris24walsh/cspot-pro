"""add volunteer role suspension ownership

Revision ID: 0046_volunteer_suspension
Revises: 0045_unavailability_roles
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0046_volunteer_suspension"
down_revision: str | None = "0045_unavailability_roles"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "volunteer_preferences",
        sa.Column("suspended_by", sa.String(length=16), nullable=True),
    )
    op.create_index(
        op.f("ix_volunteer_preferences_suspended_by"),
        "volunteer_preferences",
        ["suspended_by"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_volunteer_preferences_suspended_by"),
        table_name="volunteer_preferences",
    )
    op.drop_column("volunteer_preferences", "suspended_by")
