from hashlib import sha256
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import case, or_, select
from sqlalchemy.orm import Session

from app.core.database import get_session
from app.modules.identity.models import User
from app.modules.identity.auth import CurrentUser, require_any_permission, require_permission
from app.modules.library.bible_data import normalize_book_name
from app.modules.library.models import (
    BibleBook,
    BibleVerse,
    BibleVersion,
    FileCategory,
    ItemFile,
    PlanResource,
    Resource,
    StoredFile,
)
from app.modules.library.schemas import (
    BibleVersionRead,
    BibleBookRead,
    BiblePassageRead,
    BibleSearchHitRead,
    FileCategoryRead,
    ItemFileCreate,
    ItemFileRead,
    PlanResourceCreate,
    PlanResourceRead,
    PlanResourceUpdate,
    ResourceCreate,
    ResourceRead,
    ResourceUpdate,
    RenderedSlideRead,
    StoredFileRead,
)
from app.modules.planning.routes import get_item_or_404, get_plan_or_404

router = APIRouter()
UPLOAD_ROOT = Path("/app/storage/uploads")
RENDER_ROOT = Path("/app/storage/rendered")
RENDER_PIPELINE_VERSION = "libreoffice-pdf-png-v2"
LIBREOFFICE_RENDER_TIMEOUT_SECONDS = 300
PDF_TO_PNG_RENDER_TIMEOUT_SECONDS = 300
PDF_TO_PNG_DPI = 120


def resource_to_read(resource: Resource) -> ResourceRead:
    return ResourceRead(
        id=resource.id,
        name=resource.name,
        description=resource.description,
        resource_type=resource.resource_type,
    )


def get_resource_or_404(session: Session, resource_id: str) -> Resource:
    resource = session.get(Resource, resource_id)
    if resource is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Resource not found")
    return resource


def plan_resource_to_read(session: Session, plan_resource: PlanResource) -> PlanResourceRead:
    resource = get_resource_or_404(session, plan_resource.resource_id)
    return PlanResourceRead(
        id=plan_resource.id,
        plan_id=plan_resource.plan_id,
        resource_id=plan_resource.resource_id,
        notes=plan_resource.notes,
        resource_name=resource.name,
        resource_type=resource.resource_type,
    )


def stored_file_to_read(file: StoredFile) -> StoredFileRead:
    return StoredFileRead(
        id=file.id,
        category_id=file.category_id,
        song_id=file.song_id,
        display_name=file.display_name,
        content_type=file.content_type,
        checksum=file.checksum,
    )


def item_file_to_read(session: Session, row: ItemFile) -> ItemFileRead:
    file = session.get(StoredFile, row.file_id)
    if file is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")

    return ItemFileRead(
        id=row.id,
        plan_item_id=row.plan_item_id,
        file_id=row.file_id,
        sort_order=row.sort_order,
        display_name=file.display_name,
        content_type=file.content_type,
    )


def _stored_file_or_404(session: Session, file_id: str) -> StoredFile:
    stored = session.get(StoredFile, file_id)
    if stored is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")
    return stored


def _rendered_dir(file_id: str) -> Path:
    return RENDER_ROOT / file_id


def _rendered_slide_paths(file_id: str) -> list[Path]:
    output_dir = _rendered_dir(file_id)
    return sorted(output_dir.glob("slide-*.png"), key=lambda path: int(path.stem.replace("slide-", "")))


def _render_manifest_path(file_id: str) -> Path:
    return _rendered_dir(file_id) / "manifest.txt"


def _render_manifest_value(stored: StoredFile) -> str:
    suffix = Path(stored.storage_path).suffix.lower()
    return "|".join([RENDER_PIPELINE_VERSION, stored.checksum or "", suffix])


def _render_cache_is_current(stored: StoredFile) -> bool:
    slides = _rendered_slide_paths(stored.id)
    if not slides:
        return False

    manifest_path = _render_manifest_path(stored.id)
    if not manifest_path.exists():
        return False

    return manifest_path.read_text(encoding="utf-8").strip() == _render_manifest_value(stored)


