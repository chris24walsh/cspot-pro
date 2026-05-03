import type { PlanItem, RenderedSlide, Song } from "./api";
import { splitWorshipSlides } from "./worshipText";

export const PRESENTATION_CHANNEL = "cspot-presentation-live";
export const PRESENTATION_STORAGE_KEY = "cspot:presentation-live";
export type PresentationTheme = "dark" | "light";

export interface PresentationLiveState {
  planId: string;
  index: number;
  updatedAt: number;
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
  itemType: string;
  sequence: string;
}

export interface PresentationSection {
  id: string;
  title: string;
  itemType: string;
  slides: PresentationSlide[];
}

export function presentationTypeClass(itemType: string) {
  switch (itemType) {
    case "song":
      return "type-song";
    case "reading":
      return "type-reading";
    case "sermon":
      return "type-sermon";
    case "welcome":
      return "type-welcome";
    default:
      return "type-generic";
  }
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
      (renderedSlidesByFileId[file.file_id] ?? []).map((slide) => ({
        id: `${item.id}:${file.file_id}:${slide.index}`,
        planItemId: item.id,
        sectionId: item.id,
        sectionTitle,
        title: `${file.display_name} ${slide.index}`,
        text: "",
        imageUrl: slide.image_url,
        itemType: item.item_type,
        sequence: item.sequence,
      })),
    );

    if (deckSlides.length) {
      return { id: item.id, title: sectionTitle, itemType: item.item_type, slides: deckSlides };
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
