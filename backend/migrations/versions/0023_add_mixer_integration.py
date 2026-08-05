"""add mixer integration settings

Revision ID: 0023_mixer_integration
Revises: 0022_multi_camera_broadcast
Create Date: 2026-08-05
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0023_mixer_integration"
down_revision: str | None = "0022_multi_camera_broadcast"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("broadcast_viewer_settings", sa.Column("mixer_name", sa.String(160)))
    op.add_column("broadcast_viewer_settings", sa.Column("mixer_protocol", sa.String(40)))
    op.add_column("broadcast_viewer_settings", sa.Column("mixer_control_url", sa.Text()))
    op.add_column("broadcast_viewer_settings", sa.Column("mixer_notes", sa.Text()))


def downgrade() -> None:
    op.drop_column("broadcast_viewer_settings", "mixer_notes")
    op.drop_column("broadcast_viewer_settings", "mixer_control_url")
    op.drop_column("broadcast_viewer_settings", "mixer_protocol")
    op.drop_column("broadcast_viewer_settings", "mixer_name")
