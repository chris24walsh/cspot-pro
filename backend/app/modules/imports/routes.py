from io import BytesIO
from pathlib import Path
from zipfile import ZipFile
from xml.etree import ElementTree

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from pydantic import BaseModel, HttpUrl
from sqlalchemy.orm import Session

from app.core.database import get_session
from app.modules.identity.models import User
from app.modules.identity.auth import CurrentUser, require_any_permission, require_permission
from app.modules.imports.custom_provider_stub import run_custom_lyrics_provider
from app.modules.music.models import Song

router = APIRouter()


class ImportPreviewRequest(BaseModel):
    source_url: HttpUrl | None = None
    pasted_text: str | None = None


class ImportPreview(BaseModel):
    provider: str
    status: str
    notes: list[str]
    review_required: bool = True


class LyricsSaveRequest(BaseModel):
    title: str
    author: str | None = None
    lyrics: str
    source_url: HttpUrl | None = None
    source_label: str | None = None
    song_id: str | None = None


class LyricsSaveResult(BaseModel):
    song_id: str
    title: str
    status: str


class ParsedSlide(BaseModel):
    index: int
    title: str
    text: str


class ParsedSlideDeck(BaseModel):
    filename: str
    format: str
    slide_count: int
    slides: list[ParsedSlide]
    notes: list[str]


class CustomProviderSearchRequest(BaseModel):
    search_term: str


class CustomProviderSearchResult(BaseModel):
    provider: str
    status: str
    output_text: str | None = None
    notes: list[str]


def _clean_lines(lines: list[str]) -> list[str]:
    return [line.strip() for line in lines if line and line.strip()]


def _slide_title(lines: list[str], fallback: str) -> str:
    return lines[0] if lines else fallback


def _tag_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _parse_pptx_slide_lines(root: ElementTree.Element) -> list[str]:
    lines: list[str] = []

    for node in root.iter():
        if _tag_name(node.tag) != "p":
            continue

        text = "".join(child.text or "" for child in node.iter() if _tag_name(child.tag) == "t").strip()
        if text:
            lines.append(text)

    if lines:
        return _clean_lines(lines)

    return _clean_lines([node.text or "" for node in root.iter() if _tag_name(node.tag) == "t"])


def _parse_pptx(content: bytes) -> list[list[str]]:
    with ZipFile(BytesIO(content)) as archive:
        slide_names = sorted(
            [
                name
                for name in archive.namelist()
                if name.startswith("ppt/slides/slide") and name.endswith(".xml")
            ],
            key=lambda name: int(Path(name).stem.replace("slide", "")),
        )

        slides: list[list[str]] = []
        for slide_name in slide_names:
            root = ElementTree.fromstring(archive.read(slide_name))
            slides.append(_parse_pptx_slide_lines(root))
        return slides


def _parse_odp(content: bytes) -> list[list[str]]:
    namespaces = {
        "draw": "urn:oasis:names:tc:opendocument:xmlns:drawing:1.0",
        "text": "urn:oasis:names:tc:opendocument:xmlns:text:1.0",
    }
    with ZipFile(BytesIO(content)) as archive:
        root = ElementTree.fromstring(archive.read("content.xml"))
        slides: list[list[str]] = []
        for page in root.findall(".//draw:page", namespaces):
            lines: list[str] = []
            for node in page.findall(".//text:h", namespaces) + page.findall(".//text:p", namespaces):
                text = "".join(node.itertext()).strip()
                if text:
                    lines.append(text)
            slides.append(_clean_lines(lines))
        return slides


def _parse_slide_deck(filename: str, content: bytes) -> tuple[str, list[list[str]], list[str]]:
    suffix = Path(filename).suffix.lower()
    if suffix == ".pptx":
        return "pptx", _parse_pptx(content), []
    if suffix == ".odp":
        return "odp", _parse_odp(content), []
    raise HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail="Only .pptx and .odp parsing is supported right now.",
    )


@router.post("/slides/parse", response_model=ParsedSlideDeck)
async def parse_slide_deck(
    upload: UploadFile = File(...),
    _current_user: User = Depends(require_permission("presentation:use")),
) -> ParsedSlideDeck:
    content = await upload.read()
    filename = upload.filename or "slides"

    try:
        deck_format, slide_lines, notes = _parse_slide_deck(filename, content)
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Could not parse slide deck: {error}",
        ) from error

    slides = [
        ParsedSlide(
            index=index + 1,
            title=_slide_title(lines, f"Slide {index + 1}"),
            text="\n".join(lines),
        )
        for index, lines in enumerate(slide_lines)
        if lines
    ]
    return ParsedSlideDeck(
        filename=filename,
        format=deck_format,
        slide_count=len(slides),
        slides=slides,
        notes=notes,
    )


@router.post("/lyrics/preview", response_model=ImportPreview)
def preview_lyrics_import(
    request: ImportPreviewRequest,
    _current_user: User = Depends(require_permission("songs:read")),
) -> ImportPreview:
    if request.pasted_text:
        return ImportPreview(
            provider="manual-paste",
            status="ready-for-review",
            notes=["Parsed pasted text into a reviewable draft."],
        )

    if request.source_url:
        return ImportPreview(
            provider="url-review",
            status="requires-provider",
            notes=["URL import providers will be added source by source."],
        )

    return ImportPreview(
        provider="none",
        status="missing-input",
        notes=["Provide pasted lyrics or a source URL."],
    )


@router.get("/providers", response_model=list[str])
def list_import_providers(
    _current_user: User = Depends(require_permission("songs:read")),
) -> list[str]:
    return ["manual-paste", "url-review", "public-domain-seed", "custom-provider-stub"]


@router.post("/custom-provider/search", response_model=CustomProviderSearchResult)
def run_custom_provider_search(
    payload: CustomProviderSearchRequest,
    _current_user: User = Depends(require_permission("songs:read")),
) -> CustomProviderSearchResult:
    result = run_custom_lyrics_provider(payload.search_term)
    return CustomProviderSearchResult(
        provider=result.provider,
        status=result.status,
        output_text=result.output_text,
        notes=result.notes,
    )


@router.post("/lyrics/save", response_model=LyricsSaveResult)
def save_lyrics_import(
    payload: LyricsSaveRequest,
    _current_user: User = Depends(require_any_permission("songs:edit", "songs:create")),
    session: Session = Depends(get_session),
) -> LyricsSaveResult:
    if not payload.lyrics.strip():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Lyrics are required.",
        )

    if payload.song_id:
        song = session.get(Song, payload.song_id)
        if song is None or song.deleted_at is not None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Song not found")
        song.title = payload.title
        song.author = payload.author
        song.lyrics = payload.lyrics
    else:
        song = Song(
            title=payload.title,
            author=payload.author,
            lyrics=payload.lyrics,
            license="Unknown",
        )
        session.add(song)

    session.commit()
    session.refresh(song)
    return LyricsSaveResult(song_id=song.id, title=song.title, status="saved")
