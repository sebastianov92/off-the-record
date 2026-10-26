// Builds the app into dist/app: one classic script and stylesheet (no module
// fetches, so it runs from file:// on the TV), the icons and splash drawn from
// Off the Record's own logos, the engine's script and binaries when present.
// Adapted from LumiOS (tools/build.mjs at 8b5332c).
import fs from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import sharp from 'sharp';

const root = path.resolve(import.meta.dirname, '..');
const brand = path.resolve(root, '../pikaraoke/static/brand');
const output = path.join(root, 'dist', 'app');
const manifest = JSON.parse(await fs.readFile(path.join(root, 'appinfo.json'), 'utf8'));
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
if (pkg.version !== manifest.version) throw new Error('package.json and appinfo.json versions differ.');

await fs.rm(output, { recursive: true, force: true });
await fs.mkdir(output, { recursive: true });
await fs.cp(path.join(root, 'public'), output, {
  recursive: true,
  filter: (source) => path.basename(source) !== '.DS_Store',
});

await build({
  entryPoints: [path.join(root, 'src/main.tsx')],
  bundle: true,
  minify: true,
  outfile: path.join(output, 'app.js'),
  format: 'iife',
  target: ['chrome87'],
  jsx: 'automatic',
  define: {
    'process.env.NODE_ENV': '"production"',
    __APP_VERSION__: JSON.stringify(manifest.version),
  },
  external: ['/fonts/*'],
  legalComments: 'eof',
});
const cssPath = path.join(output, 'app.css');
const css = (await fs.readFile(cssPath, 'utf8')).replaceAll("url('/fonts/", "url('./fonts/").replaceAll('url(/fonts/', 'url(./fonts/');
await fs.writeFile(cssPath, css);

await fs.writeFile(path.join(output, 'appinfo.json'), JSON.stringify(manifest, null, 2) + '\n');

// Icons: the isologo; webOS paints the tile behind it (iconColor).
for (const [name, size] of [
  [manifest.icon, 80],
  [manifest.largeIcon, 130],
]) {
  await sharp(path.join(brand, 'isologo.svg'), { density: 600 }).resize(size, size).png().toFile(path.join(output, name));
}

// Splash: the logo on the karaoke screen's black, shown while the app starts.
const logo = await sharp(path.join(brand, 'logo-white.svg'), { density: 600 }).resize({ width: 900 }).png().toBuffer();
await sharp({ create: { width: 1920, height: 1080, channels: 3, background: '#050507' } })
  .composite([{ input: logo, gravity: 'center' }])
  .png()
  .toFile(path.join(output, manifest.splashBackground));

// The microphone engine: its wrapper script, and whichever binaries were built.
await fs.copyFile(path.join(root, 'tv', 'otr-mic.sh'), path.join(output, 'otr-mic.sh')).catch(() => {});
// The TV's copies of the next songs (Python, run by the TV's own python3).
for (const file of ['otr-files.sh', 'otr-files.py']) {
  await fs.copyFile(path.join(root, 'tv', file), path.join(output, file));
}
const engineDist = path.join(root, 'engine', 'dist');
for (const file of await fs.readdir(engineDist).catch(() => [])) {
  if (!file.startsWith('otr-mic-')) continue;
  await fs.mkdir(path.join(output, 'bin'), { recursive: true });
  await fs.copyFile(path.join(engineDist, file), path.join(output, 'bin', file));
  await fs.chmod(path.join(output, 'bin', file), 0o755);
}

const engineSocket = 'ws://127.0.0.1:47830';
// otr-files (tv/otr-files.py, song-cache.ts): the TV's copies of the next songs.
const filesServer = 'http://127.0.0.1:47831';
await fs.writeFile(
  path.join(output, 'index.html'),
  `<!doctype html>
<html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'self' data: blob:; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: http: https:; font-src 'self' data:; frame-src http: https:; connect-src ${engineSocket} ${filesServer}; object-src 'none'; base-uri 'none'"><title>${manifest.title}</title><link rel="stylesheet" href="./app.css"></head><body><div id="root"></div><script defer src="./app.js"></script></body></html>\n`,
);

const js = await fs.stat(path.join(output, 'app.js'));
const binaries = await fs.readdir(path.join(output, 'bin')).catch(() => []);
console.log(
  `Built ${manifest.title} ${manifest.version}: dist/app (${Math.round(js.size / 1024)} KB JavaScript, engine: ${binaries.join(', ') || 'none'})`,
);
