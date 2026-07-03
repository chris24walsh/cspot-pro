"""add an end slide to service plans"""

from collections.abc import Sequence
from uuid import uuid4

import sqlalchemy as sa
from alembic import op

revision: str = "0018_add_service_end_slides"
down_revision: str | None = "0017_sermon_audio_recordings"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    connection = op.get_bind()
    plan_ids = list(connection.execute(
        sa.text("""
            SELECT p.id
            FROM plans p
            JOIN plan_types pt ON pt.id = p.plan_type_id
            WHERE p.deleted_at IS NULL
              AND lower(pt.name) <> 'worship set'
              AND NOT EXISTS (
                SELECT 1 FROM plan_items pi
                WHERE pi.plan_id = p.id AND pi.item_type = 'end' AND pi.deleted_at IS NULL
              )
        """)
    ).scalars())
    for plan_id in plan_ids:
        connection.execute(
            sa.text("""
                INSERT INTO plan_items
                    (id, plan_id, item_type, sequence, title, comment, created_at, updated_at)
                VALUES
                    (:id, :plan_id, 'end', 999.00, 'End', 'End of service',
                     CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            """),
            {"id": str(uuid4()), "plan_id": plan_id},
        )


def downgrade() -> None:
    op.execute(
        sa.text("""
            DELETE FROM plan_items
            WHERE item_type = 'end' AND title = 'End' AND sequence = 999.00
        """)
    )
