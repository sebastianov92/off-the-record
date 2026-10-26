// The postMessage protocol with the splash's tv-bridge.js (pikaraoke/static/ai/).
// The bridge ships with the server and the app ships on the TV, so they update
// apart: every message carries the version, and changes are additive only.
export const BRIDGE = 1;

export type Command = 'pause' | 'skip' | 'restart' | 'volume' | 'guide' | 'login';

export interface PlayState {
  playing: boolean;
  paused: boolean;
  title: string;
  singer: string;
  upNext: string;
  nextSinger: string;
  volume: number; // 0..1
  guideVolume: number; // 0..100
  hasGuide: boolean;
  scorable: boolean;
  position: number;
  duration: number;
}

export interface Ready {
  bridge: number;
  caps: string[];
  auth: { required: boolean; ok: boolean };
  env: { ua: string; hasPalmBridge: boolean };
}

export interface CommandResult {
  id: number;
  ok: boolean;
  status: number;
  retryAfter?: number;
  token?: string;
}

export type FromSplash =
  | ({ type: 'ready' } & Ready)
  | ({ type: 'state' } & PlayState)
  | ({ type: 'result' } & CommandResult)
  | { type: 'key'; code: number; key: string }
  | { type: 'gesture'; needed: boolean }
  | { type: 'calibrated'; latency: number | null; spread?: number; count?: number }
  // The files the coming songs play from, for the TV to keep (song-cache.ts).
  | { type: 'prefetch'; songs: { name: string; url: string; size: number; file: string }[] };

const str = (v: unknown) => typeof v === 'string';
const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
const bool = (v: unknown) => typeof v === 'boolean';

// Shape checks: a message from the server's page is data, never trusted blindly.
export function parseFromSplash(data: unknown): FromSplash | null {
  if (!data || typeof data !== 'object') return null;
  const m = data as Record<string, any>;
  if (m.otr !== BRIDGE || !str(m.type)) return null;
  switch (m.type) {
    case 'ready':
      return num(m.bridge) && Array.isArray(m.caps) && m.auth && bool(m.auth.required) && bool(m.auth.ok)
        ? (m as FromSplash)
        : null;
    case 'state':
      return bool(m.playing) && str(m.title) && num(m.volume) && num(m.guideVolume) && bool(m.hasGuide)
        ? (m as FromSplash)
        : null;
    case 'result':
      return num(m.id) && bool(m.ok) && num(m.status) ? (m as FromSplash) : null;
    case 'key':
      return num(m.code) ? (m as FromSplash) : null;
    case 'gesture':
      return bool(m.needed) ? (m as FromSplash) : null;
    case 'prefetch':
      return Array.isArray(m.songs) && m.songs.every((s: any) => s && str(s.name) && str(s.url) && num(s.size))
        ? (m as FromSplash)
        : null;
    case 'calibrated':
      return m.latency === null || num(m.latency) ? (m as FromSplash) : null;
    default:
      return null;
  }
}
