"""Port existing 8/8 strums to 4/4 without changing bar or stroke timing."""

import re
from copy import deepcopy

import sqlalchemy as sa
from alembic import op

revision = "0071_four_four_strum_grids"
down_revision = "0070_rhythm_presets"
branch_labels = None
depends_on = None


def convert_rhythm(value: dict) -> dict:
    result = deepcopy(value)
    bpm = result.get("bpm", 90)
    if bpm % 2 or bpm < 60:
        raise ValueError("8/8 tempo must halve exactly within the supported BPM range")
    result.update(numerator=4, denominator=4, bpm=bpm // 2)
    for pattern in result.get("patterns", []):
        pattern["subdivision"] *= 2
    for arrangement in result.get("arrangements", []):
        arrangement["chart"] = re.sub(
            r"@(\d+(?:\.\d+)?)",
            lambda match: "@" + format(1 + (float(match.group(1)) - 1) / 2, "g"),
            arrangement["chart"],
        )
    return result


def upgrade() -> None:
    op.create_table(
        "rhythm_8_8_backup",
        sa.Column("kind", sa.String(12), primary_key=True),
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("original", sa.JSON(), nullable=False),
        sa.Column("converted", sa.JSON(), nullable=False),
    )
    bind = op.get_bind()
    backup = sa.table(
        "rhythm_8_8_backup",
        sa.column("kind"),
        sa.column("id"),
        sa.column("original", sa.JSON()),
        sa.column("converted", sa.JSON()),
    )
    songs = sa.table("songs", sa.column("id"), sa.column("rhythm", sa.JSON()))
    for row in bind.execute(sa.select(songs)).mappings().all():
        rhythm = row["rhythm"]
        if not rhythm or (rhythm.get("numerator"), rhythm.get("denominator")) != (8, 8):
            continue
        converted = convert_rhythm(rhythm)
        bind.execute(
            backup.insert().values(kind="song", id=row["id"], original=rhythm, converted=converted)
        )
        bind.execute(songs.update().where(songs.c.id == row["id"]).values(rhythm=converted))
    presets = sa.table(
        "rhythm_presets",
        sa.column("id"),
        sa.column("kind"),
        sa.column("numerator"),
        sa.column("denominator"),
        sa.column("subdivision"),
    )
    for row in (
        bind.execute(
            sa.select(presets).where(
                presets.c.kind == "strum", presets.c.numerator == 8, presets.c.denominator == 8
            )
        )
        .mappings()
        .all()
    ):
        original = {key: row[key] for key in ("numerator", "denominator", "subdivision")}
        converted = {"numerator": 4, "denominator": 4, "subdivision": original["subdivision"] * 2}
        bind.execute(
            backup.insert().values(
                kind="strum", id=row["id"], original=original, converted=converted
            )
        )
        bind.execute(presets.update().where(presets.c.id == row["id"]).values(**converted))


def downgrade() -> None:
    bind = op.get_bind()
    backup = sa.table(
        "rhythm_8_8_backup",
        sa.column("kind"),
        sa.column("id"),
        sa.column("original", sa.JSON()),
        sa.column("converted", sa.JSON()),
    )
    for row in bind.execute(sa.select(backup)).mappings().all():
        if row["kind"] == "song":
            table = sa.table("songs", sa.column("id"), sa.column("rhythm", sa.JSON()))
            current = bind.execute(
                sa.select(table.c.rhythm).where(table.c.id == row["id"])
            ).scalar()
            if current == row["converted"]:
                bind.execute(
                    table.update().where(table.c.id == row["id"]).values(rhythm=row["original"])
                )
        else:
            table = sa.table(
                "rhythm_presets",
                sa.column("id"),
                sa.column("numerator"),
                sa.column("denominator"),
                sa.column("subdivision"),
            )
            current = (
                bind.execute(
                    sa.select(table.c.numerator, table.c.denominator, table.c.subdivision).where(
                        table.c.id == row["id"]
                    )
                )
                .mappings()
                .first()
            )
            if current and dict(current) == row["converted"]:
                bind.execute(
                    table.update().where(table.c.id == row["id"]).values(**row["original"])
                )
    op.drop_table("rhythm_8_8_backup")
