import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';

// Where the app is mounted on the Indico host. Everything — the manifest's
// start_url, the service worker's scope, the router's base — derives from this
// one value, so moving the app is a one-line change.
const BASE = '/schedule-app/';

// In development the app runs on localhost (a secure context, so the service
// worker registers) and the Indico API is proxied through the dev server. That
// reproduces production's single-origin arrangement, which is the whole point:
// the app never makes a cross-origin request, in dev or in production.
const INDICO = process.env.INDICO_URL || 'http://indico.wisecat.net';

// Every Indico path the app touches. In production these are simply the same
// origin; in development they have to be listed, and an endpoint missing from
// here fails only in dev — which is a confusing way to lose an afternoon.
const proxy = Object.fromEntries(
  [
    '/event',
    '/login',
    '/logout',
    '/api',
    '/export',
    '/search',
    '/category',
    // The logo is read out of Indico's page header, and then fetched from
    // wherever that header points — the built-in images, or a site's own
    // customisation directory.
    '/images',
    '/static',
    // Exactly the home page: a proxy key beginning with `^` is treated as a
    // regular expression, which is the only way to forward `/` without also
    // swallowing `/schedule-app/` and the app's own assets.
    '^/$',
  ].map(path => [path, {target: INDICO, changeOrigin: true}])
);

export default defineConfig({
  base: BASE,
  plugins: [react()],
  build: {
    manifest: true,
    outDir: 'dist',
    // The service worker precaches by exact URL, so a stray unhashed asset
    // would silently serve stale forever. Keep everything content-hashed.
    assetsDir: 'assets',
  },
  server: {port: 5173, proxy},
  preview: {port: 4173, proxy},
});
