import { describe, expect, it } from "vitest";

import type { PlanItem, RenderedSlide, Song } from "./api";
import { CHURCH_FAMILY_BACKGROUND_URL, LCF_BACKGROUND_URL, buildPresentationSections, buildPresentationSlides, resolveLiveIndex, splitOversizedLyricSlide, suggestedSlideFontCap, suggestUniformSlideGroupFontCap } from "./presentation";

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
  it("uses one compact font cap based on the densest slide in a set", () => {
    expect(suggestUniformSlideGroupFontCap(["Short lyric", "One\nTwo\nThree\nFour\nFive\nSix"], true)).toBe(9);
  });
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

  it("keeps the end item last and renders it as a title slide", () => {
    const sections = buildPresentationSections([
      planItem({ id: "end", item_type: "end", sequence: "999.00", title: "End", comment: "End of service" }),
      planItem({ id: "late-item", item_type: "reading", sequence: "1009.00", title: "Late reading" }),
    ], []);

    expect(sections.map((section) => section.id)).toEqual(["late-item", "end"]);
    expect(sections[1].slides).toMatchObject([
      { backgroundImageUrl: LCF_BACKGROUND_URL, text: "End", title: "End", slideKind: "title" },
    ]);
  });

  it("uses the LCF background for contentless transition sections", () => {
    const slides = buildPresentationSlides([
      planItem({ id: "welcome", item_type: "welcome", title: "Welcome and prayer" }),
      planItem({ id: "reading", item_type: "reading", title: "John 3:16", comment: "For God so loved the world." }),
    ], []);

    expect(slides[0]).toMatchObject({ backgroundImageUrl: LCF_BACKGROUND_URL, text: "Welcome and prayer" });
    expect(slides[1].backgroundImageUrl).toBeUndefined();
  });

  it("uses dedicated countdown and Church Family transition slides", () => {
    const slides = buildPresentationSlides([
      planItem({ id: "seating", item_type: "seating", title: "Call to seats" }),
      planItem({ id: "community", item_type: "community", title: "Church Family" }),
    ], []);

    expect(slides[0]).toMatchObject({ countdownSeconds: 300, text: "" });
    expect(slides[0].backgroundImageUrl).toBeUndefined();
    expect(slides[1].backgroundImageUrl).toBe(CHURCH_FAMILY_BACKGROUND_URL);
  });

  it("turns pre-service photos into one montage slide", () => {
    const slides = buildPresentationSlides([
      planItem({
        files: [{ content_type: "image/jpeg", display_name: "Church", file_id: "photo-1", id: "photo-link", sort_order: 0 }],
        id: "pre-service",
        item_type: "pre_service",
        title: "Welcome",
      }),
    ], []);

    expect(slides).toHaveLength(1);
    expect(slides[0].montageImageUrls).toHaveLength(1);
    expect(slides[0].montageImageUrls?.[0]).toContain("photo-1");
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

  it("uses restrained title sizing without enlarging short lyric slides", () => {
    const slides = buildPresentationSlides([
      planItem({ id: "song-item", item_type: "song", song_id: "song-1", title: "Song" }),
      planItem({ id: "reading", item_type: "reading", title: "John 3:16", comment: "For God so loved the world." }),
    ], [song({
      lyrics: "Verse 1\nThis is a moderately long first lyric line\nThis is a moderately long second lyric line\nThis is a moderately long third lyric line\nThis is a moderately long fourth lyric line",
      sequence: "V1",
      title: "Short title",
    })]);

    const songTitle = slides.find((slide) => slide.itemType === "song" && slide.slideKind === "title");
    const songContent = slides.find((slide) => slide.itemType === "song" && slide.slideKind === "content");
    const reading = slides.find((slide) => slide.itemType === "reading");

    expect(songTitle?.backgroundImageUrl).toBeUndefined();
    expect(suggestedSlideFontCap(songTitle)).toBe(64);
    expect(suggestedSlideFontCap(songContent)).toBe(52);
    expect(suggestedSlideFontCap(reading)).toBe(68);
  });
});
