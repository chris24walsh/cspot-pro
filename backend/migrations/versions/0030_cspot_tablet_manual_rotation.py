"""keep the worship tablet account out of automatic rotation

Revision ID: 0030_tablet_manual_rotation
Revises: 0029_leader_limits
Create Date: 2026-08-20
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0030_tablet_manual_rotation"
down_revision: str | None = "0029_leader_limits"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    users = sa.table(
        "users",
        sa.column("username", sa.String()),
        sa.column("worship_max_sundays_per_month", sa.Integer()),
    )
    op.execute(
        users.update()
        .where(sa.func.lower(users.c.username) == "cspot_tablet")
        .values(worship_max_sundays_per_month=0)
    )


def downgrade() -> None:
    # The account may already have been manual-only, so its previous limit
    # cannot be reconstructed safely.
    pass
