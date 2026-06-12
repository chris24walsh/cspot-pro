from __future__ import annotations

import os
import re
import zipfile
from dataclasses import dataclass
from datetime import date
from html import unescape
from pathlib import Path

from pypdf import PdfReader
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.sunday_school.models import SundaySchoolResource

DEFAULT_ROOTS = (
    Path("/home/chwalsh/Spring 2026 3-5 years-20260612T123514Z-3-001/Spring 2026 3-5 years"),
    Path("/home/chwalsh/Spring 2026 6-12 years-20260612T123828Z-3-001/Spring 2026 6-12 years"),
)

RESOURCE_LABELS = {
    "lesson_packet": "Lesson packet",
    "bible_story": "Bible story",
    "craft": "Craft",
    "game": "Game",
    "coloring": "Coloring/activity",
    "worksheet": "Worksheet",
    "media": "Video/resources",
}

RESOURCE_SORT = {
    "lesson_packet": 0,
    "bible_story": 10,
    "craft": 20,
    "game": 30,
    "coloring": 40,
    "worksheet": 50,
    "media": 60,
}

SPRING_2026_DATES = {
    1: date(2026, 3, 1),
    2: date(2026, 3, 8),
    3: date(2026, 3, 15),
    4: date(2026, 3, 22),
    5: date(2026, 3, 29),
    6: date(2026, 4, 5),
    7: date(2026, 4, 12),
    8: date(2026, 4, 19),
    9: date(2026, 4, 26),
    10: date(2026, 5, 5),
    11: date(2026, 5, 10),
    12: date(2026, 5, 17),
    13: date(2026, 5, 24),
    14: date(2026, 5, 31),
}


@dataclass
class ImportResult:
    scanned: int
    imported: int


@dataclass
class ResourceCandidate:
    title: str
    resource_type: str
    age_group: str
    source_title: str
    theme: str
    bible_reference: str
    lesson_date: date | None
    week_number: int | None
    translation: str
    file_name: str
    file_path: str
    page_start: int | None
    page_end: int | None
    summary: str
    sort_order: int


def configured_roots() -> list[Path]:
    raw = os.getenv("CSPOT_SUNDAY_SCHOOL_RESOURCE_ROOTS", "")
    roots = [Path(part).expanduser() for part in raw.split(os.pathsep) if part.strip()]
    roots.extend(DEFAULT_ROOTS)
    seen: set[Path] = set()
    existing: list[Path] = []
    for root in roots:
        resolved = root.resolve()
        if resolved in seen or not resolved.exists():
            continue
        seen.add(resolved)
        existing.append(resolved)
    return existing


