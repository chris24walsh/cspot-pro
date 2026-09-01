import json
import re
import shutil
import subprocess
import tempfile
from hashlib import sha256
from pathlib import Path
from threading import Lock
from uuid import uuid4
from xml.etree import ElementTree
from zipfile import ZIP_DEFLATED, ZipFile

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import case, or_, select
from sqlalchemy.orm import Session

from app.core.database import get_session
from app.modules.identity.auth import require_any_permission, require_permission
from app.modules.identity.models import User
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
    BibleBookRead,
    BiblePassageRead,
    BibleSearchHitRead,
    BibleVersionRead,
    FileCategoryRead,
    ItemFileCreate,
    ItemFileRead,
    ItemFileUpdate,
    PlanResourceCreate,
    PlanResourceRead,
    PlanResourceUpdate,
    RenderedSlideRead,
    ResourceCreate,
    ResourceRead,
    ResourceUpdate,
    StoredFileRead,
)
from app.modules.planning.completion import require_plan_editable
from app.modules.planning.routes import get_item_or_404, get_plan_or_404

router = APIRouter()
UPLOAD_ROOT = Path("/app/storage/uploads")
RENDER_ROOT = Path("/app/storage/rendered")
RENDER_PIPELINE_VERSION = "libreoffice-pdf-png-v5"
PRE_SERVICE_CATEGORY_NAME = "Pre-service Montage"
LIBREOFFICE_RENDER_TIMEOUT_SECONDS = 300
PDF_TO_PNG_RENDER_TIMEOUT_SECONDS = 300
PDF_TO_PNG_DPI = 120
DEFAULT_SLIDE_WIDTH_EMU = 9144000
DEFAULT_SLIDE_HEIGHT_EMU = 6858000
PML_NS = "http://schemas.openxmlformats.org/presentationml/2006/main"
AML_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"
R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
CT_NS = "http://schemas.openxmlformats.org/package/2006/content-types"
SLIDE_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide"
SLIDE_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.slide+xml"
SHAPE_TAGS = {
    f"{{{PML_NS}}}sp",
    f"{{{PML_NS}}}pic",
    f"{{{PML_NS}}}graphicFrame",
    f"{{{PML_NS}}}cxnSp",
    f"{{{PML_NS}}}grpSp",
}
ElementTree.register_namespace("p", PML_NS)
ElementTree.register_namespace("a", AML_NS)
ElementTree.register_namespace("r", R_NS)
ElementTree.register_namespace("", CT_NS)
_render_locks: dict[str, Lock] = {}
_render_locks_guard = Lock()


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
        flatten_builds=file.flatten_builds,
    )


def pre_service_category(session: Session) -> FileCategory:
    category = session.scalar(
        select(FileCategory).where(FileCategory.name == PRE_SERVICE_CATEGORY_NAME)
    )
    if category is None:
        category = FileCategory(
            name=PRE_SERVICE_CATEGORY_NAME,
            description="Photos shown during the pre-service welcome montage.",
        )
        session.add(category)
        session.flush()
    return category


