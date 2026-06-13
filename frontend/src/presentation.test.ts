import { describe, expect, it } from "vitest";

import type { PlanItem, RenderedSlide, Song } from "./api";
import { buildPresentationSections, buildPresentationSlides, resolveLiveIndex, splitOversizedLyricSlide } from "./presentation";

function planItem(overrides: Partial<PlanItem>): PlanItem {
  return {
    comment: null,
    files: [],
    id: "item-1",
    item_type: "custom",
    key_signature: null,
    plan_id: "plan-1",
    sequence: "10.00",
    song_id: null,
    teacher_notes: null,
    title: "Item",
    ...overrides,
  };
}

function song(overrides: Partial<Song>): Song {
  return {
    alternate_title: null,
    author: null,
    book_reference: null,
    ccli_number: null,
    chords: null,
    energy: null,
    external_link: null,
    id: "song-1",
    license: null,
    lyrics: null,
    sequence: null,
    tempo: null,
    theme_tags: null,
    title: "Song",
    worship_role: null,
    lyrics_status: "ready",
    youtube_id: null,
    ...overrides,
  };
}

describe("presentation slide derivation", () => {
  it("keeps deck-backed items as rendered image slides", () => {
    const item = planItem({
      files: [{ content_type: "application/vnd.ms-powerpoint", display_name: "Sermon", file_id: "file-1", id: "pf-1", sort_order: 0 }],
      id: "sermon-1",
      item_type: "sermon",
      title: "Sermon",
    });
    const rendered: RenderedSlide[] = [
      { build_count: 2, build_index: 0, image_url: "/slides/1.png", index: 1, original_index: 1 },
      { build_count: 2, build_index: 1, image_url: "/slides/2.png", index: 2, original_index: 1 },
    ];

    const sections = buildPresentationSections([item], [], { "file-1": rendered });

    expect(sections).toHaveLength(1);
    expect(sections[0].slides).toMatchObject([
      { id: "sermon-1:file-1:1", imageUrl: "/slides/1.png", title: "Sermon 1.1" },
      { id: "sermon-1:file-1:2", imageUrl: "/slides/2.png", title: "Sermon 1.2" },
    ]);
  });

  it("expands worship songs from sequence without duplicating stored lyrics", () => {
    const item = planItem({ id: "song-item", item_type: "song", song_id: "song-1", title: "Ignored" });
    const songs = [
      song({
        lyrics: "Verse 1\nFirst verse\n\nChorus\nMain chorus",
        sequence: "V1 C V1",
        title: "Known Song",
      }),
    ];

    const slides = buildPresentationSlides([item], songs);

    expect(slides.map((slide) => slide.text)).toEqual(["Known Song", "First verse", "Main chorus", "First verse"]);
  });

  it("resolves live state by plan item and slide offset when slide indexes change", () => {
    const slides = buildPresentationSlides([
      planItem({ id: "intro", sequence: "5.00", title: "Intro" }),
      planItem({ id: "target", sequence: "10.00", title: "Target" }),
    ], []);

    expect(resolveLiveIndex(slides, { index: 0, planId: "plan-1", planItemId: "target", slideOffset: 0, updatedAt: 1 })).toBe(1);
  });

  it("splits oversized lyric slides into balanced readable chunks", () => {
    const text = ["Line one has enough words", "Line two has enough words", "Line three has enough words", "Line four has enough words", "Line five has enough words", "Line six has enough words"].join("\n");

    expect(splitOversizedLyricSlide(text)).toEqual([
      "Line one has enough words\nLine two has enough words\nLine three has enough words",
      "Line four has enough words\nLine five has enough words\nLine six has enough words",
    ]);
  });
});