def _write_render_manifest(stored: StoredFile) -> None:
    _render_manifest_path(stored.id).write_text(_render_manifest_value(stored), encoding="utf-8")


def _required_tool(name: str) -> str:
    path = shutil.which(name)
    if path is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Slide rendering is not available because {name} is not installed in the API container. Rebuild the API image.",
        )
    return path


def _office_command() -> str:
    command = shutil.which("soffice") or shutil.which("libreoffice")
    if command is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Slide rendering is not available because LibreOffice is not installed in the API container. Rebuild the API image.",
        )
    return command


def _render_slides(stored: StoredFile) -> list[Path]:
    source_path = Path(stored.storage_path)
    if not source_path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Stored file is missing")

    output_dir = _rendered_dir(stored.id)
    if _render_cache_is_current(stored):
        return _rendered_slide_paths(stored.id)

    if output_dir.exists():
        shutil.rmtree(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    suffix = source_path.suffix.lower()

    if suffix in {".png", ".jpg", ".jpeg"}:
        target = output_dir / "slide-1.png"
        shutil.copyfile(source_path, target)
        _write_render_manifest(stored)
        return [target]

    with tempfile.TemporaryDirectory() as temp_dir_name:
        temp_dir = Path(temp_dir_name)
        pdf_path = source_path

        if suffix != ".pdf":
            office_command = _office_command()
            office_profile = temp_dir / "lo-profile"
            subprocess.run(
                [
                    office_command,
                    "--headless",
                    "--nologo",
                    "--nofirststartwizard",
                    "--invisible",
                    "--nodefault",
                    "--nolockcheck",
                    f"-env:UserInstallation=file://{office_profile}",
                    "--convert-to",
                    "pdf:impress_pdf_Export",
                    "--outdir",
                    str(temp_dir),
                    str(source_path),
                ],
                check=True,
                capture_output=True,
                text=True,
                timeout=LIBREOFFICE_RENDER_TIMEOUT_SECONDS,
            )
            converted = list(temp_dir.glob("*.pdf"))
            if not converted:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="LibreOffice did not produce a PDF for this deck.",
                )
            pdf_path = converted[0]

        prefix = output_dir / "slide"
        subprocess.run(
            [_required_tool("pdftoppm"), "-png", "-r", str(PDF_TO_PNG_DPI), str(pdf_path), str(prefix)],
            check=True,
            capture_output=True,
            text=True,
            timeout=PDF_TO_PNG_RENDER_TIMEOUT_SECONDS,
        )

    slides = sorted(output_dir.glob("slide-*.png"))
    if not slides:
        slides = sorted(output_dir.glob("slide-*.png")) or sorted(output_dir.glob("slide*.png"))

    _write_render_manifest(stored)

    # pdftoppm names files as slide-1.png when the prefix is "slide".
    return _rendered_slide_paths(stored.id) or sorted(output_dir.glob("slide*.png"))


def _parse_reference_query(raw: str) -> tuple[str, int, int, int | None] | None:
    compact = " ".join(raw.replace(":", " ").replace("-", " - ").split())
    if not compact:
        return None

    parts = compact.split()
    split_index = next((index for index, part in enumerate(parts) if part.isdigit()), None)
    if split_index is None or split_index == 0:
        return None

    book_raw = " ".join(parts[:split_index])
    book_name = normalize_book_name(book_raw)
    if book_name is None:
        return None

    chapter = int(parts[split_index])
    if len(parts) == split_index + 1:
        return book_name, chapter, 1, None

    verse_from_part = parts[split_index + 1]
    if not verse_from_part.isdigit():
        return None
    verse_from = int(verse_from_part)

    verse_to: int | None = None
    if len(parts) > split_index + 2:
        if parts[split_index + 2] == "-" and len(parts) > split_index + 3 and parts[split_index + 3].isdigit():
            verse_to = int(parts[split_index + 3])
        elif parts[split_index + 2].isdigit():
            verse_to = int(parts[split_index + 2])
    return book_name, chapter, verse_from, verse_to


