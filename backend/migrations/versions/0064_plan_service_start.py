"""Store each service's actual start time separately from its Welcome start.

Revision ID: 0064_plan_service_start
Revises: 0063_livestream_background_audio
"""

import sqlalchemy as sa
from alembic import op

revision = "0064_plan_service_start"
down_revision = "0063_livestream_background_audio"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("plans", sa.Column("service_start", sa.String(length=5), nullable=True))


def downgrade() -> None:
    op.drop_column("plans", "service_start")
