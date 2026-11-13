import type { Song, WorshipMusicTiming } from './api';
import { parseChordChart } from './chordSheet';
import { buildPracticePerformance, MIDI_PPQ, performanceBarLength } from './musicPractice';
import { lyricBarLayout, lyricPlaybackBars, liveJumpStart, timedPracticeBars, timelineWithEntry } from './lyricTiming';

export interface MusicDestinationPage {
  occurrence: number;
  lineStart: number;
  lineEnd: number;
}

export function resolveMusicTimingDestination(song: Song, planItemId: string, page?: MusicDestinationPage): WorshipMusicTiming | null {
  if (!song.rhythm || !song.lyrics) return null;
  const annotations = parseChordChart(song.chords, song.lyrics).document.annotations;
  const timeline = lyricPlaybackBars(song.lyrics, song.sequence, lyricBarLayout(song.lyrics, song.rhythm, annotations));
  const { index, stop } = liveJumpStart(song.lyrics, timeline, annotations, page);
  if (index < 0 || !timeline.length) return null;
  const jumpTimeline = timelineWithEntry(timeline, index, stop);
  const bars = timedPracticeBars(song.lyrics, jumpTimeline.slice(index), annotations, song.rhythm.numerator);
  if (!bars.length) return null;
  const performance = buildPracticePerformance(song.rhythm, {
    mode: 'song', lyrics: song.lyrics, sequence: song.sequence, annotations, bars,
    countIn: false, metronome: true, metronomeDuringRests: true, chords: false, finish: false,
  });
  const durations = bars.map((_, bar) => performanceBarLength(performance, bar) / MIDI_PPQ * 60_000 / performance.quarterBpm);
  return {
    owner_id: '',
    active: true,
    song_id: song.id,
    plan_item_id: planItemId,
    start_index: index,
    first_bar_stop: stop,
    position: 0,
    bar_duration_ms: durations[0],
    bar_durations_ms: durations,
    total_bars: bars.length,
    updated_at: 0,
  };
}
