import re


_SEQUENCE_TOKEN = re.compile(
    r"(?<![A-Za-z])"
    r"(pre[-\s]?chorus|verse|chorus|bridge|tag|ending|outro|intro|pc|v|c|b|p|t|e|o|i)"
    r"\s*(\d+)?(?![A-Za-z])",
    re.IGNORECASE,
)

_LYRIC_LABEL = re.compile(
    r"^\s*\[?\s*(verse|v|chorus|c|bridge|b|pre[-\s]?chorus|pc|p|tag|t|ending|e|outro|o|intro|i|section|s)\s*(\d+)?\s*\]?\s*:?\s*$",
    re.IGNORECASE,
)
_BRACKETED_LABEL = re.compile(r"^\s*\[[^\]]+\]\s*:?\s*$")

_SEQUENCE_PREFIX = {
    "v": "V",
    "verse": "V",
    "c": "C",
    "chorus": "C",
    "b": "B",
    "bridge": "B",
    "p": "P",
    "pc": "P",
    "prechorus": "P",
    "t": "T",
    "tag": "T",
    "e": "E",
    "ending": "E",
    "o": "O",
    "outro": "O",
    "i": "I",
    "intro": "I",
}


def normalize_song_sequence(
    sequence: str | None, verse_number_map: dict[int, int] | None = None
) -> str | None:
    if not sequence or not sequence.strip():
        return None

    tokens: list[tuple[str, int | None]] = []
    for match in _SEQUENCE_TOKEN.finditer(sequence):
        name = match.group(1).lower().replace("-", "").replace(" ", "")
        number = int(match.group(2)) if match.group(2) else None
        tokens.append((_SEQUENCE_PREFIX[name], number))

    if not tokens:
        return None

    verse_numbers = sorted({number for prefix, number in tokens if prefix == "V" and number is not None})
    compact_verse_number = dict(verse_number_map or {})
    next_verse_number = max(compact_verse_number.values(), default=0) + 1
    for number in verse_numbers:
        if number not in compact_verse_number:
            compact_verse_number[number] = next_verse_number
            next_verse_number += 1
    return " ".join(
        f"{prefix}{compact_verse_number[number] if prefix == 'V' and number is not None else number or ''}"
        for prefix, number in tokens
    )


def normalize_song_lyrics(lyrics: str | None) -> tuple[str | None, dict[int, int]]:
    if not lyrics or not lyrics.strip():
        return None, {}

    output: list[str] = []
    verse_number_map: dict[int, int] = {}
    next_verse_number = 1

    for line in lyrics.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        match = _LYRIC_LABEL.match(line)
        if match:
            name = match.group(1).lower().replace("-", "").replace(" ", "")
            if name in {"section", "s"}:
                continue
            prefix = _SEQUENCE_PREFIX[name]
            if prefix == "V":
                original_number = int(match.group(2)) if match.group(2) else None
                if original_number is not None and original_number in verse_number_map:
                    number = verse_number_map[original_number]
                else:
                    number = next_verse_number
                    next_verse_number += 1
                    if original_number is not None:
                        verse_number_map[original_number] = number
                output.append(f"[V{number}]")
            else:
                output.append(f"[{prefix}{match.group(2) or ''}]")
            continue
        if _BRACKETED_LABEL.match(line):
            continue
        output.append(line.rstrip())

    normalized = re.sub(r"\n{3,}", "\n\n", "\n".join(output)).strip()
    return normalized or None, verse_number_map


def _lyric_labels(lyrics: str | None) -> list[str]:
    if not lyrics:
        return []
    labels: list[str] = []
    for line in lyrics.splitlines():
        match = _LYRIC_LABEL.match(line)
        if not match:
            continue
        name = match.group(1).lower().replace("-", "").replace(" ", "")
        if name in {"section", "s"}:
            continue
        labels.append(f"{_SEQUENCE_PREFIX[name]}{match.group(2) or ''}")
    return labels


def _insert_missing_lyric_labels(sequence_labels: list[str], lyric_labels: list[str]) -> list[str]:
    result = list(sequence_labels)
    for lyric_index, label in enumerate(lyric_labels):
        if label in result:
            continue

        next_label = next((candidate for candidate in lyric_labels[lyric_index + 1 :] if candidate in result), None)
        if next_label is not None:
            result.insert(result.index(next_label), label)
            continue

        previous_label = next((candidate for candidate in reversed(lyric_labels[:lyric_index]) if candidate in result), None)
        if previous_label is not None:
            insert_at = len(result) - result[::-1].index(previous_label)
            result.insert(insert_at, label)
        else:
            result.append(label)
    return result


def reconcile_song_sequence(sequence: str | None, lyric_labels: list[str]) -> str | None:
    if not lyric_labels:
        return sequence

    sequence_labels = sequence.split() if sequence else []
    if len(sequence_labels) <= len(lyric_labels):
        return " ".join(lyric_labels)

    known_labels = set(lyric_labels)
    preserved = [label for label in sequence_labels if label in known_labels]
    reconciled = _insert_missing_lyric_labels(preserved, lyric_labels)
    return " ".join(reconciled or lyric_labels)


def normalize_song_text(lyrics: str | None, sequence: str | None) -> tuple[str | None, str | None]:
    normalized_lyrics, verse_number_map = normalize_song_lyrics(lyrics)
    normalized_sequence = normalize_song_sequence(sequence, verse_number_map)
    return normalized_lyrics, reconcile_song_sequence(normalized_sequence, _lyric_labels(normalized_lyrics))
