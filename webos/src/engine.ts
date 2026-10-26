// The app's side of otr-mic, the native engine that owns the USB microphone
// (protocol: webos/engine/PROTOCOL.md). The app launches it as root through
// Homebrew Channel, talks to it over a WebSocket on 127.0.0.1 with a token made
// for this launch, and keeps it alive with a heartbeat: when the TV hides the app,
// its JavaScript stops, the beats stop, and the engine mutes and then exits.
import type { EngineParams, OutputKind } from './presets';

export const ENGINE_PORT = 47830;
const BEAT_EVERY = 2000;
const PARAMS_DELAY = 50;
const CONNECT_TRIES = 12; // ~6 s for a cold start on a busy TV
// A dead or silent engine is launched again after this long, twice as long after
// each failure in a row, so an engine that keeps crashing cannot spin the TV.
const RETRY_FIRST = 1000;
const RETRY_MAX = 30000;
const PROTO = 1;

export type EngineState =
  | 'idle'
  | 'starting'
  | 'connecting'
  | 'ready'
  | 'standby'
  | 'unavailable' // not on a TV, or the engine is missing
  | 'failed';

export interface Meter {
  peak: number;
  rms: number;
  gate: number;
  gr: number;
  notches: number;
}

export interface EngineInfo {
  state: EngineState;
  input?: { name: string; card: number };
  output?: { kind: OutputKind; pcm: string; period: number; buffer: number };
  status?: { state: string; error: string; xruns: number; slips: number; cpu: number };
  measuredMs?: number;
  error?: string;
}

export interface PitchBatch {
  epoch: string;
  seq: number;
  hop: number;
  midi: number[];
}

interface Options {
  exec: (command: string) => Promise<string>;
  appDir: string;
  version: string;
  onInfo: (info: EngineInfo) => void;
  onPitch: (batch: PitchBatch) => void;
  onMeter: (meter: Meter) => void;
  onOnset?: (epoch: string, frame: number) => void;
  socket?: (url: string) => WebSocket;
  port?: number;
}

export const randomToken = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');

export class EngineClient {
  private ws: WebSocket | null = null;
  private info: EngineInfo = { state: 'idle' };
  private token = '';
  private output: OutputKind = 'tv';
  private params: EngineParams | null = null;
  private beat: ReturnType<typeof setInterval> | undefined;
  private paramsTimer: ReturnType<typeof setTimeout> | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private retryDelay = RETRY_FIRST;
  private readyAt = 0;
  private stopped = true;
  private launch = 0; // bumps on every start, so a stale socket's events are ignored

  constructor(private options: Options) {}

  get state() {
    return this.info.state;
  }

  private update(patch: Partial<EngineInfo>) {
    this.info = { ...this.info, ...patch };
    this.options.onInfo(this.info);
  }

  private script(args: string) {
    return `sh '${this.options.appDir}/otr-mic.sh' ${args}`;
  }

  async start(output: OutputKind) {
    this.stopped = false;
    this.output = output;
    clearTimeout(this.retryTimer);
    const launch = ++this.launch;
    this.close();
    this.token = randomToken();
    this.update({ state: 'starting', error: undefined });
    try {
      const out = await this.options.exec(
        `OTR_TOKEN=${this.token} ${this.script(`start --output ${output} --port ${this.port}`)}`,
      );
      // The script answers with one JSON line: {"started":true} or {"error":...}.
      const reply = JSON.parse(out.trim().split('\n').pop() || '{}');
      if (reply.error) throw new Error(reply.error);
    } catch (error) {
      if (launch !== this.launch) return;
      this.update({ state: 'unavailable', error: (error as Error).message });
      return;
    }
    if (launch === this.launch) this.connect(launch, CONNECT_TRIES);
  }

  private get port() {
    return this.options.port ?? ENGINE_PORT;
  }

