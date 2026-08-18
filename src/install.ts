/**
 * Installation state.
 *
 * The single most confusing thing about a web app is that it looks like a
 * website until it is installed, and the reasons it *cannot* be installed are
 * invisible. This module works out which of those situations the user is in so
 * the UI can say so plainly, rather than leaving them to wonder why there is
 * still an address bar.
 *
 * The `beforeinstallprompt` listener is registered at module load, before React
 * mounts: Chrome fires it once, early, and an event missed is an Install button
 * that never appears.
 */

export type Platform = 'ios' | 'android' | 'desktop';

export type InstallState =
  /** Already running from a home-screen icon — nothing to offer. */
  | {kind: 'installed'}
  /** Chrome has offered us its native prompt; we can trigger it on a tap. */
  | {kind: 'promptable'}
  /** iOS has no prompt API at all; the Share menu is the only route. */
  | {kind: 'ios-manual'}
  /** Not a secure context, so installation is impossible for a real reason. */
  | {kind: 'needs-https'}
  /** Installable in principle, but this browser gives us no hook. */
  | {kind: 'manual'};

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{outcome: 'accepted' | 'dismissed'}>;
}

const DISMISSED_KEY = 'indico-schedule:install-dismissed';

let deferredPrompt: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

/**
 * The current state, cached.
 *
 * `useSyncExternalStore` compares snapshots by identity, so a getter that built
 * a fresh object on every call would report a change on every render and spin
 * forever. Nothing here changes without one of the events below firing, so
 * caching is both safe and required.
 */
let cachedState: InstallState | null = null;

function announce() {
  cachedState = null;
  listeners.forEach(listener => listener());
}

window.addEventListener('beforeinstallprompt', event => {
  // Without preventDefault Chrome shows its own mini-infobar, which competes
  // with our card and cannot be styled or placed.
  event.preventDefault();
  deferredPrompt = event as BeforeInstallPromptEvent;
  announce();
});

window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  announce();
});

export function subscribeInstall(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Running from a home-screen icon rather than in a browser tab. */
export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    // Safari's own, predating the standard media query and still the only
    // reliable signal on iOS.
    (navigator as {standalone?: boolean}).standalone === true
  );
}

export function detectPlatform(): Platform {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) {
    return 'ios';
  }
  // iPadOS 13+ reports itself as a Mac; touch points are what give it away.
  if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) {
    return 'ios';
  }
  if (/Android/i.test(ua)) {
    return 'android';
  }
  return 'desktop';
}

function computeInstallState(): InstallState {
  if (isStandalone()) {
    return {kind: 'installed'};
  }
  if (deferredPrompt) {
    return {kind: 'promptable'};
  }
  if (!window.isSecureContext) {
    return {kind: 'needs-https'};
  }
  if (detectPlatform() === 'ios') {
    return {kind: 'ios-manual'};
  }
  return {kind: 'manual'};
}

export function getInstallState(): InstallState {
  if (cachedState === null) {
    cachedState = computeInstallState();
  }
  return cachedState;
}

/** Trigger Chrome's native install dialog. Returns true if the user accepted. */
export async function promptInstall(): Promise<boolean> {
  if (!deferredPrompt) {
    return false;
  }
  const prompt = deferredPrompt;
  // The event is single-use: whatever the outcome, it cannot be shown twice.
  deferredPrompt = null;
  await prompt.prompt();
  const {outcome} = await prompt.userChoice;
  announce();
  return outcome === 'accepted';
}

export function isDismissed(): boolean {
  return localStorage.getItem(DISMISSED_KEY) === '1';
}

export function dismiss(): void {
  localStorage.setItem(DISMISSED_KEY, '1');
  announce();
}

export function undismiss(): void {
  localStorage.removeItem(DISMISSED_KEY);
  announce();
}
