"""Move content attached to outline groups into named child items.

Revision ID: 0052_nest_outline_content
Revises: 0051_group_plan_items
"""

from alembic import op


revision = "0052_nest_outline_content"
down_revision = "0051_group_plan_items"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        WITH roots AS (
            SELECT pi.*,
                   COALESCE(
                     (SELECT regexp_replace(sf.display_name, '\\.[^.]+$', '')
                      FROM item_files item_file
                      JOIN files sf ON sf.id = item_file.file_id
                      WHERE item_file.plan_item_id = pi.id
                      ORDER BY item_file.sort_order LIMIT 1),
                     pi.title
                   ) AS child_title,
                   substr(md5(pi.id || '-group-child'), 1, 8) || '-' ||
                   substr(md5(pi.id || '-group-child'), 9, 4) || '-4' ||
                   substr(md5(pi.id || '-group-child'), 14, 3) || '-8' ||
                   substr(md5(pi.id || '-group-child'), 18, 3) || '-' ||
                   substr(md5(pi.id || '-group-child'), 21, 12) AS child_id
            FROM plan_items pi
            WHERE pi.parent_item_id IS NULL
              AND pi.deleted_at IS NULL
              AND pi.item_type IN ('sermon', 'announcements')
              AND EXISTS (SELECT 1 FROM item_files f WHERE f.plan_item_id = pi.id)
        )
        INSERT INTO plan_items
            (id, plan_id, parent_item_id, song_id, item_type, sequence, title,
             planned_start, comment, key_signature, deleted_at, created_at, updated_at)
        SELECT child_id, plan_id, id, song_id, item_type, 10, child_title,
               planned_start, comment, key_signature, NULL, created_at, updated_at
        FROM roots
        ON CONFLICT (id) DO NOTHING
        """
    )
    op.execute(
        """
        WITH roots AS (
            SELECT pi.id,
                   substr(md5(pi.id || '-group-child'), 1, 8) || '-' ||
                   substr(md5(pi.id || '-group-child'), 9, 4) || '-4' ||
                   substr(md5(pi.id || '-group-child'), 14, 3) || '-8' ||
                   substr(md5(pi.id || '-group-child'), 18, 3) || '-' ||
                   substr(md5(pi.id || '-group-child'), 21, 12) AS child_id
            FROM plan_items pi
            WHERE pi.parent_item_id IS NULL
              AND pi.deleted_at IS NULL
              AND pi.item_type IN ('sermon', 'announcements')
        )
        UPDATE item_files f SET plan_item_id = roots.child_id
        FROM roots
        WHERE f.plan_item_id = roots.id
          AND EXISTS (SELECT 1 FROM plan_items child WHERE child.id = roots.child_id)
        """
    )


def downgrade() -> None:
    op.execute(
        """
        UPDATE item_files f SET plan_item_id = child.parent_item_id
        FROM plan_items child
        WHERE child.parent_item_id IS NOT NULL
          AND child.id = f.plan_item_id
          AND child.id = (
            substr(md5(child.parent_item_id || '-group-child'), 1, 8) || '-' ||
            substr(md5(child.parent_item_id || '-group-child'), 9, 4) || '-4' ||
            substr(md5(child.parent_item_id || '-group-child'), 14, 3) || '-8' ||
            substr(md5(child.parent_item_id || '-group-child'), 18, 3) || '-' ||
            substr(md5(child.parent_item_id || '-group-child'), 21, 12)
          )
        """
    )
    op.execute(
        """DELETE FROM plan_items child WHERE child.id = (
          substr(md5(child.parent_item_id || '-group-child'), 1, 8) || '-' ||
          substr(md5(child.parent_item_id || '-group-child'), 9, 4) || '-4' ||
          substr(md5(child.parent_item_id || '-group-child'), 14, 3) || '-8' ||
          substr(md5(child.parent_item_id || '-group-child'), 18, 3) || '-' ||
          substr(md5(child.parent_item_id || '-group-child'), 21, 12)
        )"""
    )
