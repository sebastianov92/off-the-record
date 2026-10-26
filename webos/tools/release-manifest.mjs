// Writes the Homebrew Channel manifest for this build. LumiOS's repo.json lists
// the app with a manifestUrl pointing at the fixed "webos-feed" release of this
// repository, where CI uploads this file; the IPK itself sits on the versioned
// release webos-v<version>.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const root = path.resolve(import.meta.dirname, '..');
const manifest = JSON.parse(await fs.readFile(path.join(root, 'appinfo.json'), 'utf8'));
const repository = process.env.GITHUB_REPOSITORY || 'sebastianov92/pikaraoke';
const tag = `webos-v${manifest.version}`;
if (process.env.RELEASE_TAG && process.env.RELEASE_TAG !== tag)
  throw new Error(`RELEASE_TAG ${process.env.RELEASE_TAG} does not match ${tag}.`);

export function releaseManifest({ appinfo, repository, ipkName, ipkBytes }) {
  const base = `https://github.com/${repository}/releases/download`;
  return {
    id: appinfo.id,
    version: appinfo.version,
    type: appinfo.type,
    title: appinfo.title,
    appDescription:
      'Karaoke screen for Off the Record, with remote controls and a USB microphone with voice processing.',
    iconUri: `${base}/webos-feed/${appinfo.id}.png`,
    sourceUrl: `https://github.com/${repository}/tree/karaoke-ai/webos`,
    rootRequired: true,
    ipkUrl: `${base}/webos-v${appinfo.version}/${ipkName}`,
    ipkHash: { sha256: createHash('sha256').update(ipkBytes).digest('hex') },
    ipkSize: ipkBytes.length,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const ipkName = `${manifest.id}_${manifest.version}_all.ipk`;
  const ipkBytes = await fs.readFile(path.join(root, 'dist', ipkName));
  const out = releaseManifest({ appinfo: manifest, repository, ipkName, ipkBytes });
  await fs.writeFile(path.join(root, 'dist', `${manifest.id}.manifest.json`), JSON.stringify(out, null, 2) + '\n');
  await fs.copyFile(path.join(root, 'dist', 'app', manifest.largeIcon), path.join(root, 'dist', `${manifest.id}.png`));
  if (process.env.GITHUB_OUTPUT) await fs.appendFile(process.env.GITHUB_OUTPUT, `tag=${tag}\n`);
  console.log(`Manifest for ${tag}: dist/${manifest.id}.manifest.json`);
}
