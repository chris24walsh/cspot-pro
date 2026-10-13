const pitches = [40, 45, 50, 55, 59, 64, 69, 74, 79, 84, 89];
const decodedSamples = new WeakMap<AudioContext, Map<string, Promise<AudioBuffer>>>();
const downloads = new Map<string, Promise<ArrayBuffer>>();
export function guitarSampleFor(pitch: number, muted: boolean) {
  const root = pitches.reduce((best, candidate) => Math.abs(candidate - pitch) < Math.abs(best - pitch) ? candidate : best);
  return { root, rate: 2 ** ((pitch - root) / 12), key: `${muted ? "muted" : "steel"}-${root}` };
}
export async function loadGuitarSamples(context: AudioContext, notes: Array<{ pitch: number; channel: number }>) {
  const keys = [...new Set(notes.filter(note => note.channel !== 9).map(note => guitarSampleFor(note.pitch, note.channel === 1).key))];
  const buffers = new Map<string, AudioBuffer>();
  let cache = decodedSamples.get(context);
  if (!cache) { cache = new Map(); decodedSamples.set(context, cache); }
  await Promise.all(keys.map(async key => {
    let ready = cache!.get(key);
    if (!ready) {
      ready = (async () => {
        let request = downloads.get(key);
        if (!request) {
          request = fetch(`${import.meta.env.BASE_URL}audio/guitar/${key}.mp3`).then(response => {
            if (!response.ok) throw new Error("Could not load guitar sounds. Try Listen again.");
            return response.arrayBuffer();
          });
          downloads.set(key, request);
          request.catch(() => { downloads.delete(key); });
        }
        const data = await request;
        // Safari's callback form also works on older supported iPhones. Decoding
        // consumes the input on some engines, so retain a copy in the download cache.
        const decoded = await new Promise<AudioBuffer>((resolve, reject) => context.decodeAudioData(data.slice(0), resolve, reject));
        return decoded;
      })();
      cache!.set(key, ready);
      ready.catch(() => cache!.delete(key));
    }
    buffers.set(key, await ready);
  }));
  return buffers;
}

export function guitarSustainBuffer(context: AudioContext, sample: AudioBuffer) {
  const buffer = context.createBuffer(sample.numberOfChannels, sample.length, sample.sampleRate);
  const loopStart = Math.floor(sample.sampleRate);
  const loopEnd = Math.floor(sample.sampleRate * 2);
  const fade = Math.floor(sample.sampleRate * 0.06);
  for (let channel = 0; channel < sample.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    data.set(sample.getChannelData(channel));
    for (let index = 0; index < fade; index++) {
      const blend = (index + 1) / fade;
      data[loopEnd - fade + index] = data[loopEnd - fade + index] * (1 - blend) + data[loopStart - fade + index] * blend;
    }
  }
  return buffer;
}
