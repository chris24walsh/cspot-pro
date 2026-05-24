import type { PlanItem, RenderedSlide, Song } from "./api";
import { splitWorshipSlides } from "./worshipText";

export const PRESENTATION_CHANNEL = "cspot-pro-presentation-live";
export const PRESENTATION_STORAGE_KEY = "cspot-pro:presentation-live";
export const PRESENTATION_OUTPUT_STATUS_KEY = "cspot-pro:presentation-output-status";
export type PresentationTheme = "dark" | "light";

export interface PresentationLiveState {
  planId: string;
  index: number;
  updatedAt: number;
  planItemId?: string | null;
  slideOffset?: number;
  theme?: PresentationTheme;
  blanked?: boolean;
  fullscreen?: boolean;
}

export interface PresentationSlide {
  id: string;
  planItemId: string;
  sectionId: string;
  sectionTitle: string;
  title: string;
  text: string;
  imageUrl?: string;
  videoUrl?: string;
  videoProvider?: "youtube";
  videoId?: string;
  renderedSlideIndex?: number;
  originalSlideIndex?: number | null;
  buildIndex?: number;
  buildCount?: number;
  itemType: string;
  sequence: string;
}

export interface PresentationSection {
  id: string;
  title: string;
  itemType: string;
  slides: PresentationSlide[];
}

function suggestTextFontCap(text: string, compact = false) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const totalChars = lines.join(" ").length;
  const longestLine = lines.reduce((longest, line) => Math.max(longest, line.length), 0);

  if (compact) {
    if (lines.length >= 6 || totalChars > 180 || longestLine > 34) {
      return 9;
    }
    if (lines.length >= 5 || totalChars > 145 || longestLine > 30) {
      return 10;
    }
    if (lines.length >= 4 || totalChars > 115 || longestLine > 25) {
      return 11;
    }
    if (lines.length >= 3 || totalChars > 85 || longestLine > 20) {
      return 12;
    }
    return 13;
  }

  if (lines.length >= 7 || totalChars > 260 || longestLine > 46) {
    return 48;
  }
  if (lines.length >= 6 || totalChars > 220 || longestLine > 40) {
    return 54;
  }
  if (lines.length >= 5 || totalChars > 180 || longestLine > 34) {
    return 60;
  }
  if (lines.length >= 4 || totalChars > 135 || longestLine > 28) {
    return 66;
  }
  return 72;
}

export function suggestSlideGroupFontCap(texts: string[], compact = false) {
  const meaningfulTexts = texts.map((text) => text.trim()).filter(Boolean);
  if (!meaningfulTexts.length) {
    return compact ? 13 : 72;
  }

  const frequency = new Map<number, number>();
  for (const text of meaningfulTexts) {
    const cap = suggestTextFontCap(text, compact);
    frequency.set(cap, (frequency.get(cap) ?? 0) + 1);
  }

  let bestCap = compact ? 13 : 72;
  let bestCount = -1;

  for (const [cap, count] of frequency.entries()) {
    if (count > bestCount || (count === bestCount && cap < bestCap)) {
      bestCap = cap;
      bestCount = count;
    }
  }

  return bestCap;
}

export function resolveLiveIndex(slides: PresentationSlide[], liveState: PresentationLiveState | null) {
  if (!slides.length) {
    return 0;
  }
  if (!liveState) {
    return 0;
  }

  if (liveState.planItemId) {
    const matchingSlides = slides.filter((slide) => slide.planItemId === liveState.planItemId);
    if (matchingSlides.length) {
      const offset = Math.min(Math.max(liveState.slideOffset ?? 0, 0), matchingSlides.length - 1);
      const targetSlide = matchingSlides[offset];
      const targetIndex = slides.findIndex((slide) => slide.id === targetSlide?.id);
      if (targetIndex >= 0) {
        return targetIndex;
      }
    }
  }

  return Math.min(Math.max(liveState.index, 0), slides.length - 1);
}

export function presentationTypeClass(itemType: string) {
  switch (itemType) {
    case "song":
      return "type-song";
    case "reading":
      return "type-reading";
    case "sermon":
      return "type-sermon";
    case "video":
      return "type-video";
    case "welcome":
      return "type-welcome";
    default:
      return "type-generic";
  }
}

