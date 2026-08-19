import { describe, expect, it } from "vitest";

import { findSlideLineOffset, keySetupLabel } from "./MusicianLiveView";
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

describe("musician key selector labels", () => {
  it("uses compact closed labels and descriptive expanded labels", () => {
    const setup = { absoluteKey: "F", capo: 5, shapeKey: "C" };

    expect(keySetupLabel(setup, false)).toBe("C5");
    expect(keySetupLabel(setup, true)).toBe("C capo 5 (F)");
  });
});
