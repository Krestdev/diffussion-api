/**
 * Writes manifest.json's version from the permission catalogue's (CATALOG_VERSION) and removes
 * what the manifest no longer carries. The manifest only gives context (which app, where it
 * opens, which API to call): Diffusion's permissions, roles and default roles live in its API
 * (src/auth/permissions.ts), which the core's console reads live through the app-admin API.
 *
 *   npm run manifest:sync
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CATALOG_VERSION } from '../src/auth/permissions';

const file = join(__dirname, '..', 'manifest.json');
const manifest = JSON.parse(readFileSync(file, 'utf8')) as Record<
  string,
  unknown
>;

for (const gone of ['permissions', 'defaultRoles', 'implies', 'replaces']) {
  delete manifest[gone];
}
if (typeof manifest.apiUrl !== 'string') {
  throw new Error(
    'manifest.json needs apiUrl (the address of Diffusion’s API)',
  );
}
manifest.version = CATALOG_VERSION;

writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`manifest.json ${CATALOG_VERSION}`);
