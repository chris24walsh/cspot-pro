import type { ChordAnnotation } from "./chordSheet";
import type { BarMarker, SongRhythm } from "./songRhythm";

function comparePosition(a: { lineIndex: number; anchorIndex: number }, b: { lineIndex: number; anchorIndex: number }) {
  return a.lineIndex - b.lineIndex || a.anchorIndex - b.anchorIndex;
}

// Explicit lyric boundaries define bars; chords within each bar divide its time evenly.
export function rhythmWithBarMarkers(rhythm: SongRhythm | null | undefined, annotations: ChordAnnotation[], markers = rhythm?.markers ?? []): SongRhythm | null {
  if (!rhythm && !markers.length) return null;
  const current: SongRhythm = rhythm ?? { numerator: 4, denominator: 4, patterns: [], notes: "" };
  const managed = new Set([...(current.markers ?? []), ...markers].map((marker) => marker.section));
  const arrangements = (current.arrangements ?? []).filter((entry) => !managed.has(entry.section === "Default" ? null : entry.section));
  for (const section of Array.from(new Set(markers.map((marker) => marker.section))).sort((a, b) => (a ?? "").localeCompare(b ?? ""))) {
    const boundaries = markers.filter((marker) => marker.section === section).sort(comparePosition);
    const chords = annotations.filter((annotation) => annotation.section === section).sort(comparePosition);
    if (!chords.length) continue;
    const buckets: string[][] = Array.from({ length: boundaries.length + 1 }, () => []);
    for (const chord of chords) {
      const index = boundaries.filter((marker) => comparePosition(marker, chord) <= 0).length;
      buckets[index].push(chord.chord);
    }
    const bars: string[] = [];
    let previous: string | null = null;
    buckets.forEach((bucket, index) => {
      if (!bucket.length && index === 0) return;
      if (bucket.length) { bars.push(bucket.join(" ")); previous = bucket[bucket.length - 1]; }
      else if (previous) bars.push(previous);
    });
    if (bars.length) arrangements.push({ section: section ?? "Default", chart: bars.join(" | ") });
  }
  return { ...current, markers, arrangements };
}

export function placeBarMarker(rhythm: SongRhythm | null | undefined, annotations: ChordAnnotation[], position: Omit<BarMarker, "id">, id = `bar-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`) {
  const markers = (rhythm?.markers ?? []).filter((marker) => marker.id !== id && !(marker.section === position.section && marker.lineIndex === position.lineIndex && marker.anchorIndex === position.anchorIndex));
  return rhythmWithBarMarkers(rhythm, annotations, [...markers, { id, ...position }])!;
}

export function removeBarMarker(rhythm: SongRhythm, annotations: ChordAnnotation[], id: string) {
  return rhythmWithBarMarkers(rhythm, annotations, (rhythm.markers ?? []).filter((marker) => marker.id !== id))!;
}
