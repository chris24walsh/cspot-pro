"""Add scoped serving managers and delegated account management roles.

Revision ID: 0073_delegated_management
Revises: 0072_xr18_mixer
"""

from collections.abc import Sequence
from uuid import uuid4

import sqlalchemy as sa
from alembic import op

revision: str = "0073_delegated_management"
down_revision: str | None = "0072_xr18_mixer"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "serving_area_managers",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column(
            "serving_area_id",
            sa.String(36),
            sa.ForeignKey("serving_areas.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.UniqueConstraint("user_id", "serving_area_id", name="uq_serving_manager_user_area"),
    )
    op.create_index("ix_serving_area_managers_user_id", "serving_area_managers", ["user_id"])
    op.create_index(
        "ix_serving_area_managers_serving_area_id", "serving_area_managers", ["serving_area_id"]
    )
    for name, description in (
        ("registration_approver", "Approve or reject new account registrations."),
        ("user_administrator", "Manage ordinary accounts and standard workspace access."),
    ):
        op.get_bind().execute(
            sa.text(
                "INSERT INTO roles (id, name, description, system_role) "
                "VALUES (:id, :name, :description, true) ON CONFLICT (name) DO NOTHING"
            ),
            {"id": str(uuid4()), "name": name, "description": description},
        )


def downgrade() -> None:
    op.drop_table("serving_area_managers")
    # Retain assigned role records so downgrading never deletes user assignments.
