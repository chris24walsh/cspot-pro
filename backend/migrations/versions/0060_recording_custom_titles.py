"""Add custom titles for sermon recordings.

Revision ID: 0060_recording_custom_titles
Revises: 0059_public_recordings
"""

import sqlalchemy as sa
from alembic import op

revision = "0060_recording_custom_titles"
down_revision = "0059_public_recordings"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("broadcast_recordings", sa.Column("custom_title", sa.String(220)))


def downgrade() -> None:
    op.drop_column("broadcast_recordings", "custom_title")
