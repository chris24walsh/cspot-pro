"""add worship song metadata

Revision ID: 0006_add_worship_song_metadata
Revises: 0005_add_worship_set_plan_type
Create Date: 2026-05-14
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "0006_add_worship_song_metadata"
down_revision: str | None = "0005_add_worship_set_plan_type"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("songs", sa.Column("worship_role", sa.String(length=40), nullable=True))
    op.add_column("songs", sa.Column("energy", sa.Integer(), nullable=True))
    op.add_column("songs", sa.Column("tempo", sa.String(length=40), nullable=True))
    op.add_column("songs", sa.Column("theme_tags", sa.String(length=500), nullable=True))
    op.create_index("ix_songs_worship_role", "songs", ["worship_role"])


def downgrade() -> None:
    op.drop_index("ix_songs_worship_role", table_name="songs")
    op.drop_column("songs", "theme_tags")
    op.drop_column("songs", "tempo")
    op.drop_column("songs", "energy")
    op.drop_column("songs", "worship_role")
