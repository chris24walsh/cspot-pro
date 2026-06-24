"""add broadcast viewer settings

Revision ID: 0014_broadcast_viewer_settings
Revises: 0013_user_calendar_identity
Create Date: 2026-06-24
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0014_broadcast_viewer_settings"
down_revision: str | None = "0013_user_calendar_identity"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "broadcast_viewer_settings",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("stream_title", sa.String(length=180), nullable=False, server_default="Sunday Service"),
        sa.Column("stream_description", sa.Text(), nullable=True),
        sa.Column("camera_url", sa.Text(), nullable=True),
        sa.Column("pre_service_audio_url", sa.Text(), nullable=True),
        sa.Column("pre_service_minutes", sa.Integer(), nullable=False, server_default="60"),
        sa.Column("starting_soon_message", sa.String(length=240), nullable=False, server_default="Our service will begin shortly"),
        sa.Column("offline_message", sa.String(length=240), nullable=False, server_default="No service is streaming right now"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("broadcast_viewer_settings")
