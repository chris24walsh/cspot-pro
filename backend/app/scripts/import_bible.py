from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any
from urllib.request import urlopen

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.modules.library.bible_data import BIBLE_BOOKS
from app.modules.library.models import BibleBook, BibleVerse, BibleVersion

DEFAULT_KJV_URL = "https://raw.githubusercontent.com/thiagobodruk/bible/master/json/en_kjv.json"


def load_json(source: str) -> Any:
    if source.startswith("http://") or source.startswith("https://"):
        with urlopen(source, timeout=30) as response:
            return json.loads(response.read().decode("utf-8-sig"))
    return json.loads(Path(source).read_text(encoding="utf-8-sig"))


def ensure_books(session: Session) -> dict[int, BibleBook]:
    books_by_order: dict[int, BibleBook] = {}
    for book in BIBLE_BOOKS:
        existing = session.scalar(select(BibleBook).where(BibleBook.sort_order == book.sort_order))
        if existing is None:
            existing = BibleBook(
                name=book.name,
                abbreviation=book.abbreviation,
                testament=book.testament,
                sort_order=book.sort_order,
            )
            session.add(existing)
            session.flush()
        books_by_order[book.sort_order] = existing
    return books_by_order


def ensure_version(
    session: Session,
    *,
    code: str,
    name: str,
    language: str = "en",
    license_name: str | None = None,
) -> BibleVersion:
    version = session.scalar(select(BibleVersion).where(BibleVersion.code == code))
    if version is None:
        version = BibleVersion(code=code, name=name, language=language, license=license_name)
        session.add(version)
        session.flush()
    else:
        version.name = name
        version.language = language
        version.license = license_name
        session.flush()
    return version


def import_thiagobodruk_json(
    session: Session,
    *,
    version: BibleVersion,
    payload: list[dict[str, Any]],
    replace: bool = False,
) -> int:
    books_by_order = ensure_books(session)
    if replace:
        session.execute(delete(BibleVerse).where(BibleVerse.version_id == version.id))
        session.flush()

    existing_count = session.scalar(
        select(BibleVerse).where(BibleVerse.version_id == version.id).limit(1)
    )
    if existing_count is not None and not replace:
        return 0

    inserted = 0
    batch: list[BibleVerse] = []
    for book_index, book_payload in enumerate(payload, start=1):
        book = books_by_order[book_index]
        chapters = book_payload.get("chapters", [])
        for chapter_index, chapter in enumerate(chapters, start=1):
            for verse_index, verse_text in enumerate(chapter, start=1):
                batch.append(
                    BibleVerse(
                        version_id=version.id,
                        book_id=book.id,
                        chapter=chapter_index,
                        verse=verse_index,
                        text=str(verse_text).strip(),
                    )
                )
                inserted += 1
                if len(batch) >= 1000:
                    session.add_all(batch)
                    session.flush()
                    batch.clear()
    if batch:
        session.add_all(batch)
        session.flush()
    return inserted


def import_translation(
    session: Session,
    *,
    code: str,
    name: str,
    source: str,
    license_name: str | None = None,
    replace: bool = False,
) -> int:
    payload = load_json(source)
    if not isinstance(payload, list):
        raise ValueError("Expected a JSON array of books.")
    version = ensure_version(session, code=code, name=name, license_name=license_name)
    inserted = import_thiagobodruk_json(session, version=version, payload=payload, replace=replace)
    session.commit()
    return inserted


def autoload_kjv_if_missing(session: Session) -> int:
    version = ensure_version(session, code="KJV", name="King James Version", license_name="Public Domain")
    has_verses = session.scalar(select(BibleVerse.id).where(BibleVerse.version_id == version.id).limit(1))
    if has_verses is not None:
        session.commit()
        return 0
    inserted = import_thiagobodruk_json(
        session,
        version=version,
        payload=load_json(DEFAULT_KJV_URL),
        replace=False,
    )
    session.commit()
    return inserted


def main() -> None:
    parser = argparse.ArgumentParser(description="Import Bible translation text into cspot-pro.")
    parser.add_argument("--version-code", required=True)
    parser.add_argument("--name", required=True)
    parser.add_argument("--source", required=True)
    parser.add_argument("--license", default=None)
    parser.add_argument("--replace", action="store_true")
    args = parser.parse_args()

    with SessionLocal() as session:
        inserted = import_translation(
            session,
            code=args.version_code,
            name=args.name,
            source=args.source,
            license_name=args.license,
            replace=args.replace,
        )
    print(f"Imported {inserted} verses into {args.version_code}.")


if __name__ == "__main__":
    main()
