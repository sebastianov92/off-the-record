// The app with the real engine: a stand-in for Homebrew Channel's exec runs the
// app's own otr-mic.sh on this machine, which starts the Mac build of the engine
// (null audio device). Checks the whole path: launch, token, hello, the splash
// told there is a microphone, and the engine stopped on the way out.
import { expect, test } from '@playwright/test';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { startFakeServer } from './splash-server';
import type { FakeServer } from './splash-server';

const root = path.resolve(import.meta.dirname, '..');
const appUrl = pathToFileURL(path.join(root, 'dist/app/index.html')).href;
const engine = path.join(root, 'engine/build/otr-mic');
let server: FakeServer;
let tmp: string;

test.beforeAll(() => {
  if (!fs.existsSync(engine)) execSync('make build/otr-mic', { cwd: path.join(root, 'engine') });
});

test.afterEach(async () => {
  execSync(`sh '${path.join(root, 'dist/app/otr-mic.sh')}' stop`, { env: { ...process.env, OTR_TMP: tmp } });
  await server?.close();
});

test('launches the engine, connects and tells the splash there is a microphone', async ({ page }) => {
  server = await startFakeServer({ password: false });
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'otr-e2e-'));
  // luna-send for the sound mode: answers "standard" and accepts changes.
  fs.writeFileSync(path.join(tmp, 'luna-send'), '#!/bin/sh\necho \'{"settings":{"soundMode":"standard"}}\'\n', { mode: 0o755 });
  const commands: string[] = [];
  await page.exposeFunction('__exec', (command: string) => {
    commands.push(command);
    return execSync(command, {
      encoding: 'utf8',
      env: { ...process.env, OTR_TMP: tmp, OTR_BIN: engine, OTR_LUNA: path.join(tmp, 'luna-send') },
      timeout: 10000,
    });
  });
  await page.addInitScript((s) => {
    localStorage.setItem('offtherecord.settings', JSON.stringify({ server: s, recent: [s] }));
    // webOS as far as the app can tell: a service bridge whose exec runs in Node.
    (window as any).PalmSystem = { platformBack: () => ((window as any).__exited = true) };
    (window as any).PalmServiceBridge = class {
      onservicecallback = (_: string) => {};
      call(uri: string, payload: string) {
        if (!uri.endsWith('/exec')) return;
        (window as any)
          .__exec(JSON.parse(payload).command)
          .then((stdoutString: string) => this.onservicecallback(JSON.stringify({ returnValue: true, stdoutString })))
          .catch((e: Error) => this.onservicecallback(JSON.stringify({ returnValue: false, errorText: e.message })));
      }
      cancel() {}
    };
  }, server.url);
  await page.goto(appUrl);

  await expect.poll(() => commands.some((c) => /otr-mic\.sh' start --output tv --port 47830/.test(c))).toBe(true);
  // The token goes in the environment of the start, never in the URL or storage.
  expect(commands.find((c) => c.includes(' start '))).toMatch(/^OTR_TOKEN=[0-9a-f]{32} /);

  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.mic-status')).toHaveText(/Microphone ready|Micrófono listo/, { timeout: 10000 });
  const splash = page.frames().find((f) => f.url().includes('/splash'))!;
  await expect.poll(() => splash.evaluate(() => (window as any).recorded.useFeed.at(-1))).toBe(true);

  // Leaving stops the engine through the script.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => (window as any).__exited)).toBe(true);
  expect(commands.some((c) => /otr-mic\.sh' stop/.test(c))).toBe(true);
  const status = JSON.parse(execSync(`sh '${path.join(root, 'dist/app/otr-mic.sh')}' status`, { env: { ...process.env, OTR_TMP: tmp }, encoding: 'utf8' }));
  expect(status.running).toBe(false);
});
