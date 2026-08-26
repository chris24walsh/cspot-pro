"""merge Sunday service transition sections

Revision ID: 0042_merge_transitions
Revises: 0041_plan_item_times
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0042_merge_transitions"
down_revision: str | None = "0041_plan_item_times"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "UPDATE plan_items SET title = 'Welcome' "
        "WHERE item_type = 'pre_service' AND title = 'Pre-service fellowship'"
    )
    op.execute(
        "DELETE FROM plan_items WHERE item_type = 'seating' AND title = 'Call to seats' "
        "AND comment IS NULL AND song_id IS NULL "
        "AND NOT EXISTS (SELECT 1 FROM item_files WHERE item_files.plan_item_id = plan_items.id)"
    )
    op.execute(
        "UPDATE plan_items SET item_type = 'community', title = 'Church Family' "
        "WHERE item_type = 'sunday_school' AND title = 'Sunday school prayer and dismissal'"
    )
    op.execute(
        "DELETE FROM plan_items WHERE item_type IN ('testimony', 'sharing') "
        "AND title = 'Testimony and congregational sharing' "
        "AND comment IS NULL AND song_id IS NULL "
        "AND NOT EXISTS (SELECT 1 FROM item_files WHERE item_files.plan_item_id = plan_items.id)"
    )
    op.execute(
        "UPDATE plan_items SET title = 'Announcements and fellowship' "
        "WHERE item_type = 'announcements' AND title = 'Announcements'"
    )
    op.execute(
        "DELETE FROM plan_items WHERE item_type = 'end' AND title = 'Dismissal and fellowship' "
        "AND comment IS NULL AND song_id IS NULL "
        "AND NOT EXISTS (SELECT 1 FROM item_files WHERE item_files.plan_item_id = plan_items.id)"
    )


def downgrade() -> None:
    op.execute(
        "UPDATE plan_items SET title = 'Pre-service fellowship' "
        "WHERE item_type = 'pre_service' AND title = 'Welcome'"
    )
    op.execute(
        "UPDATE plan_items SET item_type = 'sunday_school', "
        "title = 'Sunday school prayer and dismissal' "
        "WHERE item_type = 'community' AND title = 'Church Family'"
    )
    op.execute(
        "UPDATE plan_items SET title = 'Announcements' "
        "WHERE item_type = 'announcements' AND title = 'Announcements and fellowship'"
    )
