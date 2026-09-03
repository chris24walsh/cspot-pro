"""Store nested template cues and template automation start.

Revision ID: 0057_template_cues_and_scenes
Revises: 0056_item_presentation_options
"""

import sqlalchemy as sa
from alembic import op

revision = "0057_template_cues_and_scenes"
down_revision = "0056_item_presentation_options"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("plan_types", sa.Column("automation_start", sa.String(5), nullable=True))
    op.add_column("default_items", sa.Column("parent_item_id", sa.String(), nullable=True))
    op.add_column("default_items", sa.Column("presentation_options", sa.JSON(), nullable=False, server_default=sa.text("'{}'")))
    op.create_foreign_key("fk_default_items_parent", "default_items", "default_items", ["parent_item_id"], ["id"], ondelete="CASCADE")
    op.create_index("ix_default_items_parent_item_id", "default_items", ["parent_item_id"])
    op.execute("UPDATE plan_types SET automation_start = '10:30' WHERE name = 'Sunday Service'")
    op.execute("UPDATE plan_types SET automation_start = starts_at WHERE automation_start IS NULL")
    welcome_children = (
        ("c0a00000-0000-4000-8000-000000000011", "welcome_montage", "Welcome montage", 10, '{"dwell_seconds":12,"auto_advance":true,"auto_advance_seconds":1500,"overlay_mode":"countdown","overlay_countdown_seconds":1800,"overlay_text":"Service begins in","audio_scene_id":"pre_service","display_targets":["church","livestream"]}'),
        ("c0a00000-0000-4000-8000-000000000012", "welcome_countdown", "Service countdown", 20, '{"dwell_seconds":12,"auto_advance":true,"auto_advance_seconds":300,"overlay_mode":"countdown","overlay_countdown_seconds":300,"overlay_text":"Service begins in","audio_scene_id":"pre_service","display_targets":["church","livestream"]}'),
        ("c0a00000-0000-4000-8000-000000000013", "welcome_seated", "Please be seated", 30, '{"auto_advance":false,"audio_scene_id":"pastor","display_targets":["church","livestream"]}'),
    )
    for item_id, item_type, title, sequence, options in welcome_children:
        op.execute(sa.text("""
            INSERT INTO default_items (id, plan_type_id, parent_item_id, item_type, sequence, title, comment, presentation_options, created_at, updated_at)
            SELECT :id, root.plan_type_id, root.id, :item_type, :sequence, :title, NULL, CAST(:options AS JSON), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            FROM default_items root JOIN plan_types pt ON pt.id = root.plan_type_id
            WHERE pt.name = 'Sunday Service' AND root.item_type = 'pre_service'
              AND NOT EXISTS (SELECT 1 FROM default_items child WHERE child.parent_item_id = root.id AND child.item_type = :item_type)
        """).bindparams(id=item_id, item_type=item_type, sequence=sequence, title=title, options=options))
        op.execute(sa.text("UPDATE plan_items SET presentation_options = CAST(:options AS JSON) WHERE item_type = :item_type AND (presentation_options IS NULL OR CAST(presentation_options AS VARCHAR) = '{}')").bindparams(options=options, item_type=item_type))
    op.execute("""
        INSERT INTO default_items (id, plan_type_id, item_type, sequence, title, comment, presentation_options, created_at, updated_at)
        SELECT 'c0a00000-0000-4000-8000-000000000014', id, 'post_service', 60, 'Post-service', NULL, '{}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        FROM plan_types WHERE name = 'Sunday Service'
          AND NOT EXISTS (SELECT 1 FROM default_items WHERE plan_type_id = plan_types.id AND item_type = 'post_service')
    """)
    op.execute(sa.text("""
        INSERT INTO default_items (id, plan_type_id, parent_item_id, item_type, sequence, title, comment, presentation_options, created_at, updated_at)
        SELECT 'c0a00000-0000-4000-8000-000000000015', root.plan_type_id, root.id, 'open_time', 10, 'Post-service montage', NULL,
               CAST(:options AS JSON), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        FROM default_items root JOIN plan_types pt ON pt.id = root.plan_type_id
        WHERE pt.name = 'Sunday Service' AND root.item_type = 'post_service'
          AND NOT EXISTS (SELECT 1 FROM default_items child WHERE child.parent_item_id = root.id)
    """).bindparams(options='{"dwell_seconds":12,"auto_advance":false,"repeat":true,"audio_scene_id":"post_service","display_targets":["church","livestream"]}'))


def downgrade() -> None:
    op.execute("DELETE FROM default_items WHERE id IN ('c0a00000-0000-4000-8000-000000000011','c0a00000-0000-4000-8000-000000000012','c0a00000-0000-4000-8000-000000000013','c0a00000-0000-4000-8000-000000000015','c0a00000-0000-4000-8000-000000000014')")
    op.drop_index("ix_default_items_parent_item_id", table_name="default_items")
    op.drop_constraint("fk_default_items_parent", "default_items", type_="foreignkey")
    op.drop_column("default_items", "presentation_options")
    op.drop_column("default_items", "parent_item_id")
    op.drop_column("plan_types", "automation_start")
