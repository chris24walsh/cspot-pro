from pathlib import Path

from app.modules.integrations.google_drive import _convert_drive_video_for_browser


def test_browser_video_conversion_leaves_mp4_unchanged() -> None:
    content = b"already-browser-video"

    assert _convert_drive_video_for_browser(content, "service.mp4", "video/mp4") == (
        content,
        "video/mp4",
        "service.mp4",
    )


def test_browser_video_conversion_transcodes_mov_to_fast_start_mp4(monkeypatch) -> None:
    captured_command: list[str] = []

    def fake_run(command: list[str], **_kwargs: object) -> None:
        captured_command.extend(command)
        Path(command[-1]).write_bytes(b"converted-mp4")

    monkeypatch.setattr("app.modules.integrations.google_drive.subprocess.run", fake_run)

    result = _convert_drive_video_for_browser(b"quicktime-video", "Ethan.MOV", "video/quicktime")

    assert result == (b"converted-mp4", "video/mp4", "Ethan.mp4")
    assert "libx264" in captured_command
    assert "+faststart" in captured_command