def _clean_bible_verse_text(text: str) -> str:
    cleaned = re.sub(r"\{[^{}]*\}", "", text)
    cleaned = re.sub(r"\s+", " ", cleaned)
    cleaned = re.sub(r"\s+([,.;:?!])", r"\1", cleaned)
    return cleaned.strip()


def _passage_to_read(
    *,
    version_code: str,
    book_name: str,
    chapter: int,
    verse_from: int,
    verses: list[BibleVerse],
) -> BibleSearchHitRead:
    verse_to = verses[-1].verse
    reference = f"{book_name} {chapter}:{verse_from}"
    if verse_to != verse_from:
        reference = f"{reference}-{verse_to}"
    text = "\n".join(f"{verse.verse}. {_clean_bible_verse_text(verse.text)}" for verse in verses)
    return BibleSearchHitRead(
        version=version_code,
        reference=reference,
        text=text,
        book=book_name,
        chapter=chapter,
        verse_from=verse_from,
        verse_to=verse_to,
    )


@router.get("/resources", response_model=list[ResourceRead])
def list_resources(
    _current_user: User = Depends(require_permission("library:read")),
    session: Session = Depends(get_session),
) -> list[ResourceRead]:
    resources = session.scalars(select(Resource).order_by(Resource.name)).all()
    return [resource_to_read(resource) for resource in resources]


@router.post("/resources", response_model=ResourceRead, status_code=status.HTTP_201_CREATED)
def create_resource(
    payload: ResourceCreate,
    _current_user: User = Depends(require_permission("library:create")),
    session: Session = Depends(get_session),
) -> ResourceRead:
    resource = Resource(**payload.model_dump())
    session.add(resource)
    session.commit()
    session.refresh(resource)
    return resource_to_read(resource)