def item_file_to_read(session: Session, row: ItemFile) -> ItemFileRead:
    file = session.get(StoredFile, row.file_id)
    if file is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")

    return ItemFileRead(
        id=row.id,
        plan_item_id=row.plan_item_id,
        file_id=row.file_id,
        sort_order=row.sort_order,
        persistent=row.persistent,
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


def _build_manifest_path(file_id: str) -> Path:
    return _rendered_dir(file_id) / "builds.json"


def _render_manifest_value(stored: StoredFile) -> str:
    suffix = Path(stored.storage_path).suffix.lower()
    flatten_builds = "flatten-builds" if stored.flatten_builds else "static"
    return "|".join([RENDER_PIPELINE_VERSION, stored.checksum or "", suffix, flatten_builds])


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


def _write_build_manifest(file_id: str, build_counts: list[int]) -> None:
    _build_manifest_path(file_id).write_text(json.dumps(build_counts), encoding="utf-8")


def _read_build_manifest(file_id: str, slide_count: int) -> list[dict[str, int]]:
    manifest_path = _build_manifest_path(file_id)
    if not manifest_path.exists():
        return [
            {"original_index": index + 1, "build_index": 0, "build_count": 1}
            for index in range(slide_count)
        ]

    try:
        raw_counts = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        raw_counts = []

    metadata: list[dict[str, int]] = []
    if isinstance(raw_counts, list):
        for original_index, raw_count in enumerate(raw_counts, start=1):
            try:
                build_count = max(int(raw_count), 1)
            except (TypeError, ValueError):
                build_count = 1
            for build_index in range(build_count):
                metadata.append(
                    {
                        "original_index": original_index,
                        "build_index": build_index,
                        "build_count": build_count,
                    }
                )

    if len(metadata) != slide_count:
        return [
            {"original_index": index + 1, "build_index": 0, "build_count": 1}
            for index in range(slide_count)
        ]
    return metadata


def _render_lock_for(file_id: str) -> Lock:
    with _render_locks_guard:
        lock = _render_locks.get(file_id)
        if lock is None:
            lock = Lock()
            _render_locks[file_id] = lock
        return lock


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


def _numeric_slide_key(name: str) -> int:
    match = re.search(r"slide(\d+)\.xml$", name)
    return int(match.group(1)) if match else 0


def _shape_elements_by_id(root: ElementTree.Element) -> dict[str, ElementTree.Element]:
    shapes: dict[str, ElementTree.Element] = {}
    for shape in root.iter():
        if shape.tag not in SHAPE_TAGS:
            continue
        candidate = shape.find(f".//{{{PML_NS}}}cNvPr")
        target_id = candidate.attrib.get("id") if candidate is not None else None
        if target_id:
            shapes[target_id] = shape
    return shapes


def _parent_map(root: ElementTree.Element) -> dict[ElementTree.Element, ElementTree.Element]:
    return {child: parent for parent in root.iter() for child in parent}


def _shape_has_text(shape: ElementTree.Element) -> bool:
    text_body = shape.find(f".//{{{PML_NS}}}txBody")
    if text_body is None:
        return False
    return any((text.text or "").strip() for text in text_body.iter(f"{{{AML_NS}}}t"))


def _shape_bounds(shape: ElementTree.Element) -> tuple[int, int, int, int] | None:
    transform = shape.find(f".//{{{AML_NS}}}xfrm")
    if transform is None:
        return None
    offset = transform.find(f"{{{AML_NS}}}off")
    extent = transform.find(f"{{{AML_NS}}}ext")
    if offset is None or extent is None:
        return None
    try:
        return (
            int(offset.attrib.get("x", "0")),
            int(offset.attrib.get("y", "0")),
            int(extent.attrib.get("cx", "0")),
            int(extent.attrib.get("cy", "0")),
        )
    except ValueError:
        return None


def _shape_is_large_base_visual(shape: ElementTree.Element) -> bool:
    if _shape_has_text(shape):
        return False
    if shape.tag == f"{{{PML_NS}}}pic":
        return True
    bounds = _shape_bounds(shape)
    if bounds is None:
        return False
    _x, _y, width, height = bounds
    slide_area = DEFAULT_SLIDE_WIDTH_EMU * DEFAULT_SLIDE_HEIGHT_EMU
    shape_area = max(width, 0) * max(height, 0)
    return width >= DEFAULT_SLIDE_WIDTH_EMU * 0.45 and height >= DEFAULT_SLIDE_HEIGHT_EMU * 0.45 and shape_area >= slide_area * 0.25


def _is_entrance_build_target(
    target: ElementTree.Element,
    parents: dict[ElementTree.Element, ElementTree.Element],
) -> bool:
    current: ElementTree.Element | None = target
    while current is not None:
        if current.tag == f"{{{PML_NS}}}animEffect":
            transition = current.attrib.get("transition")
            if transition == "out":
                return False
        if current.tag == f"{{{PML_NS}}}set":
            for descendant in current.iter():
                value = descendant.attrib.get("val")
                if value == "hidden":
                    return False
        current = parents.get(current)
    return True


def _is_exit_build_target(
    target: ElementTree.Element,
    parents: dict[ElementTree.Element, ElementTree.Element],
) -> bool:
    current: ElementTree.Element | None = target
    while current is not None:
        if current.tag == f"{{{PML_NS}}}animEffect" and current.attrib.get("transition") == "out":
            return True
        if current.tag == f"{{{PML_NS}}}set":
            for descendant in current.iter():
                if descendant.attrib.get("val") == "hidden":
                    return True
        current = parents.get(current)
    return False


def _animation_build_events(root: ElementTree.Element) -> list[tuple[str, int | None, int | None]]:
    events: list[tuple[str, int | None, int | None]] = []
    seen: set[tuple[str, int | None, int | None]] = set()
    parents = _parent_map(root)
    for target in root.findall(f".//{{{PML_NS}}}spTgt"):
        if not _is_entrance_build_target(target, parents):
            continue
        target_id = target.attrib.get("spid")
        if not target_id:
            continue
        paragraph_range = target.find(f".//{{{PML_NS}}}pRg")
        start = end = None
        if paragraph_range is not None:
            start_raw = paragraph_range.attrib.get("st")
            end_raw = paragraph_range.attrib.get("end")
            if start_raw is not None and end_raw is not None:
                try:
                    start = int(start_raw)
                    end = int(end_raw)
                except ValueError:
                    start = end = None
        event = (target_id, start, end)
        if event not in seen:
            seen.add(event)
            events.append(event)
    return events


def _animation_exit_targets(root: ElementTree.Element) -> set[str]:
    targets: set[str] = set()
    parents = _parent_map(root)
    for target in root.findall(f".//{{{PML_NS}}}spTgt"):
        if not _is_exit_build_target(target, parents):
            continue
        target_id = target.attrib.get("spid")
        if target_id:
            targets.add(target_id)
    return targets


def _remove_shape(root: ElementTree.Element, shape: ElementTree.Element) -> None:
    parent = _parent_map(root).get(shape)
    if parent is not None:
        parent.remove(shape)


def _remove_shapes_by_id(root: ElementTree.Element, target_ids: set[str]) -> None:
    if not target_ids:
        return
    shapes = _shape_elements_by_id(root)
    for target_id in target_ids:
        shape = shapes.get(target_id)
        if shape is not None:
            _remove_shape(root, shape)


def _hide_future_builds(
    root: ElementTree.Element,
    events: list[tuple[str, int | None, int | None]],
    visible_event_count: int,
) -> None:
    shapes = _shape_elements_by_id(root)
    future_events = events[visible_event_count:]
    remove_shapes: set[str] = set()
    hidden_paragraphs: dict[str, set[int]] = {}

    for target_id, start, end in future_events:
        if start is None or end is None:
            shape = shapes.get(target_id)
            if shape is not None and not _shape_is_large_base_visual(shape):
                remove_shapes.add(target_id)
            continue
        hidden_paragraphs.setdefault(target_id, set()).update(range(start, end + 1))

    for target_id in remove_shapes:
        shape = shapes.get(target_id)
        if shape is not None:
            _remove_shape(root, shape)

    for target_id, paragraph_indexes in hidden_paragraphs.items():
        shape = shapes.get(target_id)
        if shape is None or target_id in remove_shapes:
            continue
        text_body = shape.find(f".//{{{PML_NS}}}txBody")
        if text_body is None:
            continue
        paragraphs = [child for child in list(text_body) if child.tag == f"{{{AML_NS}}}p"]
        for index in sorted(paragraph_indexes, reverse=True):
            if 0 <= index < len(paragraphs):
                text_body.remove(paragraphs[index])
        if not [child for child in list(text_body) if child.tag == f"{{{AML_NS}}}p"]:
            _remove_shape(root, shape)


def _set_slide_id_list(presentation_root: ElementTree.Element, slide_entries: list[tuple[str, str]]) -> None:
    slide_id_list = presentation_root.find(f"{{{PML_NS}}}sldIdLst")
    if slide_id_list is None:
        slide_id_list = ElementTree.SubElement(presentation_root, f"{{{PML_NS}}}sldIdLst")
    slide_id_list.clear()
    for index, (_slide_name, rel_id) in enumerate(slide_entries, start=256):
        ElementTree.SubElement(
            slide_id_list,
            f"{{{PML_NS}}}sldId",
            {"id": str(index), f"{{{R_NS}}}id": rel_id},
        )


def _set_presentation_relationships(rels_root: ElementTree.Element, slide_entries: list[tuple[str, str]]) -> None:
    for relationship in list(rels_root):
        if relationship.attrib.get("Type") == SLIDE_REL_TYPE:
            rels_root.remove(relationship)
    for slide_name, rel_id in slide_entries:
        ElementTree.SubElement(
            rels_root,
            f"{{{REL_NS}}}Relationship",
            {"Id": rel_id, "Type": SLIDE_REL_TYPE, "Target": f"slides/{Path(slide_name).name}"},
        )


def _set_content_types(content_types_root: ElementTree.Element, slide_entries: list[tuple[str, str]]) -> None:
    slide_part_names = {f"/ppt/slides/{Path(slide_name).name}" for slide_name, _rel_id in slide_entries}
    for override in list(content_types_root):
        part_name = str(override.attrib.get("PartName", ""))
        if override.tag == f"{{{CT_NS}}}Override" and part_name.startswith("/ppt/slides/slide"):
            content_types_root.remove(override)
    for part_name in sorted(slide_part_names, key=lambda value: _numeric_slide_key(value)):
        ElementTree.SubElement(
            content_types_root,
            f"{{{CT_NS}}}Override",
            {"PartName": part_name, "ContentType": SLIDE_CONTENT_TYPE},
        )


def _flatten_pptx_builds(source_path: Path, output_path: Path) -> list[int] | None:
    with ZipFile(source_path, "r") as source:
        names = source.namelist()
        slide_names = sorted(
            [name for name in names if re.fullmatch(r"ppt/slides/slide\d+\.xml", name)],
            key=_numeric_slide_key,
        )
        if not slide_names:
            return None

        generated_slides: list[tuple[str, bytes, str | None, bytes | None]] = []
        build_counts: list[int] = []
        found_builds = False
        next_slide_number = 1
        for slide_name in slide_names:
            slide_xml = source.read(slide_name)
            root = ElementTree.fromstring(slide_xml)
            events = _animation_build_events(root)
            exit_targets = _animation_exit_targets(root)
            rels_name = f"ppt/slides/_rels/{Path(slide_name).name}.rels"
            rels_xml = source.read(rels_name) if rels_name in names else None
            states = range(len(events) + 1) if events else range(1)
            if events:
                found_builds = True
            build_counts.append(len(events) + 1 if events else 1)
            for visible_count in states:
                state_root = ElementTree.fromstring(slide_xml)
                _remove_shapes_by_id(state_root, exit_targets)
                if events:
                    _hide_future_builds(state_root, events, visible_count)
                new_slide_name = f"ppt/slides/slide{next_slide_number}.xml"
                new_rels_name = f"ppt/slides/_rels/slide{next_slide_number}.xml.rels" if rels_xml is not None else None
                generated_slides.append(
                    (
                        new_slide_name,
                        ElementTree.tostring(state_root, encoding="utf-8", xml_declaration=True),
                        new_rels_name,
                        rels_xml,
                    )
                )
                next_slide_number += 1

        if not found_builds:
            return None

        slide_entries = [
            (slide_name, f"rIdFlattenedSlide{index}")
            for index, (slide_name, _xml, _rels_name, _rels_xml) in enumerate(generated_slides, start=1)
        ]
        presentation_root = ElementTree.fromstring(source.read("ppt/presentation.xml"))
        _set_slide_id_list(presentation_root, slide_entries)
        presentation_rels_root = ElementTree.fromstring(source.read("ppt/_rels/presentation.xml.rels"))
        _set_presentation_relationships(presentation_rels_root, slide_entries)
        content_types_root = ElementTree.fromstring(source.read("[Content_Types].xml"))
        _set_content_types(content_types_root, slide_entries)
        generated_slide_names = {slide_name for slide_name, _xml, _rels_name, _rels_xml in generated_slides}
        generated_rels_names = {rels_name for _slide_name, _xml, rels_name, _rels_xml in generated_slides if rels_name}

        with ZipFile(output_path, "w", compression=ZIP_DEFLATED) as target:
            for name in names:
                if name in slide_names:
                    continue
                if re.fullmatch(r"ppt/slides/_rels/slide\d+\.xml\.rels", name):
                    continue
                if name in {"ppt/presentation.xml", "ppt/_rels/presentation.xml.rels", "[Content_Types].xml"}:
                    continue
                target.writestr(name, source.read(name))
            target.writestr(
                "ppt/presentation.xml",
                ElementTree.tostring(presentation_root, encoding="utf-8", xml_declaration=True),
            )
            target.writestr(
                "ppt/_rels/presentation.xml.rels",
                ElementTree.tostring(presentation_rels_root, encoding="utf-8", xml_declaration=True),
            )
            target.writestr(
                "[Content_Types].xml",
                ElementTree.tostring(content_types_root, encoding="utf-8", xml_declaration=True),
            )
            for slide_name, slide_xml, rels_name, rels_xml in generated_slides:
                if slide_name not in generated_slide_names:
                    continue
                target.writestr(slide_name, slide_xml)
                if rels_name and rels_xml and rels_name in generated_rels_names:
                    target.writestr(rels_name, rels_xml)

    return build_counts


def _render_slides(stored: StoredFile) -> list[Path]:
    with _render_lock_for(stored.id):
        return _render_slides_locked(stored)


def _render_slides_locked(stored: StoredFile) -> list[Path]:
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
        build_counts: list[int] | None = None

        if suffix != ".pdf":
            office_command = _office_command()
            office_profile = temp_dir / "lo-profile"
            office_source_path = source_path
            if stored.flatten_builds and suffix == ".pptx":
                flattened_path = temp_dir / f"{source_path.stem}-click-builds.pptx"
                try:
                    next_build_counts = _flatten_pptx_builds(source_path, flattened_path)
                    if next_build_counts:
                        build_counts = next_build_counts
                        office_source_path = flattened_path
                except Exception:
                    office_source_path = source_path
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
                    str(office_source_path),
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

        if build_counts:
            _write_build_manifest(stored.id, build_counts)

    slides = sorted(output_dir.glob("slide-*.png"))
    if not slides:
        slides = sorted(output_dir.glob("slide-*.png")) or sorted(output_dir.glob("slide*.png"))

    _write_render_manifest(stored)

    # pdftoppm names files as slide-1.png when the prefix is "slide".
    return _rendered_slide_paths(stored.id) or sorted(output_dir.glob("slide*.png"))


def _parse_reference_query(raw: str) -> tuple[str, int, int, int | None] | None:
    compact = raw.replace(":", " ").replace("-", " - ")
    compact = re.sub(r"([A-Za-z])(\d)", r"\1 \2", compact)
    compact = re.sub(r"(\d)([A-Za-z])", r"\1 \2", compact)
    compact = " ".join(compact.split())
    if not compact:
        return None

    parts = compact.split()
    candidates: list[tuple[str, int]] = []
    for index, part in enumerate(parts):
        if index <= 0 or not part.isdigit():
            continue
        book_name = normalize_book_name(" ".join(parts[:index]))
        if book_name is not None:
            candidates.append((book_name, index))
    if not candidates:
        return None

    book_name, split_index = max(candidates, key=lambda candidate: candidate[1])

    chapter = int(parts[split_index])
    if len(parts) == split_index + 1:
        return book_name, chapter, 1, None

    verse_from_part = parts[split_index + 1]
    if not verse_from_part.isdigit():
        return None
    verse_from = int(verse_from_part)

    verse_to: int | None = None
    if len(parts) > split_index + 2:
        if (
            parts[split_index + 2] == "-"
            and len(parts) > split_index + 3
            and parts[split_index + 3].isdigit()
        ):
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
    current_user: User = Depends(
        require_any_permission("library:edit", "library:create", "plans:edit", "plans:create")
    ),
    session: Session = Depends(get_session),
) -> PlanResourceRead:
    plan = get_plan_or_404(session, plan_id)
    require_plan_editable(session, plan, current_user)
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
    current_user: User = Depends(
        require_any_permission("library:edit", "library:create", "plans:edit", "plans:create")
    ),
    session: Session = Depends(get_session),
) -> PlanResourceRead:
    row = session.get(PlanResource, plan_resource_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plan resource not found")
    plan = get_plan_or_404(session, row.plan_id)
    require_plan_editable(session, plan, current_user)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(row, field, value)

    session.commit()
    session.refresh(row)
    return plan_resource_to_read(session, row)


@router.delete("/plan-resources/{plan_resource_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_plan_resource(
    plan_resource_id: str,
    current_user: User = Depends(require_any_permission("library:delete", "plans:delete")),
    session: Session = Depends(get_session),
) -> Response:
    row = session.get(PlanResource, plan_resource_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plan resource not found")
    plan = get_plan_or_404(session, row.plan_id)
    require_plan_editable(session, plan, current_user)
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
    flatten_builds: bool = Form(default=False),
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
        flatten_builds=flatten_builds,
    )
    session.add(stored)
    session.commit()
    session.refresh(stored)
    return stored_file_to_read(stored)


@router.get("/pre-service-media", response_model=list[StoredFileRead])
def list_pre_service_media(
    _current_user: User = Depends(require_any_permission("plans:read", "presentation:use")),
    session: Session = Depends(get_session),
) -> list[StoredFileRead]:
    category = session.scalar(
        select(FileCategory).where(FileCategory.name == PRE_SERVICE_CATEGORY_NAME)
    )
    if category is None:
        return []
    files = session.scalars(
        select(StoredFile)
        .where(StoredFile.category_id == category.id, StoredFile.content_type.like("image/%"))
        .order_by(StoredFile.created_at, StoredFile.display_name)
    ).all()
    return [stored_file_to_read(stored) for stored in files]


@router.post(
    "/pre-service-media",
    response_model=StoredFileRead,
    status_code=status.HTTP_201_CREATED,
)
async def upload_pre_service_media(
    upload: UploadFile = File(...),
    display_name: str | None = Form(default=None),
    current_user: User = Depends(require_any_permission("presentation:use", "users:manage")),
    session: Session = Depends(get_session),
) -> StoredFileRead:
    if not upload.content_type or not upload.content_type.startswith("image/"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Pre-service montage files must be images.",
        )
    category = pre_service_category(session)
    UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)
    original_name = upload.filename or "pre-service-photo"
    storage_name = f"{uuid4()}-{Path(original_name).name}"
    storage_path = UPLOAD_ROOT / storage_name
    digest = sha256()
    with storage_path.open("wb") as output:
        while chunk := await upload.read(1024 * 1024):
            digest.update(chunk)
            output.write(chunk)
    stored = StoredFile(
        category_id=category.id,
        uploaded_by_id=current_user.id,
        display_name=display_name or original_name,
        storage_path=str(storage_path),
        content_type=upload.content_type,
        checksum=digest.hexdigest(),
    )
    session.add(stored)
    session.commit()
    session.refresh(stored)
    return stored_file_to_read(stored)


