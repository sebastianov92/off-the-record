// The built app against a fake server that runs the real tv-bridge.js: the remote
// drives the music through the bridge, the password becomes a stored token, and
// the keys never get lost in the frame.
import { expect, test } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PASSWORD, startFakeServer, TOKEN } from './splash-server';
import type { FakeServer } from './splash-server';

const appUrl = pathToFileURL(path.resolve(import.meta.dirname, '../dist/app/index.html')).href;
let server: FakeServer;

async function openApp(page: import('@playwright/test').Page, tokens: Record<string, string> = {}) {
  await page.addInitScript(
    ([s, t]) => {
      if (!sessionStorage.getItem('seeded')) {
        localStorage.setItem('offtherecord.settings', JSON.stringify({ server: s, recent: [s], tokens: t }));
        sessionStorage.setItem('seeded', '1');
      }
    },
    [server.url, tokens] as const,
  );
  await page.goto(appUrl);
}

test.afterEach(async () => server?.close());

test('asks for the password, keeps only the token and then controls the music', async ({ page }) => {
  server = await startFakeServer();
  await openApp(page);
  const dialog = page.getByRole('dialog', { name: /password|contraseña/i });
  await expect(dialog).toBeVisible();
  await page.keyboard.type(PASSWORD);
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  const settings = await page.evaluate(() => JSON.parse(localStorage.getItem('offtherecord.settings')!));
  expect(Object.values(settings.tokens)).toEqual([TOKEN]);
  expect(JSON.stringify(settings)).not.toContain(PASSWORD);

  // OK opens the dock on Pause; OK again pauses.
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expect.poll(() => server.calls.map((c) => c.path)).toContain('/api/pause');
  expect(server.calls.find((c) => c.path === '/api/pause')!.token).toBe(TOKEN);
});

test('a stored token opens the controls without asking', async ({ page }) => {
  server = await startFakeServer();
  await openApp(page, { [server.url]: TOKEN });
  await page.waitForTimeout(1500);
  await expect(page.getByRole('dialog', { name: /password|contraseña/i })).toHaveCount(0);
  await page.keyboard.press('ArrowDown'); // opens the dock
  await page.keyboard.press('ArrowDown'); // music
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => server.calls.map((c) => c.path)).toContain('/api/volume/0.75');
});

test('skip wants a second press', async ({ page }) => {
  server = await startFakeServer({ password: false });
  await openApp(page);
  await page.waitForTimeout(1000);
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  expect(server.calls.some((c) => c.path === '/api/skip')).toBe(false);
  await page.keyboard.press('Enter');
  await expect.poll(() => server.calls.map((c) => c.path)).toContain('/api/skip');
});

test('keys stay with the app and Back asks before leaving', async ({ page }) => {
  server = await startFakeServer({ password: false });
  await openApp(page);
  await page.waitForTimeout(1000);
  for (const key of ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'Enter', 'Escape', 'Tab', 'ArrowRight']) {
    await page.keyboard.press(key);
    expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('IFRAME');
  }
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
});

test('the splash reports what is playing into the dock', async ({ page }) => {
  server = await startFakeServer({ password: false });
  await openApp(page);
  await page.waitForTimeout(1000);
  await page.keyboard.press('Enter');
  await expect(page.locator('.now-title')).toHaveText('Song');
  await expect(page.locator('.now-singer')).toHaveText('Ana');
});
