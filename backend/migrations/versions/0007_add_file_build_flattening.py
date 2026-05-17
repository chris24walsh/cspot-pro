"""add file build flattening

Revision ID: 0007_add_file_build_flattening
Revises: 0006_add_worship_song_metadata
Create Date: 2026-05-17
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "0007_add_file_build_flattening"
down_revision: str | None = "0006_add_worship_song_metadata"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("files", sa.Column("flatten_builds", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    op.drop_column("files", "flatten_builds")
