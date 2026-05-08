from __future__ import annotations

from dataclasses import dataclass
import re

import requests
from bs4 import BeautifulSoup


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


GENIUS_PROVIDER = "genius"


def _headers() -> dict[str, str]:
    return {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36"
        ),
        "Accept-Language": "en-US,en;q=0.9",
    }


def _clean_lyrics(text: str) -> str:
    cleaned = re.sub(r"\n{3,}", "\n\n", text)
    cleaned = re.sub(r"^\s*You might also like\s*$", "", cleaned, flags=re.MULTILINE | re.IGNORECASE)
    cleaned = re.sub(r"^\s*Embed\s*$", "", cleaned, flags=re.MULTILINE | re.IGNORECASE)
    cleaned = re.sub(r"\d+Embed$", "", cleaned).strip()
    return cleaned.strip()


def run_custom_lyrics_provider_search(search_term: str) -> CustomLyricsProviderSearchResult:
    cleaned = search_term.strip()
    if not cleaned:
        return CustomLyricsProviderSearchResult(
            status="missing-query",
            provider=GENIUS_PROVIDER,
            matches=[],
            notes=["Enter a song title or search term."],
        )

    notes = [f'Searching Genius for "{cleaned}"']

    try:
        search_url = f"https://genius.com/api/search?q={requests.utils.quote(cleaned)}"
        response = requests.get(search_url, headers=_headers(), timeout=12)
        response.raise_for_status()

        data = response.json()
        hits = data.get("response", {}).get("hits", [])[:10]

        if not hits:
            return CustomLyricsProviderSearchResult(
                status="not-found",
                provider=GENIUS_PROVIDER,
                matches=[],
                notes=notes + ["No matching songs found."],
            )

        matches: list[CustomLyricsProviderMatch] = []
        for hit in hits:
            result = hit.get("result", {})
            url = result.get("url")
            title = result.get("title")
            artist = result.get("artist_names")
            if not isinstance(url, str) or not isinstance(title, str):
                continue

            matches.append(
                CustomLyricsProviderMatch(
                    id=url,
                    title=title,
                    subtitle=artist if isinstance(artist, str) else None,
                    summary="Lyrics available" if result.get("lyrics_state") == "complete" else None,
                )
            )

        return CustomLyricsProviderSearchResult(
            status="multiple-matches" if len(matches) > 1 else "single-match",
            provider=GENIUS_PROVIDER,
            matches=matches,
            notes=notes + [f"Found {len(matches)} possible matches."],
        )
    except requests.exceptions.RequestException as error:
        return CustomLyricsProviderSearchResult(
            status="error",
            provider=GENIUS_PROVIDER,
            matches=[],
            notes=[f"Network error: {str(error)[:120]}"],
        )
    except Exception as error:
        return CustomLyricsProviderSearchResult(
            status="error",
            provider=GENIUS_PROVIDER,
            matches=[],
            notes=[f"Unexpected error: {str(error)[:120]}"],
        )


def fetch_custom_lyrics_provider_match(match_id: str) -> CustomLyricsProviderSelectionResult:
    target = match_id.strip()
    if not target:
        return CustomLyricsProviderSelectionResult(
            status="missing-match",
            provider=GENIUS_PROVIDER,
            title=None,
            output_text=None,
            notes=["Select a match first."],
        )

    try:
        response = requests.get(target, headers=_headers(), timeout=15)
        response.raise_for_status()
        soup = BeautifulSoup(response.text, "html.parser")

        title_tag = soup.find("h1")
        title = title_tag.get_text(" ", strip=True) if title_tag else "Imported lyrics"

        lyric_blocks = soup.select('[data-lyrics-container="true"]')
        if lyric_blocks:
            lyrics = "\n".join(block.get_text("\n", strip=True) for block in lyric_blocks)
            lyrics = _clean_lyrics(lyrics)
            if lyrics:
                return CustomLyricsProviderSelectionResult(
                    status="ready",
                    provider=GENIUS_PROVIDER,
                    title=title,
                    output_text=lyrics,
                    notes=[f"Fetched lyrics for {title}."],
                )

        fallback_blocks = [
            div.get_text("\n", strip=True)
            for div in soup.find_all("div")
            if "Lyrics" not in " ".join(div.get("class", [])) and len(div.get_text(" ", strip=True)) > 200
        ]
        if fallback_blocks:
            lyrics = _clean_lyrics(max(fallback_blocks, key=len))
            return CustomLyricsProviderSelectionResult(
                status="ready",
                provider=GENIUS_PROVIDER,
                title=title,
                output_text=lyrics,
                notes=["Fetched lyrics using a fallback extractor. Double-check the output."],
            )

        return CustomLyricsProviderSelectionResult(
            status="not-found",
            provider=GENIUS_PROVIDER,
            title=title,
            output_text=None,
            notes=["Could not extract lyrics from the selected match."],
        )
    except requests.exceptions.RequestException as error:
        return CustomLyricsProviderSelectionResult(
            status="error",
            provider=GENIUS_PROVIDER,
            title=None,
            output_text=None,
            notes=[f"Network error: {str(error)[:120]}"],
        )
    except Exception as error:
        return CustomLyricsProviderSelectionResult(
            status="error",
            provider=GENIUS_PROVIDER,
            title=None,
            output_text=None,
            notes=[f"Unexpected error: {str(error)[:120]}"],
        )
