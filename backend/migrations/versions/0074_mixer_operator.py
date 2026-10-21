"""Add independently assignable hardware mixer access.

Revision ID: 0074_mixer_operator
Revises: 0073_delegated_management
"""

from uuid import uuid4

import sqlalchemy as sa
from alembic import op

revision = "0074_mixer_operator"
down_revision = "0073_delegated_management"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.get_bind().execute(
        sa.text(
            "INSERT INTO roles (id, name, description, system_role) "
            "VALUES (:id, :name, :description, true) ON CONFLICT (name) DO UPDATE "
            "SET description = EXCLUDED.description"
        ),
        {
            "id": str(uuid4()),
            "name": "mixer_operator",
            "description": (
            "Access and control the hardware mixer independently of worship and broadcast views."
        ),
        },
    )
    op.get_bind().execute(
        sa.text("UPDATE roles SET description = :description WHERE name = 'worship_leader'"),
        {"description": "Manage worship songs, files, and worship set planning."},
    )


def downgrade() -> None:
    # Preserve explicit role assignments when rolling back application code.
    pass
