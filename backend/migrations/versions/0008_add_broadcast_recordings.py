"""add broadcast recordings

Revision ID: 0008_add_broadcast_recordings
Revises: 0007_add_file_build_flattening
Create Date: 2026-05-18
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "0008_add_broadcast_recordings"
down_revision: str | None = "0007_add_file_build_flattening"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "broadcast_recordings",
        sa.Column("plan_id", sa.String(length=36), nullable=True),
        sa.Column("plan_item_id", sa.String(length=36), nullable=True),
        sa.Column("created_by_user_id", sa.String(length=36), nullable=True),
        sa.Column("title", sa.String(length=220), nullable=False),
        sa.Column("source", sa.String(length=80), nullable=False),
        sa.Column("media_kind", sa.String(length=40), nullable=False),
        sa.Column("status", sa.String(length=40), nullable=False),
        sa.Column("file_path", sa.Text(), nullable=False),
        sa.Column("file_name", sa.String(length=255), nullable=False),
        sa.Column("content_type", sa.String(length=160), nullable=True),
        sa.Column("size_bytes", sa.Integer(), nullable=True),
        sa.Column("duration_seconds", sa.Integer(), nullable=True),
        sa.Column("audio_file_path", sa.Text(), nullable=True),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["plan_id"], ["plans.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["plan_item_id"], ["plan_items.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("file_path", name="uq_broadcast_recordings_file_path"),
    )
    op.create_index(op.f("ix_broadcast_recordings_created_by_user_id"), "broadcast_recordings", ["created_by_user_id"], unique=False)
    op.create_index(op.f("ix_broadcast_recordings_plan_id"), "broadcast_recordings", ["plan_id"], unique=False)
    op.create_index(op.f("ix_broadcast_recordings_plan_item_id"), "broadcast_recordings", ["plan_item_id"], unique=False)
    op.create_index(op.f("ix_broadcast_recordings_recorded_at"), "broadcast_recordings", ["recorded_at"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_broadcast_recordings_recorded_at"), table_name="broadcast_recordings")
    op.drop_index(op.f("ix_broadcast_recordings_plan_item_id"), table_name="broadcast_recordings")
    op.drop_index(op.f("ix_broadcast_recordings_plan_id"), table_name="broadcast_recordings")
    op.drop_index(op.f("ix_broadcast_recordings_created_by_user_id"), table_name="broadcast_recordings")
    op.drop_table("broadcast_recordings")
