// Calls into webOS from the app page: the luna bus through PalmServiceBridge, and
// root shell commands through Homebrew Channel's exec service. Adapted from LumiOS
// (github.com/sebastianov92/LumiOS, src/bridge.ts at 8b5332c).
interface NativeBridge {
  onservicecallback: (raw: string) => void;
  call(uri: string, payload: string): void;
  cancel(): void;
}

declare global {
  interface Window {
    PalmSystem?: { platformBack?: () => void; identifier?: string; launchParams?: string };
    webOSSystem?: { platformBack?: () => void };
    PalmServiceBridge?: new () => NativeBridge;
    webOSServiceBridge?: new () => NativeBridge;
  }
}

export const isTV = () =>
  typeof window !== 'undefined' &&
  !!(window.PalmSystem || window.webOSSystem) &&
  !!(window.PalmServiceBridge || window.webOSServiceBridge);

export function nativeCall(
  uri: string,
  payload: Record<string, unknown>,
  timeout = 6500,
): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    const Bridge = window.PalmServiceBridge ?? window.webOSServiceBridge;
    if (!Bridge) {
      reject(new Error('Solo en la tele'));
      return;
    }
    let bridge: NativeBridge | undefined;
    let done = false;
    const finish = (error: Error | null, result?: Record<string, any>) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (bridge) {
        bridge.onservicecallback = () => {};
        try {
          bridge.cancel();
        } catch {
          /* Native object may already be closed. */
        }
      }
      if (error) reject(error);
      else resolve(result!);
    };
    const timer = setTimeout(() => finish(new Error('The TV did not respond')), timeout);
    try {
      bridge = new Bridge();
      bridge.onservicecallback = (raw) => {
        try {
          const value = JSON.parse(raw);
          if (!value || value.returnValue !== true) {
            throw new Error(typeof value?.errorText === 'string' ? value.errorText.slice(0, 240) : 'Denied');
          }
          finish(null, value);
        } catch (error) {
          finish(error instanceof Error ? error : new Error('Unreadable response'));
        }
      };
      bridge.call(uri, JSON.stringify(payload));
    } catch {
      finish(new Error('The webOS service bridge is unavailable'));
    }
  });
}

const decode = (base64: string) =>
  new TextDecoder().decode(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)));

// Runs a shell command as root. Anything left running must not keep stdout open,
// or the call only returns at the timeout.
export async function execText(command: string, timeout = 20000): Promise<string> {
  const envelope = await nativeCall('luna://org.webosbrew.hbchannel.service/exec', { command }, timeout);
  if (typeof envelope.stdoutBytes === 'string') return decode(envelope.stdoutBytes);
  if (typeof envelope.stdoutString === 'string') return envelope.stdoutString;
  return '';
}

// The installed app's folder, where the engine and its script live.
export const appDir = () => decodeURIComponent(new URL('.', window.location.href).pathname).replace(/\/$/, '');

export function exitApp() {
  const system = window.PalmSystem ?? window.webOSSystem;
  if (system?.platformBack) system.platformBack();
  else window.close();
}

// A server passed when the app is launched ({"server": "192.168.18.2"}), so a
// launcher or a test can open it straight on the karaoke screen.
export function launchServer(): string | null {
  try {
    const raw = window.PalmSystem?.launchParams;
    const params = typeof raw === 'string' && raw ? JSON.parse(raw) : raw;
    return params && typeof params.server === 'string' ? params.server : null;
  } catch {
    return null;
  }
}

