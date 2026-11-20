"""Persist visual edits separately from captured recording events."""

import sqlalchemy as sa
from alembic import op

revision = "0080_recording_visuals"
down_revision = "0079_teacher_camera"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("broadcast_recordings", sa.Column("visual_segments_json", sa.Text()))


def downgrade():
    op.drop_column("broadcast_recordings", "visual_segments_json")
