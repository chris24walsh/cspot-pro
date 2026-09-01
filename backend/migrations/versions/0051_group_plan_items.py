"""Allow plan items to be nested beneath outline groups.

Revision ID: 0051_group_plan_items
Revises: 0050_seed_plan_type_outlines
"""

from alembic import op
import sqlalchemy as sa


revision = "0051_group_plan_items"
down_revision = "0050_seed_plan_type_outlines"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("plan_items", sa.Column("parent_item_id", sa.String(length=36), nullable=True))
    op.create_index("ix_plan_items_parent_item_id", "plan_items", ["parent_item_id"])
    op.create_foreign_key(
        "fk_plan_items_parent_item_id_plan_items",
        "plan_items",
        "plan_items",
        ["parent_item_id"],
        ["id"],
        ondelete="CASCADE",
    )


def downgrade() -> None:
    op.drop_constraint("fk_plan_items_parent_item_id_plan_items", "plan_items", type_="foreignkey")
    op.drop_index("ix_plan_items_parent_item_id", table_name="plan_items")
    op.drop_column("plan_items", "parent_item_id")
