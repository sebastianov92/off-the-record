// The engine client keeps the microphone engine alive: one that dies or never
// answers is launched again, waiting longer after each failure in a row.
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { EngineClient } from '../src/engine.ts';
import type { EngineInfo } from '../src/engine.ts';

class FakeSocket {
  readyState = 1;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  send(message: string) {
    this.sent.push(message);
  }
  close() {
    this.readyState = 3;
  }
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

function harness() {
  const commands: string[] = [];
  const sockets: FakeSocket[] = [];
  let info: EngineInfo = { state: 'idle' };
  const client = new EngineClient({
    exec: async (command) => {
      commands.push(command);
      return '{"started":true}';
    },
    appDir: '/app',
    version: 'test',
    onInfo: (i) => (info = i),
    onPitch: () => {},
    onMeter: () => {},
    socket: () => {
      const s = new FakeSocket();
      sockets.push(s);
      return s as unknown as WebSocket;
    },
  });
  return {
    client,
    sockets,
    info: () => info,
    starts: () => commands.filter((c) => c.includes(' start ')).length,
    latest: () => sockets[sockets.length - 1],
  };
}

function greet(s: FakeSocket) {
  s.onopen?.();
  s.onmessage?.({ data: JSON.stringify({ type: 'hello', proto: 1 }) });
}

async function after(ms: number) {
  mock.timers.tick(ms);
  await flush();
}

describe('engine client', () => {
  beforeEach(() => mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 0 }));
  afterEach(() => mock.timers.reset());

  it('launches a dead engine again, waiting longer after each failure in a row', async () => {
    const h = harness();
    await h.client.start('tv');
    greet(h.latest());
    assert.equal(h.info().state, 'ready');

    h.latest().onclose?.();
    assert.equal(h.info().state, 'failed');
    await after(999);
    assert.equal(h.starts(), 1);
    await after(1);
    assert.equal(h.starts(), 2);

    // This one never answers: once its connection tries run out, the wait doubles.
    for (let i = 0; i < 11; i++) {
      h.latest().onclose?.();
      await after(500);
    }
    h.latest().onclose?.();
    assert.match(h.info().error ?? '', /No answer/);
    await after(1999);
    assert.equal(h.starts(), 2);
    await after(1);
    assert.equal(h.starts(), 3);
  });

  it('waits the shortest time again after a long good run', async () => {
    const h = harness();
    await h.client.start('tv');
    greet(h.latest());
    h.latest().onclose?.();
    await after(1000);
    greet(h.latest());
    await after(60000);
    h.latest().onclose?.();
    await after(1000);
    assert.equal(h.starts(), 3);
  });

  it('launches nothing once stopped', async () => {
    const h = harness();
    await h.client.start('tv');
    greet(h.latest());
    h.latest().onclose?.();
    await h.client.stop();
    await after(60000);
    assert.equal(h.starts(), 1);
    assert.equal(h.info().state, 'idle');
  });
});
