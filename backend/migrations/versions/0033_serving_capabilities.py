"""group serving capabilities by ministry"""

from collections.abc import Sequence
from uuid import uuid4

import sqlalchemy as sa
from alembic import op

revision: str = "0033_serving_capabilities"
down_revision: str | None = "0032_volunteer_serving"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        sa.text(
            "UPDATE serving_areas SET category = 'Worship & Production' WHERE key IN ('worship', 'sound_av')"
        )
    )
    op.execute(
        sa.text(
            "UPDATE serving_areas SET name = 'Sound, projection & livestream', description = 'Operate sound, projection, recording, or livestream cameras.' WHERE key = 'sound_av'"
        )
    )
    op.execute(
        sa.text("UPDATE serving_areas SET category = 'Sunday School' WHERE key = 'sunday_school'")
    )
    op.execute(
        sa.text(
            "UPDATE serving_areas SET category = 'Hospitality & Care' WHERE key IN ('welcome', 'cooking')"
        )
    )
    op.execute(
        sa.text(
            "UPDATE serving_areas SET category = 'Property & Facilities' WHERE key IN ('cleaning', 'maintenance', 'grounds')"
        )
    )
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
                "key": "worship_musician",
                "name": "Musician",
                "category": "Worship & Production",
                "description": "Play or sing as part of the worship team.",
                "active": True,
            },
            {
                "id": str(uuid4()),
                "key": "worship_equipment_care",
                "name": "Music & AV equipment care",
                "category": "Worship & Production",
                "description": "Maintain instruments, strings, microphones, cables, and production equipment.",
                "active": True,
            },
            {
                "id": str(uuid4()),
                "key": "sunday_school_leader",
                "name": "Sunday School leader",
                "category": "Sunday School",
                "description": "Coordinate lessons, resources, and the teaching rota.",
                "active": True,
            },
            {
                "id": str(uuid4()),
                "key": "service_teacher",
                "name": "Service teacher",
                "category": "Service",
                "description": "Prepare teaching content and sermon material.",
                "active": True,
            },
            {
                "id": str(uuid4()),
                "key": "service_presenter",
                "name": "Service presenter",
                "category": "Service",
                "description": "Prepare and operate the complete live service flow.",
                "active": True,
            },
        ],
    )


def downgrade() -> None:
    op.execute(
        sa.text(
            "DELETE FROM serving_areas WHERE key IN ('worship_musician', 'worship_equipment_care', 'sunday_school_leader', 'service_teacher', 'service_presenter')"
        )
    )
    op.execute(
        sa.text(
            "UPDATE serving_areas SET category = 'Services' WHERE key IN ('worship', 'sunday_school', 'sound_av', 'welcome', 'cleaning', 'cooking', 'maintenance', 'grounds')"
        )
    )
    op.execute(
        sa.text(
            "UPDATE serving_areas SET name = 'Sound & AV', description = 'Support sound, projection, recording, or streaming.' WHERE key = 'sound_av'"
        )
    )
