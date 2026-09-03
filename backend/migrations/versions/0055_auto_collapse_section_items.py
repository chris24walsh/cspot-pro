"""Allow section items to stay collapsed in the slide sorter.

Revision ID: 0055_auto_collapse_section_items
Revises: 0054_sunday_school_board
"""

import sqlalchemy as sa
from alembic import op

revision = "0055_auto_collapse_section_items"
down_revision = "0054_sunday_school_board"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "plan_items",
        sa.Column("auto_collapse_items", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("plan_items", "auto_collapse_items")
