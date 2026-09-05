import { describe, expect, it } from "vitest";

import type { PlanItem, RenderedSlide, Song } from "./api";
import { LCF_BACKGROUND_URL, buildPresentationSections, buildPresentationSlides, resolveLiveIndex, splitOversizedLyricSlide, suggestedSlideFontCap, suggestUniformSlideGroupFontCap, videoPlaybackStateForSlideTransition } from "./presentation";

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
  it("applies type-specific presentation options and structured announcement details", () => {
    const [slide] = buildPresentationSlides([planItem({
      item_type: "announcements",
      comment: "Community lunch",
      presentation_options: {
        dwell_seconds: 12,
        auto_advance: true,
        fit_mode: "cover",
        transition: "slide",
        overlay_mode: "static",
        overlay_text: "This Sunday",
        overlay_font: "display",
        overlay_panel_opacity: 25,
        overlay_background_dim: 50,
        overlay_position: "top-right",
        announcement_date: "12:30",
        announcement_location: "Church hall",
      },
    })], []);

    expect(slide).toMatchObject({
      autoAdvanceSeconds: 12,
      dwellSeconds: 12,
      fitMode: "cover",
      overlayText: "This Sunday",
      overlayFont: "display",
      overlayPanelOpacity: 25,
      overlayBackgroundDim: 50,
      overlayPosition: "top-right",
      transition: "slide",
    });
    expect(slide.text).toBe("Community lunch\n12:30\nChurch hall");
  });

  it("keeps playing media state while navigating inside the same section", () => {
    const currentState = {
      planItemId: "song-item",
      videoAction: "play" as const,
      videoActionAt: 123,
    };
    const currentSlide = { planItemId: "song-item", sectionId: "song-section" };
    const nextSlide = { planItemId: "song-item", sectionId: "song-section" };

    expect(videoPlaybackStateForSlideTransition(currentState, currentSlide, nextSlide)).toEqual({
      videoAction: "play",
      videoActionAt: 123,
    });
  });

  it("clears media state when leaving its item and honors explicit controls", () => {
    const currentState = {
      planItemId: "song-item",
      videoAction: "play" as const,
      videoActionAt: 123,
    };
    const currentSlide = { planItemId: "song-item", sectionId: "song-section" };
    const nextSlide = { planItemId: "reading-item", sectionId: "reading-section" };

    expect(videoPlaybackStateForSlideTransition(currentState, currentSlide, nextSlide)).toEqual({
      videoAction: null,
      videoActionAt: undefined,
    });
    expect(videoPlaybackStateForSlideTransition(currentState, currentSlide, currentSlide, {
      videoAction: "pause",
      videoActionAt: 456,
    })).toEqual({
      videoAction: "pause",
      videoActionAt: 456,
    });
  });

  it("does not carry an old plan's media state through an index fallback", () => {
    const oldPlanState = {
      planItemId: "old-plan-video",
      videoAction: "play" as const,
      videoActionAt: 123,
    };
    const resolvedCurrentSlide = {
      planItemId: "new-plan-welcome",
      sectionId: "new-plan-welcome",
    };

    expect(videoPlaybackStateForSlideTransition(
      oldPlanState,
      resolvedCurrentSlide,
      resolvedCurrentSlide,
    )).toEqual({
      videoAction: null,
      videoActionAt: undefined,
    });
  });

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

  it("keeps named child items inside their outline group", () => {
    const sections = buildPresentationSections([
      planItem({ id: "sermon", item_type: "sermon", title: "Sermon" }),
      planItem({ id: "deck-a", parent_item_id: "sermon", item_type: "sermon", sequence: "10.00", title: "Grace" }),
      planItem({ id: "deck-b", parent_item_id: "sermon", item_type: "sermon", sequence: "20.00", title: "Hope" }),
    ], []);

    expect(sections).toHaveLength(1);
    expect(sections[0]).toMatchObject({ id: "sermon", title: "Sermon" });
    expect(sections[0].slides.map((slide) => [slide.planItemId, slide.sectionId])).toEqual([
      ["deck-a", "sermon"], ["deck-b", "sermon"],
    ]);
  });

  it("marks every slide in a configured ending section", () => {
    const sections = buildPresentationSections([
      planItem({ id: "closing", item_type: "custom", title: "Closing", presentation_options: { end_after_section: true } }),
      planItem({ id: "closing-a", parent_item_id: "closing", item_type: "open_time", sequence: "10.00", title: "Closing slide" }),
      planItem({ id: "later", item_type: "sermon", sequence: "20.00", title: "Later" }),
    ], []);

    expect(sections[0].slides.every((slide) => slide.endAfterSection)).toBe(true);
    expect(sections[1].slides.some((slide) => slide.endAfterSection)).toBe(false);
  });

  it("hides a section's fallback image while it has child items", () => {
    const sections = buildPresentationSections([
      planItem({
        id: "announcements",
        item_type: "announcements",
        title: "Announcements",
        files: [{ content_type: "image/jpeg", display_name: "Fallback", file_id: "fallback-1", id: "link-1", sort_order: 0 }],
      }),
      planItem({ id: "notice", parent_item_id: "announcements", item_type: "announcements", title: "Church lunch" }),
    ], []);

    expect(sections[0].slides.map((slide) => slide.planItemId)).toEqual(["notice"]);
  });

  it("uses the LCF background for contentless transition sections", () => {
    const slides = buildPresentationSlides([
      planItem({ id: "welcome", item_type: "welcome", title: "Welcome and prayer" }),
      planItem({ id: "reading", item_type: "reading", title: "John 3:16", comment: "For God so loved the world." }),
    ], []);

    expect(slides[0]).toMatchObject({ backgroundImageUrl: LCF_BACKGROUND_URL, text: "Welcome and prayer" });
    expect(slides[1].backgroundImageUrl).toBeUndefined();
  });

  it("uses the LCF background for Open time", () => {
    const slides = buildPresentationSlides([
      planItem({ id: "open-time", item_type: "open_time", title: "Open time" }),
    ], []);

    expect(slides[0]).toMatchObject({ backgroundImageUrl: LCF_BACKGROUND_URL, text: "Open time" });
  });

  it("uses one attached image as fitted slide media and several as a montage", () => {
    const oneImage = buildPresentationSlides([
      planItem({
        files: [{ content_type: "image/jpeg", display_name: "Still", file_id: "still-1", id: "link-1", sort_order: 0 }],
        id: "sermon",
        item_type: "sermon",
        title: "Sermon",
      }),
    ], []);
    const montage = buildPresentationSlides([
      planItem({
        files: [
          { content_type: "image/jpeg", display_name: "First", file_id: "photo-1", id: "link-1", sort_order: 0 },
          { content_type: "image/png", display_name: "Second", file_id: "photo-2", id: "link-2", sort_order: 1 },
        ],
        id: "announcements",
        item_type: "announcements",
        title: "Announcements",
      }),
    ], []);

    expect(oneImage[0].imageUrl).toContain("still-1");
    expect(oneImage[0].backgroundImageUrl).toBeUndefined();
    expect(oneImage[0].montageImageUrls).toBeUndefined();
    expect(montage[0].backgroundImageUrl).toBeUndefined();
    expect(montage[0].montageImageUrls).toHaveLength(2);
  });

  it("shows attached images on child items regardless of their outline type", () => {
    const slides = buildPresentationSlides([
      planItem({ id: "group", item_type: "custom", title: "Visuals" }),
      planItem({
        files: [{ content_type: "image/jpeg", display_name: "Still", file_id: "still-1", id: "link-1", sort_order: 0 }],
        id: "image-item",
        item_type: "reading",
        parent_item_id: "group",
        title: "Still",
      }),
    ], []);

    expect(slides[0]).toMatchObject({ planItemId: "image-item", sectionId: "group" });
    expect(slides[0].imageUrl).toContain("still-1");
  });

  it("renders an image child of Welcome as a normal image slide", () => {
    const slides = buildPresentationSlides([
      planItem({ id: "welcome", item_type: "pre_service", title: "Welcome" }),
      planItem({
        files: [{ content_type: "image/png", display_name: "Invite", file_id: "invite-1", id: "link-1", sort_order: 0 }],
        id: "invite-item",
        item_type: "pre_service",
        parent_item_id: "welcome",
        title: "Invite",
      }),
    ], []);

    const inviteSlide = slides.find((slide) => slide.planItemId === "invite-item");
    expect(inviteSlide).toMatchObject({ imageUrl: expect.stringContaining("invite-1"), planItemId: "invite-item" });
    expect(inviteSlide?.montageImageUrls).toBeUndefined();
    expect(inviteSlide?.preServiceTimed).toBeUndefined();
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
    expect(slides[0].preServiceTimed).toBe(true);
  });

  it("builds Welcome as three individually selectable automation stages", () => {
    const slides = buildPresentationSlides([
      planItem({ id: "welcome", item_type: "pre_service", title: "Welcome" }),
      planItem({
        files: [{ content_type: "image/jpeg", display_name: "Church", file_id: "photo-1", id: "photo-link", sort_order: 0 }],
        id: "welcome-montage",
        item_type: "welcome_montage",
        parent_item_id: "welcome",
        title: "Welcome montage",
      }),
      planItem({ id: "welcome-countdown", item_type: "welcome_countdown", parent_item_id: "welcome", title: "Service countdown" }),
      planItem({ id: "welcome-seated", item_type: "welcome_seated", parent_item_id: "welcome", title: "Please be seated" }),
    ], []);

    expect(slides).toHaveLength(3);
    expect(slides.map((slide) => [slide.planItemId, slide.preServiceStage])).toEqual([
      ["welcome-montage", "montage"],
      ["welcome-countdown", "countdown"],
      ["welcome-seated", "complete"],
    ]);
    expect(slides[0].montageImageUrls?.[0]).toContain("photo-1");
    expect(slides[1].montageImageUrls).toEqual([LCF_BACKGROUND_URL]);
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


describe("section backing audio", () => {
  it("keeps the section track across child items and marks the fade cue", () => {
    const slides = buildPresentationSlides([
      planItem({ id: "root", title: "Prayer", presentation_options: { backing_audio_id: "abcdefghijk" } }),
      planItem({ id: "first", parent_item_id: "root", title: "Quiet", sequence: "10" }),
      planItem({ id: "stop", parent_item_id: "root", title: "Speaking", sequence: "20", presentation_options: { backing_audio_id: "childtrack1", stop_backing_audio: true } }),
    ], []);
    expect(slides).toHaveLength(2);
    expect(slides[0].youtubeAudioUrl).toContain("abcdefghijk");
    expect(slides[1].youtubeAudioUrl).toBe(slides[0].youtubeAudioUrl);
    expect(slides[1].youtubeAudioUrl).not.toContain("childtrack1");
    expect(slides[0].stopBackingAudio).toBe(false);
    expect(slides[1].stopBackingAudio).toBe(true);
  });
});
