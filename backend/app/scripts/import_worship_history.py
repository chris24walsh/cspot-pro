"""Preview or import historical worship sets from the connected Google Drive.

Run inside the API container so it can reuse the app database and stored
Google Drive OAuth connection.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
import re

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.modules.imports.routes import _parse_slide_deck
from app.modules.integrations.google_drive import download_google_drive_deck_for_parsing, list_google_drive_decks
from app.modules.integrations.schemas import GoogleDriveFileRead
from app.modules.music.models import Song
from app.modules.planning.models import Plan, PlanItem, PlanType

DEFAULT_FOLDER = "LCF Cloud/Worship/Weekly Worship Slidedecks"
WORSHIP_SET_TYPE = "Worship Set"

WEB_CLUTTER_PATTERNS = [
    re.compile(pattern, re.I)
    for pattern in [
        r"^lyrics?\s*$",
        r"^copyright\b",
        r"^ccli\b",
        r"^writer\(s\):",
        r"^publisher\(s\):",
        r"^words?\s+(?:and\s+music\s+)?by\b",
        r"^music\s+by\b",
        r"^used by permission\b",
        r"^all rights reserved\b",
        r"^slide\s+\d+$",
        r"^page\s+\d+$",
    ]
]

MONTHS = {
    "jan": 1,
    "january": 1,
    "feb": 2,
    "february": 2,
    "mar": 3,
    "march": 3,
    "apr": 4,
    "april": 4,
    "may": 5,
    "jun": 6,
    "june": 6,
    "jul": 7,
    "july": 7,
    "aug": 8,
    "august": 8,
    "sep": 9,
    "sept": 9,
    "september": 9,
    "oct": 10,
    "october": 10,
    "nov": 11,
    "november": 11,
    "dec": 12,
    "december": 12,
}

WEEKDAYS = {
    "mon": 0,
    "monday": 0,
    "tue": 1,
    "tues": 1,
    "tuesday": 1,
    "wed": 2,
    "wednesday": 2,
    "thu": 3,
    "thur": 3,
    "thurs": 3,
    "thursday": 3,
    "fri": 4,
    "friday": 4,
    "sat": 5,
    "saturday": 5,
    "sun": 6,
    "sunday": 6,
}


@dataclass
class ParsedSlide:
    index: int
    title: str
    text: str


@dataclass
class MissingSong:
    title: str
    lyrics: str
    sequence: str | None
    first_slide: int
    last_slide: int
    author: str | None
    ccli_number: str | None
    license: str | None
    notes: list[str]


@dataclass
class MatchedSong:
    first_slide: int
    song: Song


@dataclass
class DeckPreview:
    file: GoogleDriveFileRead
    date: str
    slides: list[ParsedSlide]
    matched: list[MatchedSong]
    missing: list[MissingSong]


def normalized_title(value: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", value.lower().replace("&", "and"))).strip()


def song_title_keys(song: Song) -> list[str]:
    return [normalized_title(value) for value in [song.title, song.alternate_title] if value]


def clean_slide_title(value: str) -> str:
    value = re.sub(r"\.[a-z0-9]+$", "", value, flags=re.I)
    value = re.sub(r"\s+(?:lyrics|song|worship)\s*$", "", value, flags=re.I)
    value = re.sub(r"\s*[-–—]\s*(?:lyrics|song|worship)\s*$", "", value, flags=re.I)
    return re.sub(r"\s+", " ", value).strip()


def meaningful_lines(value: str) -> list[str]:
    return [line.strip() for line in value.splitlines() if line.strip()]


def title_from_slide(slide: ParsedSlide) -> str:
    lines = meaningful_lines(f"{slide.title}\n{slide.text}")
    for line in lines:
        cleaned = clean_slide_title(line)
        word_count = len(cleaned.split())
        if 4 <= len(cleaned) <= 70 and word_count <= 7 and not re.search(r"[.;:,]$", cleaned):
            return cleaned
    return ""


def is_probably_song_title_slide(slide: ParsedSlide) -> bool:
    lines = meaningful_lines(f"{slide.title}\n{slide.text}")
    candidate = title_from_slide(slide)
    if not candidate or len(lines) > 4:
        return False

    normalized = normalized_title(candidate)
    if re.search(
        r"^(welcome|sermon|reading|offering|communion|notices|announcements|prayer|closing|opening)$",
        candidate,
        re.I,
    ):
        return False
    if re.search(r"^(?:slide|page)\s+\d+$", candidate, re.I):
        return False
    if re.search(r"\b(?:john|genesis|exodus|psalm|psalms|matthew|mark|luke|romans|revelation)\s+\d+", candidate, re.I):
        return False
    if "ccli" in normalized or "copyright" in normalized:
        return False

    lyric_lines = [line for line in lines if len(line.split()) >= 6]
    title_line_count = 0
    for line in lines:
        cleaned = clean_slide_title(line)
        if 4 <= len(cleaned) and len(cleaned.split()) <= 7 and not re.search(r"[.;:,]$", cleaned):
            title_line_count += 1
    return title_line_count > 0 and not lyric_lines


def is_likely_chord_line(line: str) -> bool:
    token = r"[A-G](?:#|b)?(?:m|maj|min|sus|dim|aug|add)?\d*(?:/[A-G](?:#|b)?)?"
    return bool(re.fullmatch(rf"{token}(?:\s+{token})*", line.strip()))


def is_clutter(line: str) -> bool:
    return any(pattern.search(line.strip()) for pattern in WEB_CLUTTER_PATTERNS)


def collapse_repeated_lines(block: str) -> str:
    collapsed: list[str] = []
    for raw_line in meaningful_lines(block):
        line = re.sub(r"\s{2,}", " ", raw_line)
        previous = collapsed[-1] if collapsed else None
        if previous == line:
            collapsed[-1] = f"{line} x2"
            continue
        repeated = re.match(r"^(.*) x(\d+)$", previous or "")
        if repeated and repeated.group(1) == line:
            collapsed[-1] = f"{line} x{int(repeated.group(2)) + 1}"
            continue
        collapsed.append(line)
    return "\n".join(collapsed)


def format_worship_text(value: str, *, remove_chords: bool = True) -> str:
    output: list[str] = []
    previous_blank = True
    normalized = (
        value.replace("\r\n", "\n")
        .replace("\r", "\n")
        .replace("“", '"')
        .replace("”", '"')
        .replace("‘", "'")
        .replace("’", "'")
        .replace("\u00a0", " ")
    )

    for raw_line in normalized.split("\n"):
        line = raw_line.strip()
        if not line or is_clutter(line) or (remove_chords and is_likely_chord_line(line)):
            if output and not previous_blank:
                output.append("")
                previous_blank = True
            continue
        output.append(re.sub(r"\s{2,}", " ", line))
        previous_blank = False

    blocks = [collapse_repeated_lines(block.strip()) for block in "\n".join(output).split("\n\n") if block.strip()]
    return "\n\n".join(block for block in blocks if block).strip()


def title_case_from_filename(value: str) -> str | None:
    base = re.sub(r"\.[^.]+$", "", value)
    base = re.sub(r"[_-]+", " ", base)
    base = re.sub(r"\s+", " ", base).strip()
    return base.title() if base else None


def strip_leading_title_block(blocks: list[str], title: str | None) -> tuple[list[str], list[str]]:
    if len(blocks) < 2 or not title:
        return blocks, []
    first = meaningful_lines(blocks[0])
    if not first or len(first) > 2:
        return blocks, []
    if normalized_title(" ".join(first)) == normalized_title(title) and len(meaningful_lines(blocks[1])) >= 2:
        return blocks[1:], ["Ignored the opening title slide and used it as the song title only."]
    return blocks, []


def block_key(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip().lower())


def infer_sections(blocks: list[str]) -> tuple[str, str | None, list[str]]:
    counts: dict[str, int] = {}
    first_index: dict[str, int] = {}
    for index, block in enumerate(blocks):
        key = block_key(block)
        counts[key] = counts.get(key, 0) + 1
        first_index.setdefault(key, index)

    repeated = sorted(
        [(key, count) for key, count in counts.items() if count > 1],
        key=lambda item: (-item[1], first_index[item[0]]),
    )
    chorus_key = next(
        (key for key, _count in repeated if first_index.get(key, 0) > 0),
        repeated[0][0] if repeated else None,
    )
    line_counts = [len(meaningful_lines(block)) for block in blocks]
    word_counts = [len(" ".join(meaningful_lines(block)).split()) for block in blocks]
    average_words = sum(word_counts) / max(1, len(word_counts))
    hymn_like = (
        len(blocks) >= 4
        and not repeated
        and line_counts
        and max(line_counts) - min(line_counts) <= 2
        and min(word_counts or [0]) >= average_words * 0.62
        and max(word_counts or [0]) <= average_words * 1.45
    )

    labels: dict[str, str] = {}
    notes: list[str] = []
    verse_number = 1
    for index, block in enumerate(blocks):
        key = block_key(block)
        if key in labels:
            continue
        if chorus_key and key == chorus_key:
            labels[key] = "Chorus"
        elif hymn_like:
            labels[key] = f"Verse{verse_number}"
            verse_number += 1
        else:
            count = counts[key]
            word_count = word_counts[index]
            near_end = index >= max(2, int(len(blocks) * 0.66))
            if index > 0 and index < len(blocks) - 1 and word_count <= average_words * 0.72:
                labels[key] = "Chorus"
            elif near_end and count == 1 and len(blocks) >= 4 and word_count <= average_words * 0.55:
                labels[key] = "Bridge"
            else:
                labels[key] = f"Verse{verse_number}"
                verse_number += 1

    if repeated:
        notes.append("Repeated slide content was used to infer a chorus sequence.")
    if hymn_like:
        notes.append("Similar-length stanzas were treated as hymn-style verses.")

    sections = []
    sequence = []
    for block in blocks:
        label = labels.get(block_key(block), "Section")
        sections.append(f"[{label}]\n{block}".strip())
        sequence.append(label)
    return "\n\n".join(sections), " ".join(sequence) if sequence else None, notes


def analyze_imported_song_slides(slides: list[str], title: str) -> tuple[str, str | None, list[str]]:
    cleaned = [format_worship_text(slide) for slide in slides]
    cleaned = [slide for slide in cleaned if slide]
    candidate_title = title_case_from_filename(title) or title
    blocks, notes = strip_leading_title_block(cleaned, candidate_title)
    if not blocks:
        return "", None, notes
    lyrics, sequence, section_notes = infer_sections(blocks)
    return lyrics, sequence, [*notes, *section_notes]


def infer_deck_date(file: GoogleDriveFileRead) -> str:
    name = file.name
    leading_weekday_match = re.match(r"\s*([A-Za-z]+)\b", name)
    expected_weekday = WEEKDAYS.get(leading_weekday_match.group(1).lower()) if leading_weekday_match else None

    def resolve_candidate(year: int, month: int, day: int) -> str | None:
        try:
            candidate = datetime(year, month, day, tzinfo=UTC)
        except ValueError:
            return None
        if expected_weekday is not None and candidate.weekday() != expected_weekday:
            return None
        return candidate.date().isoformat()

    def fallback_date() -> str:
        fallback = file.modified_time or datetime.now(UTC)
        return fallback.date().isoformat()

    numeric = re.search(r"\b(20\d{2})[-_. ]?([01]?\d)[-_. ]?([0-3]?\d)\b", name)
    if numeric:
        resolved = resolve_candidate(int(numeric.group(1)), int(numeric.group(2)), int(numeric.group(3)))
        return resolved or fallback_date()

    short = re.search(r"\b([0-3]?\d)[-_. /]([01]?\d)[-_. /](20\d{2}|\d{2})\b", name)
    if short:
        year = short.group(3) if len(short.group(3)) == 4 else f"20{short.group(3)}"
        resolved = resolve_candidate(int(year), int(short.group(2)), int(short.group(1)))
        return resolved or fallback_date()

    words = re.search(
        r"\b([0-3]?\d)\s+([A-Za-z]+)\s+(20\d{2}|\d{2})\b|\b([A-Za-z]+)\s+([0-3]?\d),?\s+(20\d{2}|\d{2})\b",
        name,
    )
    if words:
        if words.group(1):
            day = int(words.group(1))
            month = MONTHS.get(words.group(2).lower())
            year = int(words.group(3)) if len(words.group(3)) == 4 else int(f"20{words.group(3)}")
        else:
            month = MONTHS.get(words.group(4).lower())
            day = int(words.group(5))
            year = int(words.group(6)) if len(words.group(6)) == 4 else int(f"20{words.group(6)}")
        if month:
            resolved = resolve_candidate(year, month, day)
            return resolved or fallback_date()

    return fallback_date()


def service_datetime(date_input: str) -> datetime:
    return datetime.fromisoformat(f"{date_input}T10:30:00+00:00")


def long_date(value: str) -> str:
    date = datetime.fromisoformat(f"{value}T10:30:00+00:00")
    return date.strftime("%A, %B %-d, %Y")


def worship_set_title(value: str) -> str:
    return f"Worship Set {long_date(value)}"


def load_songs(session: Session) -> list[Song]:
    return list(session.scalars(select(Song).where(Song.deleted_at.is_(None)).order_by(Song.title)).all())


def parse_drive_deck(session: Session, file: GoogleDriveFileRead) -> list[ParsedSlide]:
    filename, content = download_google_drive_deck_for_parsing(session=session, file_id=file.id)
    _deck_format, slide_lines, _notes = _parse_slide_deck(filename, content)
    slides = []
    for index, lines in enumerate(slide_lines, start=1):
        cleaned = [line.strip() for line in lines if line.strip()]
        if cleaned:
            slides.append(ParsedSlide(index=index, title=cleaned[0], text="\n".join(cleaned)))
    return slides


def match_songs(slides: list[ParsedSlide], songs: list[Song]) -> list[MatchedSong]:
    matched: dict[str, MatchedSong] = {}
    matched_title_keys: set[str] = set()
    searchable = [(slide.index, normalized_title(f"{slide.title}\n{slide.text}")) for slide in slides]
    for song in songs:
        keys = [key for key in song_title_keys(song) if len(key) >= 5]
        if any(key in matched_title_keys for key in keys):
            continue
        first = next((index for index, text in searchable if any(key in text for key in keys)), None)
        if first is not None:
            matched[song.id] = MatchedSong(first_slide=first, song=song)
            matched_title_keys.update(keys)
    return sorted(matched.values(), key=lambda item: item.first_slide)


def detect_missing_songs(slides: list[ParsedSlide], songs: list[Song]) -> list[MissingSong]:
    existing_keys = [key for song in songs for key in song_title_keys(song) if len(key) >= 5]
    title_slides = [
        (slide.index, slide, title_from_slide(slide))
        for slide in slides
        if is_probably_song_title_slide(slide)
    ]
    title_slides = [entry for entry in title_slides if entry[2]]
    seen: set[str] = set()
    missing: list[MissingSong] = []
    for anchor_index, (slide_index, _slide, title) in enumerate(title_slides):
        title_key = normalized_title(title)
        if title_key in seen:
            continue
        seen.add(title_key)
        if any(title_key == key or title_key in key or key in title_key for key in existing_keys):
            continue

        next_title = title_slides[anchor_index + 1] if anchor_index + 1 < len(title_slides) else None
        range_slides = [
            slide
            for slide in slides
            if slide.index >= slide_index and (not next_title or slide.index < next_title[0])
        ]
        lyrics, sequence, notes = analyze_imported_song_slides(
            [slide.text or slide.title for slide in range_slides],
            title,
        )
        if lyrics.strip():
            missing.append(
                MissingSong(
                    title=title_case_from_filename(title) or title,
                    lyrics=lyrics,
                    sequence=sequence,
                    first_slide=slide_index,
                    last_slide=range_slides[-1].index if range_slides else slide_index,
                    author=None,
                    ccli_number=None,
                    license=None,
                    notes=notes,
                )
            )
    return missing


def build_preview(session: Session, file: GoogleDriveFileRead, songs: list[Song]) -> DeckPreview:
    slides = parse_drive_deck(session, file)
    return DeckPreview(
        file=file,
        date=infer_deck_date(file),
        slides=slides,
        matched=match_songs(slides, songs),
        missing=detect_missing_songs(slides, songs),
    )


def find_or_create_worship_plan(session: Session, date_input: str, file_name: str, *, commit: bool) -> Plan | None:
    plan_type = session.scalar(select(PlanType).where(PlanType.name == WORSHIP_SET_TYPE))
    if plan_type is None:
        raise RuntimeError("The Worship Set plan type is missing. Run migrations first.")

    existing = session.scalar(
        select(Plan).where(
            Plan.plan_type_id == plan_type.id,
            Plan.deleted_at.is_(None),
            Plan.service_date >= datetime.fromisoformat(f"{date_input}T00:00:00+00:00"),
            Plan.service_date <= datetime.fromisoformat(f"{date_input}T23:59:59+00:00"),
        )
    )
    if existing or not commit:
        return existing

    plan = Plan(
        plan_type_id=plan_type.id,
        service_date=service_datetime(date_input),
        title=worship_set_title(date_input),
        subtitle=None,
        leader_id=None,
        teacher_id=None,
        status="draft",
        info=f"Imported from {file_name}",
    )
    session.add(plan)
    session.commit()
    session.refresh(plan)
    return plan


def create_missing_songs(
    session: Session,
    missing: list[MissingSong],
    songs: list[Song],
    *,
    commit: bool,
) -> tuple[list[MatchedSong], int, list[Song]]:
    entries: list[MatchedSong] = []
    catalog = list(songs)
    created = 0
    for item in missing:
        title_key = normalized_title(item.title)
        existing = next(
            (
                song
                for song in catalog
                if any(title_key == key or title_key in key or key in title_key for key in song_title_keys(song))
            ),
            None,
        )
        if existing:
            entries.append(MatchedSong(first_slide=item.first_slide, song=existing))
            continue
        if not commit:
            continue
        song = Song(
            title=item.title,
            alternate_title=None,
            author=item.author,
            lyrics=item.lyrics,
            chords=None,
            ccli_number=item.ccli_number,
            book_reference=None,
            license=item.license,
            sequence=item.sequence,
            youtube_id=None,
            external_link=None,
            worship_role=None,
            energy=None,
            tempo=None,
            theme_tags=None,
        )
        session.add(song)
        session.commit()
        session.refresh(song)
        catalog.append(song)
        entries.append(MatchedSong(first_slide=item.first_slide, song=song))
        created += 1
    return entries, created, catalog


def import_preview(
    session: Session,
    preview: DeckPreview,
    songs: list[Song],
    *,
    commit: bool,
) -> tuple[int, int, list[Song]]:
    missing_entries, created_songs, catalog = create_missing_songs(session, preview.missing, songs, commit=commit)
    entries = sorted([*preview.matched, *missing_entries], key=lambda entry: entry.first_slide)
    if not commit:
        return 0, len(entries), catalog

    plan = find_or_create_worship_plan(session, preview.date, preview.file.name, commit=True)
    if plan is None:
        raise RuntimeError("Could not find or create the worship set.")

    existing_song_ids = set(
        session.scalars(
            select(PlanItem.song_id).where(
                PlanItem.plan_id == plan.id,
                PlanItem.deleted_at.is_(None),
                PlanItem.item_type == "song",
                PlanItem.song_id.is_not(None),
            )
        ).all()
    )
    highest = session.scalar(
        select(PlanItem.sequence)
        .where(PlanItem.plan_id == plan.id, PlanItem.deleted_at.is_(None))
        .order_by(PlanItem.sequence.desc())
    )
    sequence = Decimal(highest or 0) + Decimal("1.00")
    added = 0
    for entry in entries:
        if entry.song.id in existing_song_ids:
            continue
        session.add(
            PlanItem(
                plan_id=plan.id,
                song_id=entry.song.id,
                item_type="song",
                sequence=sequence,
                title=entry.song.title,
                comment=f"Imported from {preview.file.name} slide {entry.first_slide}",
                key_signature=None,
            )
        )
        sequence += Decimal("10.00")
        existing_song_ids.add(entry.song.id)
        added += 1
    session.commit()
    return created_songs, added, catalog


def print_lyrics_block(label: str, lyrics: str | None) -> None:
    print(f"      {label}:")
    if not lyrics or not lyrics.strip():
        print("        (empty)")
        return
    for line in lyrics.strip().splitlines():
        print(f"        {line}")


def print_preview(preview: DeckPreview, *, show_lyrics: bool = False) -> None:
    print(f"\n{preview.file.name}")
    print(f"  date: {preview.date}")
    print(f"  parsed slides: {len(preview.slides)}")
    print(f"  matched songs: {len(preview.matched)}")
    for match in preview.matched:
        print(f"    slide {match.first_slide:>2}: {match.song.title}")
        if show_lyrics:
            print_lyrics_block("library lyrics", match.song.lyrics)
    print(f"  new song candidates: {len(preview.missing)}")
    for item in preview.missing:
        first_lines = " / ".join(meaningful_lines(item.lyrics)[:3])
        print(f"    slides {item.first_slide:>2}-{item.last_slide:<2}: {item.title}")
        print(f"      sequence: {item.sequence or 'unknown'}")
        if item.notes:
            print(f"      notes: {'; '.join(item.notes)}")
        if show_lyrics:
            print_lyrics_block("candidate lyrics", item.lyrics)
        else:
            print(f"      lyrics: {first_lines[:180]}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Preview/import historical worship sets from Google Drive.")
    parser.add_argument("--folder", default=DEFAULT_FOLDER)
    parser.add_argument("--search", default="")
    parser.add_argument("--limit", type=int, default=2)
    parser.add_argument("--offset", type=int, default=0)
    parser.add_argument("--commit", action="store_true", help="Write songs and worship set items to the database.")
    parser.add_argument("--oldest-first", action="store_true")
    parser.add_argument("--show-lyrics", action="store_true", help="Print full lyrics for matched and candidate songs.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    with SessionLocal() as session:
        files = list_google_drive_decks(
            session,
            query=args.search.strip(),
            folder_path=args.folder,
            limit=max(args.limit + args.offset, 1),
        )
        if args.oldest_first:
            files = sorted(files, key=lambda file: file.modified_time or datetime.min.replace(tzinfo=UTC))
        selected = files[args.offset : args.offset + args.limit]
        print(f"{'COMMIT' if args.commit else 'PREVIEW'} worship history import")
        print(f"folder: {args.folder}")
        print(f"search: {args.search or '(blank)'}")
        print(f"files: {len(selected)} of {len(files)} loaded")
        songs = load_songs(session)
        total_created = 0
        total_items = 0
        for file in selected:
            preview = build_preview(session, file, songs)
            print_preview(preview, show_lyrics=args.show_lyrics)
            created, items, songs = import_preview(session, preview, songs, commit=args.commit)
            if args.commit:
                print(f"  committed: {items} set song item(s), {created} new song(s)")
            total_created += created
            total_items += items
        print("\nDone.")
        if args.commit:
            print(f"Committed totals: {total_items} set song item(s), {total_created} new song(s).")
        else:
            print("No changes written. Re-run with --commit when this preview looks right.")


if __name__ == "__main__":
    main()
