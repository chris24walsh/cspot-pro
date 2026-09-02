"""Add random-order option for item image montages.

Revision ID: 0053_montage_random_order
Revises: 0052_nest_outline_content
"""

import sqlalchemy as sa
from alembic import op


revision = "0053_montage_random_order"
down_revision = "0052_nest_outline_content"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("plan_items", sa.Column("montage_random", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    op.drop_column("plan_items", "montage_random")
