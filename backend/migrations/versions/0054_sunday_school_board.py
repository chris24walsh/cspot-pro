"""Add flexible Sunday School board items.

Revision ID: 0054_sunday_school_board
Revises: 0053_montage_random_order
"""

import sqlalchemy as sa
from alembic import op

revision = "0054_sunday_school_board"
down_revision = "0053_montage_random_order"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "sunday_school_lessons",
        sa.Column("board_items", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
    )


def downgrade() -> None:
    op.drop_column("sunday_school_lessons", "board_items")
