import { describe, expect, it } from "vitest";

import { canonicalizeWorshipLyrics, normalizeWorshipSequence } from "./worshipText";

describe("worship text normalization", () => {
  it("keeps a sequence aligned when lyric verses are renumbered", () => {
    const lyrics = "Verse 3\nFirst\n\nChorus\nSing\n\nVerse 4\nSecond";

    expect(canonicalizeWorshipLyrics(lyrics)).toBe("[V1]\nFirst\n\n[C]\nSing\n\n[V2]\nSecond");
    expect(normalizeWorshipSequence("Verse 3, Chorus, Verse 4, Chorus", lyrics)).toBe("V1 C V2 C");
  });

  it("preserves repeated references to the same renumbered verse", () => {
    const lyrics = "Verse 2\nFirst\n\nChorus\nSing\n\nVerse 2";

    expect(canonicalizeWorshipLyrics(lyrics)).toBe("[V1]\nFirst\n\n[C]\nSing\n\n[V1]");
    expect(normalizeWorshipSequence("V2 C V2", lyrics)).toBe("V1 C V1");
  });

  it("normalizes long sequence labels that contain spaces", () => {
    expect(normalizeWorshipSequence("Verse 1 Chorus Verse 2 Pre-Chorus 2")).toBe("V1 C V2 PC2");
  });

  it("closes gaps in sequence verse numbering", () => {
    expect(normalizeWorshipSequence("V1 C V3 V4 C V3")).toBe("V1 C V2 V3 C V2");
  });
});
