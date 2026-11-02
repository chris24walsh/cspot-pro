"""Account-owned camera contributions from the teacher Service workspace."""

import sqlalchemy as sa
from alembic import op

revision = "0079_teacher_camera"
down_revision = "0078_remote_contributions"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("broadcast_contributions", sa.Column("owner_user_id", sa.String(36)))
    op.create_foreign_key(
        "fk_contribution_owner",
        "broadcast_contributions",
        "users",
        ["owner_user_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index(
        "ix_broadcast_contributions_owner_user_id", "broadcast_contributions", ["owner_user_id"]
    )


def downgrade():
    op.drop_index("ix_broadcast_contributions_owner_user_id", "broadcast_contributions")
    op.drop_constraint("fk_contribution_owner", "broadcast_contributions", type_="foreignkey")
    op.drop_column("broadcast_contributions", "owner_user_id")
