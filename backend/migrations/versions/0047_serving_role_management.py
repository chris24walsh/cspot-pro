"""add serving role categories and assignment intervals

Revision ID: 0047_role_management
Revises: 0046_volunteer_suspension
"""

from collections.abc import Sequence
from uuid import uuid4

import sqlalchemy as sa
from alembic import op

revision: str = "0047_role_management"
down_revision: str | None = "0046_volunteer_suspension"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "serving_role_categories",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index(
        "ix_serving_role_categories_name", "serving_role_categories", ["name"], unique=True
    )
    connection = op.get_bind()
    categories = connection.execute(
        sa.text("SELECT DISTINCT category FROM serving_areas ORDER BY category")
    ).scalars()
    for name in categories:
        connection.execute(
            sa.text("INSERT INTO serving_role_categories (id, name) VALUES (:id, :name)"),
            {"id": str(uuid4()), "name": name},
        )
    op.add_column(
        "serving_areas",
        sa.Column(
            "assignment_interval", sa.String(24), nullable=False, server_default="weekly"
        ),
    )


def downgrade() -> None:
    op.drop_column("serving_areas", "assignment_interval")
    op.drop_index("ix_serving_role_categories_name", table_name="serving_role_categories")
    op.drop_table("serving_role_categories")
