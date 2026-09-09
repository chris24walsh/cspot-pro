"""Add opt-in public links for sermon recordings.

Revision ID: 0059_public_recordings
Revises: 0058_single_service_queue
"""

import sqlalchemy as sa
from alembic import op

revision = "0059_public_recordings"
down_revision = "0058_single_service_queue"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("broadcast_recordings", sa.Column("public_token", sa.String(80)))
    op.add_column("broadcast_recordings", sa.Column("published_at", sa.DateTime(timezone=True)))
    op.create_index(
        "ix_broadcast_recordings_public_token",
        "broadcast_recordings",
        ["public_token"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_broadcast_recordings_public_token", table_name="broadcast_recordings")
    op.drop_column("broadcast_recordings", "published_at")
    op.drop_column("broadcast_recordings", "public_token")
