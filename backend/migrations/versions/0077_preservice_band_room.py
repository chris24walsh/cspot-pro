"""Open mapped band channels in the room, excluding them from pre-service stream sends."""

import json

import sqlalchemy as sa
from alembic import op

revision = "0077_preservice_band_room"
down_revision = "0076_retire_software_audio_mix"
branch_labels = None
depends_on = None


def upgrade():
    connection = op.get_bind()
    rows = connection.execute(
        sa.text("SELECT id, automation_json FROM mixer_configuration")
    ).mappings()
    for row in rows:
        if not row["automation_json"]:
            continue
        cfg = json.loads(row["automation_json"])
        scenes = {scene["id"]: scene for scene in cfg.get("scenes", [])}
        pre = scenes.get("pre_service")
        if pre is None:
            continue
        worship = scenes.get("worship", {}).get("channels", {})
        for strip, role in cfg.get("roles", {}).items():
            if role != "worship":
                continue
            channel = pre.setdefault("channels", {}).setdefault(strip, {})
            room = channel.setdefault("room", {})
            if room is None:
                room = channel["room"] = {}
            room["enabled"] = True
            room["level_db"] = (worship.get(strip, {}).get("room") or {}).get(
                "level_db", room.get("level_db", 0)
            )
            stream = channel.setdefault("livestream", {})
            if stream is None:
                stream = channel["livestream"] = {}
            stream["enabled"] = False
        connection.execute(
            sa.text("UPDATE mixer_configuration SET automation_json = :cfg WHERE id = :id"),
            {"cfg": json.dumps(cfg, separators=(",", ":")), "id": row["id"]},
        )


def downgrade():
    # Retain operator scene settings rather than overwriting live desk presets.
    pass
