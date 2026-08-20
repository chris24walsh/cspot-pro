"""add per-area monthly Sunday limits

Revision ID: 0029_leader_limits
Revises: 0028_viewer_inheritance
Create Date: 2026-08-20
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0029_leader_limits"
down_revision: str | None = "0028_viewer_inheritance"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("worship_max_sundays_per_month", sa.Integer(), nullable=True))
    op.add_column(
        "users",
        sa.Column("sunday_school_max_sundays_per_month", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("users", "sunday_school_max_sundays_per_month")
    op.drop_column("users", "worship_max_sundays_per_month")
