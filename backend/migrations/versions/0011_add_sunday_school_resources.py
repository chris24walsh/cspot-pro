"""add sunday school resources

Revision ID: 0011_add_sunday_school_resources
Revises: 0010_add_sunday_school_lessons
Create Date: 2026-06-12
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0011_add_sunday_school_resources"
down_revision: str | None = "0010_add_sunday_school_lessons"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "sunday_school_lessons",
        sa.Column("teacher_name", sa.String(length=120), nullable=False, server_default=""),
    )
    op.create_table(
        "sunday_school_resources",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("title", sa.String(length=220), nullable=False),
        sa.Column("resource_type", sa.String(length=60), nullable=False),
        sa.Column("age_group", sa.String(length=40), nullable=False, server_default=""),
        sa.Column("source_title", sa.String(length=220), nullable=False, server_default=""),
        sa.Column("theme", sa.String(length=220), nullable=False, server_default=""),
        sa.Column("bible_reference", sa.String(length=160), nullable=False, server_default=""),
        sa.Column("lesson_date", sa.Date(), nullable=True),
        sa.Column("week_number", sa.Integer(), nullable=True),
        sa.Column("translation", sa.String(length=20), nullable=False, server_default=""),
        sa.Column("file_name", sa.String(length=255), nullable=False),
        sa.Column("file_path", sa.Text(), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False, server_default=""),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "file_path",
            "resource_type",
            "translation",
            name="uq_sunday_school_resource_file_type_translation",
        ),
    )
    op.create_index(
        "ix_sunday_school_resources_age_group",
        "sunday_school_resources",
        ["age_group"],
    )
    op.create_index(
        "ix_sunday_school_resources_lesson_date",
        "sunday_school_resources",
        ["lesson_date"],
    )
    op.create_index(
        "ix_sunday_school_resources_resource_type",
        "sunday_school_resources",
        ["resource_type"],
    )
    op.create_index("ix_sunday_school_resources_title", "sunday_school_resources", ["title"])
    op.create_index(
        "ix_sunday_school_resources_week_number",
        "sunday_school_resources",
        ["week_number"],
    )


def downgrade() -> None:
    op.drop_index("ix_sunday_school_resources_week_number", table_name="sunday_school_resources")
    op.drop_index("ix_sunday_school_resources_title", table_name="sunday_school_resources")
    op.drop_index("ix_sunday_school_resources_resource_type", table_name="sunday_school_resources")
    op.drop_index("ix_sunday_school_resources_lesson_date", table_name="sunday_school_resources")
    op.drop_index("ix_sunday_school_resources_age_group", table_name="sunday_school_resources")
    op.drop_table("sunday_school_resources")
    op.drop_column("sunday_school_lessons", "teacher_name")
