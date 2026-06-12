from __future__ import annotations

import argparse
import io
import json
import re
import zipfile
from pathlib import Path
from typing import Any
from urllib.request import Request, urlopen

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.modules.library.bible_data import BIBLE_BOOKS
from app.modules.library.models import BibleBook, BibleVerse, BibleVersion

DEFAULT_KJV_URL = "https://raw.githubusercontent.com/thiagobodruk/bible/master/json/en_kjv.json"
DEFAULT_ASV_VPL_ZIP_URL = "https://ebible.org/Scriptures/eng-asv_vpl.zip"

EBIBLE_VPL_BOOK_CODES = (
    "GEN", "EXO", "LEV", "NUM", "DEU", "JOS", "JDG", "RUT", "1SA", "2SA", "1KI", "2KI", "1CH", "2CH", "EZR", "NEH",
    "EST", "JOB", "PSA", "PRO", "ECC", "SOL", "ISA", "JER", "LAM", "EZE", "DAN", "HOS", "JOE", "AMO", "OBA", "JON",
    "MIC", "NAH", "HAB", "ZEP", "HAG", "ZEC", "MAL", "MAT", "MAR", "LUK", "JOH", "ACT", "ROM", "1CO", "2CO", "GAL",
    "EPH", "PHI", "COL", "1TH", "2TH", "1TI", "2TI", "TIT", "PHM", "HEB", "JAM", "1PE", "2PE", "1JO", "2JO", "3JO",
    "JUD", "REV",
)

EBIBLE_VPL_BOOK_ORDER = {code: index + 1 for index, code in enumerate(EBIBLE_VPL_BOOK_CODES)}


def load_json(source: str) -> Any:
    if source.startswith("http://") or source.startswith("https://"):
        request = Request(source, headers={"User-Agent": "cspot-pro Bible importer"})
        with urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8-sig"))
    return json.loads(Path(source).read_text(encoding="utf-8-sig"))


def load_bytes(source: str) -> bytes:
    if source.startswith("http://") or source.startswith("https://"):
        request = Request(source, headers={"User-Agent": "cspot-pro Bible importer"})
        with urlopen(request, timeout=60) as response:
            return response.read()
    return Path(source).read_bytes()


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


def import_ebible_vpl_text(
    session: Session,
    *,
    version: BibleVersion,
    text: str,
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
    for line in text.splitlines():
        match = re.match(r"^(\S+)\s+(\d+):(\d+)(?:-\d+)?\s+(.*)$", line.strip())
        if not match:
            continue
        book_code, chapter, verse, verse_text = match.groups()
        book_order = EBIBLE_VPL_BOOK_ORDER.get(book_code)
        if not book_order:
            continue
        batch.append(
            BibleVerse(
                version_id=version.id,
                book_id=books_by_order[book_order].id,
                chapter=int(chapter),
                verse=int(verse),
                text=verse_text.strip(),
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


def load_ebible_vpl_zip_text(source: str) -> str:
    archive_data = load_bytes(source)
    with zipfile.ZipFile(io.BytesIO(archive_data)) as archive:
        vpl_names = [name for name in archive.namelist() if name.endswith("_vpl.txt")]
        if not vpl_names:
            raise ValueError("Expected an eBible VPL zip containing *_vpl.txt.")
        return archive.read(vpl_names[0]).decode("utf-8-sig")


def import_translation(
    session: Session,
    *,
    code: str,
    name: str,
    source: str,
    license_name: str | None = None,
    replace: bool = False,
    source_format: str = "thiagobodruk-json",
) -> int:
    version = ensure_version(session, code=code, name=name, license_name=license_name)
    if source_format == "ebible-vpl-zip":
        inserted = import_ebible_vpl_text(
            session,
            version=version,
            text=load_ebible_vpl_zip_text(source),
            replace=replace,
        )
    else:
        payload = load_json(source)
        if not isinstance(payload, list):
            raise ValueError("Expected a JSON array of books.")
        inserted = import_thiagobodruk_json(session, version=version, payload=payload, replace=replace)
    session.commit()
    return inserted


def autoload_asv_if_missing(session: Session) -> int:
    version = ensure_version(session, code="ASV", name="American Standard Version", license_name="Public Domain")
    has_verses = session.scalar(select(BibleVerse.id).where(BibleVerse.version_id == version.id).limit(1))
    if has_verses is not None:
        session.commit()
        return 0
    inserted = import_ebible_vpl_text(
        session,
        version=version,
        text=load_ebible_vpl_zip_text(DEFAULT_ASV_VPL_ZIP_URL),
        replace=False,
    )
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
    parser.add_argument("--format", choices=("thiagobodruk-json", "ebible-vpl-zip"), default="thiagobodruk-json")
    args = parser.parse_args()

    with SessionLocal() as session:
        inserted = import_translation(
            session,
            code=args.version_code,
            name=args.name,
            source=args.source,
            license_name=args.license,
            replace=args.replace,
            source_format=args.format,
        )
    print(f"Imported {inserted} verses into {args.version_code}.")


if __name__ == "__main__":
    main()
