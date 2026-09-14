"""Track livestream events and authenticated viewer visits.

Revision ID: 0062_livestream_viewership
Revises: 0061_archive_recordings
"""

import sqlalchemy as sa
from alembic import op

revision = "0062_livestream_viewership"
down_revision = "0061_archive_recordings"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "livestream_events",
        sa.Column("presentation_session_id", sa.String(36), nullable=True),
        sa.Column("plan_id", sa.String(36), nullable=True),
        sa.Column("title", sa.String(220), nullable=False),
        sa.Column("audience", sa.String(20), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["presentation_session_id"], ["presentation_sessions.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["plan_id"], ["plans.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("presentation_session_id"),
    )
    op.create_index("ix_livestream_events_presentation_session_id", "livestream_events", ["presentation_session_id"])
    op.create_index("ix_livestream_events_plan_id", "livestream_events", ["plan_id"])
    op.create_index("ix_livestream_events_started_at", "livestream_events", ["started_at"])
    op.create_index("ix_livestream_events_ended_at", "livestream_events", ["ended_at"])
    op.create_table(
        "livestream_viewer_visits",
        sa.Column("livestream_event_id", sa.String(36), nullable=False),
        sa.Column("user_id", sa.String(36), nullable=False),
        sa.Column("client_session_id", sa.String(80), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("duration_seconds", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["livestream_event_id"], ["livestream_events.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("livestream_event_id", "user_id", "client_session_id", name="uq_livestream_viewer_visit_client"),
    )
    op.create_index("ix_livestream_viewer_visits_livestream_event_id", "livestream_viewer_visits", ["livestream_event_id"])
    op.create_index("ix_livestream_viewer_visits_user_id", "livestream_viewer_visits", ["user_id"])
    op.create_index("ix_livestream_viewer_visits_started_at", "livestream_viewer_visits", ["started_at"])
    op.create_index("ix_livestream_viewer_visits_last_seen_at", "livestream_viewer_visits", ["last_seen_at"])


def downgrade() -> None:
    op.drop_table("livestream_viewer_visits")
    op.drop_table("livestream_events")
