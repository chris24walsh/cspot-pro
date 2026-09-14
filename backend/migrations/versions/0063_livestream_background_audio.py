"""Keep background audio listeners present while browser timers are suspended.

Revision ID: 0063_livestream_background_audio
Revises: 0062_livestream_viewership
"""

import sqlalchemy as sa
from alembic import op

revision = "0063_livestream_background_audio"
down_revision = "0062_livestream_viewership"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "livestream_viewer_visits",
        sa.Column("playback_active", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("livestream_viewer_visits", "playback_active")
