// The app's side of the TV's song copies: it starts otr-files with its own token,
// passes the coming songs on with the device token, and reports what the TV has.
import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { CACHE_ROOT, SongCache } from '../src/song-cache.ts';
import { parseFromSplash } from '../src/splash-protocol.ts';

function harness() {
  const commands: string[] = [];
  const calls: { url: string; init: RequestInit }[] = [];
  const reports: string[][] = [];
  let files: Record<string, number> = {};
  const cache = new SongCache({
    exec: async (command) => {
      commands.push(command);
      return '{"started":true}';
    },
    appDir: '/app',
    onFiles: (names) => reports.push(names),
    fetch: (async (url: string, init: RequestInit = {}) => {
      calls.push({ url, init });
      return { ok: true, json: async () => ({ files }) };
    }) as unknown as typeof fetch,
  });
  return { cache, commands, calls, reports, setFiles: (f: Record<string, number>) => (files = f) };
}

describe('song cache', () => {
  it('starts otr-files with its own token and the cache folder', async () => {
    mock.timers.enable({ apis: ['setInterval'] });
    try {
      const h = harness();
      await h.cache.start();
      assert.match(h.commands[0], /^OTR_TOKEN=[0-9a-f]{32} sh '\/app\/otr-files\.sh' start --root '.+' --port 47831$/);
      assert.ok(h.commands[0].includes(CACHE_ROOT));
    } finally {
      mock.timers.reset();
    }
  });

  it('passes the coming songs on with the device token and reports what the TV has', async () => {
    const h = harness();
    h.setFiles({ 'aaaaaaaaaaaaaaaaaaaa.mp4': 10 });
    const songs = [{ name: 'aaaaaaaaaaaaaaaaaaaa.mp4', url: '/api/tv/media/aaaaaaaaaaaaaaaaaaaa.mp4', size: 10 }];
    await h.cache.want('http://192.168.18.2:5555', 'device', songs);
    await h.cache.want('http://192.168.18.2:5555', 'device', songs);
    const sent = JSON.parse(String(h.calls[0].init.body));
    assert.deepEqual(sent, { server: 'http://192.168.18.2:5555', token: 'device', songs });
    assert.match(String((h.calls[0].init.headers as Record<string, string>)['X-Otr-Token']), /^[0-9a-f]{32}$/);
    assert.deepEqual(h.reports, [['aaaaaaaaaaaaaaaaaaaa.mp4']]); // once, not on every unchanged answer
  });

  it('accepts a well-formed song list from the splash and nothing else', () => {
    const song = { name: 'a.mp4', url: '/x', size: 1, file: '/songs/a.mp4' };
    assert.ok(parseFromSplash({ otr: 1, type: 'prefetch', songs: [song] }));
    assert.equal(parseFromSplash({ otr: 1, type: 'prefetch', songs: [{ name: 'a.mp4' }] }), null);
  });
});
