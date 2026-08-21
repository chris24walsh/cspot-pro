"""remove end slides from otherwise empty services

Revision ID: 0031_remove_empty_ends
Revises: 0030_tablet_manual_rotation
Create Date: 2026-08-21
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0031_remove_empty_ends"
down_revision: str | None = "0030_tablet_manual_rotation"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        sa.text(
            """
            DELETE FROM plan_items
            WHERE id IN (
                SELECT end_item.id
                FROM plan_items AS end_item
                JOIN plans AS plan ON plan.id = end_item.plan_id
                JOIN plan_types AS plan_type ON plan_type.id = plan.plan_type_id
                WHERE end_item.deleted_at IS NULL
                  AND end_item.item_type = 'end'
                  AND plan.deleted_at IS NULL
                  AND lower(plan_type.name) <> 'worship set'
                  AND NOT EXISTS (
                      SELECT 1
                      FROM plan_items AS other_item
                      WHERE other_item.plan_id = end_item.plan_id
                        AND other_item.id <> end_item.id
                        AND other_item.deleted_at IS NULL
                  )
            )
            """
        )
    )


def downgrade() -> None:
    # Deleted placeholder slides cannot be distinguished from intentional end
    # slides after the cleanup, so recreating them would be unsafe.
    pass
