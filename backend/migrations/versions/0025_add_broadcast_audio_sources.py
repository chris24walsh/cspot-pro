"""add grouped broadcast audio sources

Revision ID: 0025_audio_sources
Revises: 0024_recording_grace
Create Date: 2026-08-10
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0025_audio_sources"
down_revision: str | None = "0024_recording_grace"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("broadcast_viewer_settings", sa.Column("audio_sources_json", sa.Text()))


def downgrade() -> None:
    op.drop_column("broadcast_viewer_settings", "audio_sources_json")
