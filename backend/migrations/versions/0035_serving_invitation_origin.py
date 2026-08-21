"""track serving invitation origin"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0035_serving_invitation_origin"
down_revision: str | None = "0034_serving_frequency"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "volunteer_preferences",
        sa.Column("initiated_by", sa.String(24), server_default="volunteer", nullable=False),
    )


def downgrade() -> None:
    op.drop_column("volunteer_preferences", "initiated_by")
