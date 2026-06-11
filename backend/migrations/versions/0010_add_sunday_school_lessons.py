"""add sunday school lessons

Revision ID: 0010_add_sunday_school_lessons
Revises: 0009_add_site_content_blocks
Create Date: 2026-06-11
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "0010_add_sunday_school_lessons"
down_revision: str | None = "0009_add_site_content_blocks"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "sunday_school_lessons",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("lesson_date", sa.Date(), nullable=False),
        sa.Column("status", sa.String(length=40), nullable=False, server_default="draft"),
        sa.Column("theme", sa.String(length=220), nullable=False, server_default=""),
        sa.Column("bible_reference", sa.String(length=160), nullable=False, server_default=""),
        sa.Column("bible_story", sa.Text(), nullable=False, server_default=""),
        sa.Column("crafts", sa.Text(), nullable=False, server_default=""),
        sa.Column("songs", sa.Text(), nullable=False, server_default=""),
        sa.Column("games", sa.Text(), nullable=False, server_default=""),
        sa.Column("source_notes", sa.Text(), nullable=False, server_default=""),
        sa.Column("teacher_notes", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_sunday_school_lessons_lesson_date", "sunday_school_lessons", ["lesson_date"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_sunday_school_lessons_lesson_date", table_name="sunday_school_lessons")
    op.drop_table("sunday_school_lessons")
