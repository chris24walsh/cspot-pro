import { describe, expect, it } from "vitest";

import {
  BoundedFmp4SegmentQueue,
  FragmentedMp4Parser,
  LIVE_EDGE_CATCH_UP_RATE,
  liveAudioEdgeCorrection,
  liveEdgeCorrection,
} from "./liveAudioMse";

function box(type: string, payload: number[]) {
  const result = new Uint8Array(8 + payload.length);
  new DataView(result.buffer).setUint32(0, result.byteLength);
  for (let index = 0; index < 4; index += 1) result[4 + index] = type.charCodeAt(index);
  result.set(payload, 8);
  return result;
}

function join(...parts: Uint8Array[]) {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

describe("fragmented MP4 live audio buffering", () => {
  it("reassembles arbitrary network chunks into init and complete media segments", () => {
    const parser = new FragmentedMp4Parser();
    const bytes = join(
      box("ftyp", [1]),
      box("moov", [2, 3]),
      box("moof", [4]),
      box("mdat", [5, 6, 7]),
    );

    expect(parser.push(bytes.slice(0, 11))).toEqual([]);
    const segments = [
      ...parser.push(bytes.slice(11, 29)),
      ...parser.push(bytes.slice(29)),
    ];

    expect(segments.map((segment) => segment.kind)).toEqual(["init", "media"]);
    expect(segments[0].data).toEqual(join(box("ftyp", [1]), box("moov", [2, 3])));
    expect(segments[1].data).toEqual(join(box("moof", [4]), box("mdat", [5, 6, 7])));
  });

  it("retains initialization but drops stale complete fragments when the browser stalls", () => {
    const queue = new BoundedFmp4SegmentQueue(2);
    queue.enqueue({ kind: "init", data: new Uint8Array([9]) });
    queue.enqueue({ kind: "media", data: new Uint8Array([1]) });
    queue.enqueue({ kind: "media", data: new Uint8Array([2]) });
    queue.enqueue({ kind: "media", data: new Uint8Array([3]) });

    expect(queue.take()).toEqual({ kind: "init", data: new Uint8Array([9]) });
    expect(queue.take()).toEqual({ kind: "media", data: new Uint8Array([2]) });
    expect(queue.take()).toEqual({ kind: "media", data: new Uint8Array([3]) });
    expect(queue.take()).toBeNull();
  });
});

describe("shared camera/audio live-edge correction", () => {
  it("hard-seeks a materially delayed stream to about 250 ms behind live", () => {
    expect(liveEdgeCorrection(2, 1, 5)).toEqual({ currentTime: 4.75, playbackRate: 1 });
  });

  it("uses only modest catch-up for a small drift and returns to normal at the target", () => {
    expect(liveEdgeCorrection(4.4, 1, 5)).toEqual({
      currentTime: null,
      playbackRate: LIVE_EDGE_CATCH_UP_RATE,
    });
    expect(liveEdgeCorrection(4.75, 1, 5)).toEqual({ currentTime: null, playbackRate: 1 });
  });

  it("does not time-stretch live audio for ordinary drift", () => {
    expect(liveAudioEdgeCorrection(4.4, 1, 5)).toEqual({
      currentTime: null,
      playbackRate: 1,
    });
    expect(liveAudioEdgeCorrection(2, 1, 5)).toEqual({
      currentTime: 4.75,
      playbackRate: 1,
    });
  });
});
