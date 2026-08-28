"""scope volunteer unavailability to serving roles

Revision ID: 0045_unavailability_roles
Revises: 0044_room_audio_control
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0045_unavailability_roles"
down_revision: str | None = "0044_room_audio_control"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("volunteer_unavailability", sa.Column("role_keys", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("volunteer_unavailability", "role_keys")
