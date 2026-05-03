"""initial domain schema

Revision ID: 0001_initial_domain
Revises:
Create Date: 2026-05-02
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "0001_initial_domain"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def id_column() -> sa.Column[str]:
    return sa.Column("id", sa.String(length=36), primary_key=True)


def timestamps() -> list[sa.Column]:
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    ]


def upgrade() -> None:
    op.create_table(
        "users",
        id_column(),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=True),
        sa.Column("start_page", sa.String(length=255), nullable=True),
        sa.Column("email_confirmed", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        *timestamps(),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)

    op.create_table(
        "roles",
        id_column(),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("description", sa.String(length=500), nullable=True),
        sa.Column("system_role", sa.Boolean(), nullable=False, server_default=sa.false()),
        *timestamps(),
    )
    op.create_index("ix_roles_name", "roles", ["name"], unique=True)

    op.create_table(
        "user_roles",
        id_column(),
        sa.Column("user_id", sa.String(length=36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("role_id", sa.String(length=36), sa.ForeignKey("roles.id", ondelete="CASCADE"), nullable=False),
        *timestamps(),
    )
    op.create_index("ix_user_roles_user_id", "user_roles", ["user_id"])
    op.create_index("ix_user_roles_role_id", "user_roles", ["role_id"])

    op.create_table(
        "social_logins",
        id_column(),
        sa.Column("user_id", sa.String(length=36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("provider", sa.String(length=80), nullable=False),
        sa.Column("provider_user_id", sa.String(length=255), nullable=False),
        *timestamps(),
    )
    op.create_index("ix_social_logins_user_id", "social_logins", ["user_id"])
    op.create_index("ix_social_logins_provider", "social_logins", ["provider"])
    op.create_index("ix_social_logins_provider_user_id", "social_logins", ["provider_user_id"])

    op.create_table(
        "plan_types",
        id_column(),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("description", sa.String(length=500), nullable=True),
        sa.Column("starts_at", sa.String(length=20), nullable=True),
        sa.Column("default_duration_minutes", sa.Integer(), nullable=True),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        *timestamps(),
    )
    op.create_index("ix_plan_types_name", "plan_types", ["name"], unique=True)

    op.create_table(
        "songs",
        id_column(),
        sa.Column("title", sa.String(length=220), nullable=False),
        sa.Column("alternate_title", sa.String(length=220), nullable=True),
        sa.Column("author", sa.String(length=220), nullable=True),
        sa.Column("lyrics", sa.Text(), nullable=True),
        sa.Column("chords", sa.Text(), nullable=True),
        sa.Column("ccli_number", sa.String(length=80), nullable=True),
        sa.Column("book_reference", sa.String(length=220), nullable=True),
        sa.Column("license", sa.String(length=80), nullable=True),
        sa.Column("sequence", sa.String(length=120), nullable=True),
        sa.Column("youtube_id", sa.String(length=80), nullable=True),
        sa.Column("external_link", sa.String(length=500), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        *timestamps(),
    )
    op.create_index("ix_songs_title", "songs", ["title"])
    op.create_index("ix_songs_alternate_title", "songs", ["alternate_title"])
    op.create_index("ix_songs_ccli_number", "songs", ["ccli_number"])

    op.create_table(
        "plans",
        id_column(),
        sa.Column("plan_type_id", sa.String(length=36), sa.ForeignKey("plan_types.id"), nullable=False),
        sa.Column("service_date", sa.DateTime(timezone=True), nullable=False),
        sa.Column("title", sa.String(length=180), nullable=False),
        sa.Column("subtitle", sa.String(length=180), nullable=True),
        sa.Column("leader_id", sa.String(length=36), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("teacher_id", sa.String(length=36), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("status", sa.String(length=40), nullable=False, server_default="draft"),
        sa.Column("info", sa.Text(), nullable=True),
        *timestamps(),
    )
    op.create_index("ix_plans_plan_type_id", "plans", ["plan_type_id"])
    op.create_index("ix_plans_service_date", "plans", ["service_date"])
    op.create_index("ix_plans_leader_id", "plans", ["leader_id"])
    op.create_index("ix_plans_teacher_id", "plans", ["teacher_id"])

    op.create_table(
        "plan_items",
        id_column(),
        sa.Column("plan_id", sa.String(length=36), sa.ForeignKey("plans.id", ondelete="CASCADE"), nullable=False),
        sa.Column("song_id", sa.String(length=36), sa.ForeignKey("songs.id"), nullable=True),
        sa.Column("item_type", sa.String(length=80), nullable=False, server_default="custom"),
        sa.Column("sequence", sa.Numeric(8, 2), nullable=False),
        sa.Column("title", sa.String(length=180), nullable=False),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("key_signature", sa.String(length=20), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        *timestamps(),
    )
    op.create_index("ix_plan_items_plan_id", "plan_items", ["plan_id"])
    op.create_index("ix_plan_items_song_id", "plan_items", ["song_id"])

    op.create_table(
        "song_parts",
        id_column(),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("abbreviation", sa.String(length=20), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        *timestamps(),
    )
    op.create_index("ix_song_parts_name", "song_parts", ["name"], unique=True)
    op.create_index("ix_song_parts_abbreviation", "song_parts", ["abbreviation"], unique=True)

    op.create_table(
        "onsong_sections",
        id_column(),
        sa.Column("song_id", sa.String(length=36), sa.ForeignKey("songs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("song_part_id", sa.String(length=36), sa.ForeignKey("song_parts.id"), nullable=True),
        sa.Column("section_label", sa.String(length=80), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        *timestamps(),
    )
    op.create_index("ix_onsong_sections_song_id", "onsong_sections", ["song_id"])
    op.create_index("ix_onsong_sections_song_part_id", "onsong_sections", ["song_part_id"])

    op.create_table(
        "default_items",
        id_column(),
        sa.Column("plan_type_id", sa.String(length=36), sa.ForeignKey("plan_types.id"), nullable=False),
        sa.Column("item_type", sa.String(length=80), nullable=False, server_default="custom"),
        sa.Column("sequence", sa.Numeric(8, 2), nullable=False),
        sa.Column("title", sa.String(length=180), nullable=False),
        sa.Column("comment", sa.Text(), nullable=True),
        *timestamps(),
    )
    op.create_index("ix_default_items_plan_type_id", "default_items", ["plan_type_id"])

    op.create_table(
        "plan_notes",
        id_column(),
        sa.Column("plan_id", sa.String(length=36), sa.ForeignKey("plans.id", ondelete="CASCADE"), nullable=False),
        sa.Column("author_id", sa.String(length=36), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        *timestamps(),
    )
    op.create_index("ix_plan_notes_plan_id", "plan_notes", ["plan_id"])
    op.create_index("ix_plan_notes_author_id", "plan_notes", ["author_id"])

    op.create_table(
        "item_notes",
        id_column(),
        sa.Column("plan_item_id", sa.String(length=36), sa.ForeignKey("plan_items.id", ondelete="CASCADE"), nullable=False),
        sa.Column("author_id", sa.String(length=36), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("body", sa.Text(), nullable=False),
        *timestamps(),
    )
    op.create_index("ix_item_notes_plan_item_id", "item_notes", ["plan_item_id"])
    op.create_index("ix_item_notes_author_id", "item_notes", ["author_id"])

    op.create_table(
        "plan_caches",
        id_column(),
        sa.Column("plan_id", sa.String(length=36), sa.ForeignKey("plans.id", ondelete="CASCADE"), nullable=False),
        sa.Column("cache_kind", sa.String(length=80), nullable=False),
        sa.Column("payload_json", sa.Text(), nullable=False),
        *timestamps(),
    )
    op.create_index("ix_plan_caches_plan_id", "plan_caches", ["plan_id"])

    op.create_table(
        "history_entries",
        id_column(),
        sa.Column("actor_id", sa.String(length=36), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("entity_type", sa.String(length=80), nullable=False),
        sa.Column("entity_id", sa.String(length=36), nullable=False),
        sa.Column("action", sa.String(length=80), nullable=False),
        sa.Column("details", sa.Text(), nullable=True),
        *timestamps(),
    )
    op.create_index("ix_history_entries_actor_id", "history_entries", ["actor_id"])
    op.create_index("ix_history_entries_entity_type", "history_entries", ["entity_type"])
    op.create_index("ix_history_entries_entity_id", "history_entries", ["entity_id"])

    op.create_table(
        "instruments",
        id_column(),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        *timestamps(),
    )
    op.create_index("ix_instruments_name", "instruments", ["name"], unique=True)

    op.create_table(
        "user_instruments",
        id_column(),
        sa.Column("user_id", sa.String(length=36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("instrument_id", sa.String(length=36), sa.ForeignKey("instruments.id", ondelete="CASCADE"), nullable=False),
        *timestamps(),
    )
    op.create_index("ix_user_instruments_user_id", "user_instruments", ["user_id"])
    op.create_index("ix_user_instruments_instrument_id", "user_instruments", ["instrument_id"])

    op.create_table(
        "team_assignments",
        id_column(),
        sa.Column("plan_id", sa.String(length=36), sa.ForeignKey("plans.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.String(length=36), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("role_label", sa.String(length=120), nullable=False),
        sa.Column("instrument_id", sa.String(length=36), sa.ForeignKey("instruments.id"), nullable=True),
        sa.Column("status", sa.String(length=60), nullable=False, server_default="invited"),
        sa.Column("confirmation_token", sa.String(length=120), nullable=True),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        *timestamps(),
    )
    op.create_index("ix_team_assignments_plan_id", "team_assignments", ["plan_id"])
    op.create_index("ix_team_assignments_user_id", "team_assignments", ["user_id"])
    op.create_index("ix_team_assignments_instrument_id", "team_assignments", ["instrument_id"])
    op.create_index("ix_team_assignments_confirmation_token", "team_assignments", ["confirmation_token"])

    op.create_table(
        "resources",
        id_column(),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("resource_type", sa.String(length=80), nullable=True),
        *timestamps(),
    )
    op.create_index("ix_resources_name", "resources", ["name"], unique=True)

    op.create_table(
        "plan_resources",
        id_column(),
        sa.Column("plan_id", sa.String(length=36), sa.ForeignKey("plans.id", ondelete="CASCADE"), nullable=False),
        sa.Column("resource_id", sa.String(length=36), sa.ForeignKey("resources.id"), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        *timestamps(),
    )
    op.create_index("ix_plan_resources_plan_id", "plan_resources", ["plan_id"])
    op.create_index("ix_plan_resources_resource_id", "plan_resources", ["resource_id"])

    op.create_table(
        "file_categories",
        id_column(),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        *timestamps(),
    )
    op.create_index("ix_file_categories_name", "file_categories", ["name"], unique=True)

    op.create_table(
        "files",
        id_column(),
        sa.Column("category_id", sa.String(length=36), sa.ForeignKey("file_categories.id"), nullable=True),
        sa.Column("song_id", sa.String(length=36), sa.ForeignKey("songs.id"), nullable=True),
        sa.Column("uploaded_by_id", sa.String(length=36), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("display_name", sa.String(length=220), nullable=False),
        sa.Column("storage_path", sa.String(length=1000), nullable=False),
        sa.Column("content_type", sa.String(length=160), nullable=True),
        sa.Column("checksum", sa.String(length=128), nullable=True),
        *timestamps(),
    )
    op.create_index("ix_files_category_id", "files", ["category_id"])
    op.create_index("ix_files_song_id", "files", ["song_id"])
    op.create_index("ix_files_uploaded_by_id", "files", ["uploaded_by_id"])

    op.create_table(
        "item_files",
        id_column(),
        sa.Column("plan_item_id", sa.String(length=36), sa.ForeignKey("plan_items.id", ondelete="CASCADE"), nullable=False),
        sa.Column("file_id", sa.String(length=36), sa.ForeignKey("files.id", ondelete="CASCADE"), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        *timestamps(),
    )
    op.create_index("ix_item_files_plan_item_id", "item_files", ["plan_item_id"])
    op.create_index("ix_item_files_file_id", "item_files", ["file_id"])

    op.create_table(
        "bible_versions",
        id_column(),
        sa.Column("code", sa.String(length=40), nullable=False),
        sa.Column("name", sa.String(length=180), nullable=False),
        sa.Column("language", sa.String(length=80), nullable=True),
        sa.Column("license", sa.String(length=120), nullable=True),
        *timestamps(),
    )
    op.create_index("ix_bible_versions_code", "bible_versions", ["code"], unique=True)

    op.create_table(
        "bible_books",
        id_column(),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("abbreviation", sa.String(length=20), nullable=False),
        sa.Column("testament", sa.String(length=20), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        *timestamps(),
    )
    op.create_index("ix_bible_books_name", "bible_books", ["name"])
    op.create_index("ix_bible_books_abbreviation", "bible_books", ["abbreviation"])

    op.create_table(
        "bible_verses",
        id_column(),
        sa.Column("version_id", sa.String(length=36), sa.ForeignKey("bible_versions.id"), nullable=False),
        sa.Column("book_id", sa.String(length=36), sa.ForeignKey("bible_books.id"), nullable=False),
        sa.Column("chapter", sa.Integer(), nullable=False),
        sa.Column("verse", sa.Integer(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        *timestamps(),
    )
    op.create_index("ix_bible_verses_version_id", "bible_verses", ["version_id"])
    op.create_index("ix_bible_verses_book_id", "bible_verses", ["book_id"])
    op.create_index("ix_bible_verses_chapter", "bible_verses", ["chapter"])
    op.create_index("ix_bible_verses_verse", "bible_verses", ["verse"])

    op.create_table(
        "presentation_sessions",
        id_column(),
        sa.Column("plan_id", sa.String(length=36), sa.ForeignKey("plans.id", ondelete="CASCADE"), nullable=False),
        sa.Column("presenter_id", sa.String(length=36), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("status", sa.String(length=60), nullable=False, server_default="ready"),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        *timestamps(),
    )
    op.create_index("ix_presentation_sessions_plan_id", "presentation_sessions", ["plan_id"])
    op.create_index("ix_presentation_sessions_presenter_id", "presentation_sessions", ["presenter_id"])

    op.create_table(
        "presentation_positions",
        id_column(),
        sa.Column("session_id", sa.String(length=36), sa.ForeignKey("presentation_sessions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("plan_item_id", sa.String(length=36), sa.ForeignKey("plan_items.id"), nullable=True),
        sa.Column("slide_index", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("payload_json", sa.Text(), nullable=True),
        *timestamps(),
    )
    op.create_index("ix_presentation_positions_session_id", "presentation_positions", ["session_id"])
    op.create_index("ix_presentation_positions_plan_item_id", "presentation_positions", ["plan_item_id"])

    op.create_table(
        "message_threads",
        id_column(),
        sa.Column("subject", sa.String(length=220), nullable=False),
        sa.Column("creator_id", sa.String(length=36), sa.ForeignKey("users.id"), nullable=True),
        *timestamps(),
    )
    op.create_index("ix_message_threads_creator_id", "message_threads", ["creator_id"])

    op.create_table(
        "message_participants",
        id_column(),
        sa.Column("thread_id", sa.String(length=36), sa.ForeignKey("message_threads.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.String(length=36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("last_read_at", sa.DateTime(timezone=True), nullable=True),
        *timestamps(),
    )
    op.create_index("ix_message_participants_thread_id", "message_participants", ["thread_id"])
    op.create_index("ix_message_participants_user_id", "message_participants", ["user_id"])

    op.create_table(
        "messages",
        id_column(),
        sa.Column("thread_id", sa.String(length=36), sa.ForeignKey("message_threads.id", ondelete="CASCADE"), nullable=False),
        sa.Column("sender_id", sa.String(length=36), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("body", sa.Text(), nullable=False),
        *timestamps(),
    )
    op.create_index("ix_messages_thread_id", "messages", ["thread_id"])
    op.create_index("ix_messages_sender_id", "messages", ["sender_id"])

    op.create_table(
        "import_providers",
        id_column(),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("display_name", sa.String(length=160), nullable=False),
        sa.Column("provider_type", sa.String(length=80), nullable=False, server_default="manual"),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("notes", sa.Text(), nullable=True),
        *timestamps(),
    )
    op.create_index("ix_import_providers_name", "import_providers", ["name"], unique=True)

    op.create_table(
        "import_runs",
        id_column(),
        sa.Column("provider_name", sa.String(length=120), nullable=False),
        sa.Column("source_url", sa.String(length=1000), nullable=True),
        sa.Column("status", sa.String(length=80), nullable=False, server_default="draft"),
        sa.Column("raw_text", sa.Text(), nullable=True),
        sa.Column("normalized_text", sa.Text(), nullable=True),
        sa.Column("review_notes", sa.Text(), nullable=True),
        *timestamps(),
    )
    op.create_index("ix_import_runs_provider_name", "import_runs", ["provider_name"])

    op.create_table(
        "lyrics_imports",
        id_column(),
        sa.Column("song_id", sa.String(length=36), sa.ForeignKey("songs.id"), nullable=True),
        sa.Column("provider", sa.String(length=120), nullable=False),
        sa.Column("source_url", sa.String(length=1000), nullable=True),
        sa.Column("source_label", sa.String(length=220), nullable=True),
        sa.Column("status", sa.String(length=80), nullable=False, server_default="draft"),
        sa.Column("confidence", sa.String(length=40), nullable=True),
        sa.Column("imported_text", sa.Text(), nullable=True),
        *timestamps(),
    )
    op.create_index("ix_lyrics_imports_song_id", "lyrics_imports", ["song_id"])
    op.create_index("ix_lyrics_imports_provider", "lyrics_imports", ["provider"])


def downgrade() -> None:
    for table_name in [
        "lyrics_imports",
        "import_runs",
        "import_providers",
        "messages",
        "message_participants",
        "message_threads",
        "presentation_positions",
        "presentation_sessions",
        "bible_verses",
        "bible_books",
        "bible_versions",
        "item_files",
        "files",
        "file_categories",
        "plan_resources",
        "resources",
        "team_assignments",
        "user_instruments",
        "instruments",
        "history_entries",
        "plan_caches",
        "item_notes",
        "plan_notes",
        "default_items",
        "onsong_sections",
        "song_parts",
        "plan_items",
        "plans",
        "songs",
        "plan_types",
        "social_logins",
        "user_roles",
        "roles",
        "users",
    ]:
        op.drop_table(table_name)
