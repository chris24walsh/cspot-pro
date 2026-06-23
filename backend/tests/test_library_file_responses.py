from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

from fastapi.responses import FileResponse

from app.modules.library import routes


def test_rendered_slide_releases_database_session_before_file_response(
    monkeypatch,
    tmp_path: Path,
) -> None:
    slide_path = tmp_path / "slide-1.png"
    slide_path.write_bytes(b"png")
    session = Mock()
    stored = SimpleNamespace(id="file-1")
    close_was_called_before_render = False

    monkeypatch.setattr(routes, "_stored_file_or_404", lambda _session, _file_id: stored)

    def observed_render(_stored):
        nonlocal close_was_called_before_render
        close_was_called_before_render = session.close.called
        return [slide_path]

    monkeypatch.setattr(routes, "_render_slides", observed_render)

    response = routes.get_rendered_slide(
        file_id="file-1",
        slide_index=1,
        _current_user=SimpleNamespace(),
        session=session,
    )

    assert isinstance(response, FileResponse)
    assert close_was_called_before_render is True
    session.close.assert_called_once_with()
    assert response.headers["cache-control"] == "private, max-age=3600"


def test_slide_manifest_releases_database_session_before_cold_render(
    monkeypatch,
    tmp_path: Path,
) -> None:
    slide_path = tmp_path / "slide-1.png"
    slide_path.write_bytes(b"png")
    session = Mock()
    stored = SimpleNamespace(id="file-1")

    monkeypatch.setattr(routes, "_stored_file_or_404", lambda _session, _file_id: stored)

    def observed_render(_stored):
        assert session.close.called
        return [slide_path]

    monkeypatch.setattr(routes, "_render_slides", observed_render)
    monkeypatch.setattr(
        routes,
        "_read_build_manifest",
        lambda _file_id, _count: [{"original_index": 1, "build_index": 0, "build_count": 1}],
    )

    slides = routes.list_rendered_slides(
        file_id="file-1",
        _current_user=SimpleNamespace(),
        session=session,
    )

    session.close.assert_called_once_with()
    assert len(slides) == 1
    assert slides[0].image_url.endswith("/slides/1.png")


def test_file_download_copies_metadata_before_releasing_session(
    monkeypatch,
    tmp_path: Path,
) -> None:
    file_path = tmp_path / "service.pptx"
    file_path.write_bytes(b"deck")
    session = Mock()
    stored = SimpleNamespace(
        storage_path=str(file_path),
        display_name="Sunday service.pptx",
        content_type="application/test",
    )
    monkeypatch.setattr(routes, "_stored_file_or_404", lambda _session, _file_id: stored)

    response = routes.download_file(
        file_id="file-1",
        _current_user=SimpleNamespace(),
        session=session,
    )

    session.close.assert_called_once_with()
    assert response.path == str(file_path)
    assert response.media_type == "application/test"
    assert "Sunday%20service.pptx" in response.headers["content-disposition"]
