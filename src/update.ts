/**
 * Knowing which build is running, and when a newer one is ready.
 *
 * The service worker updates itself silently: `skipWaiting()` in sw.js means a
 * new build takes over the cache while the already-loaded JS keeps running.
 * Without a word on screen, that is indistinguishable from nothing happening —
 * a resumed PWA can sit on last week's code all day. This module turns the
 * registration's `updatefound` into something the UI can subscribe to, and
 * reads the build id out of `asset-manifest.json` so Settings can show a
 * version a bug report can quote.
 */

let updateReady = false;
const listeners = new Set<() => void>();

export function subscribeUpdate(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function isUpdateReady(): boolean {
  return updateReady;
}

/** Watch a registration for a new worker installing behind the live one. */
export function watchForUpdates(registration: ServiceWorkerRegistration): void {
  registration.addEventListener('updatefound', () => {
    const worker = registration.installing;
    if (!worker) {
      return;
    }
    worker.addEventListener('statechange', () => {
      // "installed" while a controller exists is an update; without one it is
      // the very first install, which needs no announcement.
      if (worker.state === 'installed' && navigator.serviceWorker.controller) {
        updateReady = true;
        listeners.forEach(listener => listener());
      }
    });
  });
}

/**
 * The deployed build's id, from the manifest the build step writes. Null on
 * the dev server, which has no manifest — and null rather than a throw on any
 * failure, because a version row is diagnostics, never worth an error state.
 */
export async function fetchBuildId(): Promise<string | null> {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}asset-manifest.json`);
    if (!response.ok) {
      return null;
    }
    const {buildId} = (await response.json()) as {buildId?: unknown};
    return typeof buildId === 'string' ? buildId : null;
  } catch {
    return null;
  }
}
