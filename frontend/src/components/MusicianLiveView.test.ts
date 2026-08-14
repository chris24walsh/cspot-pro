import { describe, expect, it } from "vitest";

import { findSlideLineOffset } from "./MusicianLiveView";
import { chordEditorLineLengthForWidth } from "./SongEditorDialog";

describe("musician chord alignment", () => {
  it("does not copy lyric chords onto a matching song title", () => {
    const lyrics = "[V1]\nAmazing Grace\nHow sweet the sound";

    expect(findSlideLineOffset(lyrics, "Amazing Grace", "title")).toBe(-1);
    expect(findSlideLineOffset(lyrics, "Amazing Grace", "content")).toBeGreaterThanOrEqual(0);
  });
});

describe("chord editor line width", () => {
  it("uses nearly all of the available pane before wrapping", () => {
    expect(chordEditorLineLengthForWidth(800)).toBe(64);
    expect(chordEditorLineLengthForWidth(400)).toBe(31);
  });
});