def compact_text(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def read_pdf_page_texts(path: Path, page_limit: int | None = 80) -> list[str]:
    try:
        reader = PdfReader(str(path))
        pages = reader.pages if page_limit is None else reader.pages[:page_limit]
        return [page.extract_text() or "" for page in pages]
    except Exception:
        return []


def read_pdf_text(path: Path, page_limit: int = 6) -> str:
    return "\n".join(read_pdf_page_texts(path, page_limit))


def read_docx_lines(path: Path) -> list[str]:
    try:
        xml = zipfile.ZipFile(path).read("word/document.xml").decode("utf-8", errors="ignore")
    except Exception:
        return []
    xml = re.sub(r"<w:p[^>]*>", "\n", xml)
    xml = re.sub(r"<[^>]*>", "", xml)
    return [compact_text(unescape(line)) for line in xml.splitlines() if compact_text(line)]


def overview_by_week(root: Path) -> dict[int, tuple[str, str, str]]:
    docx_files = list(root.glob("*.docx"))
    if not docx_files:
        return {}
    lines = read_docx_lines(docx_files[0])
    overview: dict[int, tuple[str, str, str]] = {}
    for index, line in enumerate(lines):
        if not line.isdigit():
            continue
        week = int(line)
        if week < 1 or week > 14 or index + 3 >= len(lines):
            continue
        title_line = lines[index + 2]
        why = lines[index + 3] if index + 3 < len(lines) else ""
        match = re.match(r"(.+?)\s*\(([^)]+)\)(.*)", title_line)
        if match:
            theme = compact_text(f"{match.group(1)}{match.group(3)}")
            reference = compact_text(match.group(2))
        else:
            theme = title_line
            reference = ""
        overview[week] = (theme, reference, why)
    return overview


def week_from_path(path: Path) -> int | None:
    for part in path.parts:
        match = re.match(r"(?:Week\s+)?(\d{1,2})\b", part, flags=re.IGNORECASE)
        if match:
            week = int(match.group(1))
            if 1 <= week <= 14:
                return week
    return None


def age_group_from_root(root: Path) -> str:
    root_text = str(root).lower()
    if "3-5" in root_text:
        return "3-5"
    if "6-12" in root_text:
        return "6-12"
    return ""


def translation_from_name(path: Path) -> str:
    match = re.search(r"\b(ESV|KJV|NIV|NKJV|ASV)\b", path.name, flags=re.IGNORECASE)
    return match.group(1).upper() if match else ""


def title_from_pdf(path: Path, text: str) -> str:
    for line in text.splitlines():
        line = compact_text(line)
        if line and "copyright" not in line.lower():
            return line
    return path.stem


def bible_reference_from_text(text: str) -> str:
    patterns = (
        r"Bible\s+Story:\s*.*?\(([^)]+)\)",
        r"Passage:\s*([^\n]+)",
        r"\b((?:[1-3]\s*)?[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\s+\d+(?::\d+(?:[-–]\d+)?)?)",
    )
    for pattern in patterns:
        match = re.search(pattern, text)
        if match:
            return compact_text(match.group(1))
    return ""


def detected_types(text: str) -> list[str]:
    lowered = text.lower()
    types = ["lesson_packet"]
    if "bible story" in lowered or "passage:" in lowered:
        types.append("bible_story")
    if "craft" in lowered:
        types.append("craft")
    if "game" in lowered or "guided play" in lowered:
        types.append("game")
    if "coloring" in lowered or "activity sheet" in lowered:
        types.append("coloring")
    if "worksheet" in lowered or "word search" in lowered or "wordsearch" in lowered:
        types.append("worksheet")
    if "more resources online" in lowered or "watch the video" in lowered:
        types.append("media")
    return types


PAGE_KEYWORDS = {
    "bible_story": ("bible story", "passage:"),
    "craft": ("craft",),
    "game": ("game", "guided play"),
    "coloring": ("coloring", "activity sheet"),
    "worksheet": ("worksheet", "word search", "wordsearch"),
    "media": ("more resources online", "watch the video"),
}


def page_range_for(resource_type: str, page_texts: list[str]) -> tuple[int | None, int | None]:
    if resource_type == "lesson_packet":
        return None, None

    keywords = PAGE_KEYWORDS.get(resource_type, ())
    if not keywords:
        return None, None

    matches = [
        index + 1
        for index, text in enumerate(page_texts)
        if any(keyword in text.lower() for keyword in keywords)
    ]
    if not matches:
        return None, None

    start = matches[0]
    if resource_type in {"craft", "coloring", "worksheet"}:
        return start, min(start + 1, len(page_texts))
    return start, start


def summary_for(resource_type: str, text: str, overview_note: str) -> str:
    if resource_type == "lesson_packet":
        first_lines = [compact_text(line) for line in text.splitlines() if compact_text(line)]
        return compact_text(" ".join(first_lines[1:4]))[:600] or overview_note
    if resource_type == "bible_story":
        return "Bible reading/story section detected in the source packet."
    if resource_type == "craft":
        return "Craft or printable craft instructions detected in the source packet."
    if resource_type == "game":
        return "Game, guided play, or movement activity detected in the source packet."
    if resource_type == "coloring":
        return "Coloring page or activity sheet detected in the source packet."
    if resource_type == "worksheet":
        return "Worksheet, word search, or printable activity detected in the source packet."
    if resource_type == "media":
        return "Online video/resource links detected in the source packet."
    return overview_note


def candidates_from_pdf(
    root: Path,
    path: Path,
    overview: dict[int, tuple[str, str, str]],
) -> list[ResourceCandidate]:
    page_texts = read_pdf_page_texts(path)
    text = "\n".join(page_texts[:6])
    week = week_from_path(path)
    overview_theme, overview_reference, overview_note = overview.get(week or 0, ("", "", ""))
    title = title_from_pdf(path, text)
    reference = bible_reference_from_text(text) or overview_reference
    theme = overview_theme or title
    translation = translation_from_name(path)
    age_group = age_group_from_root(root)
    source_title = path.parent.name if path.parent != root else path.stem
    lesson_date = SPRING_2026_DATES.get(week or 0)
    candidates: list[ResourceCandidate] = []
    for resource_type in detected_types(text):
        label = RESOURCE_LABELS[resource_type]
        resource_title = title if resource_type == "lesson_packet" else f"{label}: {title}"
        page_start, page_end = page_range_for(resource_type, page_texts)
        candidates.append(
            ResourceCandidate(
                title=resource_title[:220],
                resource_type=resource_type,
                age_group=age_group,
                source_title=source_title[:220],
                theme=theme[:220],
                bible_reference=reference[:160],
                lesson_date=lesson_date,
                week_number=week,
                translation=translation,
                file_name=path.name,
                file_path=str(path),
                page_start=page_start,
                page_end=page_end,
                summary=summary_for(resource_type, text, overview_note),
                sort_order=RESOURCE_SORT[resource_type],
            )
        )
    return candidates


def upsert_candidate(session: Session, candidate: ResourceCandidate) -> bool:
    existing = session.scalar(
        select(SundaySchoolResource).where(
            SundaySchoolResource.file_path == candidate.file_path,
            SundaySchoolResource.resource_type == candidate.resource_type,
            SundaySchoolResource.translation == candidate.translation,
        )
    )
    if existing is None:
        session.add(SundaySchoolResource(**candidate.__dict__))
        return True
    for key, value in candidate.__dict__.items():
        setattr(existing, key, value)
    return False


def import_resources_from_roots(session: Session, roots: list[Path]) -> ImportResult:
    scanned = 0
    imported = 0
    for root in roots:
        overview = overview_by_week(root)
        for path in sorted(root.rglob("*.pdf")):
            scanned += 1
            for candidate in candidates_from_pdf(root, path, overview):
                if upsert_candidate(session, candidate):
                    imported += 1
    session.commit()
    return ImportResult(scanned=scanned, imported=imported)


def import_resources_from_default_roots(session: Session) -> ImportResult:
    return import_resources_from_roots(session, configured_roots())
