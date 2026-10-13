import { expect, it, vi } from "vitest";
import { guitarSampleFor, guitarSustainBuffer, loadGuitarSamples } from "./guitarSamples";
it("chooses nearby recorded strings with exact pitch shifts and distinct muted samples", () => {
  const sample = guitarSampleFor(48, false);
  expect(sample.root).toBe(50);
  expect(sample.rate).toBeCloseTo(2 ** (-2 / 12));
  expect(guitarSampleFor(48, true).key).toBe("muted-50");
});
it("loads only needed samples, shares downloads, and does not load guitar for clicks", async () => {
  const fetcher = vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
  vi.stubGlobal("fetch", fetcher);
  const context = { decodeAudioData: vi.fn((_data, resolve) => resolve({ duration: 3.13 })) } as unknown as AudioContext;
  try {
    await loadGuitarSamples(context, [{ pitch: 48, channel: 0 }, { pitch: 49, channel: 0 }, { pitch: 48, channel: 1 }, { pitch: 76, channel: 9 }]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.map(call => (call as unknown as string[])[0])).toEqual(expect.arrayContaining([expect.stringContaining('steel-50.mp3'), expect.stringContaining('muted-50.mp3')]));
    await loadGuitarSamples(context, [{ pitch: 48, channel: 0 }]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await loadGuitarSamples(context, [{ pitch: 76, channel: 9 }]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  } finally { vi.unstubAllGlobals(); }
});
it("crossfades the recorded sustain loop while retaining the original attack", () => {
  const input = Float32Array.from({ length: 3000 }, (_, index) => Math.sin(index / 17));
  const output = new Float32Array(3000);
  const sample = { sampleRate: 1000, numberOfChannels: 1, length: 3000, getChannelData: () => input } as unknown as AudioBuffer;
  const context = { createBuffer: () => ({ getChannelData: () => output }) } as unknown as AudioContext;
  guitarSustainBuffer(context, sample);
  expect(Array.from(output.slice(0, 1000))).toEqual(Array.from(input.slice(0, 1000)));
  expect(output[1999]).toBeCloseTo(input[999]);
  expect(input[1999]).toBeCloseTo(Math.sin(1999 / 17)); // source remains reusable
});
