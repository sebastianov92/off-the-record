// The singer's voice settings, the presets the remote picks from, and the full
// parameter snapshot the engine takes (webos/engine/PROTOCOL.md). Presets live
// only here: the engine just applies numbers.
export type OutputKind = 'tv' | 'usb' | 'off';
export type PresetId = 'natural' | 'clear' | 'warm' | 'radio' | 'custom';
export type Eq = [number, number, number, number, number];

export interface VoiceSettings {
  preset: PresetId;
  eq: Eq; // dB per band, EQ_BANDS order
  echo: number; // 0..100
  reverb: number; // 0..100
  deesser: number; // 0..100
  antifeedback: boolean;
}

export const EQ_BANDS = ['120 Hz', '300 Hz', '1,2 kHz', '3,5 kHz', '9 kHz'] as const;
export const EQ_RANGE = 12; // dB either way

export const PRESET_IDS: Exclude<PresetId, 'custom'>[] = ['natural', 'clear', 'warm', 'radio'];

type Preset = Pick<VoiceSettings, 'eq' | 'echo' | 'reverb' | 'deesser'>;
export const PRESETS: Record<Exclude<PresetId, 'custom'>, Preset> = {
  // Flat, a touch of room: the voice as the microphone hears it.
  natural: { eq: [0, 0, 0, 0, 0], echo: 15, reverb: 15, deesser: 30 },
  // Less boom and box, more presence: cuts through a loud backing track.
  clear: { eq: [-2, -3, 0, 4, 3], echo: 15, reverb: 15, deesser: 45 },
  // Body and a softer top, for ballads.
  warm: { eq: [3, 1, -1, -1, -2], echo: 20, reverb: 25, deesser: 25 },
  // Telephone-narrow midrange, dry: a deliberate effect.
  radio: { eq: [-9, -2, 4, 5, -6], echo: 0, reverb: 5, deesser: 40 },
};

// A copy, so changing a band never edits the preset itself.
const copy = (preset: Preset): Preset => ({ ...preset, eq: [...preset.eq] as Eq });

export const defaultVoice = (): VoiceSettings => ({
  preset: 'natural',
  ...copy(PRESETS.natural),
  antifeedback: true,
});

export function applyPreset(voice: VoiceSettings, id: Exclude<PresetId, 'custom'>): VoiceSettings {
  return { ...voice, preset: id, ...copy(PRESETS[id]) };
}

const clamp = (v: unknown, lo: number, hi: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;

export function normalizeVoice(raw: unknown): VoiceSettings {
  const base = defaultVoice();
  if (!raw || typeof raw !== 'object') return base;
  const v = raw as Partial<VoiceSettings>;
  const preset = (['natural', 'clear', 'warm', 'radio', 'custom'] as const).includes(v.preset as PresetId)
    ? (v.preset as PresetId)
    : base.preset;
  const eq = Array.isArray(v.eq) && v.eq.length === 5
    ? (v.eq.map((g, i) => clamp(g, -EQ_RANGE, EQ_RANGE, base.eq[i])) as Eq)
    : base.eq;
  return {
    preset,
    eq,
    echo: clamp(v.echo, 0, 100, base.echo),
    reverb: clamp(v.reverb, 0, 100, base.reverb),
    deesser: clamp(v.deesser, 0, 100, base.deesser),
    antifeedback: v.antifeedback !== false,
  };
}

export interface ParamsInput {
  voice: VoiceSettings;
  micVolume: number;
  micMuted: boolean;
  output: OutputKind;
  monitorLatencyMs: number;
}

// The engine's full snapshot. Sent whole on every change, so it is idempotent.
export function engineParams({ voice, micVolume, micMuted, output, monitorLatencyMs }: ParamsInput) {
  return {
    inputGain: 0,
    hpf: true,
    gate: { threshold: -50, range: 30 },
    eq: [...voice.eq],
    comp: { threshold: -18, ratio: 3 },
    deesser: { amount: voice.deesser / 100 },
    // Through the TV speakers the voice already comes back ~120 ms late; an echo of
    // the same delay turns that lag into the first repeat of a karaoke echo.
    echo: {
      mix: voice.echo / 100,
      delayMs: output === 'tv' ? Math.round(monitorLatencyMs) : 140,
      feedback: 0.25,
    },
    reverb: { mix: voice.reverb / 100, size: 0.5 },
    antifeedback: voice.antifeedback,
    micVolume: Math.round(micVolume),
    mute: micMuted || output === 'off',
  };
}

export type EngineParams = ReturnType<typeof engineParams>;
