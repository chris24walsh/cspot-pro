import { describe, expect, it } from "vitest";
import type { Song } from "./api";
import { matchesSongLibraryFilters, songLibraryMetadata } from "./songLibraryFilters";

const song = {
  title: "Amazing Grace", author: "Newton", lyrics: "Amazing grace", book_reference: "Hymns #123",
  theme_tags: "Grace, Easter, grace", chords: JSON.stringify({ version: 3, absoluteKey: "D", annotations: [] }),
} as Song;
const filters = { query: "", key: "all", theme: "all", source: "all" };

describe("song library filtering", () => {
  it("combines text, key, exact theme and grouped book source", () => {
    const metadata = songLibraryMetadata(song);
    expect(metadata).toEqual({ key: "D", themes: ["grace", "easter"], source: "Hymns" });
    expect(matchesSongLibraryFilters(song, metadata, { query: " NEWTON ", key: "D", theme: "grace", source: "Hymns" })).toBe(true);
    for (const mismatch of [{ key: "C" }, { theme: "east" }, { source: "Other" }, { query: "missing" }]) {
      expect(matchesSongLibraryFilters(song, metadata, { ...filters, ...mismatch })).toBe(false);
    }
  });
  it("supports missing metadata and clearing filters", () => {
    const blank = { ...song, chords: null, theme_tags: " ", book_reference: null };
    expect(matchesSongLibraryFilters(blank, songLibraryMetadata(blank), { ...filters, key: "none", theme: "none", source: "none" })).toBe(true);
    expect(matchesSongLibraryFilters(song, songLibraryMetadata(song), { ...filters, key: "none" })).toBe(false);
    expect(matchesSongLibraryFilters(song, songLibraryMetadata(song), filters)).toBe(true);
  });
  it("uses the sounding key for capo charts", () => {
    const capoSong = { ...song, chords: JSON.stringify({ version: 3, capoKey: "C", capo: 2, annotations: [] }) };
    expect(songLibraryMetadata(capoSong).key).toBe("D");
  });
});
