// tv/otr-mic.sh with a fake engine and a fake luna-send: start must return at
// once (Homebrew Channel's exec waits for it), and LG's sound mode must go to
// "game" for the TV speakers and come back afterwards, even after a crash.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, it } from 'node:test';

const SCRIPT = path.resolve(import.meta.dirname, '../../tv/otr-mic.sh');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let dir, env;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'otr-sh-'));
  fs.writeFileSync(path.join(dir, 'mode'), 'standard');
  // luna-send: reads and writes the mode in a file, logs every call.
  fs.writeFileSync(
    path.join(dir, 'luna-send'),
    `#!/bin/sh
echo "$@" >> "${dir}/luna.log"
case "$3" in
  *getSystemSettings) printf '{"returnValue":true,"settings":{"soundMode":"%s"}}' "$(cat "${dir}/mode")" ;;
  *setSystemSettings) echo "$4" | sed -n 's/.*"soundMode":"\\([^"]*\\)".*/\\1/p' > "${dir}/mode" ;;
esac
`,
    { mode: 0o755 },
  );
  // The engine: runs until it is told to stop.
  fs.writeFileSync(path.join(dir, 'engine'), `#!/bin/sh\necho "$@" > "${dir}/engine.args"\ntrap 'exit 0' TERM\nwhile :; do sleep 0.05; done\n`, { mode: 0o755 });
  env = { ...process.env, OTR_TMP: dir, OTR_LUNA: path.join(dir, 'luna-send'), OTR_BIN: path.join(dir, 'engine'), OTR_TOKEN: 'x'.repeat(20) };
});

const sh = (...args) => execFileSync('sh', [SCRIPT, ...args], { env, encoding: 'utf8', timeout: 10000 });
const mode = () => fs.readFileSync(path.join(dir, 'mode'), 'utf8').trim();
const status = () => JSON.parse(sh('status'));

async function until(check) {
  for (let i = 0; i < 60; i++) {
    if (check()) return;
    await sleep(50);
  }
  assert.fail('timed out');
}

describe('otr-mic.sh', () => {
  it('returns from start at once and leaves the engine running', async () => {
    const t = Date.now();
    const out = sh('start', '--output', 'tv', '--port', '47830');
    assert.ok(Date.now() - t < 1000);
    assert.deepEqual(JSON.parse(out), { started: true });
    await until(() => status().running && fs.existsSync(path.join(dir, 'engine.args')));
    assert.match(fs.readFileSync(path.join(dir, 'engine.args'), 'utf8'), /run --output tv --port 47830/);
    sh('stop');
  });

  it('puts the TV in game sound mode while singing through its speakers, and back after', async () => {
    sh('start', '--output', 'tv');
    await until(() => mode() === 'game');
    sh('stop');
    assert.equal(status().running, false);
    assert.equal(mode(), 'standard');
  });

  it('leaves the sound mode alone for a USB speaker', async () => {
    sh('start', '--output', 'usb');
    await until(() => status().running);
    assert.equal(mode(), 'standard');
    sh('stop');
  });

  it('keeps a sound mode the singer picked while it ran', async () => {
    sh('start', '--output', 'tv');
    await until(() => mode() === 'game');
    fs.writeFileSync(path.join(dir, 'mode'), 'cinema');
    sh('stop');
    assert.equal(mode(), 'cinema');
  });

  it('puts back a mode a crashed run left saved', () => {
    fs.writeFileSync(path.join(dir, 'mode'), 'game');
    fs.writeFileSync(path.join(dir, 'otr-mic.soundmode'), 'standard');
    spawnSync('sh', [SCRIPT, 'run', '--output', 'off'], { env: { ...env, OTR_BIN: '/usr/bin/true' }, timeout: 5000 });
    assert.equal(mode(), 'standard');
  });

  it('starting again replaces the running engine', async () => {
    sh('start', '--output', 'tv');
    await until(() => status().running);
    const first = status().pid;
    sh('start', '--output', 'tv');
    await until(() => status().running && status().pid !== first);
    sh('stop');
    assert.equal(mode(), 'standard');
  });

  it('starts when called by a relative path, as on the TV', async () => {
    const out = execFileSync('sh', ['otr-mic.sh', 'start', '--output', 'off'], { cwd: path.dirname(SCRIPT), env, encoding: 'utf8' });
    assert.deepEqual(JSON.parse(out), { started: true });
    await until(() => status().running);
    sh('stop');
  });

  it('refuses to start without a token', () => {
    const r = spawnSync('sh', [SCRIPT, 'start'], { env: { ...env, OTR_TOKEN: '' }, encoding: 'utf8' });
    assert.notEqual(r.status, 0);
    assert.match(r.stdout, /OTR_TOKEN/);
  });
});
