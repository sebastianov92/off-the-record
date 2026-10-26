// What the singer types on the remote becomes the server's base URL: a bare IP or
// host gets http:// and the server's default port; a trailing slash is dropped.
export const DEFAULT_PORT = 5555;
export const DEFAULT_SERVER = `http://192.168.18.2:${DEFAULT_PORT}`;

export function normalizeServer(input: string): string | null {
  let text = input.trim();
  if (!text) return null;
  if (!/^https?:\/\//i.test(text)) {
    // "host:5555" is a host and a port; "ftp:..." is another scheme.
    if (/^[a-z][a-z0-9+.-]*:/i.test(text) && !/^[^:/]+:\d+(\/|$)/.test(text)) return null;
    text = `http://${text}`;
  }
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname) return null;
  const typedPort = /^https?:\/\/(\[[^\]]*\]|[^/:]+):\d+/i.test(text);
  if (!typedPort) url.port = String(DEFAULT_PORT);
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

export const splashUrl = (server: string) => `${server}/splash?client=webos`;
export const originOf = (server: string) => new URL(server).origin;
