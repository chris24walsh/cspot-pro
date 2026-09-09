import type { Song } from "./api";
import { deriveAbsoluteKey, parseChordChart } from "./chordSheet";

export function songBookSource(song: Song) {
  return song.book_reference?.replace(/\s+#\d+\s*$/, "").trim() || null;
}

export function songLibraryMetadata(song: Song) {
  const chart = parseChordChart(song.chords, song.lyrics).document;
  return {
    key: chart.absoluteKey || (chart.capoKey ? deriveAbsoluteKey(chart.capoKey, chart.capo) : null),
    themes: [...new Set((song.theme_tags ?? "").split(",").map((tag) => tag.trim().toLowerCase()).filter(Boolean))],
    source: songBookSource(song),
  };
}

export function matchesSongLibraryFilters(
  song: Song,
  metadata: ReturnType<typeof songLibraryMetadata>,
  filters: { query: string; key: string; theme: string; source: string },
) {
  if (filters.key === "none" ? metadata.key !== null : filters.key !== "all" && metadata.key !== filters.key) return false;
  if (filters.theme === "none" ? metadata.themes.length > 0 : filters.theme !== "all" && !metadata.themes.includes(filters.theme)) return false;
  if (filters.source === "none" ? metadata.source !== null : filters.source !== "all" && metadata.source !== filters.source) return false;
  return `${song.title} ${song.author ?? ""} ${song.alternate_title ?? ""} ${song.lyrics ?? ""} ${song.book_reference ?? ""} ${song.theme_tags ?? ""}`
    .toLowerCase().includes(filters.query.trim().toLowerCase());
}
