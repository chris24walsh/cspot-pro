import re


_SEQUENCE_TOKEN = re.compile(
    r"(?<![A-Za-z])"
    r"(pre[-\s]?chorus|verse|chorus|bridge|tag|ending|outro|intro|section|pc|v|c|b|t|e|o|i|s)"
    r"\s*(\d+)?(?![A-Za-z])",
    re.IGNORECASE,
)

_SEQUENCE_PREFIX = {
    "v": "V",
    "verse": "V",
    "c": "C",
    "chorus": "C",
    "b": "B",
    "bridge": "B",
    "pc": "PC",
    "prechorus": "PC",
    "t": "T",
    "tag": "T",
    "e": "E",
    "ending": "E",
    "o": "O",
    "outro": "O",
    "i": "I",
    "intro": "I",
    "s": "S",
    "section": "S",
}


def normalize_song_sequence(sequence: str | None) -> str | None:
    if not sequence or not sequence.strip():
        return None

    tokens: list[tuple[str, int | None]] = []
    for match in _SEQUENCE_TOKEN.finditer(sequence):
        name = match.group(1).lower().replace("-", "").replace(" ", "")
        number = int(match.group(2)) if match.group(2) else None
        tokens.append((_SEQUENCE_PREFIX[name], number))

    if not tokens:
        return None

    verse_numbers = sorted(
        {number for prefix, number in tokens if prefix == "V" and number is not None}
    )
    compact_verse_number = {number: index for index, number in enumerate(verse_numbers, start=1)}
    return " ".join(
        f"{prefix}{compact_verse_number[number] if prefix == 'V' and number is not None else number or ''}"
        for prefix, number in tokens
    )
