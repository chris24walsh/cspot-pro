"""Prepare opt-in hardware scenes and a dedicated stereo program audio mode."""

import sqlalchemy as sa
from alembic import op

revision = "0075_mixer_scene_automation"
down_revision = "0074_mixer_operator"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("mixer_configuration", sa.Column("automation_json", sa.Text(), nullable=True))
    op.add_column(
        "broadcast_viewer_settings",
        sa.Column("audio_mix_mode", sa.String(20), nullable=False, server_default="software"),
    )
    op.add_column(
        "broadcast_viewer_settings",
        sa.Column("mixer_program_source_id", sa.String(80), nullable=True),
    )


def downgrade():
    op.drop_column("broadcast_viewer_settings", "mixer_program_source_id")
    op.drop_column("broadcast_viewer_settings", "audio_mix_mode")
    op.drop_column("mixer_configuration", "automation_json")
