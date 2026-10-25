import { buildAbsoluteApiUrl } from './api';
export interface MixerParameter {
  path: string;
  label: string;
  group: string;
  kind: 'float' | 'int' | 'string';
  min: number;
  max: number;
  unit: string;
  scale: string;
  options: string[] | null;
}
export interface MixerStrip {
  id: string;
  name: string;
  kind: string;
  meter: number;
}
export interface MixerState {
  startup_muting?: boolean;
  fx_specs: Record<string, MixerParameter>;
  host: string | null;
  connected: boolean;
  identity: string[];
  values: Record<string, number | string>;
  meters: number[];
  pending: string[];
  failed: Record<string, string>;
  synchronized: boolean;
  syncing: boolean;
  recalling: boolean;
  revision: number;
  age_ms: number | null;
  error: string | null;
}
export const emptyMixer: MixerState = {
  fx_specs: {},
  host: null,
  connected: false,
  identity: [],
  values: {},
  meters: [],
  pending: [],
  failed: {},
  synchronized: false,
  syncing: false,
  recalling: false,
  revision: 0,
  age_ms: null,
  error: null
};
export function fromWire(spec: MixerParameter, value: number) {
  if (spec.kind === 'int') return value;
  if (spec.scale === 'fader') return value >= .5 ? value * 40 - 30 : value >= .25 ? value * 80 - 50 : value >= .0625 ? value * 160 - 70 : value * 480 - 90;
  if (spec.scale === 'log' || spec.scale === 'reverse-log') return spec.min * Math.pow(spec.max / spec.min, spec.scale === 'reverse-log' ? 1 - value : value);
  return spec.min + (spec.max - spec.min) * value;
}
export function toWire(spec: MixerParameter, value: number) {
  if (spec.kind === 'int') return value;
  if (spec.scale === 'fader') return value >= -10 ? (value + 30) / 40 : value >= -30 ? (value + 50) / 80 : value >= -60 ? (value + 70) / 160 : (value + 90) / 480;
  if (spec.scale === 'log' || spec.scale === 'reverse-log') {
    const n = Math.log(value / spec.min) / Math.log(spec.max / spec.min);
    return spec.scale === 'reverse-log' ? 1 - n : n;
  }
  return (value - spec.min) / (spec.max - spec.min);
}
export function displayValue(spec: MixerParameter, wire: number | string | undefined) {
  if (wire === undefined) return '—';
  if (typeof wire === 'string') return wire;
  if (spec.options) return spec.options[wire] ?? String(wire);
  if (spec.scale === 'fader' && wire === 0) return '−∞ dB';
  const v = fromWire(spec, wire);
  return `${Math.abs(v) >= 1000 ? (v / 1000).toFixed(2) + 'k' : v.toFixed(spec.kind === 'int' ? 0 : 1)} ${spec.unit}`.trim();
}
export async function mixerRequest<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(buildAbsoluteApiUrl('/api/v1/mixer' + path), {
      method,
      credentials: 'include',
      headers: body === undefined ? undefined : {
        'Content-Type': 'application/json'
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.detail || `Mixer request failed (${response.status})`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

export function physicalHeadamp(values: Record<string, number | string>, channel: string) {
  const source = values[channel + '/config/insrc'];
  if (!channel.startsWith('/ch/') || typeof source !== 'number' || source < 0 || source > 15) return null;
  return `/headamp/${String(source + 1).padStart(2, '0')}`;
}
