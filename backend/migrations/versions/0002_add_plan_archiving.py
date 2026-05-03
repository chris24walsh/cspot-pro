"""add plan archiving

Revision ID: 0002_add_plan_archiving
Revises: 0001_initial_domain
Create Date: 2026-05-02
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "0002_add_plan_archiving"
down_revision: str | None = "0001_initial_domain"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("plans", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("plans", "deleted_at")
