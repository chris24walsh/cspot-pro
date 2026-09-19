"""Permanent Sunday School room and single live lesson owner."""

import sqlalchemy as sa
from alembic import op

revision = "0067_sunday_school_room"
down_revision = "0066_sunday_school_display"
branch_labels = None
depends_on = None


def upgrade() -> None:
    room = op.create_table(
        "sunday_school_room",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("lesson_date", sa.Date(), nullable=True),
        sa.Column("lesson_title", sa.String(220), nullable=False),
        sa.Column("state", sa.JSON(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("sound_ready", sa.Boolean(), nullable=False),
        sa.CheckConstraint("id = 1", name="single_sunday_school_room"),
    )
    op.bulk_insert(
        room, [{"id": 1, "lesson_title": "", "state": {}, "revision": 0, "sound_ready": False}]
    )


def downgrade() -> None:
    op.drop_table("sunday_school_room")
