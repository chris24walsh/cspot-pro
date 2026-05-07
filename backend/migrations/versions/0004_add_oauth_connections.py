"""add oauth connections

Revision ID: 0004_add_oauth_connections
Revises: 0003_add_auth_tokens
Create Date: 2026-05-07
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "0004_add_oauth_connections"
down_revision: str | None = "0003_add_auth_tokens"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "oauth_connections",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("provider", sa.String(length=80), nullable=False),
        sa.Column("provider_user_id", sa.String(length=255), nullable=True),
        sa.Column("account_email", sa.String(length=320), nullable=True),
        sa.Column("account_name", sa.String(length=255), nullable=True),
        sa.Column("scope", sa.Text(), nullable=True),
        sa.Column("access_token_encrypted", sa.Text(), nullable=False),
        sa.Column("refresh_token_encrypted", sa.Text(), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("connected_by_user_id", sa.String(length=36), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["connected_by_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_oauth_connections_provider", "oauth_connections", ["provider"], unique=True)
    op.create_index("ix_oauth_connections_provider_user_id", "oauth_connections", ["provider_user_id"])
    op.create_index("ix_oauth_connections_account_email", "oauth_connections", ["account_email"])
    op.create_index("ix_oauth_connections_connected_by_user_id", "oauth_connections", ["connected_by_user_id"])


def downgrade() -> None:
    op.drop_index("ix_oauth_connections_connected_by_user_id", table_name="oauth_connections")
    op.drop_index("ix_oauth_connections_account_email", table_name="oauth_connections")
    op.drop_index("ix_oauth_connections_provider_user_id", table_name="oauth_connections")
    op.drop_index("ix_oauth_connections_provider", table_name="oauth_connections")
    op.drop_table("oauth_connections")
