"""Local XR18 connection and desk snapshots."""

from alembic import op
import sqlalchemy as sa

revision = "0072_xr18_mixer"
down_revision = "0071_four_four_strum_grids"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "mixer_configuration",
        sa.Column("id", sa.String(20), primary_key=True),
        sa.Column("host", sa.String(45), nullable=True),
        sa.Column("snapshots_json", sa.Text(), nullable=False),
    )


def downgrade():
    op.drop_table("mixer_configuration")
