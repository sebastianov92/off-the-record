// Reads the IPK that ares-package wrote, checks it carries what the app needs and
// normalizes file modes: the CLI emits world-writable directories, and the engine
// and its script must stay executable. Adapted from LumiOS (tools/ipk.mjs at
// 8b5332c), with the required files and executables passed in.
import { gunzipSync, gzipSync } from 'node:zlib';

function members(bytes) {
  if (bytes.subarray(0, 8).toString() !== '!<arch>\n') throw new Error('Not an IPK/ar archive.');
  const result = [];
  for (let offset = 8; offset + 60 <= bytes.length; ) {
    const header = Buffer.from(bytes.subarray(offset, offset + 60));
    const size = Number(header.subarray(48, 58).toString().trim());
    if (!Number.isSafeInteger(size) || size < 0 || offset + 60 + size > bytes.length)
      throw new Error('Invalid IPK archive member.');
    result.push({
      header,
      name: header.subarray(0, 16).toString().trim().replace(/\/$/, ''),
      data: bytes.subarray(offset + 60, offset + 60 + size),
    });
    offset += 60 + size + (size % 2);
  }
  return result;
}

function entries(tar) {
  const result = [];
  for (let offset = 0; offset + 512 <= tar.length; ) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const text = (start, length) =>
      header
        .subarray(start, start + length)
        .toString()
        .replace(/\0.*$/, '');
    const size = parseInt(text(124, 12).trim(), 8) || 0;
    if (!Number.isSafeInteger(size) || size < 0 || offset + 512 + size > tar.length)
      throw new Error('Invalid package tar member.');
    const prefix = text(345, 155);
    result.push({
      header,
      name: (prefix ? `${prefix}/` : '') + text(0, 100),
      type: text(156, 1),
      data: tar.subarray(offset + 512, offset + 512 + size),
    });
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return result;
}

// executable(name): whether an app file needs mode 0755.
export function normalizeAndVerifyPackage(bytes, manifest, { required, executable }) {
  const archive = members(bytes);
  const member = archive.find((entry) => entry.name === 'data.tar.gz');
  if (!member || !archive.some((entry) => entry.name === 'control.tar.gz')) throw new Error('Incomplete IPK.');
  const tar = gunzipSync(member.data);
  const files = entries(tar);
  const owned = files.filter((file) => file.name.split('/').includes(manifest.id));
  if (!owned.length) throw new Error('The IPK contains no app directory.');
  const appinfo = owned.find((file) => file.name.endsWith('/appinfo.json'));
  const actual = appinfo && JSON.parse(appinfo.data.toString());
  if (actual?.id !== manifest.id || actual?.version !== manifest.version)
    throw new Error('Packaged app metadata does not match the source.');
  if (JSON.stringify(actual.requiredACG) !== JSON.stringify(manifest.requiredACG))
    throw new Error('Packaged app permissions do not match the source.');
  for (const name of required) {
    if (!owned.some((file) => file.name.endsWith(`/${name}`) && file.data.length > 0))
      throw new Error(`Package is missing ${name}.`);
  }
  const appRoot = `${manifest.id}/`;
  for (const file of owned) {
    if (!['', '0', '5'].includes(file.type)) throw new Error(`Unexpected package entry type: ${file.name}`);
    const inApp = file.name.slice(file.name.indexOf(appRoot) + appRoot.length);
    const mode = file.type === '5' || executable(inApp) ? '0000755\0' : '0000644\0';
    file.header.write(mode, 100, 8, 'ascii');
    file.header.fill(32, 148, 156);
    const sum = file.header.reduce((total, byte) => total + byte, 0);
    file.header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
  }
  member.data = gzipSync(tar, { level: 9 });
  const parts = [Buffer.from('!<arch>\n')];
  for (const entry of archive) {
    entry.header.write(String(entry.data.length).padEnd(10, ' '), 48, 10, 'ascii');
    parts.push(entry.header, entry.data);
    if (entry.data.length % 2) parts.push(Buffer.from('\n'));
  }
  console.log(`Verified IPK: ${owned.length} app entries; metadata, files and modes checked.`);
  return Buffer.concat(parts);
}

// Lists an IPK's app files with their modes, for tests and checks.
export function listPackage(bytes, manifest) {
  const archive = members(bytes);
  const tar = gunzipSync(archive.find((entry) => entry.name === 'data.tar.gz').data);
  const appRoot = `${manifest.id}/`;
  return entries(tar)
    .filter((file) => file.name.includes(appRoot))
    .map((file) => ({
      name: file.name.slice(file.name.indexOf(appRoot) + appRoot.length),
      mode: file.header.subarray(100, 107).toString(),
      size: file.data.length,
    }));
}
