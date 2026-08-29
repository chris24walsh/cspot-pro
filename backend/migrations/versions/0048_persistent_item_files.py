"""add persistence flag to plan item files

Revision ID: 0048_persistent_item_files
Revises: 0047_role_management
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0048_persistent_item_files"
down_revision: str | None = "0047_role_management"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "item_files",
        sa.Column("persistent", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("item_files", "persistent")
