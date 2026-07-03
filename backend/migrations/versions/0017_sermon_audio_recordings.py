"""add synchronized sermon audio recording metadata"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0017_sermon_audio_recordings"
down_revision: str | None = "0016_worship_leader_assignments"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("broadcast_recordings", sa.Column("timeline_json", sa.Text(), nullable=True))
    op.add_column(
        "broadcast_recordings", sa.Column("started_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "broadcast_recordings", sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("broadcast_recordings", "ended_at")
    op.drop_column("broadcast_recordings", "started_at")
    op.drop_column("broadcast_recordings", "timeline_json")
