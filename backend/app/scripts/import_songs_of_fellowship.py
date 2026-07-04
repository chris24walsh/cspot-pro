"""One-time, reversible import of Songs of Fellowship Volume 1 titles.

The source text must be produced from the publisher's 1-6 title index with:

    pdftotext -layout songs-of-fellowship-index.pdf /tmp/sof-index.txt

Run inside the API container. Both import and rollback preview by default and
only write when ``--commit`` is supplied.
"""

from __future__ import annotations

import argparse
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path
import re
import unicodedata

from sqlalchemy import select

from app.core.database import SessionLocal
from app.modules.music.models import Song


BATCH_MARKER = "source:songs-of-fellowship-1 batch:sof1-20260704"
BOOK_NAME = "Songs of Fellowship 1"
ROW_PATTERN = re.compile(r"^\s*(.*?)\s+(\d+)\s+(\d+)\s*$")


def normalized_title(value: str) -> str:
    value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", " ", value.casefold()).strip()


def parse_volume_one_index(source: Path) -> dict[int, list[str]]:
    entries: dict[int, list[str]] = defaultdict(list)
    for raw_line in source.read_text(encoding="utf-8").splitlines():
        match = ROW_PATTERN.match(raw_line.replace("\f", ""))
        if not match:
            continue
        title, number_text, book_text = match.groups()
        number = int(number_text)
        if int(book_text) != 1 or not 1 <= number <= 640:
            continue
        clean_title = " ".join(title.split())
        if clean_title and clean_title not in entries[number]:
            entries[number].append(clean_title)

    missing = [number for number in range(1, 641) if number not in entries]
    if missing:
        raise ValueError(f"Index is incomplete; missing Volume 1 numbers: {missing}")
    return dict(entries)


def run_import(source: Path, *, commit: bool) -> None:
    entries = parse_volume_one_index(source)
    with SessionLocal() as session:
        existing = session.scalars(select(Song).where(Song.deleted_at.is_(None))).all()
        existing_by_title: dict[str, Song] = {}
        for song in existing:
            for candidate in (song.title, song.alternate_title):
                if candidate:
                    existing_by_title.setdefault(normalized_title(candidate), song)

        to_create: list[tuple[int, list[str]]] = []
        skipped: list[tuple[int, str, Song]] = []
        for number, titles in sorted(entries.items()):
            matched = next(
                (existing_by_title[normalized_title(title)] for title in titles if normalized_title(title) in existing_by_title),
                None,
            )
            if matched:
                skipped.append((number, titles[0], matched))
            else:
                to_create.append((number, titles))

        print(f"Parsed: 640 numbered Volume 1 songs")
        print(f"Create: {len(to_create)}")
        print(f"Skip existing: {len(skipped)}")
        for number, source_title, matched in skipped:
            print(f"  skip #{number}: {source_title!r} -> existing {matched.title!r}")

        if not commit:
            print("Preview only. Re-run with --commit to import.")
            return

        for number, titles in to_create:
            session.add(
                Song(
                    title=titles[0],
                    alternate_title=titles[1] if len(titles) > 1 else None,
                    book_reference=f"{BOOK_NAME} #{number}",
                    theme_tags=BATCH_MARKER,
                )
            )
        session.commit()
        print(f"Committed {len(to_create)} new songs with marker: {BATCH_MARKER}")


def run_rollback(*, commit: bool) -> None:
    with SessionLocal() as session:
        songs = session.scalars(
            select(Song).where(Song.deleted_at.is_(None), Song.theme_tags == BATCH_MARKER)
        ).all()
        print(f"Rollback target: {len(songs)} active songs with marker: {BATCH_MARKER}")
        if not commit:
            print("Preview only. Re-run with --rollback --commit to soft-delete this batch.")
            return
        deleted_at = datetime.now(UTC)
        for song in songs:
            song.deleted_at = deleted_at
        session.commit()
        print(f"Soft-deleted {len(songs)} imported songs.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", nargs="?", type=Path, help="Text extracted from the Songs of Fellowship 1-6 index PDF.")
    parser.add_argument("--commit", action="store_true", help="Write the previewed change to the database.")
    parser.add_argument("--rollback", action="store_true", help="Soft-delete songs created by this import batch.")
    args = parser.parse_args()

    if args.rollback:
        run_rollback(commit=args.commit)
        return
    if not args.source:
        parser.error("source is required unless --rollback is used")
    run_import(args.source, commit=args.commit)


if __name__ == "__main__":
    main()
