"""add auth tokens

Revision ID: 0003_add_auth_tokens
Revises: 0002_add_plan_archiving
Create Date: 2026-05-07
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "0003_add_auth_tokens"
down_revision: str | None = "0002_add_plan_archiving"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "auth_tokens",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("created_by_user_id", sa.String(length=36), nullable=True),
        sa.Column("purpose", sa.String(length=40), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("sent_to_email", sa.String(length=320), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_auth_tokens_user_id", "auth_tokens", ["user_id"])
    op.create_index("ix_auth_tokens_created_by_user_id", "auth_tokens", ["created_by_user_id"])
    op.create_index("ix_auth_tokens_purpose", "auth_tokens", ["purpose"])
    op.create_index("ix_auth_tokens_token_hash", "auth_tokens", ["token_hash"], unique=True)
    op.create_index("ix_auth_tokens_sent_to_email", "auth_tokens", ["sent_to_email"])
    op.create_index("ix_auth_tokens_expires_at", "auth_tokens", ["expires_at"])


def downgrade() -> None:
    op.drop_index("ix_auth_tokens_expires_at", table_name="auth_tokens")
    op.drop_index("ix_auth_tokens_sent_to_email", table_name="auth_tokens")
    op.drop_index("ix_auth_tokens_token_hash", table_name="auth_tokens")
    op.drop_index("ix_auth_tokens_purpose", table_name="auth_tokens")
    op.drop_index("ix_auth_tokens_created_by_user_id", table_name="auth_tokens")
    op.drop_index("ix_auth_tokens_user_id", table_name="auth_tokens")
    op.drop_table("auth_tokens")
