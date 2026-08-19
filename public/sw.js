/*
 * Service worker.
 *
 * Scope is narrow on purpose. It caches the app shell and its hashed assets so
 * the app can start with no connection, and it does NOT cache the Indico API —
 * the app keeps schedule data in IndexedDB, where it can also be searched, and
 * a second copy here would only fight it (and quietly break conditional
 * requests).
 *
 * The build id below is stamped in by scripts/build-precache.mjs with a hash of
 * the asset list, so the worker's bytes change exactly when the assets do. The
 * browser then picks up a new deploy by itself, and an unchanged rebuild does
 * not churn every client's cache.
 */
const BUILD_ID = '__BUILD_ID__';
const CACHE = `schedule-shell-${BUILD_ID}`;
const BASE = '/schedule-app/';
const SHELL = BASE;

self.addEventListener('install', event => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // The asset list is generated at build time rather than hard-coded, so
      // adding a file cannot silently leave it out of the offline bundle.
      const response = await fetch(`${BASE}asset-manifest.json`, {cache: 'no-store'});
      const {files} = await response.json();
      // `cache: 'reload'` bypasses the HTTP cache. The shell URL is the one
      // entry that is not content-hashed, and precaching a heuristically-fresh
      // stale copy of it would pin this cache to assets the deploy that
      // triggered this install has already deleted — a blank app that cannot
      // self-heal, because navigations are answered from this cache.
      await cache.addAll([SHELL, ...files].map(url => new Request(url, {cache: 'reload'})));
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter(name => name.startsWith('schedule-shell-') && name !== CACHE).map(name => caches.delete(name))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', event => {
  const {request} = event;
  if (request.method !== 'GET') {
    return;
  }
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  // Navigations are answered from the cached shell. That is what makes a cold
  // start work offline, and it is also what makes deep links work: the server
  // never has to know the app's own routes.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cached = await caches.match(SHELL);
        if (cached) {
          return cached;
        }
        try {
          return await fetch(request);
        } catch {
          return new Response('Offline, and this app has not been saved yet.', {
            status: 503,
            headers: {'Content-Type': 'text/plain'},
          });
        }
      })()
    );
    return;
  }

  // App assets: cache-first, safely, because every one of them is
  // content-hashed — a changed file is a changed URL.
  if (url.pathname.startsWith(BASE)) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request);
        if (cached) {
          return cached;
        }
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(CACHE);
          cache.put(request, response.clone());
        }
        return response;
      })()
    );
  }

  // Anything else — every Indico API call — is left entirely alone.
});