  private connect(launch: number, triesLeft: number) {
    if (this.stopped || launch !== this.launch) return;
    this.update({ state: 'connecting' });
    const make = this.options.socket ?? ((url: string) => new WebSocket(url));
    let ws: WebSocket;
    try {
      ws = make(`ws://127.0.0.1:${this.port}`);
    } catch (error) {
      this.update({ state: 'failed', error: (error as Error).message });
      return;
    }
    this.ws = ws;
    let greeted = false;
    ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token: this.token, app: this.options.version }));
    ws.onmessage = (event) => {
      if (launch !== this.launch) return;
      let message: any;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (message.type === 'hello') {
        greeted = true;
        if (message.proto !== PROTO) {
          this.update({ state: 'failed', error: `Engine protocol ${message.proto}` });
          ws.close();
          return;
        }
        this.readyAt = Date.now();
        this.update({ state: 'ready', input: message.input, output: message.output });
        this.sendParams();
        clearInterval(this.beat);
        this.beat = setInterval(() => this.send({ type: 'beat' }), BEAT_EVERY);
      } else if (message.type === 'tick') {
        if (Array.isArray(message.midi) && message.midi.length) {
          this.options.onPitch({ epoch: String(message.epoch), seq: message.seq, hop: message.hop ?? 0.02, midi: message.midi });
        }
        if (message.meter) this.options.onMeter(message.meter);
      } else if (message.type === 'status') {
        // The engine runs on without a mic (it retries every 2 s); for the app
        // that is a failure with a reason until the mic comes back.
        const state: EngineState =
          message.state === 'running' ? 'ready' : message.state === 'standby' ? 'standby' : 'failed';
        this.update({ status: message, state, error: state === 'failed' ? message.error || message.state : undefined });
      } else if (message.type === 'onset') {
        this.options.onOnset?.(String(message.epoch), message.frame);
      } else if (message.type === 'measured') {
        this.update({ measuredMs: message.ms });
      } else if (message.type === 'error') {
        this.update({ error: message.detail || message.code });
      }
    };
    ws.onclose = () => {
      if (this.ws === ws) this.ws = null;
      clearInterval(this.beat);
      if (this.stopped || launch !== this.launch) return;
      // Not up yet: keep knocking. Up and then gone, or never answering: launch again.
      if (!greeted && triesLeft > 1) {
        setTimeout(() => this.connect(launch, triesLeft - 1), 500);
        return;
      }
      if (greeted && Date.now() - this.readyAt > RETRY_MAX) this.retryDelay = RETRY_FIRST;
      this.update({
        state: 'failed',
        error: greeted ? 'The microphone engine stopped' : 'No answer from the microphone engine',
      });
      this.retry();
    };
  }

  private retry() {
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.start(this.output), this.retryDelay);
    this.retryDelay = Math.min(this.retryDelay * 2, RETRY_MAX);
  }

  private send(message: Record<string, unknown>) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(message));
  }

  setParams(params: EngineParams) {
    this.params = params;
    clearTimeout(this.paramsTimer);
    this.paramsTimer = setTimeout(() => this.sendParams(), PARAMS_DELAY);
  }

  private sendParams() {
    if (this.params) this.send({ type: 'params', ...this.params });
  }

  measure() {
    this.send({ type: 'measure' });
  }

  // Attacks the mic hears, for the score's timing calibration.
  setOnsets(on: boolean) {
    this.send({ type: 'onsets', on });
  }

  standby() {
    this.send({ type: 'standby' });
  }

  resume() {
    this.send({ type: 'resume' });
  }

  private close() {
    clearInterval(this.beat);
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      ws.onclose = null;
      ws.close();
    }
  }

  async stop() {
    this.stopped = true;
    this.launch++;
    clearTimeout(this.retryTimer);
    this.send({ type: 'quit' });
    this.close();
    this.update({ state: 'idle' });
    await this.options.exec(this.script('stop')).catch(() => {});
  }
}
