"""add volunteer serving profiles"""

from collections.abc import Sequence
from uuid import uuid4

import sqlalchemy as sa
from alembic import op

revision: str = "0032_volunteer_serving"
down_revision: str | None = "0031_remove_empty_ends"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _timestamps() -> list[sa.Column]:
    return [
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    ]


def upgrade() -> None:
    op.create_table(
        "serving_areas",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("key", sa.String(80), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("category", sa.String(80), nullable=False),
        sa.Column("description", sa.String(500)),
        sa.Column("active", sa.Boolean(), server_default=sa.true(), nullable=False),
        *_timestamps(),
    )
    op.create_index("ix_serving_areas_key", "serving_areas", ["key"], unique=True)
    op.create_index("ix_serving_areas_category", "serving_areas", ["category"])
    op.create_table(
        "volunteer_preferences",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column(
            "serving_area_id",
            sa.String(36),
            sa.ForeignKey("serving_areas.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("status", sa.String(24), server_default="pending", nullable=False),
        sa.Column("preferred_frequency", sa.String(24), server_default="monthly", nullable=False),
        sa.Column("availability_notes", sa.Text()),
        sa.Column("admin_notes", sa.Text()),
        sa.Column("reviewed_by_user_id", sa.String(36), sa.ForeignKey("users.id")),
        sa.Column("reviewed_at", sa.DateTime(timezone=True)),
        *_timestamps(),
        sa.UniqueConstraint("user_id", "serving_area_id", name="uq_volunteer_user_area"),
    )
    for column in ("user_id", "serving_area_id", "status", "reviewed_by_user_id"):
        op.create_index(f"ix_volunteer_preferences_{column}", "volunteer_preferences", [column])
    op.create_table(
        "volunteer_unavailability",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("starts_on", sa.Date(), nullable=False),
        sa.Column("ends_on", sa.Date(), nullable=False),
        sa.Column("note", sa.String(300)),
        *_timestamps(),
    )
    for column in ("user_id", "starts_on", "ends_on"):
        op.create_index(
            f"ix_volunteer_unavailability_{column}", "volunteer_unavailability", [column]
        )
    areas = [
        ("worship", "Worship leading", "Services", "Lead sung worship and prepare sets."),
        ("sunday_school", "Sunday School", "Services", "Teach or assist with children’s lessons."),
        ("welcome", "Welcome team", "Services", "Welcome people and help them find their way."),
        (
            "sound_av",
            "Sound & AV",
            "Services",
            "Support sound, projection, recording, or streaming.",
        ),
        ("cleaning", "Cleaning", "Care", "Help keep shared spaces clean and ready."),
        ("cooking", "Cooking & hospitality", "Care", "Prepare food and refreshments."),
        ("maintenance", "Maintenance", "Property", "Help with repairs and practical upkeep."),
        ("grounds", "Grounds", "Property", "Help maintain outdoor areas."),
    ]
    table = sa.table(
        "serving_areas",
        sa.column("id"),
        sa.column("key"),
        sa.column("name"),
        sa.column("category"),
        sa.column("description"),
        sa.column("active"),
    )
    op.bulk_insert(
        table,
        [
            {
                "id": str(uuid4()),
                "key": key,
                "name": name,
                "category": category,
                "description": description,
                "active": True,
            }
            for key, name, category, description in areas
        ],
    )


def downgrade() -> None:
    op.drop_table("volunteer_unavailability")
    op.drop_table("volunteer_preferences")
    op.drop_table("serving_areas")
