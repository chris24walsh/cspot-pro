"""add worship suggestion learning state

Revision ID: 0027_worship_learning
Revises: 0026_manual_livestream
Create Date: 2026-08-14
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0027_worship_learning"
down_revision: str | None = "0026_manual_livestream"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "song_worship_role_removals",
        sa.Column("song_id", sa.String(length=36), nullable=False),
        sa.Column("role", sa.String(length=40), nullable=False),
        sa.Column("removed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["song_id"], ["songs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("song_id", "role", name="uq_song_worship_role_removal"),
    )
    op.create_index(
        "ix_song_worship_role_removals_song_id", "song_worship_role_removals", ["song_id"]
    )
    op.create_index("ix_song_worship_role_removals_role", "song_worship_role_removals", ["role"])
    op.create_table(
        "worship_suggestion_feedback",
        sa.Column("song_id", sa.String(length=36), nullable=False),
        sa.Column("slot", sa.String(length=40), nullable=False),
        sa.Column("action", sa.String(length=40), nullable=False),
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["song_id"], ["songs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_worship_suggestion_feedback_song_id", "worship_suggestion_feedback", ["song_id"]
    )
    op.create_index("ix_worship_suggestion_feedback_slot", "worship_suggestion_feedback", ["slot"])
    op.create_index(
        "ix_worship_suggestion_feedback_action", "worship_suggestion_feedback", ["action"]
    )


def downgrade() -> None:
    op.drop_table("worship_suggestion_feedback")
    op.drop_table("song_worship_role_removals")
