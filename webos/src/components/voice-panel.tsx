// The singer's voice: a style to start from, the five EQ bands and the effects.
import { t } from '../i18n';
import type { Cursor } from '../menu';
import { EQ_BANDS, EQ_RANGE, PRESET_IDS } from '../presets';
import type { VoiceSettings } from '../presets';
import { SliderRow } from './slider-row';

// Row order, shared with the player's key handling.
export const VOICE_ROWS = { preset: 0, eq: 1, echo: 6, reverb: 7, deesser: 8, antifeedback: 9 } as const;

interface Props {
  cursor: Cursor;
  voice: VoiceSettings;
  onHover: (cursor: Cursor) => void;
  onPreset: (col: number) => void;
  onSlider: (row: number, value: number) => void;
  onToggle: () => void;
}

const db = (v: number) => `${v > 0 ? '+' : ''}${v} dB`;

export function VoicePanel({ cursor, voice, onHover, onPreset, onSlider, onToggle }: Props) {
  const at = (row: number, col = 0) => cursor.row === row && cursor.col === col;
  const slider = (row: number, label: string, value: number) => (
    <SliderRow
      key={row}
      label={label}
      value={value}
      min={0}
      max={100}
      focused={at(row)}
      onHover={() => onHover({ row, col: 0 })}
      onPick={(v) => onSlider(row, v)}
    />
  );
  return (
    <div className="panel" role="dialog" aria-label={t('voice')}>
      <h2>{t('voice')}</h2>
      <div className="chips">
        {PRESET_IDS.map((id, col) => (
          <button
            key={id}
            className={`chip${voice.preset === id ? ' is-selected' : ''}${at(VOICE_ROWS.preset, col) ? ' is-focused' : ''}`}
            onPointerEnter={(e) => e.pointerType === 'mouse' && onHover({ row: VOICE_ROWS.preset, col })}
            onClick={() => onPreset(col)}
          >
            {t(id)}
          </button>
        ))}
        {voice.preset === 'custom' ? <span className="mic-status">{t('custom')}</span> : null}
      </div>
      <div className="section">{t('equalizer')}</div>
      {EQ_BANDS.map((band, i) => (
        <SliderRow
          key={band}
          label={band}
          value={voice.eq[i]}
          min={-EQ_RANGE}
          max={EQ_RANGE}
          centered
          display={db(voice.eq[i])}
          focused={at(VOICE_ROWS.eq + i)}
          onHover={() => onHover({ row: VOICE_ROWS.eq + i, col: 0 })}
          onPick={(v) => onSlider(VOICE_ROWS.eq + i, v)}
        />
      ))}
      {slider(VOICE_ROWS.echo, t('echo'), voice.echo)}
      {slider(VOICE_ROWS.reverb, t('reverb'), voice.reverb)}
      {slider(VOICE_ROWS.deesser, t('deesser'), voice.deesser)}
      <div
        className={`toggle${at(VOICE_ROWS.antifeedback) ? ' is-focused' : ''}`}
        role="switch"
        aria-checked={voice.antifeedback}
        onPointerEnter={(e) => e.pointerType === 'mouse' && onHover({ row: VOICE_ROWS.antifeedback, col: 0 })}
        onClick={onToggle}
      >
        {t('antifeedback')}
        <em>{voice.antifeedback ? t('on') : t('off')}</em>
      </div>
    </div>
  );
}
