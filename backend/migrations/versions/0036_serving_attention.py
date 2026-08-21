"""track serving attention ownership"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0036_serving_attention"
down_revision: str | None = "0035_serving_invitation_origin"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "volunteer_preferences",
        sa.Column(
            "admin_attention_pending", sa.Boolean(), server_default=sa.false(), nullable=False
        ),
    )
    op.execute(
        sa.text(
            "UPDATE volunteer_preferences SET admin_attention_pending = true WHERE initiated_by = 'volunteer' AND status = 'pending'"
        )
    )


def downgrade() -> None:
    op.drop_column("volunteer_preferences", "admin_attention_pending")
