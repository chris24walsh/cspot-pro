"""add dedicated live audio source

Revision ID: 0019_add_live_audio_source
Revises: 0018_add_service_end_slides
Create Date: 2026-07-19
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0019_add_live_audio_source"
down_revision: str | None = "0018_add_service_end_slides"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "broadcast_viewer_settings",
        sa.Column("live_audio_url", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("broadcast_viewer_settings", "live_audio_url")
