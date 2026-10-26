// Where the amplified voice comes out, and the latency check.
import type { EngineInfo } from '../engine';
import { t } from '../i18n';
import type { Cursor } from '../menu';
import type { OutputKind } from '../presets';

export const OUTPUTS: OutputKind[] = ['tv', 'usb', 'off'];
export const OUTPUT_ROWS = { first: 0, tools: 3 } as const;

const LABELS = {
  tv: ['outputTv', 'outputTvHint'],
  usb: ['outputUsb', 'outputUsbHint'],
  off: ['outputOff', 'outputOffHint'],
} as const;

interface Props {
  cursor: Cursor;
  output: OutputKind;
  engine: EngineInfo;
  onHover: (cursor: Cursor) => void;
  onPick: (output: OutputKind) => void;
  onMeasure: () => void;
  onCalibrate: () => void;
  calibrating: boolean;
  // The clicks play through a second media player, and the TV pauses a playing
  // song for it: calibrating waits for the song to stop.
  songPlaying: boolean;
}

export function OutputPanel(props: Props) {
  const { cursor, output, engine, onHover, onPick, onMeasure, onCalibrate, calibrating, songPlaying } = props;
  const ready = engine.state === 'ready';
  const canMeasure = ready && output !== 'off';
  const at = (col: number) => cursor.row === OUTPUT_ROWS.tools && cursor.col === col;
  return (
    <div className="panel" role="dialog" aria-label={t('output')}>
      <h2>{t('output')}</h2>
      {OUTPUTS.map((kind, row) => (
        <div
          key={kind}
          role="radio"
          aria-checked={output === kind}
          className={`option${output === kind ? ' is-selected' : ''}${cursor.row === row ? ' is-focused' : ''}`}
          onPointerEnter={(e) => e.pointerType === 'mouse' && onHover({ row, col: 0 })}
          onClick={() => onPick(kind)}
        >
          <strong>{t(LABELS[kind][0])}</strong>
          <span>{t(LABELS[kind][1])}</span>
        </div>
      ))}
      <div className="chips">
        <button
          className={`chip${at(0) ? ' is-focused' : ''}`}
          disabled={!canMeasure}
          onPointerEnter={(e) => e.pointerType === 'mouse' && onHover({ row: OUTPUT_ROWS.tools, col: 0 })}
          onClick={onMeasure}
        >
          {t('measure')}
        </button>
        <button
          className={`chip${at(1) ? ' is-focused' : ''}`}
          disabled={!ready || calibrating || songPlaying}
          onPointerEnter={(e) => e.pointerType === 'mouse' && onHover({ row: OUTPUT_ROWS.tools, col: 1 })}
          onClick={onCalibrate}
        >
          {t('calibrate')}
        </button>
        {engine.measuredMs ? <span className="mic-status">{t('measured', { ms: Math.round(engine.measuredMs) })}</span> : null}
      </div>
    </div>
  );
}
