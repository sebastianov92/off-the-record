// Unit tests for the app's pure parts: what the remote types, what it remembers,
// what its keys mean, the voice presets and the messages it accepts.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { keyOf } from '../src/keys.ts';
import { clampCursor, moveCol, moveRow } from '../src/menu.ts';
import type { MenuRow } from '../src/menu.ts';
import { applyPreset, defaultVoice, engineParams, normalizeVoice } from '../src/presets.ts';
import { normalizeServer, splashUrl } from '../src/server-url.ts';
import { defaults, normalizeSettings, withRecent } from '../src/settings.ts';
import { parseFromSplash } from '../src/splash-protocol.ts';

describe('server address', () => {
  it('completes a bare IP with http and the server port', () => {
    assert.equal(normalizeServer('192.168.18.2'), 'http://192.168.18.2:5555');
  });

  it('keeps a typed port and drops a trailing slash', () => {
    assert.equal(normalizeServer(' 192.168.18.2:8080/ '), 'http://192.168.18.2:8080');
    assert.equal(normalizeServer('localhost:5566'), 'http://localhost:5566');
  });

  it('keeps a path for a server behind a proxy', () => {
    assert.equal(normalizeServer('https://casa.example/karaoke/'), 'https://casa.example:5555/karaoke');
    assert.equal(normalizeServer('https://casa.example:443/karaoke'), 'https://casa.example/karaoke');
  });

  it('refuses what is not an http address', () => {
    assert.equal(normalizeServer(''), null);
    assert.equal(normalizeServer('ftp://host'), null);
    assert.equal(normalizeServer('http://'), null);
  });

  it('asks the splash for the webOS bridge', () => {
    assert.equal(splashUrl('http://h:5555'), 'http://h:5555/splash?client=webos');
  });
});

describe('settings', () => {
  it('falls back to defaults for missing or damaged values', () => {
    const s = normalizeSettings({ micVolume: 'loud', output: 'hdmi', tokens: { a: 1, b: 'x' } });
    assert.equal(s.micVolume, defaults().micVolume);
    assert.equal(s.output, 'tv');
    assert.deepEqual(s.tokens, { b: 'x' });
  });

  it('clamps numbers into range', () => {
    assert.equal(normalizeSettings({ micVolume: 250, pitchLatency: -3 }).micVolume, 100);
    assert.equal(normalizeSettings({ pitchLatency: -3 }).pitchLatency, 0);
  });

  it('keeps the last five servers, newest first, without repeats', () => {
    let s = defaults();
    for (const n of [1, 2, 3, 4, 5, 6, 3]) s = withRecent(s, `http://h${n}:5555`);
    assert.equal(s.server, 'http://h3:5555');
    assert.deepEqual(s.recent, ['http://h3:5555', 'http://h6:5555', 'http://h5:5555', 'http://h4:5555', 'http://h2:5555']);
  });
});

describe('remote keys', () => {
  it('reads the LG remote by key code', () => {
    assert.equal(keyOf({ keyCode: 461 }), 'back');
    assert.equal(keyOf({ keyCode: 417 }), 'next');
    assert.equal(keyOf({ keyCode: 412 }), 'restart');
    assert.equal(keyOf({ keyCode: 403 }), 'red');
    assert.equal(keyOf({ keyCode: 33 }), 'micUp');
  });

  it('reads a desktop keyboard by key name', () => {
    assert.equal(keyOf({ keyCode: 0, key: 'Escape' }), 'back');
    assert.equal(keyOf({ key: 'MediaPlayPause' }), 'playPause');
  });

  it('ignores keys it has no use for', () => {
    assert.equal(keyOf({ keyCode: 65, key: 'a' }), null);
  });
});

describe('menus', () => {
  const rows: MenuRow[] = [
    { id: 'transport', kind: 'buttons', size: 3 },
    { id: 'music', kind: 'slider' },
    { id: 'guide', kind: 'slider', disabled: true },
    { id: 'mic', kind: 'slider' },
  ];

  it('skips a disabled row', () => {
    assert.deepEqual(moveRow(rows, { row: 1, col: 0 }, 1), { row: 3, col: 0 });
    assert.deepEqual(moveRow(rows, { row: 3, col: 0 }, -1), { row: 1, col: 0 });
  });

  it('stays put at either end', () => {
    assert.deepEqual(moveRow(rows, { row: 0, col: 2 }, -1), { row: 0, col: 2 });
    assert.deepEqual(moveRow(rows, { row: 3, col: 0 }, 1), { row: 3, col: 0 });
  });

  it('moves within a row of buttons and clamps at its ends', () => {
    assert.deepEqual(moveCol(rows, { row: 0, col: 1 }, 1), { row: 0, col: 2 });
    assert.deepEqual(moveCol(rows, { row: 0, col: 2 }, 1), { row: 0, col: 2 });
  });

  it('moves a cursor off a row that became disabled', () => {
    assert.deepEqual(clampCursor(rows, { row: 2, col: 0 }), { row: 3, col: 0 });
  });
});

describe('voice', () => {
  it('copies a preset, so editing a band leaves the preset alone', () => {
    const voice = applyPreset(defaultVoice(), 'clear');
    voice.eq[3] = 12;
    assert.equal(applyPreset(defaultVoice(), 'clear').eq[3], 4);
  });

  it('repairs a damaged voice setting', () => {
    const v = normalizeVoice({ preset: 'loud', eq: [99, 0, 0, 0, -99], echo: 'x' });
    assert.equal(v.preset, 'natural');
    assert.deepEqual(v.eq, [12, 0, 0, 0, -12]);
    assert.equal(v.echo, defaultVoice().echo);
  });

  it('times the echo to the measured delay through the TV', () => {
    const p = engineParams({ voice: defaultVoice(), micVolume: 70, micMuted: false, output: 'tv', monitorLatencyMs: 118.4 });
    assert.equal(p.echo.delayMs, 118);
    assert.equal(p.mute, false);
  });

  it('mutes the monitor when the output is off', () => {
    const p = engineParams({ voice: defaultVoice(), micVolume: 70, micMuted: false, output: 'off', monitorLatencyMs: 120 });
    assert.equal(p.mute, true);
  });
});

describe('messages from the splash', () => {
  it('accepts a well-formed state', () => {
    const m = parseFromSplash({ otr: 1, type: 'state', playing: true, title: 'S', volume: 0.5, guideVolume: 20, hasGuide: true });
    assert.equal(m?.type, 'state');
  });

  it('refuses another protocol version or a malformed message', () => {
    assert.equal(parseFromSplash({ otr: 2, type: 'state' }), null);
    assert.equal(parseFromSplash({ otr: 1, type: 'state', playing: 'yes' }), null);
    assert.equal(parseFromSplash({ otr: 1, type: 'shutdown' }), null);
    assert.equal(parseFromSplash('ready'), null);
  });
});
