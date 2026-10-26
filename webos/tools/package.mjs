// Packages dist/app into the IPK with the webOS CLI, then checks and normalizes it.
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { normalizeAndVerifyPackage } from './ipk.mjs';

const root = path.resolve(import.meta.dirname, '..');
const manifest = JSON.parse(await fs.readFile(path.join(root, 'appinfo.json'), 'utf8'));
const out = path.join(root, 'dist');
const state = path.join(root, '.build', 'cli-state');
await fs.mkdir(state, { recursive: true });
const cli = path.join(root, 'node_modules/@webos-tools/cli/bin/ares-package.js');
const result = spawnSync(process.execPath, [cli, '--no-minify', '--outdir', out, path.join(out, 'app')], {
  cwd: root,
  env: { ...process.env, APPDATA: state },
  encoding: 'utf8',
  timeout: 120000,
});
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

const filename = `${manifest.id}_${manifest.version}_all.ipk`;
const bytes = normalizeAndVerifyPackage(await fs.readFile(path.join(out, filename)), manifest, {
  required: ['index.html', 'app.js', 'app.css', manifest.icon, manifest.largeIcon, manifest.splashBackground, 'otr-mic.sh', 'otr-files.sh', 'otr-files.py', 'fonts/inter-latin.woff2', 'logo-white.svg'],
  executable: (name) => name.endsWith('.sh') || name.startsWith('bin/'),
});
await fs.writeFile(path.join(out, filename), bytes);
const hash = createHash('sha256').update(bytes).digest('hex');
await fs.writeFile(path.join(out, 'sha256sums'), `${hash}  ${filename}\n`);
console.log(`\nReady to install: dist/${filename}\nSHA-256: ${hash}`);
