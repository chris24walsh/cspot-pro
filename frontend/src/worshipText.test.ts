import { describe, expect, it } from "vitest";

import { analyzeWorshipText, canonicalizeWorshipLyrics, normalizeWorshipSequence, sequenceFromWorshipLyrics, worshipSequenceBlocks } from "./worshipText";

describe("worship text normalization", () => {
  it("preserves a hymn title when it is also the genuine first lyric line", () => {
    const result = analyzeWorshipText(
      "Abide with me\nFast falls the eventide\nThe darkness deepens\nLord, with me abide\n\nSwift to its close ebbs out life's little day",
      { title: "Abide with me" },
    );

    expect(result.sections[0]?.content).toContain("Abide with me");
    expect(result.notes).not.toContain("Removed title noise from imported lyrics.");
  });

  it("removes a provider title heading when the opening lyric repeats it", () => {
    const result = analyzeWorshipText(
      "Abide with me\nAbide with me\nFast falls the eventide\nThe darkness deepens\nLord, with me abide\n\nSwift to its close ebbs out life's little day",
      { title: "Abide with me" },
    );

    expect(result.sections[0]?.content.match(/Abide with me/g)).toHaveLength(1);
    expect(result.notes).toContain("Removed title noise from imported lyrics.");
  });

  it("keeps a sequence aligned when lyric verses are renumbered", () => {
    const lyrics = "Verse 3\nFirst\n\nChorus\nSing\n\nVerse 4\nSecond";

    expect(canonicalizeWorshipLyrics(lyrics)).toBe("[V1]\nFirst\n\n[C]\nSing\n\n[V2]\nSecond");
    expect(normalizeWorshipSequence("Verse 3, Chorus, Verse 4, Chorus", lyrics)).toBe("V1 C V2 C");
  });

  it("moves repeated section references into the sequence instead of duplicating lyric headings", () => {
    const lyrics = "Verse 2\nFirst\n\nChorus\nSing\n\nVerse 2";

    expect(canonicalizeWorshipLyrics(lyrics)).toBe("[V1]\nFirst\n\n[C]\nSing");
    expect(normalizeWorshipSequence("V2 C V2", lyrics)).toBe("V1 C V1");
  });

  it("removes repeated named sections with identical lyrics but keeps their sequence positions", () => {
    const lyrics = "[V1]\nFirst verse\n\n[C]\nSing together\n\n[C]\nSing together\n\n[V2]\nSecond verse";

    expect(canonicalizeWorshipLyrics(lyrics, "V1 C C V2")).toBe(
      "[V1]\nFirst verse\n\n[C]\nSing together\n\n[V2]\nSecond verse",
    );
    expect(normalizeWorshipSequence("V1 C C V2", lyrics)).toBe("V1 C C V2");
  });

  it("normalizes long sequence labels that contain spaces", () => {
    expect(normalizeWorshipSequence("Verse 1 Chorus Verse 2 Pre-Chorus 2")).toBe("V1 C V2 P2");
  });

  it("uses P and T for pre-chorus and tag labels", () => {
    const lyrics = "[Prechorus]\n\nBuild\n\n[Tag]\nRepeat";

    expect(canonicalizeWorshipLyrics(lyrics)).toBe("[P]\nBuild\n\n[T]\nRepeat");
    expect(normalizeWorshipSequence("PreChorus PC P Tag T", lyrics)).toBe("P P P T T");
    expect(sequenceFromWorshipLyrics(lyrics)).toBe("P T");
  });

  it("uses O for outro labels", () => {
    const lyrics = "[Outro]\nFinal line\n\n[O]\nFinal repeat";

    expect(canonicalizeWorshipLyrics(lyrics)).toBe("[O]\nFinal line\n\n[O]\nFinal repeat");
    expect(normalizeWorshipSequence("Outro O", lyrics)).toBe("O O");
    expect(sequenceFromWorshipLyrics(lyrics)).toBe("O");
  });

  it("does not invent Section labels for unlabelled lyrics", () => {
    expect(canonicalizeWorshipLyrics("First block\n\nSecond block")).toBe("First block\n\nSecond block");
  });

  it("prunes deprecated labels and keeps verse numbering contiguous", () => {
    const lyrics = "[V1]\nFirst\n\n[Section2]\n\n[V3]\nThird\n\n[V4]\nFourth";

    expect(canonicalizeWorshipLyrics(lyrics)).toBe("[V1]\nFirst\n\n[V2]\nThird\n\n[V3]\nFourth");
    expect(normalizeWorshipSequence("V1 S2 V3 Broken V4", lyrics)).toBe("V1 V2 V3");
  });

  it("replaces a stale like-for-like sequence from the lyric structure", () => {
    const lyrics = "[V1]\nFirst\n\n[C]\nSing together\n\n[V2]\nSecond";

    expect(normalizeWorshipSequence("V1 V2 V3", lyrics)).toBe("V1 C V2");
  });

  it("preserves longer arranged sequences and inserts missing lyric labels", () => {
    const lyrics = "[V1]\nFirst\n\n[C]\nSing together\n\n[V2]\nSecond";
    const lyricsWithBridge = `${lyrics}\n\n[B]\nBuild again`;

    expect(normalizeWorshipSequence("V1 C V2 C V1 C", lyrics)).toBe("V1 C V2 C V1 C");
    expect(normalizeWorshipSequence("V1 C V2 C V1 C", lyricsWithBridge)).toBe("V1 C V2 B C V1 C");
  });

  it("exposes repeated arranged blocks for musician navigation", () => {
    const lyrics = "[V1]\nFirst verse\n\n[C]\nSing together\n\n[V2]\nSecond verse";

    expect(worshipSequenceBlocks(lyrics, "V1 C V2 C").map((block) => block.label)).toEqual(["V1", "C", "V2", "C"]);
    expect(worshipSequenceBlocks(lyrics, "V1 C V2 C")[3]?.content).toBe("Sing together");
  });

  it("closes gaps in sequence verse numbering", () => {
    expect(normalizeWorshipSequence("V1 C V3 V4 C V3")).toBe("V1 C V2 V3 C V2");
  });
});
