"""Add type-specific presentation options to plan items.

Revision ID: 0056_item_presentation_options
Revises: 0055_auto_collapse_section_items
"""

import sqlalchemy as sa
from alembic import op

revision = "0056_item_presentation_options"
down_revision = "0055_auto_collapse_section_items"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "plan_items",
        sa.Column("presentation_options", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
    )


def downgrade() -> None:
    op.drop_column("plan_items", "presentation_options")
