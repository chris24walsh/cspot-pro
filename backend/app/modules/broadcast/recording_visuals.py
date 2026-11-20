"""Resolve the same recording slide for playback, sharing and export."""

import hashlib
import json
import tempfile
from pathlib import Path

from sqlalchemy.orm import Session

from app.modules.library.models import StoredFile
from app.modules.library.routes import _render_slides

BACKGROUND = Path(__file__).parent / "assets" / "lcf-background.jpg"


def render_recording_slide(
    session: Session, event: dict, work_dir: Path, render_slides=None
) -> Path:
    visual = event.get("visual") or {}
    render_slides = render_slides or _render_slides
    images = []
    for file in event.get("files", []):
        stored = session.get(StoredFile, file.get("file_id"))
        if not stored:
            raise ValueError("Recorded slide image is unavailable")
        images.extend(render_slides(stored))
    if images:
        offset = int(event.get("slide_offset", 0))
        if 0 <= offset < len(images):
            return images[offset]
        raise ValueError("Recorded slide image is unavailable")
    text = (
        "\n\n".join(filter(None, [visual.get("title"), visual.get("text")]))
        if visual.get("kind") != "background"
        else ""
    )
    if not text and not visual:
        text = event.get("item_comment") or event.get("item_title") or ""
        if text.strip().casefold() in {"sermon", "recorded slides"}:
            text = ""
    if not text:
        return BACKGROUND
    # Generated files are content-addressed so requests cannot reuse stale frames.
    from app.modules.broadcast.recording_video import _text_slide

    work_dir.mkdir(parents=True, exist_ok=True)
    key = hashlib.sha256(json.dumps(text, ensure_ascii=False).encode()).hexdigest()
    image = work_dir / f"{key}.png"
    if not image.is_file():
        with tempfile.NamedTemporaryFile(dir=work_dir, suffix=".png", delete=False) as temp:
            temporary = Path(temp.name)
        try:
            _text_slide(text, temporary)
            temporary.replace(image)
        finally:
            temporary.unlink(missing_ok=True)
    return image
