// otr-files.py, run with python3 against a stand-in karaoke server: it keeps the
// songs it is told to, drops the rest, stays under its budget and serves byte ranges.
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

const SCRIPT = path.join(import.meta.dirname, '..', 'tv', 'otr-files.py');
const TOKEN = 'files-token-0123456789';
const ADMIN = 'admin-device-token';
const MB = 2 ** 20;

const name = (n: number, ext = 'm4a') => `${String(n).repeat(20).slice(0, 20)}.${ext}`;
// One byte pattern per song, so a range read can be checked.
const body = (n: number, size: number) => Buffer.alloc(size, n);
const SONGS = [
  { name: name(1), size: 1 * MB },
  { name: name(2), size: 1 * MB },
  { name: name(3), size: 3 * MB }, // over the 4 MB budget once 1 and 2 are kept
];

let server: http.Server;
let origin = '';
let child: ChildProcess;
let root = '';
let port = 0;
const requests: string[] = [];

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = http.createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address() as AddressInfo;
      s.close(() => resolve(port));
    });
  });
}

const call = (route: string, init: RequestInit = {}) =>
  fetch(`http://127.0.0.1:${port}${route}`, {
    ...init,
    headers: { 'X-Otr-Token': TOKEN, 'Content-Type': 'application/json', ...init.headers },
  });

const want = (songs: typeof SONGS) =>
  call('/want', {
    method: 'POST',
    body: JSON.stringify({
      server: origin,
      token: ADMIN,
      songs: songs.map((s) => ({ ...s, url: `/api/tv/media/${s.name}` })),
    }),
  });

// The files once they match, or what they were when time ran out.
async function settles(expected: Record<string, number>): Promise<Record<string, number>> {
  let files = {};
  for (let i = 0; i < 100; i++) {
    files = (await (await call('/state')).json()).files;
    if (JSON.stringify(files) === JSON.stringify(expected)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  return files;
}

before(async () => {
  server = http.createServer((req, res) => {
    requests.push(`${req.url} ${req.headers['x-admin-token']}`);
    const i = SONGS.findIndex((s) => req.url === `/api/tv/media/${s.name}`);
    if (i < 0 || req.headers['x-admin-token'] !== ADMIN) return res.writeHead(404).end();
    res.writeHead(200, { 'Content-Length': SONGS[i].size }).end(body(i + 1, SONGS[i].size));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'otr-files-'));
  port = await freePort();
  child = spawn('python3', [SCRIPT, '--root', root, '--port', String(port), '--budget-mb', '4', '--keep-free-mb', '0'], {
    env: { ...process.env, OTR_TOKEN: TOKEN },
    stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) {
    if (await fetch(`http://127.0.0.1:${port}/state`).then(() => true, () => false)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
});

after(() => {
  child.kill();
  server.close();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('otr-files', () => {
  it('refuses orders without its token', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/state`);
    assert.equal(r.status, 403);
  });

  it('keeps the coming songs up to its budget, signed in as the app', async () => {
    assert.equal((await want(SONGS)).status, 200);
    const expected = { [SONGS[0].name]: MB, [SONGS[1].name]: MB };
    assert.deepEqual(await settles(expected), expected);
    // Song 3 would go over the budget: give it time to be wrongly fetched.
    await new Promise((r) => setTimeout(r, 300));
    assert.deepEqual((await (await call('/state')).json()).files, expected);
    assert.ok(requests.every((r) => r.endsWith(ADMIN)));
  });

  it('serves a song from the middle, as a player starting mid-song asks', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/files/${SONGS[1].name}`, { headers: { Range: 'bytes=100-199' } });
    assert.equal(r.status, 206);
    assert.equal(r.headers.get('content-range'), `bytes 100-199/${MB}`);
    assert.deepEqual(Buffer.from(await r.arrayBuffer()), body(2, 100));
  });

  it('drops a sung song and fetches the next one that now fits', async () => {
    await want([SONGS[1], SONGS[2]]);
    const expected = { [SONGS[1].name]: MB, [SONGS[2].name]: 3 * MB };
    assert.deepEqual(await settles(expected), expected);
  });

  it('serves nothing it does not keep', async () => {
    assert.equal((await fetch(`http://127.0.0.1:${port}/files/${SONGS[0].name}`)).status, 404);
    assert.equal((await fetch(`http://127.0.0.1:${port}/files/..%2Fetc%2Fpasswd`)).status, 404);
  });
});
