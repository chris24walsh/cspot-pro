import { describe, expect, it } from "vitest";

import { findSlideLineOffset } from "./MusicianLiveView";

describe("musician chord alignment", () => {
  it("does not copy lyric chords onto a matching song title", () => {
    const lyrics = "[V1]\nAmazing Grace\nHow sweet the sound";

    expect(findSlideLineOffset(lyrics, "Amazing Grace", "title")).toBe(-1);
    expect(findSlideLineOffset(lyrics, "Amazing Grace", "content")).toBeGreaterThanOrEqual(0);
  });
});
