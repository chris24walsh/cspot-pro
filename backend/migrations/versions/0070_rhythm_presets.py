"""Shared reusable meters and strumming patterns."""

import sqlalchemy as sa
from alembic import op

revision = "0070_rhythm_presets"
down_revision = "0069_song_rhythm"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "rhythm_presets",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("kind", sa.String(12), nullable=False),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("numerator", sa.Integer(), nullable=False),
        sa.Column("denominator", sa.Integer(), nullable=False),
        sa.Column("subdivision", sa.Integer()),
        sa.Column("strokes", sa.JSON()),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.UniqueConstraint("kind", "name", name="uq_rhythm_preset_kind_name"),
    )


def downgrade() -> None:
    op.drop_table("rhythm_presets")
