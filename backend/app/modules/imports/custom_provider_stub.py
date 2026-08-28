from __future__ import annotations

from dataclasses import dataclass
import re

import requests
from bs4 import BeautifulSoup


GENIUS_PROVIDER = "genius"


@dataclass
class CustomLyricsProviderMatch:
    id: str
    title: str
    subtitle: str | None = None
    summary: str | None = None


@dataclass
class CustomLyricsProviderSearchResult:
    status: str
    provider: str
    matches: list[CustomLyricsProviderMatch]
    notes: list[str]


@dataclass
class CustomLyricsProviderSelectionResult:
    status: str
    provider: str
    title: str | None
    output_text: str | None
    notes: list[str]


def _headers() -> dict[str, str]:
    return {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/135.0.0.0 Safari/537.36"
        ),
    }


def _normalize_title_fragment(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.lower())


def _extract_page_title(soup: BeautifulSoup) -> str | None:
    title_candidates: list[str] = []

    heading = soup.find("h1")
    if heading:
        heading_text = heading.get_text(" ", strip=True)
        if heading_text:
            title_candidates.append(heading_text)

    og_title = soup.find("meta", property="og:title")
    if og_title and og_title.get("content"):
        content = og_title["content"].split("|", 1)[0].strip()
        content = content.split(" Lyrics", 1)[0].strip()
        title_candidates.append(content)

    for candidate in title_candidates:
        cleaned = candidate.strip()
        if " – " in cleaned:
            cleaned = cleaned.split(" – ", 1)[1].strip()
        elif " - " in cleaned:
            cleaned = cleaned.split(" - ", 1)[1].strip()
        if cleaned:
            return cleaned

    return None


def clean_lyrics(text: str, song_title: str = "") -> str:
    if not text:
        return text

    lines = text.split("\n")
    cleaned: list[str] = []
    normalized_title = _normalize_title_fragment(song_title) if song_title else ""

    for index, line in enumerate(lines):
        line = line.strip()
        normalized_line = _normalize_title_fragment(line)

        if any(
            word in line.lower()
            for word in ["contributor", "contributors", "embed", "lyrics provided by"]
        ):
            if len(line) < 80:
                continue

        if normalized_title and index < 6:
            if normalized_line == normalized_title:
                continue
            if normalized_line in {f"{normalized_title}lyrics", f"lyrics{normalized_title}"}:
                continue
            if normalized_line.startswith(normalized_title) and len(normalized_line) <= len(normalized_title) + 12:
                continue

        if line:
            cleaned.append(line)

    text = "\n".join(cleaned)
    text = re.sub(r"^\d+\s+contributors?\s*$", "", text, flags=re.IGNORECASE | re.MULTILINE)
    text = re.sub(r"\[.+?Embed\]", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def run_custom_lyrics_provider_search(search_term: str) -> CustomLyricsProviderSearchResult:
    cleaned = search_term.strip()
    if not cleaned:
        return CustomLyricsProviderSearchResult(
            status="missing-query",
            provider=GENIUS_PROVIDER,
            matches=[],
            notes=["Enter a song title."],
        )

    notes = [f'Searching for: "{cleaned}"']

    try:
        search_url = f"https://genius.com/api/search?q={requests.utils.quote(cleaned)}"
        response = requests.get(search_url, headers=_headers(), timeout=12)

        if response.status_code != 200:
            return CustomLyricsProviderSearchResult(
                status="error",
                provider=GENIUS_PROVIDER,
                matches=[],
                notes=notes + [f"Search failed with status {response.status_code}."],
            )

        hits = response.json().get("response", {}).get("hits", [])
        matches = [
            CustomLyricsProviderMatch(
                id=hit["result"].get("url", ""),
                title=hit["result"].get("title", "Untitled"),
                subtitle=hit["result"].get("artist_names"),
                summary=hit["result"].get("full_title"),
            )
            for hit in hits
            if hit.get("result", {}).get("url")
        ]

        if not matches:
            return CustomLyricsProviderSearchResult(
                status="not-found",
                provider=GENIUS_PROVIDER,
                matches=[],
                notes=notes + ["No matches found."],
            )

        return CustomLyricsProviderSearchResult(
            status="ready",
            provider=GENIUS_PROVIDER,
            matches=matches,
            notes=notes + [f"Found {len(matches)} match(es)."],
        )
    except Exception as error:
        return CustomLyricsProviderSearchResult(
            status="error",
            provider=GENIUS_PROVIDER,
            matches=[],
            notes=notes + [f"Error: {str(error)[:100]}"],
        )


def fetch_custom_lyrics_provider_match(match_id: str) -> CustomLyricsProviderSelectionResult:
    cleaned = match_id.strip()
    if not cleaned:
        return CustomLyricsProviderSelectionResult(
            status="missing-match",
            provider=GENIUS_PROVIDER,
            title=None,
            output_text=None,
            notes=["Choose a match first."],
        )

    notes = [f"Fetching: {cleaned}"]

    try:
        lyrics_response = requests.get(cleaned, headers=_headers(), timeout=12)
        if lyrics_response.status_code != 200:
            return CustomLyricsProviderSelectionResult(
                status="error",
                provider=GENIUS_PROVIDER,
                title=None,
                output_text=None,
                notes=notes + [f"Could not load lyrics page ({lyrics_response.status_code})."],
            )

        soup = BeautifulSoup(lyrics_response.text, "html.parser")
        title = _extract_page_title(soup)

        containers = soup.find_all("div", {"data-lyrics-container": "true"})
        if not containers:
            containers = soup.find_all("div", class_=re.compile(r"Lyrics__Container"))

        raw_blocks = [container.get_text(separator="\n") for container in containers]
        raw_lyrics = "\n".join(block for block in raw_blocks if block.strip()).strip()

        if not raw_lyrics:
            return CustomLyricsProviderSelectionResult(
                status="not-found",
                provider=GENIUS_PROVIDER,
                title=title,
                output_text=None,
                notes=notes + ["Could not find lyrics on the page."],
            )

        cleaned_lyrics = clean_lyrics(raw_lyrics, title or "")
        return CustomLyricsProviderSelectionResult(
            status="ready",
            provider=GENIUS_PROVIDER,
            title=title,
            output_text=cleaned_lyrics,
            notes=notes + ["Lyrics cleaned and returned."],
        )
    except Exception as error:
        return CustomLyricsProviderSelectionResult(
            status="error",
            provider=GENIUS_PROVIDER,
            title=None,
            output_text=None,
            notes=notes + [f"Error: {str(error)[:100]}"],
        )
