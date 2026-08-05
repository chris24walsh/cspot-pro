"""add multi-camera broadcast settings

Revision ID: 0022_multi_camera_broadcast
Revises: 0021_add_auto_record_sermons
Create Date: 2026-08-05
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0022_multi_camera_broadcast"
down_revision: str | None = "0021_add_auto_record_sermons"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("broadcast_viewer_settings", sa.Column("camera_sources_json", sa.Text()))
    op.add_column("broadcast_viewer_settings", sa.Column("active_camera_id", sa.String(80)))
    op.add_column(
        "broadcast_viewer_settings",
        sa.Column("camera_cycle_seconds", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column("broadcast_viewer_settings", sa.Column("camera_cycle_started_at", sa.DateTime(timezone=True)))
    op.add_column(
        "broadcast_viewer_settings",
        sa.Column("camera_fade_ms", sa.Integer(), nullable=False, server_default="1200"),
    )
    op.add_column("broadcast_viewer_settings", sa.Column("live_audio_source", sa.String(100)))
    op.add_column(
        "broadcast_viewer_settings",
        sa.Column("slide_delay_ms", sa.Integer(), nullable=False, server_default="800"),
    )


def downgrade() -> None:
    op.drop_column("broadcast_viewer_settings", "slide_delay_ms")
    op.drop_column("broadcast_viewer_settings", "live_audio_source")
    op.drop_column("broadcast_viewer_settings", "camera_fade_ms")
    op.drop_column("broadcast_viewer_settings", "camera_cycle_started_at")
    op.drop_column("broadcast_viewer_settings", "camera_cycle_seconds")
    op.drop_column("broadcast_viewer_settings", "active_camera_id")
    op.drop_column("broadcast_viewer_settings", "camera_sources_json")
