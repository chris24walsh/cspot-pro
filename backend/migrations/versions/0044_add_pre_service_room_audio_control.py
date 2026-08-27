"""add pre-service room audio control

Revision ID: 0044_room_audio_control
Revises: 0043_simplify_outline
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0044_room_audio_control"
down_revision: str | None = "0043_simplify_outline"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "broadcast_viewer_settings",
        sa.Column(
            "pre_service_room_audio_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
    )


def downgrade() -> None:
    op.drop_column("broadcast_viewer_settings", "pre_service_room_audio_enabled")
