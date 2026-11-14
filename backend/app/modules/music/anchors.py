"""Validate saved musical positions against the same source lines as the editor."""

import json
import re

from app.modules.music.text import _SEQUENCE_PREFIX


def _section_key(label: str) -> str:
    compact = re.sub(r"[\s-]+", "", label.lower())
    match = re.fullmatch(
        r"(verse|v|chorus|c|refrain|bridge|b|prechorus|pc|p|tag|t|ending|e|outro|o|intro|i)(\d*)",
        compact,
    )
    if not match:
        return label
    kind, number = match.groups()
    return f"{_SEQUENCE_PREFIX.get(kind, 'C')}{number}"


def validate_song_anchors(lyrics: str | None, chords: str | None, rhythm: dict | None) -> None:
    sections: dict[str | None, list[str]] = {None: []}
    current = sections[None]
    for line in (lyrics or "").split("\n"):
        line = line.rstrip()
        if not line:
            continue
        heading = re.fullmatch(r"\[([^\]]+)\]", line.strip())
        if heading:
            current = []
            sections.setdefault(_section_key(heading[1]), current)
        else:
            current.append(line)

    positions = [("Bar", marker) for marker in (rhythm or {}).get("markers", [])]
    try:
        chart = json.loads(chords or "null")
    except (ValueError, TypeError):
        chart = None
    # Earlier chart formats use absolute lines and are converted by the editor.
    if isinstance(chart, dict) and chart.get("version") == 3:
        positions += [("Chord", anchor) for anchor in chart.get("annotations", [])]
    for kind, anchor in positions:
        section = anchor.get("section")
        lines = sections.get(_section_key(section) if isinstance(section, str) else None, [])
        line, column = anchor.get("lineIndex"), anchor.get("anchorIndex")
        if (
            not isinstance(line, int)
            or isinstance(line, bool)
            or not 0 <= line < len(lines)
            or not isinstance(column, int)
            or isinstance(column, bool)
            # Three leading and five trailing slots are visible in the lyric editor.
            or not 0 <= column < len(lines[line]) + 8
        ):
            raise ValueError(
                f"{kind} position {anchor.get('id', '')} falls outside the lyrics "
                f"({section or 'Unlabelled'}, line {line}, position {column}). "
                "Open the song editor and restore the lyrics or remove the hidden position."
            )
