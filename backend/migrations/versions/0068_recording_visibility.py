"""Require review before new recordings are visible to viewers."""
import sqlalchemy as sa
from alembic import op

revision = "0068_recording_visibility"
down_revision = "0067_sunday_school_room"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("broadcast_recordings", sa.Column("visible_at", sa.DateTime(timezone=True)))
    op.execute("UPDATE broadcast_recordings SET visible_at = CURRENT_TIMESTAMP "
               "WHERE status = 'ready' AND archived_at IS NULL")


def downgrade() -> None:
    op.drop_column("broadcast_recordings", "visible_at")
