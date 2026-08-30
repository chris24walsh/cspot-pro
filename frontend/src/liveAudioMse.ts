export const LIVE_AUDIO_MSE_MIME = 'audio/mp4; codecs="mp4a.40.2"';
export const LIVE_EDGE_TARGET_SECONDS = 0.25;
export const LIVE_EDGE_HARD_SEEK_SECONDS = 0.85;
export const LIVE_EDGE_CATCH_UP_SECONDS = 0.45;
export const LIVE_EDGE_CATCH_UP_RATE = 1.04;

export interface LiveEdgeCorrection {
  currentTime: number | null;
  playbackRate: number;
}

export function liveEdgeCorrection(
  currentTime: number,
  bufferedStart: number,
  bufferedEnd: number,
): LiveEdgeCorrection {
  const target = Math.max(bufferedStart, bufferedEnd - LIVE_EDGE_TARGET_SECONDS);
  const lag = bufferedEnd - currentTime;
  if (
    currentTime < bufferedStart - 0.05
    || currentTime > bufferedEnd
    || lag > LIVE_EDGE_HARD_SEEK_SECONDS
  ) {
    return { currentTime: target, playbackRate: 1 };
  }
  return {
    currentTime: null,
    playbackRate: lag > LIVE_EDGE_CATCH_UP_SECONDS ? LIVE_EDGE_CATCH_UP_RATE : 1,
  };
}

export type FragmentedMp4Segment = {
  kind: "init" | "media";
  data: Uint8Array;
};

const MAX_MP4_BOX_BYTES = 16 * 1024 * 1024;

function concatenate(parts: Uint8Array[]) {
  const combined = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    combined.set(part, offset);
    offset += part.byteLength;
  }
  return combined;
}

function boxType(box: Uint8Array) {
  return String.fromCharCode(box[4], box[5], box[6], box[7]);
}

function boxSize(buffer: Uint8Array) {
  if (buffer.byteLength < 8) return null;
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const shortSize = view.getUint32(0);
  if (shortSize === 0) throw new Error("Unbounded MP4 boxes are not valid in a live stream");
  if (shortSize !== 1) return { headerBytes: 8, size: shortSize };
  if (buffer.byteLength < 16) return null;
  const size = Number(view.getBigUint64(8));
  if (!Number.isSafeInteger(size)) throw new Error("MP4 box is too large");
  return { headerBytes: 16, size };
}

/** Split arbitrary fetch chunks into an init segment and complete moof/mdat fragments. */
export class FragmentedMp4Parser {
  private pending = new Uint8Array();
  private initParts: Uint8Array[] = [];
  private prefixParts: Uint8Array[] = [];
  private mediaParts: Uint8Array[] = [];
  private initEmitted = false;

  push(chunk: Uint8Array): FragmentedMp4Segment[] {
    this.pending = concatenate([this.pending, chunk]);
    if (this.pending.byteLength > MAX_MP4_BOX_BYTES) {
      throw new Error("Fragmented MP4 parser buffer exceeded its limit");
    }
    const segments: FragmentedMp4Segment[] = [];
    while (true) {
      const parsedSize = boxSize(this.pending);
      if (!parsedSize || this.pending.byteLength < parsedSize.size) break;
      if (parsedSize.size < parsedSize.headerBytes || parsedSize.size > MAX_MP4_BOX_BYTES) {
        throw new Error("Invalid MP4 box size");
      }
      const box = this.pending.slice(0, parsedSize.size);
      this.pending = this.pending.slice(parsedSize.size);
      const type = boxType(box);

      if (type === "moof") {
        if (this.mediaParts.length) throw new Error("MP4 fragment is missing media data");
        if (!this.initEmitted) {
          if (!this.initParts.length) throw new Error("MP4 initialization segment is missing");
          segments.push({ kind: "init", data: concatenate(this.initParts) });
          this.initParts = [];
          this.initEmitted = true;
        }
        this.mediaParts = [...this.prefixParts, box];
        this.prefixParts = [];
      } else if (this.mediaParts.length) {
        this.mediaParts.push(box);
        if (type === "mdat") {
          segments.push({ kind: "media", data: concatenate(this.mediaParts) });
          this.mediaParts = [];
        }
      } else if (this.initEmitted) {
        this.prefixParts.push(box);
      } else {
        this.initParts.push(box);
      }
    }
    return segments;
  }
}

/** Keep init data plus only the newest few complete media fragments. */
export class BoundedFmp4SegmentQueue {
  private init: Uint8Array | null = null;
  private media: Uint8Array[] = [];

  constructor(private readonly maxMediaSegments = 4) {}

  enqueue(segment: FragmentedMp4Segment) {
    if (segment.kind === "init") {
      this.init = segment.data;
      return;
    }
    this.media.push(segment.data);
    if (this.media.length > this.maxMediaSegments) {
      this.media.splice(0, this.media.length - this.maxMediaSegments);
    }
  }

  take(): FragmentedMp4Segment | null {
    if (this.init) {
      const data = this.init;
      this.init = null;
      return { kind: "init", data };
    }
    const data = this.media.shift();
    return data ? { kind: "media", data } : null;
  }

  get length() {
    return this.media.length + (this.init ? 1 : 0);
  }
}
