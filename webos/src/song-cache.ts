// The app's side of otr-files (tv/otr-files.py), which keeps copies of the next
// songs on the TV. The karaoke page says which files the coming songs play from;
// this hands the list on, with the device token the files are fetched with, and
// tells the page which ones the TV already has, so it plays those from the TV.
import { randomToken } from './engine';

export const FILES_PORT = 47831;
// Shares the TV's app partition: otr-files keeps under its budget and leaves room.
export const CACHE_ROOT = '/media/developer/otr-cache';
const POLL_EVERY = 3000;

export interface CacheSong {
  name: string;
  url: string;
  size: number;
}

interface Options {
  exec: (command: string) => Promise<string>;
  appDir: string;
  // The names the TV has now, whenever they change.
  onFiles: (names: string[]) => void;
  fetch?: typeof fetch;
  port?: number;
}

export class SongCache {
  private token = randomToken();
  private poll: ReturnType<typeof setInterval> | undefined;
  private seen = '';

  constructor(private options: Options) {}

  private get port() {
    return this.options.port ?? FILES_PORT;
  }

  // Where the karaoke page loads a kept song from.
  get base() {
    return `http://127.0.0.1:${this.port}/files/`;
  }

  private call(route: string, init: RequestInit = {}) {
    return (this.options.fetch ?? fetch)(`http://127.0.0.1:${this.port}${route}`, {
      ...init,
      headers: { 'X-Otr-Token': this.token, 'Content-Type': 'application/json' },
    });
  }

  async start() {
    const script = `sh '${this.options.appDir}/otr-files.sh'`;
    const out = await this.options.exec(`OTR_TOKEN=${this.token} ${script} start --root '${CACHE_ROOT}' --port ${this.port}`);
    const reply = JSON.parse(out.trim().split('\n').pop() || '{}');
    if (reply.error) throw new Error(reply.error);
    clearInterval(this.poll);
    this.poll = setInterval(() => this.refresh(), POLL_EVERY);
  }

  // `server`: the karaoke server's origin; `token`: the device token, '' without a password.
  async want(server: string, token: string, songs: CacheSong[]) {
    const r = await this.call('/want', { method: 'POST', body: JSON.stringify({ server, token, songs }) });
    if (r.ok) this.report((await r.json()).files);
  }

  private async refresh() {
    try {
      const r = await this.call('/state');
      if (r.ok) this.report((await r.json()).files);
    } catch {
      // Starting up, or gone for a moment: the page streams meanwhile.
    }
  }

  private report(files: Record<string, number>) {
    const names = Object.keys(files).sort();
    const key = names.join(',');
    if (key === this.seen) return;
    this.seen = key;
    this.options.onFiles(names);
  }

  async stop() {
    clearInterval(this.poll);
    await this.options.exec(`sh '${this.options.appDir}/otr-files.sh' stop`).catch(() => {});
  }
}
