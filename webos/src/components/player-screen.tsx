// The karaoke screen: the server's /splash in a frame, and everything the remote
// does on top of it. The frame never takes focus (keys stay with the app, or Back
// would vanish into it); the splash's tv-bridge.js carries commands out and state
// back over postMessage.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { EngineClient, EngineInfo, PitchBatch } from '../engine';
import { t } from '../i18n';
import type { Key } from '../keys';
import { keyOf } from '../keys';
import { clampCursor, moveCol, moveRow } from '../menu';
import type { Cursor, MenuRow } from '../menu';
import { applyPreset, EQ_RANGE, PRESET_IDS } from '../presets';
import type { OutputKind } from '../presets';
import { originOf, splashUrl } from '../server-url';
import type { Settings } from '../settings';
import type { SongCache } from '../song-cache';
import { SplashLink } from '../splash-link';
import type { Command, FromSplash, PlayState } from '../splash-protocol';
import { ExitDialog, PasswordDialog } from './dialogs';
import { Dock, DOCK_ROWS } from './dock';
import { OUTPUT_ROWS, OUTPUTS, OutputPanel } from './output-panel';
import { VOICE_ROWS, VoicePanel } from './voice-panel';

const READY_TIMEOUT = 15000; // no bridge by then: the server is down or too old
const STALE_AFTER = 10000; // no word from the splash: say so
const RELOAD_AFTER = 60000; // still nothing: a reload cannot cut a song that is not reaching us
const DOCK_IDLE = 8000;
const CONFIRM_WINDOW = 3000;
const SEND_DELAY = 150;
const STEP = 5;

type Layer = 'bare' | 'dock' | 'voice' | 'output' | 'exit' | 'password';

interface Props {
  settings: Settings;
  update: (change: (s: Settings) => Settings) => void;
  engine: EngineClient | null;
  engineInfo: EngineInfo;
  meterRef: RefObject<HTMLDivElement | null>;
  pitchSink: { current: ((batch: PitchBatch) => void) | null };
  onsetSink: { current: ((epoch: string, frame: number) => void) | null };
  cache: SongCache | null;
  filesSink: { current: ((names: string[]) => void) | null };
  onChangeServer: () => void;
  onExit: () => void;
}

