// The app: which screen is up, the remembered settings, and the microphone
// engine's lifetime (running while the karaoke screen is, standing by while the
// TV hides the app, stopped on the way out).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Diagnostics } from './components/diagnostics';
import { PlayerScreen } from './components/player-screen';
import { SetupScreen } from './components/setup-screen';
import { EngineClient } from './engine';
import type { EngineInfo, Meter, PitchBatch } from './engine';
import { appDir, execText, exitApp, isTV, launchServer } from './native';
import { engineParams } from './presets';
import { SongCache } from './song-cache';
import { loadSettings, saveSettings, withRecent } from './settings';
import { normalizeServer } from './server-url';
import type { Settings } from './settings';

declare const __APP_VERSION__: string;

type Screen = 'setup' | 'player' | 'diagnostics';

// The meter is drawn from a CSS variable, outside React: it changes 10 times a second.
function level(meter: Meter) {
  const peak = meter.peak <= 0 ? Math.max(0, (meter.peak + 60) / 60) : Math.min(1, meter.peak);
  return peak.toFixed(3);
}

function initialSettings(): Settings {
  const settings = loadSettings();
  const launched = launchServer();
  const server = launched && normalizeServer(launched);
  if (!server) return settings;
  const next = withRecent(settings, server);
  saveSettings(next);
  return next;
}

export function App() {
  const [settings, setSettings] = useState<Settings>(initialSettings);
  const [screen, setScreen] = useState<Screen>(settings.server ? 'player' : 'setup');
  const [diagnosticsFrom, setDiagnosticsFrom] = useState<Screen>('setup');
  const [engineInfo, setEngineInfo] = useState<EngineInfo>(
    isTV() ? { state: 'idle' } : { state: 'unavailable', error: 'Solo en la tele' },
  );
  const meterRef = useRef<HTMLDivElement | null>(null);
  const pitchSink = useRef<((batch: PitchBatch) => void) | null>(null);
  const onsetSink = useRef<((epoch: string, frame: number) => void) | null>(null);
  const filesSink = useRef<((names: string[]) => void) | null>(null);

  const update = useCallback((change: (s: Settings) => Settings) => {
    setSettings((current) => {
      const next = change(current);
      saveSettings(next);
      return next;
    });
  }, []);

  const engine = useMemo(
    () =>
      isTV()
        ? new EngineClient({
            exec: (command) => execText(command),
            appDir: appDir(),
            version: __APP_VERSION__,
            onInfo: setEngineInfo,
            onPitch: (batch) => pitchSink.current?.(batch),
            onOnset: (epoch, frame) => onsetSink.current?.(epoch, frame),
            onMeter: (meter) => meterRef.current?.style.setProperty('--level', level(meter)),
          })
        : null,
    [],
  );

  const cache = useMemo(
    () =>
      isTV()
        ? new SongCache({
            exec: (command) => execText(command),
            appDir: appDir(),
            onFiles: (names) => filesSink.current?.(names),
          })
        : null,
    [],
  );

  // On the karaoke screen the TV keeps copies of the next songs.
  useEffect(() => {
    if (screen === 'player') cache?.start().catch(() => {});
    else cache?.stop();
  }, [screen, cache]);

  // On the karaoke screen the engine runs; a new output relaunches it there.
  useEffect(() => {
    if (screen === 'player') engine?.start(settings.output);
  }, [screen, settings.output, engine]);

  useEffect(() => {
    if (screen !== 'player') engine?.stop();
  }, [screen, engine]);

  useEffect(() => {
    engine?.setParams(
      engineParams({
        voice: settings.voice,
        micVolume: settings.micVolume,
        micMuted: settings.micMuted,
        output: settings.output,
        monitorLatencyMs: engineInfo.measuredMs ?? 120,
      }),
    );
  }, [engine, settings.voice, settings.micVolume, settings.micMuted, settings.output, engineInfo.measuredMs, engineInfo.state]);

  // Hidden (Home, another app): the engine mutes now; its heartbeat stopping
  // makes it exit on its own if the app never comes back.
  useEffect(() => {
    const onVisibility = () => (document.hidden ? engine?.standby() : engine?.resume());
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [engine]);

  const exit = async () => {
    await Promise.all([engine?.stop(), cache?.stop()]);
    exitApp();
  };

  if (screen === 'diagnostics') {
    return <Diagnostics engine={engineInfo} onBack={() => setScreen(diagnosticsFrom)} />;
  }
  if (screen === 'setup' || !settings.server) {
    return (
      <SetupScreen
        initial={settings.server ? settings.server.replace(/^http:\/\//, '') : null}
        recent={settings.recent}
        onConnect={(server) => {
          update((s) => withRecent(s, server));
          setScreen('player');
        }}
        onDiagnostics={() => {
          setDiagnosticsFrom('setup');
          setScreen('diagnostics');
        }}
      />
    );
  }
  return (
    <PlayerScreen
      settings={settings}
      update={update}
      engine={engine}
      engineInfo={engineInfo}
      meterRef={meterRef}
      pitchSink={pitchSink}
      onsetSink={onsetSink}
      cache={cache}
      filesSink={filesSink}
      onChangeServer={() => setScreen('setup')}
      onExit={exit}
    />
  );
}
