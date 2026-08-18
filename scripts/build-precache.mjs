/**
 * Post-build step: tell the service worker what to precache.
 *
 * Runs after `vite build` and does two things:
 *   1. turns Vite's manifest into a flat list of URLs the worker precaches
 *   2. stamps a build id into `sw.js`
 *
 * The build id is a hash of that list rather than a timestamp, so rebuilding
 * unchanged sources produces a byte-identical worker. That matters: the browser
 * decides whether to install a new worker by comparing bytes, and a timestamp
 * would make every deploy look like a change and churn every client's cache.
 */
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

const BASE = '/schedule-app/';
const DIST = join(process.cwd(), 'dist');

// Files that are not in Vite's manifest but must still work offline.
const EXTRA = ['manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png'];

const manifest = JSON.parse(readFileSync(join(DIST, '.vite', 'manifest.json'), 'utf8'));

const assets = new Set();
for (const entry of Object.values(manifest)) {
  if (entry.file) {
    assets.add(entry.file);
  }
  for (const css of entry.css ?? []) {
    assets.add(css);
  }
  for (const asset of entry.assets ?? []) {
    assets.add(asset);
  }
}

const files = [...assets, ...EXTRA].sort().map(path => `${BASE}${path}`);
const buildId = createHash('sha256').update(files.join('\n')).digest('hex').slice(0, 12);

writeFileSync(join(DIST, 'asset-manifest.json'), `${JSON.stringify({buildId, files}, null, 2)}\n`);

const swPath = join(DIST, 'sw.js');
const sw = readFileSync(swPath, 'utf8');
const PLACEHOLDER = /__BUILD_ID__/g;
if (!PLACEHOLDER.test(sw)) {
  throw new Error('sw.js has no build-id placeholder — the worker would never update');
}
const stamped = sw.replace(PLACEHOLDER, buildId);
// Replacing every occurrence rather than the first: the placeholder has lived
// in a comment as well as in the constant, and a first-only replace silently
// stamped the comment and left the worker pinned to a literal id forever.
if (stamped.includes('__BUILD_ID__')) {
  throw new Error('build id was not fully substituted into sw.js');
}
writeFileSync(swPath, stamped);

console.log(`precache: ${files.length} files, build ${buildId}`);