@router.patch("/resources/{resource_id}", response_model=ResourceRead)
def update_resource(
    resource_id: str,
    payload: ResourceUpdate,
    _current_user: User = Depends(require_any_permission("library:edit", "library:create")),
    session: Session = Depends(get_session),
) -> ResourceRead:
    resource = get_resource_or_404(session, resource_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(resource, field, value)

    session.commit()
    session.refresh(resource)
    return resource_to_read(resource)


@router.delete("/resources/{resource_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_resource(
    resource_id: str,
    _current_user: User = Depends(require_permission("library:delete")),
    session: Session = Depends(get_session),
) -> Response:
    resource = get_resource_or_404(session, resource_id)
    session.delete(resource)
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/plans/{plan_id}/resources", response_model=list[PlanResourceRead])
def list_plan_resources(
    plan_id: str,
    _current_user: User = Depends(require_permission("library:read")),
    session: Session = Depends(get_session),
) -> list[PlanResourceRead]:
    get_plan_or_404(session, plan_id)
    rows = session.scalars(
        select(PlanResource).where(PlanResource.plan_id == plan_id).order_by(PlanResource.created_at)
    ).all()
    return [plan_resource_to_read(session, row) for row in rows]


@router.post(
    "/plans/{plan_id}/resources",
    response_model=PlanResourceRead,
    status_code=status.HTTP_201_CREATED,
)
def assign_plan_resource(
    plan_id: str,
    payload: PlanResourceCreate,
    _current_user: User = Depends(
        require_any_permission("library:edit", "library:create", "plans:edit", "plans:create")
    ),
    session: Session = Depends(get_session),
) -> PlanResourceRead:
    get_plan_or_404(session, plan_id)
    get_resource_or_404(session, payload.resource_id)
    if payload.plan_id != plan_id:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Plan mismatch")

    row = PlanResource(**payload.model_dump())
    session.add(row)
    session.commit()
    session.refresh(row)
    return plan_resource_to_read(session, row)


@router.patch("/plan-resources/{plan_resource_id}", response_model=PlanResourceRead)
def update_plan_resource(
    plan_resource_id: str,
    payload: PlanResourceUpdate,
    _current_user: User = Depends(
        require_any_permission("library:edit", "library:create", "plans:edit", "plans:create")
    ),
    session: Session = Depends(get_session),
) -> PlanResourceRead:
    row = session.get(PlanResource, plan_resource_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plan resource not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(row, field, value)

    session.commit()
    session.refresh(row)
    return plan_resource_to_read(session, row)


@router.delete("/plan-resources/{plan_resource_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_plan_resource(
    plan_resource_id: str,
    _current_user: User = Depends(require_any_permission("library:delete", "plans:delete")),
    session: Session = Depends(get_session),
) -> Response:
    row = session.get(PlanResource, plan_resource_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plan resource not found")
    session.delete(row)
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/file-categories", response_model=list[FileCategoryRead])
def list_file_categories(
    _current_user: User = Depends(require_permission("library:read")),
    session: Session = Depends(get_session),
) -> list[FileCategoryRead]:
    categories = session.scalars(select(FileCategory).order_by(FileCategory.name)).all()
    return [
        FileCategoryRead(id=category.id, name=category.name, description=category.description)
        for category in categories
    ]


@router.get("/files", response_model=list[StoredFileRead])
def list_files(
    song_id: str | None = None,
    category_id: str | None = None,
    _current_user: User = Depends(require_permission("library:read")),
    session: Session = Depends(get_session),
) -> list[StoredFileRead]:
    statement = select(StoredFile).order_by(StoredFile.created_at.desc(), StoredFile.display_name)
    if song_id:
        statement = statement.where(StoredFile.song_id == song_id)
    if category_id:
        statement = statement.where(StoredFile.category_id == category_id)

    return [stored_file_to_read(file) for file in session.scalars(statement).all()]


@router.post("/files", response_model=StoredFileRead, status_code=status.HTTP_201_CREATED)
async def upload_file(
    upload: UploadFile = File(...),
    display_name: str | None = Form(default=None),
    category_id: str | None = Form(default=None),
    song_id: str | None = Form(default=None),
    _current_user: User = Depends(require_permission("library:create")),
    session: Session = Depends(get_session),
) -> StoredFileRead:
    UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)
    original_name = upload.filename or "upload"
    storage_name = f"{uuid4()}-{Path(original_name).name}"
    storage_path = UPLOAD_ROOT / storage_name

    digest = sha256()
    with storage_path.open("wb") as output:
        while chunk := await upload.read(1024 * 1024):
            digest.update(chunk)
            output.write(chunk)

    stored = StoredFile(
        category_id=category_id or None,
        song_id=song_id or None,
        display_name=display_name or original_name,
        storage_path=str(storage_path),
        content_type=upload.content_type,
        checksum=digest.hexdigest(),
    )
    session.add(stored)
    session.commit()
    session.refresh(stored)
    return stored_file_to_read(stored)


@router.get("/files/{file_id}/download")
def download_file(
    file_id: str,
    _current_user: User = Depends(require_permission("library:read")),
    session: Session = Depends(get_session),
) -> FileResponse:
    stored = _stored_file_or_404(session, file_id)

    return FileResponse(
        stored.storage_path,
        filename=stored.display_name,
        media_type=stored.content_type or "application/octet-stream",
    )


@router.get("/files/{file_id}/slides", response_model=list[RenderedSlideRead])
def list_rendered_slides(
    file_id: str,
    _current_user: User = Depends(require_permission("library:read")),
    session: Session = Depends(get_session),
) -> list[RenderedSlideRead]:
    stored = _stored_file_or_404(session, file_id)
    try:
        slides = _render_slides(stored)
    except FileNotFoundError as error:
        missing_tool = error.filename or "required rendering tool"
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Slide rendering is not available because {missing_tool} is not installed in the API container. Rebuild the API image.",
        ) from error
    except subprocess.CalledProcessError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=error.stderr or error.stdout or "Could not render slide deck.",
        ) from error
    except subprocess.TimeoutExpired as error:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="Slide rendering timed out.",
        ) from error
    if not slides:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Slide rendering completed but produced no preview images.",
        )

    return [
        RenderedSlideRead(index=index + 1, image_url=f"/api/v1/library/files/{file_id}/slides/{index + 1}.png")
        for index, _path in enumerate(slides)
    ]


