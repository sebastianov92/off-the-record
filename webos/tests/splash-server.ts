// A fake Off the Record server for the browser tests: serves the fake splash with
// the real bridge scripts, and an API that wants a device token like the real one.
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';

export const PASSWORD = 'test-pass';
export const TOKEN = 'device-token-for-tests';

export interface FakeServer {
  url: string;
  calls: { path: string; token: string | undefined; body: string }[];
  close: () => Promise<void>;
}

const staticRoot = path.resolve(import.meta.dirname, '../../pikaraoke/static');
const fixture = path.resolve(import.meta.dirname, 'fixtures/fake-splash.html');

export async function startFakeServer({ password = true } = {}): Promise<FakeServer> {
  const calls: FakeServer['calls'] = [];
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://localhost');
    const token = req.headers['x-admin-token'] as string | undefined;
    let body = '';
    for await (const chunk of req) body += chunk;
    const json = (status: number, data: unknown) =>
      res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(data));
    const admin = !password || token === TOKEN;
    if (url.pathname === '/splash') {
      return res.writeHead(200, { 'Content-Type': 'text/html' }).end(await fs.readFile(fixture));
    }
    if (url.pathname.startsWith('/static/')) {
      const file = path.join(staticRoot, url.pathname.slice('/static/'.length));
      return res.writeHead(200, { 'Content-Type': 'text/javascript' }).end(await fs.readFile(file));
    }
    if (url.pathname === '/api/now_playing') return json(200, { now_playing: 'Song', now_playing_user: 'Ana', volume: 0.8 });
    if (url.pathname === '/api/auth' && req.method === 'GET') return json(200, { authenticated: admin, password_required: password });
    if (url.pathname === '/api/auth') {
      const { admin_password } = JSON.parse(body || '{}');
      return admin_password === PASSWORD ? json(200, { authenticated: true, token: TOKEN }) : json(401, { error: 'Incorrect admin password' });
    }
    if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
      calls.push({ path: url.pathname, token, body });
      return admin ? json(200, { success: true }) : json(403, { error: 'Unauthorized' });
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${port}`,
    calls,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
