"""Store song meter and strumming guidance independently of chord charts."""

import sqlalchemy as sa
from alembic import op

revision = "0069_song_rhythm"
down_revision = "0068_recording_visibility"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("songs", sa.Column("rhythm", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("songs", "rhythm")
