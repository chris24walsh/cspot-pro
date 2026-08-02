"""add automatic sermon recording setting

Revision ID: 0021_add_auto_record_sermons
Revises: 0020_add_usernames
Create Date: 2026-08-02
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0021_add_auto_record_sermons"
down_revision: str | None = "0020_add_usernames"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "broadcast_viewer_settings",
        sa.Column("auto_record_sermons", sa.Boolean(), nullable=False, server_default=sa.true()),
    )


def downgrade() -> None:
    op.drop_column("broadcast_viewer_settings", "auto_record_sermons")
