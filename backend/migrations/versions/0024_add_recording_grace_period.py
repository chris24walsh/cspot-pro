"""add recording grace period

Revision ID: 0024_recording_grace
Revises: 0023_mixer_integration
Create Date: 2026-08-05
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0024_recording_grace"
down_revision: str | None = "0023_mixer_integration"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "broadcast_viewer_settings",
        sa.Column("recording_grace_seconds", sa.Integer(), nullable=False, server_default="60"),
    )
    op.add_column(
        "broadcast_recordings", sa.Column("pending_stop_at", sa.DateTime(timezone=True))
    )
    op.add_column("broadcast_recordings", sa.Column("pending_stop_reason", sa.String(240)))
    op.add_column("broadcast_recordings", sa.Column("pending_stop_offset_ms", sa.Integer()))
    op.add_column("broadcast_recordings", sa.Column("end_reason", sa.String(240)))


def downgrade() -> None:
    op.drop_column("broadcast_recordings", "end_reason")
    op.drop_column("broadcast_recordings", "pending_stop_offset_ms")
    op.drop_column("broadcast_recordings", "pending_stop_reason")
    op.drop_column("broadcast_recordings", "pending_stop_at")
    op.drop_column("broadcast_viewer_settings", "recording_grace_seconds")
