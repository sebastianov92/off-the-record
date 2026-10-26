// The bottom dock over the karaoke screen: what is playing, the transport, the
// three volumes and the way into the voice and output panels.
import type { RefObject } from 'react';
import type { EngineInfo } from '../engine';
import { t } from '../i18n';
import type { Cursor } from '../menu';
import type { PlayState } from '../splash-protocol';
import { NextIcon, PauseIcon, PlayIcon, RestartIcon } from './icons';
import { SliderRow } from './slider-row';

export const DOCK_ROWS = { transport: 0, music: 1, guide: 2, mic: 3, chips: 4 } as const;

interface Props {
  visible: boolean;
  cursor: Cursor;
  play: PlayState | null;
  music: number;
  guide: number;
  mic: number;
  micMuted: boolean;
  confirming: 'skip' | 'restart' | null;
  engine: EngineInfo;
  meterRef: RefObject<HTMLDivElement | null>;
  onHover: (cursor: Cursor) => void;
  onButton: (row: number, col: number) => void;
  onSlider: (row: number, value: number) => void;
}

function micStatus(engine: EngineInfo, muted: boolean) {
  if (engine.state === 'ready') return muted ? t('micMuted') : t('micReady');
  if (engine.state === 'starting' || engine.state === 'connecting') return t('micStarting');
  if (engine.state === 'failed') {
    if (engine.error === 'mic-missing') return t('micMissing');
    if (engine.error === 'output-busy' || engine.error === 'usb-output-missing') return t('outputBusy');
    return t('micFailed');
  }
  if (engine.state === 'standby' || engine.state === 'idle') return '';
  return t('micUnavailable');
}

export function Dock(props: Props) {
  const { cursor, play, confirming } = props;
  const at = (row: number, col = 0) => cursor.row === row && cursor.col === col;
  const focus = (row: number, col = 0) => (at(row, col) ? ' is-focused' : '');
  const paused = !play?.playing;
  const button = (row: number, col: number, className: string, label: string, content: React.ReactNode) => (
    <button
      className={`${className}${focus(row, col)}`}
      aria-label={label}
      onPointerEnter={(e) => e.pointerType === 'mouse' && props.onHover({ row, col })}
      onClick={() => props.onButton(row, col)}
    >
      {content}
    </button>
  );
  return (
    <div className={`dock${props.visible ? '' : ' is-hidden'}`} aria-hidden={!props.visible}>
      <div className="now">
        <div>
          <div className="now-title">{play?.title || t('nothingPlaying')}</div>
          {play?.singer ? <div className="now-singer">{play.singer}</div> : null}
          {play?.upNext ? (
            <div className="now-next">
              {t('upNext')}: {play.upNext}
              {play.nextSinger ? ` · ${play.nextSinger}` : ''}
            </div>
          ) : null}
        </div>
        <div className="transport">
          {button(
            DOCK_ROWS.transport,
            0,
            `round${confirming === 'restart' ? ' is-confirming' : ''}`,
            t('restart'),
            confirming === 'restart' ? t('restartConfirm') : <RestartIcon />,
          )}
          {button(
            DOCK_ROWS.transport,
            1,
            'round is-main',
            paused ? t('resume') : t('pause'),
            paused ? <PlayIcon /> : <PauseIcon />,
          )}
          {button(
            DOCK_ROWS.transport,
            2,
            `round${confirming === 'skip' ? ' is-confirming' : ''}`,
            t('next'),
            confirming === 'skip' ? t('nextConfirm') : <NextIcon />,
          )}
        </div>
      </div>
      <div className="controls">
        <SliderRow
          label={t('music')}
          value={props.music}
          min={0}
          max={100}
          focused={at(DOCK_ROWS.music)}
          onHover={() => props.onHover({ row: DOCK_ROWS.music, col: 0 })}
          onPick={(v) => props.onSlider(DOCK_ROWS.music, v)}
        />
        <SliderRow
          label={t('artistVoice')}
          value={props.guide}
          min={0}
          max={100}
          disabled={!play?.hasGuide}
          focused={at(DOCK_ROWS.guide)}
          onHover={() => props.onHover({ row: DOCK_ROWS.guide, col: 0 })}
          onPick={(v) => props.onSlider(DOCK_ROWS.guide, v)}
        />
        <SliderRow
          label={t('myVoice')}
          value={props.mic}
          min={0}
          max={100}
          display={props.micMuted ? t('muted') : undefined}
          focused={at(DOCK_ROWS.mic)}
          onHover={() => props.onHover({ row: DOCK_ROWS.mic, col: 0 })}
          onPick={(v) => props.onSlider(DOCK_ROWS.mic, v)}
        />
        <div className="meter" ref={props.meterRef} />
        <div className="chips">
          {button(DOCK_ROWS.chips, 0, 'chip', t('voice'), t('voice'))}
          {button(DOCK_ROWS.chips, 1, 'chip', t('output'), t('output'))}
          {button(DOCK_ROWS.chips, 2, 'chip', t('changeServer'), t('changeServer'))}
          <span className="mic-status">{micStatus(props.engine, props.micMuted)}</span>
        </div>
      </div>
    </div>
  );
}
