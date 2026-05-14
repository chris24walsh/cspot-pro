"""add worship set plan type

Revision ID: 0005_add_worship_set_plan_type
Revises: 0004_add_oauth_connections
Create Date: 2026-05-14
"""

from collections.abc import Sequence
from uuid import uuid4

from alembic import op
import sqlalchemy as sa

revision: str = "0005_add_worship_set_plan_type"
down_revision: str | None = "0004_add_oauth_connections"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    plan_types = sa.table(
        "plan_types",
        sa.column("id", sa.String),
        sa.column("name", sa.String),
        sa.column("description", sa.String),
        sa.column("starts_at", sa.String),
        sa.column("default_duration_minutes", sa.Integer),
        sa.column("active", sa.Boolean),
    )
    connection = op.get_bind()
    existing = connection.execute(sa.select(plan_types.c.id).where(plan_types.c.name == "Worship Set")).first()
    if existing is None:
        connection.execute(
            plan_types.insert().values(
                id=str(uuid4()),
                name="Worship Set",
                description="Dated worship song set used by musicians and pulled into matching services.",
                starts_at="10:30",
                default_duration_minutes=30,
                active=True,
            ),
        )


def downgrade() -> None:
    op.execute("DELETE FROM plan_types WHERE name = 'Worship Set'")