export function extractYouTubeId(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    return null;
  }

  const directId = trimmed.match(/^[A-Za-z0-9_-]{11}$/);
  if (directId) {
    return trimmed;
  }

  const patterns = [
    /youtu\.be\/([A-Za-z0-9_-]{11})/,
    /youtube\.com\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{11})/,
    /youtube\.com\/watch\?[^#]*\bv=([A-Za-z0-9_-]{11})/,
    /youtube\.com\/.*[?&]v=([A-Za-z0-9_-]{11})/,
  ];

  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}

export function youtubeEmbedUrl(videoId: string) {
  return `https://www.youtube-nocookie.com/embed/${videoId}?rel=0&modestbranding=1&playsinline=1`;
}

export function slideTextForItem(item: PlanItem, songs: Song[]) {
  const song = item.song_id ? songs.find((candidate) => candidate.id === item.song_id) : null;
  if (song?.lyrics) {
    return song.lyrics;
  }

  if (item.comment) {
    return item.comment;
  }

  return item.title;
}

export function buildPresentationSlides(
  items: PlanItem[],
  songs: Song[],
  renderedSlidesByFileId: Record<string, RenderedSlide[]> = {},
): PresentationSlide[] {
  return buildPresentationSections(items, songs, renderedSlidesByFileId).flatMap((section) => section.slides);
}

export function buildPresentationSections(
  items: PlanItem[],
  songs: Song[],
  renderedSlidesByFileId: Record<string, RenderedSlide[]> = {},
): PresentationSection[] {
  return items.map((item) => {
    const song = item.song_id ? songs.find((candidate) => candidate.id === item.song_id) : null;
    const sectionTitle = song?.title ?? item.title;

    const deckSlides = (item.files ?? []).flatMap((file) =>
      (renderedSlidesByFileId[file.file_id] ?? []).map((slide) => {
        const originalIndex = slide.original_index ?? slide.index;
        const buildIndex = slide.build_index ?? 0;
        const buildCount = slide.build_count ?? 1;
        const buildSuffix = buildCount > 1 ? `.${buildIndex + 1}` : "";
        return {
          id: `${item.id}:${file.file_id}:${slide.index}`,
          planItemId: item.id,
          sectionId: item.id,
          sectionTitle,
          title: `${file.display_name} ${originalIndex}${buildSuffix}`,
          text: "",
          imageUrl: slide.image_url,
          renderedSlideIndex: slide.index,
          originalSlideIndex: originalIndex,
          buildIndex,
          buildCount,
          itemType: item.item_type,
          sequence: item.sequence,
        };
      }),
    );

    if (deckSlides.length) {
      return { id: item.id, title: sectionTitle, itemType: item.item_type, slides: deckSlides };
    }

    if (item.item_type === "video") {
      const videoId = extractYouTubeId(item.comment ?? item.title);
      const slide = {
        id: item.id,
        planItemId: item.id,
        sectionId: item.id,
        sectionTitle,
        title: sectionTitle,
        text: videoId ? "" : item.comment ?? item.title,
        videoId: videoId ?? undefined,
        videoProvider: videoId ? ("youtube" as const) : undefined,
        videoUrl: videoId ? youtubeEmbedUrl(videoId) : undefined,
        itemType: item.item_type,
        sequence: item.sequence,
      };
      return { id: item.id, title: sectionTitle, itemType: item.item_type, slides: [slide] };
    }

    if (song?.lyrics) {
      const songSlides = splitWorshipSlides(song.lyrics);
      if (songSlides.length) {
        const slides = songSlides.map((text, sectionIndex) => {
          return {
            id: `${item.id}:${sectionIndex}`,
            planItemId: item.id,
            sectionId: item.id,
            sectionTitle,
            title: `${sectionTitle} ${sectionIndex + 1}`,
            text,
            itemType: item.item_type,
            sequence: item.sequence,
          };
        });
        return { id: item.id, title: sectionTitle, itemType: item.item_type, slides };
      }
    }

    const slide = {
      id: item.id,
      planItemId: item.id,
      sectionId: item.id,
      sectionTitle,
      title: sectionTitle,
      text: slideTextForItem(item, songs),
      itemType: item.item_type,
      sequence: item.sequence,
    };

    return {
      id: item.id,
      title: sectionTitle,
      itemType: item.item_type,
      slides: [{ ...slide }],
    };
  });
}
