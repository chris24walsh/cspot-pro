"""Archive sermon recordings before automatic cleanup.

Revision ID: 0061_archive_recordings
Revises: 0060_recording_custom_titles
"""

import sqlalchemy as sa
from alembic import op

revision = "0061_archive_recordings"
down_revision = "0060_recording_custom_titles"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("broadcast_recordings", sa.Column("archived_at", sa.DateTime(timezone=True)))
    op.create_index(
        "ix_broadcast_recordings_archived_at", "broadcast_recordings", ["archived_at"]
    )


def downgrade() -> None:
    op.drop_index("ix_broadcast_recordings_archived_at", table_name="broadcast_recordings")
    op.drop_column("broadcast_recordings", "archived_at")
