"""Add isolated Sunday School display state.

Revision ID: 0066_sunday_school_display
Revises: 0065_split_pre_service_template
"""

import sqlalchemy as sa
from alembic import op

revision = "0066_sunday_school_display"
down_revision = "0065_split_pre_service_template"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "sunday_school_lessons",
        sa.Column("display_state", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
    )
    op.add_column(
        "sunday_school_lessons",
        sa.Column("display_seen_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("sunday_school_lessons", "display_seen_at")
    op.drop_column("sunday_school_lessons", "display_state")
