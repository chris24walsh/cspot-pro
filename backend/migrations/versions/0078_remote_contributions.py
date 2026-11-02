"""Expiring remote camera/microphone contributions."""

import sqlalchemy as sa
from alembic import op

revision = "0078_remote_contributions"
down_revision = "0077_preservice_band_room"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "broadcast_contributions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("label", sa.String(120), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True)),
        sa.Column("last_seen_at", sa.DateTime(timezone=True)),
        sa.Column("return_source_id", sa.String(80)),
        sa.Column("publisher_session", sa.String(160)),
    )
    op.create_index(
        "ix_broadcast_contributions_token_hash",
        "broadcast_contributions",
        ["token_hash"],
        unique=True,
    )
    op.add_column("broadcast_viewer_settings", sa.Column("remote_contribution_id", sa.String(36)))


def downgrade():
    op.drop_column("broadcast_viewer_settings", "remote_contribution_id")
    op.drop_table("broadcast_contributions")
