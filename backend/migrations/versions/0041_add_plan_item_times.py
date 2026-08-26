"""add soft plan item start times

Revision ID: 0041_plan_item_times
Revises: 0040_audio_scenes
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0041_plan_item_times"
down_revision: str | None = "0040_audio_scenes"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("plan_items", sa.Column("planned_start", sa.String(length=5)))
    op.execute(
        sa.text(
            "UPDATE plan_types SET starts_at = '10:30', default_duration_minutes = 135 "
            "WHERE name = 'Sunday Service'"
        )
    )


def downgrade() -> None:
    op.execute(
        sa.text(
            "UPDATE plan_types SET default_duration_minutes = 90 "
            "WHERE name = 'Sunday Service'"
        )
    )
    op.drop_column("plan_items", "planned_start")
