"""Give Sunday pre-service cues and the service Welcome separate sections.

Revision ID: 0065_split_pre_service_template
Revises: 0064_plan_service_start
"""

from uuid import uuid4

import sqlalchemy as sa
from alembic import op

revision = "0065_split_pre_service_template"
down_revision = "0064_plan_service_start"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    sunday = connection.execute(sa.text(
        "SELECT id FROM plan_types WHERE name = 'Sunday Service'"
    )).scalar_one_or_none()
    if sunday is None:
        return
    cue_root = connection.execute(sa.text("""
        SELECT root.id FROM default_items root
        JOIN default_items cue ON cue.parent_item_id = root.id
        WHERE root.plan_type_id = :plan_type_id
          AND root.parent_item_id IS NULL
          AND cue.item_type IN ('welcome_montage', 'welcome_countdown')
        ORDER BY root.sequence, root.created_at LIMIT 1
    """), {"plan_type_id": sunday}).scalar_one_or_none()
    if cue_root is None:
        return
    welcome = connection.execute(sa.text("""
        SELECT id FROM default_items
        WHERE plan_type_id = :plan_type_id AND parent_item_id IS NULL
          AND lower(trim(title)) = 'welcome' AND id != :cue_root
        ORDER BY sequence, created_at LIMIT 1
    """), {"plan_type_id": sunday, "cue_root": cue_root}).scalar_one_or_none()
    connection.execute(sa.text("""
        UPDATE default_items SET item_type = 'pre_service', title = 'Pre-service',
            sequence = 9, updated_at = CURRENT_TIMESTAMP
        WHERE id = :cue_root
    """), {"cue_root": cue_root})
    if welcome is None:
        connection.execute(sa.text("""
            INSERT INTO default_items
                (id, plan_type_id, parent_item_id, item_type, sequence, title,
                 comment, presentation_options, created_at, updated_at)
            VALUES (:id, :plan_type_id, NULL, 'custom', 10, 'Welcome', NULL,
                    '{}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        """), {"id": str(uuid4()), "plan_type_id": sunday})


def downgrade() -> None:
    # The sections and their cues may have been edited since migration.
    pass
