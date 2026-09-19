export type SchoolSoundCue = "pop" | "hint" | "success" | "entrance" | "harbour" | "waves" | "thunder" | "splash";

// Original, short local sounds. Keep one context through all scene/verse changes.
export class SundaySchoolSound {
  context: AudioContext | null = null;
  private sources = new Set<AudioScheduledSourceNode>();

  async enable() {
    const Audio = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Audio) throw new Error("Sound is unavailable in this browser.");
    this.context ??= new Audio();
    await this.context.resume();
    if (this.context.state !== "running") throw new Error("Tap again to enable sound.");
    this.play("pop");
  }

  stop() {
    this.sources.forEach((source) => { try { source.stop(); } catch { /* Already ended. */ } });
    this.sources.clear();
  }

  play(cue: SchoolSoundCue) {
    const context = this.context;
    if (!context || context.state !== "running") return;
    this.stop();
    const now = context.currentTime;
    const track = (source: AudioScheduledSourceNode, gain: GainNode, duration: number) => {
      source.connect(gain);
      gain.connect(context.destination);
      this.sources.add(source);
      source.onended = () => { this.sources.delete(source); source.disconnect(); gain.disconnect(); };
      source.start(now);
      source.stop(now + duration);
    };
    if (["thunder", "splash", "waves", "harbour"].includes(cue)) {
      const duration = cue === "thunder" ? 1.1 : cue === "splash" ? .45 : .8;
      const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
      const samples = buffer.getChannelData(0);
      let previous = 0;
      for (let i = 0; i < samples.length; i++) {
        previous = (previous + (Math.random() * 2 - 1) * .12) / 1.12;
        samples[i] = cue === "splash" ? (Math.random() * 2 - 1) * .6 : previous * 3;
      }
      const source = context.createBufferSource();
      source.buffer = buffer;
      const gain = context.createGain();
      gain.gain.setValueAtTime(.001, now);
      gain.gain.linearRampToValueAtTime(cue === "thunder" ? .22 : .12, now + .04);
      gain.gain.exponentialRampToValueAtTime(.001, now + duration);
      track(source, gain, duration);
      return;
    }
    const notes = cue === "success" ? [523, 659, 784, 1047] : cue === "hint" ? [523, 659] : cue === "entrance" ? [392, 523] : [660];
    notes.forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = now + index * .09;
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, now);
      gain.gain.setValueAtTime(.001, start);
      gain.gain.linearRampToValueAtTime(.12, start + .015);
      gain.gain.exponentialRampToValueAtTime(.001, start + .17);
      track(oscillator, gain, index * .09 + .18);
    });
  }

  close() { this.stop(); void this.context?.close(); this.context = null; }
}
