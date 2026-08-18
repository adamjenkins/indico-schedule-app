/**
 * Package a built dist/ into a tarball ready to copy to the server.
 *
 * The archive holds the files at its own root (no `dist/` prefix), so
 * unpacking it straight into the target directory gives the right shape:
 *
 *   tar xzf schedule-app-<build>.tar.gz -C /srv/schedule-app
 *
 * `.vite/` is left out — it is build metadata the runtime never reads.
 */
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync, readdirSync, statSync, unlinkSync} from 'node:fs';
import {join} from 'node:path';

const DIST = 'dist';
const manifestPath = join(DIST, 'asset-manifest.json');

let buildId;
try {
  buildId = JSON.parse(readFileSync(manifestPath, 'utf8')).buildId;
} catch {
  console.error(`${manifestPath} is missing — run \`npm run build\` first`);
  process.exit(1);
}

// A leftover placeholder means the worker would never update on clients, which
// is not something to discover after copying it to a server.
if (readFileSync(join(DIST, 'sw.js'), 'utf8').includes('__BUILD_ID__')) {
  console.error('dist/sw.js still has its placeholder build id');
  process.exit(1);
}

for (const name of readdirSync('.')) {
  if (/^schedule-app-.*\.tar\.gz$/.test(name)) {
    unlinkSync(name);
  }
}

const archive = `schedule-app-${buildId}.tar.gz`;
execFileSync('tar', ['--exclude=.vite', '-czf', archive, '-C', DIST, '.']);

const sha = createHash('sha256').update(readFileSync(archive)).digest('hex');
const kb = Math.round(statSync(archive).size / 1024);

console.log(`\n${archive}  (${kb} kB)`);
console.log(`sha256  ${sha}`);
console.log(`\nCopy it to the server and unpack into the web root:`);
console.log(`  scp ${archive} <server>:/tmp/`);
console.log(`  sudo mkdir -p /srv/schedule-app`);
console.log(`  sudo tar xzf /tmp/${archive} -C /srv/schedule-app`);
console.log(`  sudo chown -R root:root /srv/schedule-app && sudo chmod -R a+rX /srv/schedule-app`);
console.log(`\nThen the nginx blocks in deploy/nginx-schedule-app.conf (first time only).`);
