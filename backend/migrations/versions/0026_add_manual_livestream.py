"""add manual livestream audience

Revision ID: 0026_manual_livestream
Revises: 0025_audio_sources
Create Date: 2026-08-12
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0026_manual_livestream"
down_revision: str | None = "0025_audio_sources"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "broadcast_viewer_settings",
        sa.Column(
            "manual_live_audience",
            sa.String(length=20),
            nullable=False,
            server_default="off",
        ),
    )


def downgrade() -> None:
    op.drop_column("broadcast_viewer_settings", "manual_live_audience")
