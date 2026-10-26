// The engine's WebSocket, as the app and as an intruder would use it. Runs the
// Mac build with the null audio device and shortened heartbeat limits.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

const BIN = path.resolve(import.meta.dirname, '../build/otr-mic');
const TOKEN = 'test-token-0123456789abcdef';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function start(port, env = {}) {
  const child = spawn(BIN, ['run', '--backend', 'null', '--port', String(port)], {
    env: { ...process.env, OTR_TOKEN: TOKEN, ...env },
    stdio: 'ignore',
  });
  return child;
}

async function connect(port) {
  for (let i = 0; i < 40; i++) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const ok = await new Promise((resolve) => {
      ws.onopen = () => resolve(true);
      ws.onerror = () => resolve(false);
    });
    if (ok) return ws;
    await sleep(50);
  }
  throw new Error('engine did not listen');
}

function collect(ws) {
  const messages = [];
  let closed = false;
  ws.onmessage = (e) => messages.push(JSON.parse(e.data));
  ws.onclose = () => (closed = true);
  return { messages, closed: () => closed, of: (type) => messages.filter((m) => m.type === type) };
}

// A raw handshake, to send headers a browser would.
function handshake(port, headers) {
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1', () => {
      const lines = ['GET / HTTP/1.1', 'Upgrade: websocket', 'Connection: Upgrade', 'Sec-WebSocket-Version: 13', 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ=='];
      for (const [k, v] of Object.entries(headers)) lines.push(`${k}: ${v}`);
      socket.write(lines.join('\r\n') + '\r\n\r\n');
    });
    let data = '';
    socket.on('data', (d) => (data += d));
    socket.on('close', () => resolve(data.split('\r\n')[0]));
    setTimeout(() => {
      socket.destroy();
      resolve(data.split('\r\n')[0]);
    }, 500);
  });
}

describe('engine socket', () => {
  const port = 47920;
  let child;
  before(() => (child = start(port)));
  after(() => child.kill());

  it('greets the app that brings this launch’s token', async () => {
    const ws = await connect(port);
    const c = collect(ws);
    ws.send(JSON.stringify({ type: 'auth', token: TOKEN }));
    await sleep(400);
    const [hello] = c.of('hello');
    assert.equal(hello.proto, 1);
    assert.match(hello.epoch, /^[0-9a-f]{16}$/);
    assert.equal(hello.output.kind, 'tv');
    const tick = c.of('tick').at(-1);
    assert.equal(tick.hop, 0.02);
    assert.ok(Array.isArray(tick.midi));
    assert.ok('peak' in tick.meter && 'notches' in tick.meter);
    ws.close();
  });

  it('closes on a wrong token', async () => {
    const ws = await connect(port);
    const c = collect(ws);
    ws.send(JSON.stringify({ type: 'auth', token: 'guess' }));
    await sleep(300);
    assert.equal(c.closed(), true);
    assert.equal(c.of('hello').length, 0);
  });

  it('closes a client that never authenticates', async () => {
    const ws = await connect(port);
    const c = collect(ws);
    await sleep(2400);
    assert.equal(c.closed(), true);
  });

  it('refuses a web page and a rebound host name', async () => {
    assert.match(await handshake(port, { Host: `127.0.0.1:${port}`, Origin: 'http://evil.example' }), /403/);
    assert.match(await handshake(port, { Host: `evil.example:${port}` }), /403/);
    assert.match(await handshake(port, { Host: `127.0.0.1:${port}`, Origin: 'null' }), /101/);
  });

  it('lets a reloaded app replace the old page', async () => {
    const first = await connect(port);
    const a = collect(first);
    first.send(JSON.stringify({ type: 'auth', token: TOKEN }));
    await sleep(200);
    const second = await connect(port);
    const b = collect(second);
    second.send(JSON.stringify({ type: 'auth', token: TOKEN }));
    await sleep(300);
    assert.equal(a.closed(), true);
    assert.equal(b.of('hello').length, 1);
    second.close();
  });
});

describe('engine heartbeat', () => {
  it('mutes without beats, comes back with one, and exits when the app is gone', async () => {
    const port = 47921;
    const child = start(port, { OTR_STANDBY_MS: '600', OTR_EXIT_MS: '2500' });
    const exited = new Promise((resolve) => child.on('exit', () => resolve(Date.now())));
    const ws = await connect(port);
    const c = collect(ws);
    ws.send(JSON.stringify({ type: 'auth', token: TOKEN }));
    await sleep(1800);
    assert.equal(c.of('status').at(-1).state, 'standby');
    ws.send(JSON.stringify({ type: 'beat' }));
    await sleep(1100);
    assert.ok(c.of('status').some((s) => s.state === 'running'));
    const since = Date.now();
    const at = await exited;
    assert.ok(at - since < 4000, 'exits on its own');
  });

  it('quits when asked', async () => {
    const port = 47922;
    const child = start(port);
    const exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)));
    const ws = await connect(port);
    ws.send(JSON.stringify({ type: 'auth', token: TOKEN }));
    await sleep(200);
    ws.send(JSON.stringify({ type: 'quit' }));
    assert.equal(await exited, 0);
  });
});
