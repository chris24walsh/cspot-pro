"""add generic service schedules

Revision ID: 0049_service_schedules
Revises: 0048_persistent_item_files
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0049_service_schedules"
down_revision: str | None = "0048_persistent_item_files"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "broadcast_viewer_settings",
        sa.Column("service_schedules_json", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("broadcast_viewer_settings", "service_schedules_json")
