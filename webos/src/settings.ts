// Everything the app remembers lives in localStorage, read through defaults so an
// older or damaged entry never breaks the start.
import type { OutputKind, VoiceSettings } from './presets';
import { defaultVoice, normalizeVoice } from './presets';

export interface Settings {
  server: string | null;
  recent: string[];
  // Device tokens by server origin; the admin password itself is never kept.
  tokens: Record<string, string>;
  micVolume: number; // 0..100
  micMuted: boolean;
  output: OutputKind;
  voice: VoiceSettings;
  // Seconds between the player's clock and the music reaching the singer's ears.
  pitchLatency: number;
}

const KEY = 'offtherecord.settings';
const MAX_RECENT = 5;

export const defaults = (): Settings => ({
  server: null,
  recent: [],
  tokens: {},
  micVolume: 70,
  micMuted: false,
  output: 'tv',
  voice: defaultVoice(),
  pitchLatency: 0.15,
});

const clamp = (value: unknown, lo: number, hi: number, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(hi, Math.max(lo, value)) : fallback;

export function normalizeSettings(raw: unknown): Settings {
  const base = defaults();
  if (!raw || typeof raw !== 'object') return base;
  const value = raw as Partial<Settings>;
  return {
    server: typeof value.server === 'string' ? value.server : null,
    recent: Array.isArray(value.recent)
      ? value.recent.filter((s): s is string => typeof s === 'string').slice(0, MAX_RECENT)
      : [],
    tokens:
      value.tokens && typeof value.tokens === 'object'
        ? Object.fromEntries(
            Object.entries(value.tokens).filter(([, t]) => typeof t === 'string'),
          )
        : {},
    micVolume: clamp(value.micVolume, 0, 100, base.micVolume),
    micMuted: value.micMuted === true,
    output: value.output === 'usb' || value.output === 'off' ? value.output : 'tv',
    voice: normalizeVoice(value.voice),
    pitchLatency: clamp(value.pitchLatency, 0, 1, base.pitchLatency),
  };
}

export function loadSettings(storage: Storage = localStorage): Settings {
  try {
    return normalizeSettings(JSON.parse(storage.getItem(KEY) ?? 'null'));
  } catch {
    return defaults();
  }
}

export function saveSettings(settings: Settings, storage: Storage = localStorage) {
  try {
    storage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* A full or blocked storage only costs the remembered settings. */
  }
}

export const withRecent = (settings: Settings, server: string): Settings => ({
  ...settings,
  server,
  recent: [server, ...settings.recent.filter((s) => s !== server)].slice(0, MAX_RECENT),
});
