// Types for the tests, which import release-manifest.mjs.
export interface ReleaseManifest {
  id: string;
  version: string;
  type: string;
  title: string;
  appDescription: string;
  iconUri: string;
  sourceUrl: string;
  rootRequired: boolean;
  ipkUrl: string;
  ipkHash: { sha256: string };
  ipkSize: number;
}

export function releaseManifest(input: {
  appinfo: { id: string; version: string; type: string; title: string };
  repository: string;
  ipkName: string;
  ipkBytes: Uint8Array;
}): ReleaseManifest;
