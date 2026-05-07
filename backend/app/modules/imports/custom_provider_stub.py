from __future__ import annotations

from dataclasses import dataclass


@dataclass
class CustomLyricsProviderResult:
    status: str
    provider: str
    output_text: str | None
    notes: list[str]


def run_custom_lyrics_provider(search_term: str) -> CustomLyricsProviderResult:
    """
    Stub hook for your own lyrics/metadata lookup code.

    Replace the body of this function with whatever backend logic you want:
    requests, scraping, private APIs, local scripts, or other integrations.

    Contract:
    - `search_term` is the exact text entered in the UI.
    - return `output_text` as plain text for the UI to display.
    - use `notes` for any extra hints or diagnostics you want surfaced.
    - set `status` to something human-readable like `ready`, `not-found`, or `error`.
    """

    cleaned = search_term.strip()
    if not cleaned:
        return CustomLyricsProviderResult(
            status="missing-query",
            provider="custom-provider-stub",
            output_text=None,
            notes=["Enter a search term to run your custom provider."],
        )

    # TODO: Replace this example with your own code.
    example_output = (
        "Custom provider stub is wired up.\n\n"
        f"Search term received: {cleaned}\n\n"
        "Edit backend/app/modules/imports/custom_provider_stub.py to return your own lookup output."
    )
    return CustomLyricsProviderResult(
        status="stub",
        provider="custom-provider-stub",
        output_text=example_output,
        notes=["This is only a placeholder response from the backend stub."],
    )
