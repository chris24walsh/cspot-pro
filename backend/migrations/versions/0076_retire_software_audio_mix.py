"""Retire software mixing and retain an unambiguous desk program feed."""

import json

import sqlalchemy as sa
from alembic import op

revision = "0076_retire_software_audio_mix"
down_revision = "0075_mixer_scene_automation"
branch_labels = None
depends_on = None


def upgrade():
    connection = op.get_bind()
    rows = connection.execute(
        sa.text(
            "SELECT id, live_audio_source, mixer_program_source_id, audio_sources_json "
            "FROM broadcast_viewer_settings"
        )
    ).mappings()
    for row in rows:
        sources = json.loads(row["audio_sources_json"] or "[]")
        program = row["mixer_program_source_id"]
        selected = row["live_audio_source"]
        if not program and selected == "mix":
            desks = [source for source in sources if source.get("role") == "desk"]
            if len(desks) == 1:
                program = desks[0]["id"]
                selected = program
            else:
                # Never guess between unrelated feeds. Require operator selection.
                selected = "none"
        connection.execute(
            sa.text(
                "UPDATE broadcast_viewer_settings SET audio_mix_mode = 'mixer', "
                "mixer_program_source_id = :program, live_audio_source = :selected WHERE id = :id"
            ),
            {"id": row["id"], "program": program, "selected": selected},
        )


def downgrade():
    # Archived software source gains/scenes remain in their original JSON columns.
    op.execute("UPDATE broadcast_viewer_settings SET audio_mix_mode = 'software'")