@router.delete("/pre-service-media/{file_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_pre_service_media(
    file_id: str,
    _current_user: User = Depends(require_any_permission("presentation:use", "users:manage")),
    session: Session = Depends(get_session),
) -> Response:
    stored = _stored_file_or_404(session, file_id)
    category = session.get(FileCategory, stored.category_id) if stored.category_id else None
    if category is None or category.name != PRE_SERVICE_CATEGORY_NAME:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Photo not found")
    storage_path = Path(stored.storage_path)
    session.delete(stored)
    session.commit()
    storage_path.unlink(missing_ok=True)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/files/{file_id}/download")
def download_file(
    file_id: str,
    _current_user: User = Depends(require_any_permission("library:read", "plans:read")),
    session: Session = Depends(get_session),
) -> FileResponse:
    stored = _stored_file_or_404(session, file_id)
    storage_path = stored.storage_path
    display_name = stored.display_name
    content_type = stored.content_type or "application/octet-stream"

    # Yield-based dependencies are finalized after the response body is sent.  A
    # FileResponse can therefore retain its database connection for the whole
    # download unless we release it explicitly.  This is especially important
    # for slide decks, whose images are requested in parallel by the presenter.
    session.close()

    return FileResponse(
        storage_path,
        filename=display_name,
        media_type=content_type,
    )


