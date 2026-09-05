"""Give every planned service one authoritative queued start.

Revision ID: 0058_single_service_queue
Revises: 0057_template_cues_and_scenes
"""

import sqlalchemy as sa
from alembic import op

revision = "0058_single_service_queue"
down_revision = "0057_template_cues_and_scenes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("plans", sa.Column("queued_start", sa.String(5), nullable=True))
    op.execute("""
        UPDATE plans
        SET queued_start = COALESCE(
            (SELECT MIN(plan_items.planned_start) FROM plan_items
             WHERE plan_items.plan_id = plans.id AND plan_items.deleted_at IS NULL),
            (SELECT COALESCE(plan_types.automation_start, plan_types.starts_at)
             FROM plan_types WHERE plan_types.id = plans.plan_type_id)
        )
    """)


def downgrade() -> None:
    op.drop_column("plans", "queued_start")