@router.get("/files/{file_id}/slides/{slide_index}.png")
def get_rendered_slide(
    file_id: str,
    slide_index: int,
    _current_user: User = Depends(require_permission("library:read")),
    session: Session = Depends(get_session),
) -> FileResponse:
    stored = _stored_file_or_404(session, file_id)
    slides = _render_slides(stored)
    if slide_index < 1 or slide_index > len(slides):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Rendered slide not found")
    return FileResponse(slides[slide_index - 1], media_type="image/png")


@router.get("/items/{plan_item_id}/files", response_model=list[ItemFileRead])
def list_item_files(
    plan_item_id: str,
    _current_user: User = Depends(require_permission("library:read")),
    session: Session = Depends(get_session),
) -> list[ItemFileRead]:
    get_item_or_404(session, plan_item_id)
    rows = session.scalars(
        select(ItemFile).where(ItemFile.plan_item_id == plan_item_id).order_by(ItemFile.sort_order)
    ).all()
    return [item_file_to_read(session, row) for row in rows]


@router.post("/items/{plan_item_id}/files", response_model=ItemFileRead, status_code=status.HTTP_201_CREATED)
def attach_item_file(
    plan_item_id: str,
    payload: ItemFileCreate,
    _current_user: User = Depends(
        require_any_permission("library:edit", "library:create", "plans:edit", "plans:create")
    ),
    session: Session = Depends(get_session),
) -> ItemFileRead:
    get_item_or_404(session, plan_item_id)
    if session.get(StoredFile, payload.file_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")

    row = ItemFile(plan_item_id=plan_item_id, file_id=payload.file_id, sort_order=payload.sort_order)
    session.add(row)
    session.commit()
    session.refresh(row)
    return item_file_to_read(session, row)


@router.delete("/item-files/{item_file_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_item_file(
    item_file_id: str,
    _current_user: User = Depends(require_any_permission("library:delete", "plans:delete")),
    session: Session = Depends(get_session),
) -> Response:
    row = session.get(ItemFile, item_file_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item file not found")
    session.delete(row)
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/bible/versions", response_model=list[BibleVersionRead])
def list_bible_versions(
    _current_user: User = Depends(require_permission("library:read")),
    session: Session = Depends(get_session),
) -> list[BibleVersionRead]:
    versions = session.scalars(select(BibleVersion).order_by(BibleVersion.code)).all()
    return [
        BibleVersionRead(
            id=version.id,
            code=version.code,
            name=version.name,
            language=version.language,
            license=version.license,
        )
        for version in versions
    ]


@router.get("/bible/books", response_model=list[BibleBookRead])
def list_bible_books(
    _current_user: User = Depends(require_permission("library:read")),
    session: Session = Depends(get_session),
) -> list[BibleBookRead]:
    books = session.scalars(select(BibleBook).order_by(BibleBook.sort_order)).all()
    return [
        BibleBookRead(
            id=book.id,
            name=book.name,
            abbreviation=book.abbreviation,
            testament=book.testament,
            sort_order=book.sort_order,
        )
        for book in books
    ]


@router.get("/bible/passage/{version_code}/{book_name}/{chapter}/{verse_from}", response_model=BiblePassageRead)
def get_bible_passage(
    version_code: str,
    book_name: str,
    chapter: int,
    verse_from: int,
    verse_to: int | None = None,
    _current_user: User = Depends(require_permission("library:read")),
    session: Session = Depends(get_session),
) -> BiblePassageRead:
    version = session.scalar(select(BibleVersion).where(BibleVersion.code == version_code))
    if version is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bible version not found")

    book = session.scalar(
        select(BibleBook).where(
            (BibleBook.name.ilike(book_name)) | (BibleBook.abbreviation.ilike(book_name))
        )
    )
    if book is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bible book not found")

    last_verse = verse_to or verse_from
    verses = session.scalars(
        select(BibleVerse)
        .where(
            BibleVerse.version_id == version.id,
            BibleVerse.book_id == book.id,
            BibleVerse.chapter == chapter,
            BibleVerse.verse >= verse_from,
            BibleVerse.verse <= last_verse,
        )
        .order_by(BibleVerse.verse)
    ).all()
    if not verses:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Passage not found")

    reference = f"{book.name} {chapter}:{verse_from}"
    if last_verse != verse_from:
        reference = f"{reference}-{last_verse}"

    text = "\n".join(f"{verse.verse}. {_clean_bible_verse_text(verse.text)}" for verse in verses)
    return BiblePassageRead(version=version.code, reference=reference, text=text)


@router.get("/bible/search", response_model=list[BibleSearchHitRead])
def search_bible(
    q: str,
    version_code: str = "KJV",
    search_type: str = "auto",
    limit: int = 20,
    _current_user: User = Depends(require_permission("library:read")),
    session: Session = Depends(get_session),
) -> list[BibleSearchHitRead]:
    version = session.scalar(select(BibleVersion).where(BibleVersion.code == version_code))
    if version is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bible version not found")

    query = q.strip()
    if not query:
        return []

    parsed = _parse_reference_query(query)
    if search_type in {"auto", "reference"} and parsed is not None:
        book_name, chapter, verse_from, verse_to = parsed
        book = session.scalar(select(BibleBook).where(BibleBook.name == book_name))
        if book is None:
            return []
        verses = session.scalars(
            select(BibleVerse)
            .where(
                BibleVerse.version_id == version.id,
                BibleVerse.book_id == book.id,
                BibleVerse.chapter == chapter,
                BibleVerse.verse >= verse_from,
                BibleVerse.verse <= (verse_to or verse_from),
            )
            .order_by(BibleVerse.verse)
        ).all()
        if not verses:
            return []
        return [
            _passage_to_read(
                version_code=version.code,
                book_name=book.name,
                chapter=chapter,
                verse_from=verse_from,
                verses=verses,
            )
        ]

    if search_type == "reference":
        return []

    exact_match = query.lower()
    prefix_match = f"{query}%"
    contains_match = f"%{query}%"
    rank = case(
        (BibleBook.name.ilike(exact_match), 0),
        (BibleBook.abbreviation.ilike(exact_match), 0),
        (BibleBook.name.ilike(prefix_match), 1),
        (BibleBook.abbreviation.ilike(prefix_match), 1),
        (BibleBook.name.ilike(contains_match), 2),
        (BibleBook.abbreviation.ilike(contains_match), 2),
        (BibleVerse.text.ilike(contains_match), 3),
        else_=4,
    )

    verses = session.scalars(
        select(BibleVerse, BibleBook)
        .join(BibleBook, BibleBook.id == BibleVerse.book_id)
        .where(
            BibleVerse.version_id == version.id,
            or_(
                BibleVerse.text.ilike(contains_match),
                BibleBook.name.ilike(contains_match),
                BibleBook.abbreviation.ilike(contains_match),
            ),
        )
        .order_by(rank, BibleBook.sort_order, BibleVerse.chapter, BibleVerse.verse)
        .limit(max(1, min(limit, 50)))
    ).all()

    results: list[BibleSearchHitRead] = []
    for verse in verses:
        book = session.get(BibleBook, verse.book_id)
        if book is None:
            continue
        results.append(
            BibleSearchHitRead(
                version=version.code,
                reference=f"{book.name} {verse.chapter}:{verse.verse}",
                text=_clean_bible_verse_text(verse.text),
                book=book.name,
                chapter=verse.chapter,
                verse_from=verse.verse,
                verse_to=verse.verse,
            )
        )
    return results
