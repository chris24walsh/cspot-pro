"""add flexible serving frequency"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0034_serving_frequency"
down_revision: str | None = "0033_serving_capabilities"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "volunteer_preferences",
        sa.Column("frequency_count", sa.Integer(), server_default="1", nullable=False),
    )
    op.add_column(
        "volunteer_preferences",
        sa.Column("frequency_period", sa.String(16), server_default="month", nullable=False),
    )
    op.execute(
        sa.text(
            "UPDATE volunteer_preferences SET frequency_period = CASE preferred_frequency WHEN 'weekly' THEN 'week' WHEN 'quarterly' THEN 'quarter' WHEN 'semi_yearly' THEN 'year' WHEN 'occasional' THEN 'year' ELSE 'month' END, frequency_count = CASE preferred_frequency WHEN 'semi_yearly' THEN 2 ELSE 1 END"
        )
    )


def downgrade() -> None:
    op.drop_column("volunteer_preferences", "frequency_period")
    op.drop_column("volunteer_preferences", "frequency_count")