@router.get("/files/{file_id}/slides", response_model=list[RenderedSlideRead])
def list_rendered_slides(
    file_id: str,
    _current_user: User = Depends(require_permission("library:read")),
    session: Session = Depends(get_session),
) -> list[RenderedSlideRead]:
    stored = _stored_file_or_404(session, file_id)
    # Rendering can take minutes on a cold cache and does not need the database
    # after the StoredFile row has been loaded.
    session.close()
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

    build_metadata = _read_build_manifest(file_id, len(slides))
    return [
        RenderedSlideRead(
            index=index + 1,
            image_url=f"/api/v1/library/files/{file_id}/slides/{index + 1}.png",
            original_index=build_metadata[index]["original_index"],
            build_index=build_metadata[index]["build_index"],
            build_count=build_metadata[index]["build_count"],
        )
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
    # Release the pooled connection before either a cold render or file transfer.
    session.close()
    slides = _render_slides(stored)
    if slide_index < 1 or slide_index > len(slides):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Rendered slide not found")
    slide_path = slides[slide_index - 1]

    # Do not hold one pooled database connection per image while the browser is
    # downloading a deck.  A single sermon can contain more images than the
    # entire SQLAlchemy pool has connections.
    return FileResponse(
        slide_path,
        media_type="image/png",
        headers={"Cache-Control": "private, max-age=3600"},
    )


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
    current_user: User = Depends(
        require_any_permission("library:edit", "library:create", "plans:edit", "plans:create")
    ),
    session: Session = Depends(get_session),
) -> ItemFileRead:
    item = get_item_or_404(session, plan_item_id)
    plan = get_plan_or_404(session, item.plan_id)
    require_plan_editable(session, plan, current_user)
    if session.get(StoredFile, payload.file_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")

    row = ItemFile(
        plan_item_id=plan_item_id,
        file_id=payload.file_id,
        sort_order=payload.sort_order,
        persistent=payload.persistent,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return item_file_to_read(session, row)


@router.patch("/item-files/{item_file_id}", response_model=ItemFileRead)
def update_item_file(
    item_file_id: str,
    payload: ItemFileUpdate,
    current_user: User = Depends(
        require_any_permission("library:edit", "plans:edit")
    ),
    session: Session = Depends(get_session),
) -> ItemFileRead:
    row = session.get(ItemFile, item_file_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item file not found")
    item = get_item_or_404(session, row.plan_item_id)
    plan = get_plan_or_404(session, item.plan_id)
    require_plan_editable(session, plan, current_user)
    row.persistent = payload.persistent
    session.commit()
    session.refresh(row)
    return item_file_to_read(session, row)


@router.delete("/item-files/{item_file_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_item_file(
    item_file_id: str,
    current_user: User = Depends(
        require_any_permission("library:delete", "plans:edit", "plans:delete")
    ),
    session: Session = Depends(get_session),
) -> Response:
    row = session.get(ItemFile, item_file_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item file not found")
    item = get_item_or_404(session, row.plan_item_id)
    plan = get_plan_or_404(session, item.plan_id)
    require_plan_editable(session, plan, current_user)
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
    version_code: str = "ASV",
    search_type: str = "auto",
    limit: int = 20,
    offset: int = 0,
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
        .offset(max(0, offset))
        .limit(max(1, min(limit, 100)))
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