export function PlayerScreen(props: Props) {
  const { settings, update, engine, engineInfo, cache } = props;
  const server = settings.server!;
  const origin = originOf(server);
  const frame = useRef<HTMLIFrameElement>(null);
  const link = useRef<SplashLink | null>(null);
  const [loadKey, setLoadKey] = useState(0);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [stale, setStale] = useState(false);
  const lastHeard = useRef(Date.now());
  const initSent = useRef(false);
  const keptFiles = useRef<string[]>([]);
  const [play, setPlay] = useState<PlayState | null>(null);
  const [gesture, setGesture] = useState(false);
  const [layer, setLayer] = useState<Layer>('bare');
  const [cursors, setCursors] = useState<Record<'dock' | 'voice' | 'output', Cursor>>({
    dock: { row: DOCK_ROWS.transport, col: 1 },
    voice: { row: 0, col: 0 },
    output: { row: 0, col: 0 },
  });
  const [exitFocus, setExitFocus] = useState<0 | 1>(0);
  const [confirming, setConfirming] = useState<{ action: 'skip' | 'restart'; until: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [calibrating, setCalibrating] = useState(false);
  const [password, setPassword] = useState({ error: '', busy: false });
  // While a slider moves, show the local value, not the server's echo of an older one.
  const [localMusic, setLocalMusic] = useState<number | null>(null);
  const [localGuide, setLocalGuide] = useState<number | null>(null);
  const sendTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const idleTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const music = localMusic ?? Math.round((play?.volume ?? 1) * 100);
  const guide = localGuide ?? Math.round(play?.guideVolume ?? 0);
  const token = settings.tokens[origin] ?? '';

  const say = useCallback((text: string) => {
    setToast(text);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  }, []);

  // ---- Link with the splash ------------------------------------------------
  const askPassword = useCallback(() => {
    setPassword({ error: '', busy: false });
    setLayer('password');
  }, []);

  const run = useCallback(
    async (action: Command, value?: number | string) => {
      const result = await link.current?.command(action, value);
      if (!result) return;
      if (result.status === 403) askPassword();
      else if (!result.ok) say(t('commandFailed'));
    },
    [askPassword, say],
  );

  const onMessage = useCallback(
    (message: FromSplash) => {
      lastHeard.current = Date.now();
      setStale(false);
      switch (message.type) {
        case 'ready':
          setPhase('ready');
          if (!initSent.current) {
            // The bridge re-announces once it has the token, with the verdict.
            initSent.current = true;
            link.current?.send('init', { token, pitchLatency: settings.pitchLatency });
            link.current?.send('mic', { present: engine?.state === 'ready' });
            if (cache) link.current?.send('cache', { base: cache.base, files: keptFiles.current });
          } else if (message.auth.required && !message.auth.ok) {
            if (token) update((s) => ({ ...s, tokens: { ...s.tokens, [origin]: '' } }));
            askPassword();
          }
          break;
        case 'state':
          setPlay(message);
          break;
        case 'prefetch':
          cache?.want(origin, token, message.songs).catch(() => {});
          break;
        case 'gesture':
          setGesture(message.needed);
          break;
        case 'calibrated':
          engine?.setOnsets(false);
          setCalibrating(false);
          if (message.latency === null) say(t('calibrateFailed'));
          else {
            const latency = message.latency;
            update((s) => ({ ...s, pitchLatency: latency }));
            say(t('calibrated', { ms: Math.round(latency * 1000) }));
          }
          break;
        case 'key': {
          const key = keyOf(message);
          if (key) handleKeyRef.current(key);
          break;
        }
      }
    },
    [token, settings.pitchLatency, engine, cache, update, origin, askPassword],
  );
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    if (!frame.current) return;
    setPhase('loading');
    initSent.current = false;
    lastHeard.current = Date.now();
    const current = new SplashLink(frame.current, origin, (m) => onMessageRef.current(m));
    link.current = current;
    const readyTimer = setTimeout(() => setPhase((p) => (p === 'loading' ? 'failed' : p)), READY_TIMEOUT);
    return () => {
      clearTimeout(readyTimer);
      current.dispose();
      if (link.current === current) link.current = null;
    };
  }, [origin, loadKey]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (phase !== 'ready') return;
      const quiet = Date.now() - lastHeard.current;
      setStale(quiet > STALE_AFTER);
      if (quiet > RELOAD_AFTER) setLoadKey((k) => k + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [phase]);

  // The engine's pitch goes straight into the splash's score and avatar; its
  // onsets only matter while calibrating.
  useEffect(() => {
    props.pitchSink.current = (batch) => link.current?.send('pitch', { ...batch });
    props.onsetSink.current = (epoch, frame) => link.current?.send('onset', { epoch, frame });
    // The songs the TV has a copy of: the splash plays those from the TV.
    props.filesSink.current = (names) => {
      keptFiles.current = names;
      if (cache) link.current?.send('cache', { base: cache.base, files: names });
    };
    return () => {
      props.pitchSink.current = null;
      props.onsetSink.current = null;
      props.filesSink.current = null;
    };
  }, [props.pitchSink, props.onsetSink, props.filesSink, cache]);

  useEffect(() => {
    link.current?.send('mic', { present: engineInfo.state === 'ready' });
  }, [engineInfo.state]);

  // Autoplay wanting a click: the frame takes the remote until the splash is happy.
  useEffect(() => {
    if (gesture) frame.current?.focus();
    else if (document.activeElement === frame.current) frame.current?.blur();
  }, [gesture]);

  useEffect(() => {
    const regain = () => {
      // A click or a stray focus moved into the frame: take the keys back.
      if (!gesture) setTimeout(() => document.activeElement === frame.current && frame.current?.blur(), 0);
    };
    window.addEventListener('blur', regain);
    return () => window.removeEventListener('blur', regain);
  }, [gesture]);

  // ---- Values --------------------------------------------------------------
  const sendLater = (name: string, send: () => void, done: () => void) => {
    clearTimeout(sendTimers.current[name]);
    sendTimers.current[name] = setTimeout(() => {
      send();
      // Keep the local value a moment, until the server's echo has caught up.
      setTimeout(done, 1500);
    }, SEND_DELAY);
  };

  const setMusic = (value: number) => {
    const v = Math.min(100, Math.max(0, value));
    setLocalMusic(v);
    sendLater('music', () => run('volume', v / 100), () => setLocalMusic(null));
  };

  const setGuide = (value: number) => {
    if (!play?.hasGuide) return;
    const v = Math.min(100, Math.max(0, value));
    setLocalGuide(v);
    sendLater('guide', () => run('guide', v), () => setLocalGuide(null));
  };

  const setMic = (value: number) => update((s) => ({ ...s, micVolume: Math.min(100, Math.max(0, value)), micMuted: false }));

  const setVoice = (change: (v: Settings['voice']) => Settings['voice']) =>
    update((s) => ({ ...s, voice: change(s.voice) }));

  const setOutput = (output: OutputKind) => update((s) => ({ ...s, output }));

  // ---- Transport -----------------------------------------------------------
  // Skip and restart cut a song, so they want a second press within a few seconds.
  const confirmThen = (action: 'skip' | 'restart', fromDock: boolean) => {
    const now = Date.now();
    if (confirming?.action === action && confirming.until > now) {
      setConfirming(null);
      run(action);
      return;
    }
    setConfirming({ action, until: now + CONFIRM_WINDOW });
    if (!fromDock) say(action === 'skip' ? t('pressAgainNext') : t('pressAgainRestart'));
  };

  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(null), confirming.until - Date.now());
    return () => clearTimeout(timer);
  }, [confirming]);

  // ---- Menus ---------------------------------------------------------------
  const dockRows: MenuRow[] = useMemo(
    () => [
      { id: 'transport', kind: 'buttons', size: 3 },
      { id: 'music', kind: 'slider' },
      { id: 'guide', kind: 'slider', disabled: !play?.hasGuide },
      { id: 'mic', kind: 'slider' },
      { id: 'chips', kind: 'buttons', size: 3 },
    ],
    [play?.hasGuide],
  );
  const voiceRows: MenuRow[] = useMemo(
    () => [
      { id: 'preset', kind: 'buttons', size: PRESET_IDS.length },
      ...[0, 1, 2, 3, 4].map((i) => ({ id: `eq${i}`, kind: 'slider' as const })),
      { id: 'echo', kind: 'slider' },
      { id: 'reverb', kind: 'slider' },
      { id: 'deesser', kind: 'slider' },
      { id: 'antifeedback', kind: 'toggle' },
    ],
    [],
  );
  const canMeasure = engineInfo.state === 'ready' && settings.output !== 'off';
  const outputRows: MenuRow[] = useMemo(
    () => [
      ...OUTPUTS.map((id) => ({ id, kind: 'option' as const })),
      { id: 'tools', kind: 'buttons', size: 2, disabled: engineInfo.state !== 'ready' },
    ],
    [engineInfo.state],
  );

  // Clicks through the music's path, heard back by the mic: how late the singer
  // hears the music, which the score then allows for.
  const calibrate = () => {
    if (calibrating || engineInfo.state !== 'ready' || play?.playing) return;
    setCalibrating(true);
    say(t('calibrating'));
    engine?.setOnsets(true);
    link.current?.send('calibrate');
    setTimeout(() => setCalibrating((c) => (c ? (engine?.setOnsets(false), false) : c)), 15000);
  };

  const setCursor = (menu: 'dock' | 'voice' | 'output', cursor: Cursor) =>
    setCursors((c) => ({ ...c, [menu]: cursor }));

  const dockButton = (row: number, col: number) => {
    setCursor('dock', { row, col });
    if (row === DOCK_ROWS.transport) {
      if (col === 0) confirmThen('restart', true);
      else if (col === 1) run('pause');
      else confirmThen('skip', true);
    } else if (row === DOCK_ROWS.chips) {
      if (col === 0) setLayer('voice');
      else if (col === 1) setLayer('output');
      else props.onChangeServer();
    }
  };

  const dockSlider = (row: number, value: number) => {
    if (row === DOCK_ROWS.music) setMusic(value);
    else if (row === DOCK_ROWS.guide) setGuide(value);
    else if (row === DOCK_ROWS.mic) setMic(value);
  };

  const voiceSlider = (row: number, value: number) => {
    if (row >= VOICE_ROWS.eq && row < VOICE_ROWS.eq + 5) {
      const band = row - VOICE_ROWS.eq;
      setVoice((v) => {
        const eq = [...v.eq] as typeof v.eq;
        eq[band] = Math.min(EQ_RANGE, Math.max(-EQ_RANGE, value));
        return { ...v, eq, preset: 'custom' };
      });
      return;
    }
    const field = row === VOICE_ROWS.echo ? 'echo' : row === VOICE_ROWS.reverb ? 'reverb' : 'deesser';
    setVoice((v) => ({ ...v, [field]: Math.min(100, Math.max(0, value)), preset: 'custom' }));
  };

  const voiceValue = (row: number) => {
    const v = settings.voice;
    if (row >= VOICE_ROWS.eq && row < VOICE_ROWS.eq + 5) return v.eq[row - VOICE_ROWS.eq];
    return row === VOICE_ROWS.echo ? v.echo : row === VOICE_ROWS.reverb ? v.reverb : v.deesser;
  };

  const resetIdle = useCallback(() => {
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setLayer((l) => (l === 'dock' ? 'bare' : l)), DOCK_IDLE);
  }, []);

  const openDock = () => {
    setLayer('dock');
    setCursor('dock', clampCursor(dockRows, { row: DOCK_ROWS.transport, col: 1 }));
    resetIdle();
  };

  // ---- Keys ----------------------------------------------------------------
  const navigate = (menu: 'dock' | 'voice' | 'output', rows: MenuRow[], key: Key) => {
    const cursor = clampCursor(rows, cursors[menu]);
    const row = rows[cursor.row];
    if (key === 'up' || key === 'down') {
      setCursor(menu, moveRow(rows, cursor, key === 'up' ? -1 : 1));
      return;
    }
    const step = key === 'left' ? -1 : 1;
    if (key === 'left' || key === 'right') {
      if (row.kind === 'buttons') setCursor(menu, moveCol(rows, cursor, step));
      else if (row.kind === 'slider') {
        if (menu === 'dock') {
          const current = cursor.row === DOCK_ROWS.music ? music : cursor.row === DOCK_ROWS.guide ? guide : settings.micVolume;
          dockSlider(cursor.row, current + step * STEP);
        } else if (menu === 'voice') {
          const isEq = cursor.row >= VOICE_ROWS.eq && cursor.row < VOICE_ROWS.eq + 5;
          voiceSlider(cursor.row, voiceValue(cursor.row) + step * (isEq ? 1 : STEP));
        }
      } else if (row.kind === 'toggle') setVoice((v) => ({ ...v, antifeedback: !v.antifeedback }));
      return;
    }
    if (key !== 'ok') return;
    if (menu === 'dock' && row.kind === 'buttons') dockButton(cursor.row, cursor.col);
    else if (menu === 'voice') {
      if (cursor.row === VOICE_ROWS.preset) setVoice((v) => applyPreset(v, PRESET_IDS[cursor.col]));
      else if (row.kind === 'toggle') setVoice((v) => ({ ...v, antifeedback: !v.antifeedback }));
    } else if (menu === 'output') {
      if (cursor.row === OUTPUT_ROWS.tools) {
        if (cursor.col === 0 && canMeasure) engine?.measure();
        else if (cursor.col === 1) calibrate();
      } else setOutput(OUTPUTS[cursor.row]);
    }
  };

  const handleKey = (key: Key) => {
    if (layer === 'password') {
      if (key === 'back') setLayer('bare');
      return;
    }
    if (layer === 'exit') {
      if (key === 'back') setLayer('bare');
      else if (key === 'left' || key === 'up') setExitFocus(0);
      else if (key === 'right' || key === 'down') setExitFocus(1);
      else if (key === 'ok') chooseExit(exitFocus);
      return;
    }
    // Media and colour keys work from anywhere, dock or not.
    if (key === 'play' || key === 'pause' || key === 'playPause') {
      const wantsPause = key === 'pause' || (key === 'playPause' && play?.playing);
      if (key === 'playPause' || wantsPause === !!play?.playing) run('pause');
      return;
    }
    if (key === 'next' || key === 'restart') {
      confirmThen(key === 'next' ? 'skip' : 'restart', false);
      return;
    }
    if (key === 'red') {
      const muted = !settings.micMuted;
      update((s) => ({ ...s, micMuted: muted }));
      say(muted ? t('micMuted') : t('micUnmuted'));
      return;
    }
    if (key === 'micUp' || key === 'micDown') {
      const v = Math.min(100, Math.max(0, settings.micVolume + (key === 'micUp' ? STEP : -STEP)));
      setMic(v);
      say(t('micVolume', { v }));
      return;
    }
    if (layer === 'bare') {
      if (key === 'back') {
        setExitFocus(0);
        setLayer('exit');
      } else if (['up', 'down', 'left', 'right', 'ok'].includes(key)) openDock();
      return;
    }
    if (layer === 'dock') {
      resetIdle();
      if (key === 'back') setLayer('bare');
      else navigate('dock', dockRows, key);
      return;
    }
    if (key === 'back') {
      setLayer('dock');
      resetIdle();
      return;
    }
    navigate(layer, layer === 'voice' ? voiceRows : outputRows, key);
  };
  const handleKeyRef = useRef(handleKey);
  handleKeyRef.current = handleKey;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Typing in the password box belongs to the box.
      if (layer === 'password' && event.target instanceof HTMLInputElement && keyOf(event) !== 'back') return;
      const key = keyOf(event);
      if (!key) return;
      event.preventDefault();
      handleKeyRef.current(key);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [layer]);

  // The Magic Remote waking up over the screen shows the dock.
  const onPointerMove = () => {
    if (layer === 'bare') openDock();
    else if (layer === 'dock') resetIdle();
  };

  const chooseExit = (choice: 0 | 1) => {
    if (choice === 0) setLayer('bare');
    else props.onExit();
  };

  const submitPassword = async (value: string) => {
    setPassword({ error: '', busy: true });
    const result = await link.current?.command('login', value);
    if (result?.ok) {
      update((s) => ({ ...s, tokens: { ...s.tokens, [origin]: result.token ?? '' } }));
      setLayer('bare');
      return;
    }
    const error =
      result?.status === 429 ? t('tooMany', { s: result.retryAfter ?? 30 }) : result?.status === 401 ? t('wrongPassword') : t('commandFailed');
    setPassword({ error, busy: false });
  };

  const reload = () => {
    setStale(false);
    setLoadKey((k) => k + 1);
  };

  // A side panel takes the screen to itself: the dock under it would only be clutter.
  const showDock = layer === 'dock';
  return (
    <div className="player" onPointerMove={onPointerMove}>
      <iframe
        key={loadKey}
        ref={frame}
        className={gesture ? 'takes-input' : undefined}
        src={splashUrl(server)}
        title={t('appName')}
        allow="autoplay"
        tabIndex={-1}
      />
      {phase === 'loading' ? (
        <div className="cover" aria-live="polite">
          <div className="stack">
            <img className="setup-logo" src="./logo-white.svg" alt="" />
            <p className="hint">{t('connecting', { server })}</p>
          </div>
        </div>
      ) : null}
      {phase === 'failed' ? (
        <div className="cover" role="alert">
          <div className="stack">
            <h2>{t('loadFailed', { server })}</h2>
            <p className="hint">{t('loadFailedHint')}</p>
            <FailedActions onRetry={reload} onChangeServer={props.onChangeServer} />
          </div>
        </div>
      ) : null}
      {stale && phase === 'ready' ? <div className="banner is-warning">{t('noConnection')}</div> : null}
      {gesture ? <div className="banner">{t('pressOk')}</div> : null}
      <Dock
        visible={showDock}
        cursor={layer === 'dock' ? clampCursor(dockRows, cursors.dock) : { row: -1, col: -1 }}
        play={play}
        music={music}
        guide={guide}
        mic={settings.micVolume}
        micMuted={settings.micMuted}
        confirming={confirming?.action ?? null}
        engine={engineInfo}
        meterRef={props.meterRef}
        onHover={(c) => {
          setLayer('dock');
          setCursor('dock', c);
          resetIdle();
        }}
        onButton={dockButton}
        onSlider={dockSlider}
      />
      {layer === 'voice' ? (
        <VoicePanel
          cursor={clampCursor(voiceRows, cursors.voice)}
          voice={settings.voice}
          onHover={(c) => setCursor('voice', c)}
          onPreset={(col) => {
            setCursor('voice', { row: VOICE_ROWS.preset, col });
            setVoice((v) => applyPreset(v, PRESET_IDS[col]));
          }}
          onSlider={voiceSlider}
          onToggle={() => setVoice((v) => ({ ...v, antifeedback: !v.antifeedback }))}
        />
      ) : null}
      {layer === 'output' ? (
        <OutputPanel
          cursor={clampCursor(outputRows, cursors.output)}
          output={settings.output}
          engine={engineInfo}
          onHover={(c) => setCursor('output', c)}
          onPick={setOutput}
          onMeasure={() => canMeasure && engine?.measure()}
          onCalibrate={calibrate}
          calibrating={calibrating}
          songPlaying={!!play?.playing}
        />
      ) : null}
      {layer === 'exit' ? <ExitDialog focus={exitFocus} onHover={setExitFocus} onChoose={chooseExit} /> : null}
      {layer === 'password' ? (
        <PasswordDialog
          error={password.error}
          busy={password.busy}
          onSubmit={submitPassword}
          onCancel={() => setLayer('bare')}
        />
      ) : null}
      {toast ? <div className="toast" role="status">{toast}</div> : null}
    </div>
  );
}

// Retry or pick another server, by remote: Left/Right and OK.
function FailedActions({ onRetry, onChangeServer }: { onRetry: () => void; onChangeServer: () => void }) {
  const [focus, setFocus] = useState(0);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const key = keyOf(event);
      if (key === 'left') setFocus(0);
      else if (key === 'right') setFocus(1);
      else if (key === 'ok') (focus === 0 ? onRetry : onChangeServer)();
      else if (key === 'back') onChangeServer();
      else return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [focus, onRetry, onChangeServer]);
  return (
    <div className="row">
      <button className={`button is-primary${focus === 0 ? ' is-focused' : ''}`} onClick={onRetry} onPointerEnter={() => setFocus(0)}>
        {t('retry')}
      </button>
      <button className={`button${focus === 1 ? ' is-focused' : ''}`} onClick={onChangeServer} onPointerEnter={() => setFocus(1)}>
        {t('changeServer')}
      </button>
    </div>
  );
}
