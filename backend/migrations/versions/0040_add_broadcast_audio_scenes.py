"""add broadcast audio scenes

Revision ID: 0040_audio_scenes
Revises: 0039_self_registration
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0040_audio_scenes"
down_revision: str | None = "0039_self_registration"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("broadcast_viewer_settings", sa.Column("audio_scenes_json", sa.Text()))
    op.add_column(
        "broadcast_viewer_settings",
        sa.Column("active_audio_scene", sa.String(length=40), nullable=False, server_default="pastor"),
    )
    op.add_column(
        "broadcast_viewer_settings",
        sa.Column("audio_scene_automation", sa.Boolean(), nullable=False, server_default=sa.true()),
    )


def downgrade() -> None:
    op.drop_column("broadcast_viewer_settings", "audio_scene_automation")
    op.drop_column("broadcast_viewer_settings", "active_audio_scene")
    op.drop_column("broadcast_viewer_settings", "audio_scenes_json")
