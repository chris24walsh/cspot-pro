"""seed editable Sunday service outline

Revision ID: 0050_plan_type_outlines
Revises: 0049_service_schedules
"""

from alembic import op

revision: str = "0050_plan_type_outlines"
down_revision: str | None = "0049_service_schedules"
branch_labels = None
depends_on = None


def upgrade() -> None:
    definitions = (
        ("c0a00000-0000-4000-8000-000000000001", "pre_service", "Welcome", 10),
        ("c0a00000-0000-4000-8000-000000000002", "worship_set", "Worship", 20),
        ("c0a00000-0000-4000-8000-000000000003", "open_time", "Open time", 30),
        ("c0a00000-0000-4000-8000-000000000004", "sermon", "Sermon", 40),
        ("c0a00000-0000-4000-8000-000000000005", "announcements", "Announcements", 50),
    )
    for item_id, item_type, title, sequence in definitions:
        op.execute(
            f"""
            INSERT INTO default_items
                (id, plan_type_id, item_type, sequence, title, comment, created_at, updated_at)
            SELECT '{item_id}', id, '{item_type}', {sequence}, '{title}', NULL,
                   CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            FROM plan_types
            WHERE name = 'Sunday Service'
              AND NOT EXISTS (
                  SELECT 1 FROM default_items
                  WHERE plan_type_id = plan_types.id AND item_type = '{item_type}'
              )
            """
        )


def downgrade() -> None:
    op.execute(
        "DELETE FROM default_items WHERE id LIKE 'c0a00000-0000-4000-8000-00000000000%'"
    )
