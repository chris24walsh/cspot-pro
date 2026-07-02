"""separate worship leader assignments from worship sets"""

from collections.abc import Sequence
from uuid import uuid4

import sqlalchemy as sa
from alembic import op

revision: str = "0016_worship_leader_assignments"
down_revision: str | None = "0015_repair_worship_set"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "worship_leader_assignments",
        sa.Column("service_date", sa.Date(), nullable=False),
        sa.Column("leader_id", sa.String(length=36), nullable=False),
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["leader_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("service_date"),
    )
    op.create_index(
        "ix_worship_leader_assignments_service_date", "worship_leader_assignments", ["service_date"]
    )
    op.create_index(
        "ix_worship_leader_assignments_leader_id", "worship_leader_assignments", ["leader_id"]
    )

    connection = op.get_bind()
    rows = connection.execute(
        sa.text("""
        SELECT p.service_date, p.leader_id
        FROM plans p JOIN plan_types pt ON pt.id = p.plan_type_id
        WHERE lower(pt.name) = 'worship set' AND p.leader_id IS NOT NULL AND p.deleted_at IS NULL
        ORDER BY p.service_date
    """)
    ).mappings()
    seen: set[str] = set()
    for row in rows:
        day = str(row["service_date"])[:10]
        if day in seen:
            continue
        seen.add(day)
        connection.execute(
            sa.text("""
            INSERT INTO worship_leader_assignments (id, service_date, leader_id)
            VALUES (:id, :service_date, :leader_id)
        """),
            {"id": str(uuid4()), "service_date": day, "leader_id": row["leader_id"]},
        )


def downgrade() -> None:
    op.drop_index(
        "ix_worship_leader_assignments_leader_id", table_name="worship_leader_assignments"
    )
    op.drop_index(
        "ix_worship_leader_assignments_service_date", table_name="worship_leader_assignments"
    )
    op.drop_table("worship_leader_assignments")
