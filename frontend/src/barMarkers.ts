import type { ChordAnnotation } from "./chordSheet";
import { effectiveBarRhythms, type BarMarker, type SongRhythm } from "./songRhythm";

function comparePosition(a: { lineIndex: number; anchorIndex: number }, b: { lineIndex: number; anchorIndex: number }) {
  return a.lineIndex - b.lineIndex || a.anchorIndex - b.anchorIndex;
}

// Unassigned changes interpolate between explicit counts, independently of lyric spacing.
export function chordBeats(chords: Array<{ beat?: number }>, numerator: number, strict = false): number[] {
  if (chords.some((chord, index) => chord.beat !== undefined && (!Number.isFinite(chord.beat) || chord.beat < 1 || chord.beat >= numerator + 1 || (index > 0 && chord.beat === 1)))) {
    if (strict) throw new Error("Choose increasing beats within the bar; only the first chord can play on beat 1.");
    return chords.map((_, index) => 1 + index * numerator / chords.length);
  }
  const anchors = [{ index: 0, beat: 1 }, ...chords.flatMap((chord, index) => index > 0 && chord.beat !== undefined && chord.beat > 1 && chord.beat < numerator + 1 ? [{ index, beat: chord.beat }] : []), { index: chords.length, beat: numerator + 1 }];
  for (let i = 1; i < anchors.length; i++) {
    if (anchors[i].beat <= anchors[i - 1].beat) {
      if (strict) throw new Error("Chord changes must have increasing beat counts within the bar.");
      return chords.map((_, index) => 1 + index * numerator / chords.length);
    }
  }
  return chords.map((_, index) => {
    const next = anchors.findIndex(anchor => anchor.index > index);
    const from = anchors[next - 1], to = anchors[next];
    return from.beat + (to.beat - from.beat) * (index - from.index) / (to.index - from.index);
  });
}

// Explicit lyric boundaries define bars; musical counts are independent of text anchors.
export function rhythmWithBarMarkers(rhythm: SongRhythm | null | undefined, annotations: ChordAnnotation[], markers = rhythm?.markers ?? []): SongRhythm | null {
  if (!rhythm && !markers.length) return null;
  const current: SongRhythm = rhythm ?? { numerator: 4, denominator: 4, patterns: [], notes: "" };
  const managed = new Set([...(current.markers ?? []), ...markers].map((marker) => marker.section));
  const arrangements = (current.arrangements ?? []).filter((entry) => !managed.has(entry.section === "Default" ? null : entry.section));
  for (const section of Array.from(new Set(markers.map((marker) => marker.section))).sort((a, b) => (a ?? "").localeCompare(b ?? ""))) {
    const boundaries = markers.filter((marker) => marker.section === section).sort(comparePosition);
    const chords = annotations.filter((annotation) => annotation.section === section).sort(comparePosition);
    if (!chords.length) continue;
    const buckets: ChordAnnotation[][] = Array.from({ length: boundaries.length + 1 }, () => []);
    for (const chord of chords) {
      const index = boundaries.filter((marker) => comparePosition(marker, chord) <= 0).length;
      buckets[index].push(chord);
    }
    const settings = effectiveBarRhythms(current, [{}, ...boundaries]);
    const bars: string[] = [];
    let previous: string | null = null;
    buckets.forEach((bucket, index) => {
      if (!bucket.length && index === 0) return;
      if (bucket.length) { const beats = chordBeats(bucket, settings[index].numerator); bars.push(bucket.map((chord, i) => `${chord.chord}${bucket.some(entry => entry.beat !== undefined) ? `@${beats[i]}` : ""}`).join(" ")); previous = bucket[bucket.length - 1].chord; }
      else if (previous) bars.push(previous);
    });
    if (bars.length) arrangements.push({ section: section ?? "Default", chart: bars.join(" | ") });
  }
  return { ...current, markers, arrangements };
}

export function placeBarMarker(rhythm: SongRhythm | null | undefined, annotations: ChordAnnotation[], position: Omit<BarMarker, "id">, id = `bar-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`) {
  const markers = (rhythm?.markers ?? []).filter((marker) => marker.id !== id && !(marker.section === position.section && marker.lineIndex === position.lineIndex && marker.anchorIndex === position.anchorIndex));
  const existing = rhythm?.markers?.find(marker => marker.id === id);
  return rhythmWithBarMarkers(rhythm, annotations, [...markers, { ...existing, id, ...position }])!;
}

export function removeBarMarker(rhythm: SongRhythm, annotations: ChordAnnotation[], id: string) {
  return rhythmWithBarMarkers(rhythm, annotations, (rhythm.markers ?? []).filter((marker) => marker.id !== id))!;
}
