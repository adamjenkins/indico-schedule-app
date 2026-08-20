/**
 * Knowing which build is running, noticing when a newer one is ready, and —
 * the part that is easy to leave out — asking the question in the first place.
 *
 * A service worker only re-fetches `sw.js` when something triggers an update
 * check, and the only trigger this app owned was `register()` in a `load`
 * listener. `load` needs a navigation, and an installed PWA resumed from the
 * app switcher does not navigate: it restores the web view it already had. A
 * phone that is never fully relaunched therefore sat on whatever build it
 * first installed, indefinitely, which is exactly what happened on staging.
 *
 * So the check also runs on resume, and what happens next depends on when the
 * new build lands:
 *
 *   - just after a resume, the page reloads itself silently — the user has not
 *     started reading anything yet, and it is how a native app would have
 *     updated itself while it was away;
 *   - mid-session, the banner goes up instead, because yanking the page out
 *     from under someone reading a talk is worse than being one tap stale.
 *
 * The route and the scroll position both survive a reload (the router reads
 * the URL, and the list restores its offset), so the silent path costs the
 * user nothing but a flicker.
 */

/** Floor on how often a foreground check may ask the server about `sw.js`. */
const CHECK_INTERVAL_MS = 60_000;

/**
 * How long after a resume an arriving build still counts as "part of coming
 * back", and so reloads silently. It has to cover a check, a download of the
 * whole shell and a worker activation on conference wifi, which is slower than
 * it sounds — but not so long that it swallows an ordinary mid-session update.
 */
const RESUME_GRACE_MS = 30_000;

/** States at or past the point where a new worker has the new build in hand. */
const INSTALLED = new Set(['installed', 'activating', 'activated']);

let updateReady = false;
let registration: ServiceWorkerRegistration | null = null;
/**
 * Whether this page was already controlled when the module subscribed, which is
 * what separates an update from a first install. Read once and never updated:
 * `clients.claim()` sets a controller partway through the very first
 * activation, so a *live* `navigator.serviceWorker.controller` test says "there
 * is a controller" for the rest of that first install and raises the banner on
 * a brand-new device.
 */
let hadController = false;
/** Whether the first `controllerchange` — the initial claim — has been seen. */
let controlled = false;
let lastCheckAt = 0;
let lastResumeAt = 0;
let reloading = false;
const listeners = new Set<() => void>();

export function subscribeUpdate(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function isUpdateReady(): boolean {
  return updateReady;
}

function announce(): void {
  if (updateReady) {
    return;
  }
  updateReady = true;
  listeners.forEach(listener => listener());
}

/**
 * Every signal below is deliberately redundant with the others — missing one is
 * how this broke — so the reload has to be idempotent or a race reloads twice.
 */
function reloadOnce(): void {
  if (reloading) {
    return;
  }
  reloading = true;
  window.location.reload();
}

/** A new build now owns the cache: reload for it, or offer it. */
function newBuildReady(): void {
  if (Date.now() - lastResumeAt < RESUME_GRACE_MS) {
    reloadOnce();
    return;
  }
  announce();
}

function watchWorker(worker: ServiceWorker | null): void {
  if (!worker) {
    return;
  }
  const settle = (): void => {
    // `hadController`, not a live controller test: the first install passes
    // through `activated` with a controller already claimed, and reading it
    // live announced an update to someone who had just arrived.
    if (INSTALLED.has(worker.state) && hadController) {
      newBuildReady();
    }
  };
  worker.addEventListener('statechange', settle);
  settle();
}

/**
 * Ask whether `sw.js` changed. Throttled, because a phone is picked up and put
 * down dozens of times an hour and every one of those is a resume.
 *
 * `resumed` is recorded even when the check itself is throttled away: a check
 * fired seconds ago can land now, and it is still the user coming back.
 */
function checkForUpdate(resumed: boolean): void {
  const now = Date.now();
  if (resumed) {
    lastResumeAt = now;
  }
  if (!registration || now - lastCheckAt < CHECK_INTERVAL_MS) {
    return;
  }
  lastCheckAt = now;
  // Rejects when offline, which is not a failure worth reporting: the app is
  // built to run from cache, and the next resume asks again.
  void registration.update().catch(() => undefined);
}

/** Watch a registration for a new worker, and keep asking for one. */
export function watchForUpdates(reg: ServiceWorkerRegistration): void {
  registration = reg;
  hadController = controlled = Boolean(navigator.serviceWorker.controller);
  // `register()` schedules a check of its own, so the throttle starts spent.
  lastCheckAt = Date.now();

  reg.addEventListener('updatefound', () => watchWorker(reg.installing));

  // The check the navigation itself triggered can beat this module into place,
  // firing `updatefound` before there is anything listening. Picking up what is
  // already in flight is what stops that race from swallowing an update
  // silently — the failure mode being a banner that simply never appears.
  watchWorker(reg.installing ?? reg.waiting);

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // With `skipWaiting()` and `clients.claim()` in the worker, this is the
    // moment a new build takes over a running page. The first one is only this
    // page being claimed by its first worker.
    if (!controlled) {
      controlled = true;
      return;
    }
    newBuildReady();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      checkForUpdate(true);
    }
  });

  // A restore from the back/forward cache runs no JS and fires no
  // `visibilitychange`, but is just as much a resume.
  window.addEventListener('pageshow', event => {
    if (event.persisted) {
      checkForUpdate(true);
    }
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
