"""add site content blocks

Revision ID: 0009_add_site_content_blocks
Revises: 0008_add_broadcast_recordings
Create Date: 2026-06-03
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "0009_add_site_content_blocks"
down_revision: str | None = "0008_add_broadcast_recordings"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "site_content_blocks",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("key", sa.String(length=160), nullable=False),
        sa.Column("label", sa.String(length=220), nullable=False),
        sa.Column("block_type", sa.String(length=40), nullable=False, server_default="text"),
        sa.Column("value", sa.Text(), nullable=False),
        sa.Column("draft_value", sa.Text(), nullable=True),
        sa.Column("published", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_site_content_blocks_key", "site_content_blocks", ["key"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_site_content_blocks_key", table_name="site_content_blocks")
    op.drop_table("site_content_blocks")
