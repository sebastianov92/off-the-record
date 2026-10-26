// The app's end of the postMessage link with the splash in its frame. Only
// messages from that frame and the server's origin count; commands resolve with
// the bridge's result, or a failure after a timeout.
import { BRIDGE, parseFromSplash } from './splash-protocol';
import type { Command, CommandResult, FromSplash } from './splash-protocol';

const COMMAND_TIMEOUT = 8000;

export class SplashLink {
  private nextId = 1;
  private pending = new Map<number, (result: CommandResult) => void>();

  constructor(
    private frame: HTMLIFrameElement,
    private origin: string,
    private onMessage: (message: FromSplash) => void,
  ) {
    window.addEventListener('message', this.listener);
  }

  private listener = (event: MessageEvent) => {
    if (event.source !== this.frame.contentWindow || event.origin !== this.origin) return;
    const message = parseFromSplash(event.data);
    if (!message) return;
    if (message.type === 'result') {
      this.pending.get(message.id)?.(message);
      this.pending.delete(message.id);
    }
    this.onMessage(message);
  };

  send(type: string, data: Record<string, unknown> = {}) {
    this.frame.contentWindow?.postMessage({ otr: BRIDGE, type, ...data }, this.origin);
  }

  command(action: Command, value?: number | string): Promise<CommandResult> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ id, ok: false, status: 0 });
      }, COMMAND_TIMEOUT);
      this.pending.set(id, (result) => {
        clearTimeout(timer);
        resolve(result);
      });
      this.send('cmd', { id, action, value });
    });
  }

  dispose() {
    window.removeEventListener('message', this.listener);
    for (const resolve of this.pending.values()) resolve({ id: 0, ok: false, status: 0 });
    this.pending.clear();
  }
}
