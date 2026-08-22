"""migrate equivalent legacy roles into serving relationships

Revision ID: 0037_migrate_roles
Revises: 0036_serving_attention
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0037_migrate_roles"
down_revision: str | None = "0036_serving_attention"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# This is deliberately a migration snapshot. Future role splits should add a
# new migration rather than changing this historical mapping.
ROLE_AREA_VALUES = """
    ('worship_leader', 'worship'),
    ('worship_team', 'worship'),
    ('author', 'worship'),
    ('editor', 'worship'),
    ('creator', 'worship'),
    ('musician', 'worship_musician'),
    ('sunday_school_teacher', 'sunday_school'),
    ('sunday_school_leader', 'sunday_school_leader'),
    ('teacher', 'service_teacher'),
    ('leader', 'service_teacher'),
    ('service_leader', 'service_teacher'),
    ('presenter', 'service_presenter')
"""


def upgrade() -> None:
    # First create missing approved relationships. Deterministic IDs make the
    # operation safe to repeat during recovery, while the unique constraint is
    # the final guard against duplicates.
    op.execute(sa.text(f"""
        WITH role_area(role_name, area_key) AS (VALUES {ROLE_AREA_VALUES}),
        assignments AS (
            SELECT DISTINCT ON (ur.user_id, sa.id)
                ur.user_id,
                sa.id AS serving_area_id,
                sa.key AS area_key,
                u.worship_max_sundays_per_month,
                u.sunday_school_max_sundays_per_month
            FROM user_roles ur
            JOIN roles r ON r.id = ur.role_id
            JOIN role_area mapping ON mapping.role_name = r.name
            JOIN serving_areas sa ON sa.key = mapping.area_key
            JOIN users u ON u.id = ur.user_id
        )
        INSERT INTO volunteer_preferences (
            id, user_id, serving_area_id, status, preferred_frequency,
            frequency_count, frequency_period, initiated_by,
            admin_attention_pending, availability_notes, admin_notes,
            reviewed_by_user_id, reviewed_at, created_at, updated_at
        )
        SELECT
            md5(user_id || ':' || serving_area_id), user_id, serving_area_id,
            'approved', 'monthly',
            CASE
                WHEN area_key = 'worship' THEN COALESCE(worship_max_sundays_per_month, 5)
                WHEN area_key = 'sunday_school'
                    THEN COALESCE(sunday_school_max_sundays_per_month, 5)
                ELSE 1
            END,
            'month', 'admin', false, NULL, NULL, NULL, CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        FROM assignments
        ON CONFLICT (user_id, serving_area_id) DO NOTHING
    """))

    # A pre-existing request for an already-assigned legacy role represents the
    # same active responsibility. Preserve its notes/frequency but normalize
    # lifecycle state so removing the old assignment cannot remove access.
    op.execute(sa.text(f"""
        WITH role_area(role_name, area_key) AS (VALUES {ROLE_AREA_VALUES})
        UPDATE volunteer_preferences preference
        SET status = 'approved', initiated_by = 'admin',
            admin_attention_pending = false,
            reviewed_at = COALESCE(preference.reviewed_at, CURRENT_TIMESTAMP),
            updated_at = CURRENT_TIMESTAMP
        WHERE EXISTS (
            SELECT 1
            FROM user_roles ur
            JOIN roles r ON r.id = ur.role_id
            JOIN role_area mapping ON mapping.role_name = r.name
            JOIN serving_areas sa ON sa.key = mapping.area_key
            WHERE ur.user_id = preference.user_id
              AND sa.id = preference.serving_area_id
        )
    """))

    # Remove only assignments whose approved replacement is present. Viewer and
    # administrator are not mapped and therefore remain direct system roles.
    op.execute(sa.text(f"""
        WITH role_area(role_name, area_key) AS (VALUES {ROLE_AREA_VALUES})
        DELETE FROM user_roles ur
        USING roles r, role_area mapping, serving_areas sa
        WHERE ur.role_id = r.id
          AND mapping.role_name = r.name
          AND sa.key = mapping.area_key
          AND EXISTS (
              SELECT 1 FROM volunteer_preferences preference
              WHERE preference.user_id = ur.user_id
                AND preference.serving_area_id = sa.id
                AND preference.status = 'approved'
          )
    """))


def downgrade() -> None:
    # Restore canonical direct assignments for approved equivalent serving
    # relationships. Preference records remain intact to avoid destroying any
    # notes or frequency changes made after the upgrade.
    canonical_values = """
        ('worship_leader', 'worship'),
        ('musician', 'worship_musician'),
        ('sunday_school_teacher', 'sunday_school'),
        ('sunday_school_leader', 'sunday_school_leader'),
        ('teacher', 'service_teacher'),
        ('presenter', 'service_presenter')
    """
    op.execute(sa.text(f"""
        WITH role_area(role_name, area_key) AS (VALUES {canonical_values})
        INSERT INTO user_roles (id, user_id, role_id, created_at, updated_at)
        SELECT md5(preference.user_id || ':' || role.id), preference.user_id,
               role.id, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        FROM volunteer_preferences preference
        JOIN serving_areas area ON area.id = preference.serving_area_id
        JOIN role_area mapping ON mapping.area_key = area.key
        JOIN roles role ON role.name = mapping.role_name
        WHERE preference.status = 'approved'
          AND NOT EXISTS (
              SELECT 1 FROM user_roles existing
              WHERE existing.user_id = preference.user_id
                AND existing.role_id = role.id
          )
    """))
