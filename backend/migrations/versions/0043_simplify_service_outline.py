"""simplify the Sunday service outline

Revision ID: 0043_simplify_outline
Revises: 0042_merge_transitions
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0043_simplify_outline"
down_revision: str | None = "0042_merge_transitions"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "DELETE FROM plan_items WHERE item_type = 'welcome' "
        "AND title = 'Welcome, opening word and prayer' "
        "AND comment IS NULL AND song_id IS NULL "
        "AND NOT EXISTS (SELECT 1 FROM item_files WHERE item_files.plan_item_id = plan_items.id)"
    )
    op.execute(
        "UPDATE plan_items SET item_type = 'open_time', title = 'Open time' "
        "WHERE item_type = 'community' AND title = 'Church Family'"
    )
    op.execute(
        "UPDATE plan_items SET title = 'Sermon' "
        "WHERE item_type = 'sermon' AND title = 'Sermon / message'"
    )
    op.execute(
        "UPDATE item_files SET sort_order = sort_order + 100, plan_item_id = ("
        "SELECT target.id FROM plan_items AS source "
        "JOIN plan_items AS target ON target.plan_id = source.plan_id "
        "WHERE source.id = item_files.plan_item_id "
        "AND source.item_type = 'sermon' "
        "AND source.comment LIKE 'Imported from Google Drive:%' "
        "AND target.item_type = 'sermon' AND target.title = 'Sermon' "
        "AND target.comment IS NULL AND target.deleted_at IS NULL "
        "ORDER BY target.created_at LIMIT 1"
        ") WHERE EXISTS ("
        "SELECT 1 FROM plan_items AS source "
        "JOIN plan_items AS target ON target.plan_id = source.plan_id "
        "WHERE source.id = item_files.plan_item_id "
        "AND source.item_type = 'sermon' "
        "AND source.comment LIKE 'Imported from Google Drive:%' "
        "AND target.item_type = 'sermon' AND target.title = 'Sermon' "
        "AND target.comment IS NULL AND target.deleted_at IS NULL"
        ")"
    )
    op.execute(
        "UPDATE plan_items AS source SET deleted_at = CURRENT_TIMESTAMP "
        "WHERE source.item_type = 'sermon' "
        "AND source.comment LIKE 'Imported from Google Drive:%' "
        "AND source.deleted_at IS NULL "
        "AND NOT EXISTS (SELECT 1 FROM item_files WHERE item_files.plan_item_id = source.id) "
        "AND EXISTS (SELECT 1 FROM plan_items AS target "
        "WHERE target.plan_id = source.plan_id AND target.id != source.id "
        "AND target.item_type = 'sermon' AND target.title = 'Sermon' "
        "AND target.comment IS NULL AND target.deleted_at IS NULL)"
    )
    op.execute(
        "DELETE FROM plan_items WHERE item_type = 'response' "
        "AND title = 'Response, closing song or prayer' "
        "AND comment IS NULL AND song_id IS NULL "
        "AND NOT EXISTS (SELECT 1 FROM item_files WHERE item_files.plan_item_id = plan_items.id)"
    )
    op.execute(
        "UPDATE plan_items SET title = 'Announcements' "
        "WHERE item_type = 'announcements' AND title = 'Announcements and fellowship'"
    )
    op.execute(
        "UPDATE plan_items SET planned_start = NULL WHERE plan_id IN ("
        "SELECT plans.id FROM plans JOIN plan_types ON plan_types.id = plans.plan_type_id "
        "WHERE plan_types.name = 'Sunday Service'"
        ")"
    )


def downgrade() -> None:
    op.execute(
        "UPDATE plan_items SET item_type = 'community', title = 'Church Family' "
        "WHERE item_type = 'open_time' AND title = 'Open time'"
    )
    op.execute(
        "UPDATE plan_items SET title = 'Sermon / message' "
        "WHERE item_type = 'sermon' AND title = 'Sermon'"
    )
    op.execute(
        "UPDATE plan_items SET title = 'Announcements and fellowship' "
        "WHERE item_type = 'announcements' AND title = 'Announcements'"
    )
