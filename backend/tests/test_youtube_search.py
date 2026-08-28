from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse

import pytest

from app.modules.integrations.youtube import YOUTUBE_READ_SCOPE, search_youtube_videos


def test_youtube_search_requires_granted_scope(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.modules.integrations.youtube.get_google_drive_connection_or_none",
        lambda _session: SimpleNamespace(scope="https://www.googleapis.com/auth/drive.readonly"),
    )

    with pytest.raises(ValueError, match="Reconnect Google"):
        search_youtube_videos(object(), query="worship")  # type: ignore[arg-type]


def test_youtube_search_returns_video_cards_and_paging(monkeypatch) -> None:
    captured_url = ""

    monkeypatch.setattr(
        "app.modules.integrations.youtube.get_google_drive_connection_or_none",
        lambda _session: SimpleNamespace(scope=YOUTUBE_READ_SCOPE),
    )
    monkeypatch.setattr(
        "app.modules.integrations.youtube.get_valid_google_drive_access_token",
        lambda _session: "token",
    )

    def fake_request(url: str, **_kwargs: object) -> dict[str, object]:
        nonlocal captured_url
        captured_url = url
        return {
            "nextPageToken": "next-page",
            "items": [
                {
                    "id": {"videoId": "abcdefghijk"},
                    "snippet": {
                        "title": "Amazing &amp; Grace",
                        "channelTitle": "Church Channel",
                        "thumbnails": {"medium": {"url": "https://img.example/video.jpg"}},
                    },
                }
            ],
        }

    monkeypatch.setattr("app.modules.integrations.youtube._json_request", fake_request)

    result = search_youtube_videos(object(), query="amazing grace", page_token="page-2")  # type: ignore[arg-type]

    assert result.next_page_token == "next-page"
    assert result.items[0].title == "Amazing & Grace"
    assert result.items[0].channel_title == "Church Channel"
    params = parse_qs(urlparse(captured_url).query)
    assert params["q"] == ["amazing grace"]
    assert params["pageToken"] == ["page-2"]
    assert params["type"] == ["video"]
