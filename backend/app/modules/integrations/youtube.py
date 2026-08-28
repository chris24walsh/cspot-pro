from html import unescape
from urllib.parse import urlencode

from sqlalchemy.orm import Session

from app.modules.integrations.google_drive import (
    _json_request,
    get_google_drive_connection_or_none,
    get_valid_google_drive_access_token,
)
from app.modules.integrations.schemas import YouTubeSearchRead, YouTubeVideoRead

YOUTUBE_READ_SCOPE = "https://www.googleapis.com/auth/youtube.readonly"
YOUTUBE_SEARCH_URL = "https://www.googleapis.com/youtube/v3/search"


def search_youtube_videos(
    session: Session,
    *,
    query: str,
    page_token: str | None = None,
    limit: int = 20,
) -> YouTubeSearchRead:
    cleaned_query = query.strip()
    if not cleaned_query:
        return YouTubeSearchRead(items=[])

    connection = get_google_drive_connection_or_none(session)
    granted_scopes = set((connection.scope or "").split()) if connection else set()
    if YOUTUBE_READ_SCOPE not in granted_scopes:
        raise ValueError("Reconnect Google in Admin to enable YouTube search.")

    params = {
        "part": "snippet",
        "type": "video",
        "order": "relevance",
        "maxResults": str(max(1, min(limit, 50))),
        "q": cleaned_query,
    }
    if page_token:
        params["pageToken"] = page_token

    try:
        payload = _json_request(
            f"{YOUTUBE_SEARCH_URL}?{urlencode(params)}",
            headers={"Authorization": f"Bearer {get_valid_google_drive_access_token(session)}"},
        )
    except ValueError as exc:
        raise ValueError(
            "YouTube search is unavailable. Confirm YouTube Data API v3 is enabled "
            "for the Google project, then reconnect Google in Admin."
        ) from exc
    raw_items = payload.get("items")
    items: list[YouTubeVideoRead] = []
    if isinstance(raw_items, list):
        for raw_item in raw_items:
            if not isinstance(raw_item, dict):
                continue
            identity = raw_item.get("id")
            snippet = raw_item.get("snippet")
            if not isinstance(identity, dict) or not isinstance(snippet, dict):
                continue
            video_id = identity.get("videoId")
            title = snippet.get("title")
            if not isinstance(video_id, str) or not isinstance(title, str):
                continue
            thumbnail_url = None
            thumbnails = snippet.get("thumbnails")
            if isinstance(thumbnails, dict):
                preferred = thumbnails.get("medium") or thumbnails.get("default")
                if isinstance(preferred, dict) and isinstance(preferred.get("url"), str):
                    thumbnail_url = preferred["url"]
            items.append(
                YouTubeVideoRead(
                    id=video_id,
                    title=unescape(title),
                    channel_title=unescape(str(snippet.get("channelTitle") or "YouTube")),
                    thumbnail_url=thumbnail_url,
                )
            )

    next_page_token = payload.get("nextPageToken")
    return YouTubeSearchRead(
        items=items,
        next_page_token=next_page_token if isinstance(next_page_token, str) else None,
    )
