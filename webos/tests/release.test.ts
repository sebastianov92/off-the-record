// The package checks and the Homebrew Channel manifest.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import { releaseManifest } from '../tools/release-manifest.mjs';

describe('release manifest', () => {
  const appinfo = { id: 'com.dezik.offtherecord', version: '0.1.0', type: 'web', title: 'Off the Record' };
  const manifest = releaseManifest({
    appinfo,
    repository: 'sebastianov92/pikaraoke',
    ipkName: 'com.dezik.offtherecord_0.1.0_all.ipk',
    ipkBytes: Buffer.from('ipk'),
  });

  it('points at the versioned release for the package', () => {
    assert.equal(
      manifest.ipkUrl,
      'https://github.com/sebastianov92/pikaraoke/releases/download/webos-v0.1.0/com.dezik.offtherecord_0.1.0_all.ipk',
    );
  });

  it('hashes the package and wants root', () => {
    assert.equal(manifest.ipkHash.sha256, createHash('sha256').update('ipk').digest('hex'));
    assert.equal(manifest.ipkSize, 3);
    assert.equal(manifest.rootRequired, true);
  });
});
