/**
 * A router, sized to five screens.
 *
 * Hand-rolled rather than a dependency: the whole surface is five URL shapes,
 * and a routing library would be a larger download than the app's own code.
 * Real paths rather than hash fragments, so a filtered view is a normal
 * shareable link — which is also why nginx needs the `try_files` fallback and
 * the service worker answers navigations with the cached shell.
 */
import {useCallback, useSyncExternalStore} from 'react';

export const BASE = '/schedule-app/';

export type Route =
  | {name: 'events'}
  | {name: 'schedule'; eventId: number; day: string | null; search: string}
  | {name: 'talk'; eventId: number; day: string; contributionId: number}
  | {name: 'agenda'}
  | {name: 'search'; query: string}
  | {name: 'settings'}
  | {name: 'notfound'; path: string};

export function parseRoute(pathname: string, search: string): Route {
  const path = pathname.startsWith(BASE) ? pathname.slice(BASE.length) : pathname.replace(/^\//, '');
  const parts = path.split('/').filter(Boolean);

  if (parts.length === 0) {
    return {name: 'events'};
  }
  if (parts[0] === 'agenda') {
    return {name: 'agenda'};
  }
  if (parts[0] === 'settings') {
    return {name: 'settings'};
  }
  if (parts[0] === 'search') {
    return {name: 'search', query: new URLSearchParams(search).get('q') ?? ''};
  }
  if (parts[0] === 'event' && parts[1]) {
    const eventId = parseInt(parts[1], 10);
    if (!Number.isFinite(eventId)) {
      return {name: 'notfound', path: pathname};
    }
    // /event/:id/:day/talk/:contributionId
    if (parts[2] && parts[3] === 'talk' && parts[4]) {
      const contributionId = parseInt(parts[4], 10);
      if (Number.isFinite(contributionId)) {
        return {name: 'talk', eventId, day: parts[2], contributionId};
      }
    }
    return {name: 'schedule', eventId, day: parts[2] ?? null, search};
  }
  return {name: 'notfound', path: pathname};
}

export function href(path: string, search = ''): string {
  return `${BASE}${path.replace(/^\//, '')}${search}`;
}

// -- reactivity -----------------------------------------------------------

const listeners = new Set<() => void>();
let snapshot = location.pathname + location.search;

function announce() {
  const next = location.pathname + location.search;
  if (next !== snapshot) {
    snapshot = next;
    listeners.forEach(listener => listener());
  }
}

window.addEventListener('popstate', announce);

export function navigate(to: string, options: {replace?: boolean} = {}): void {
  const url = to.startsWith('/') ? to : href(to);
  if (url === location.pathname + location.search) {
    return;
  }
  history[options.replace ? 'replaceState' : 'pushState'](null, '', url);
  announce();
}

/**
 * Update the query string without adding a history entry. Ticking filter
 * checkboxes should leave the URL shareable but must not bury the back button
 * under a pile of intermediate states.
 */
export function replaceSearch(search: string): void {
  history.replaceState(null, '', location.pathname + search);
  snapshot = location.pathname + search;
  listeners.forEach(listener => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): string {
  return snapshot;
}

export function useRoute(): Route {
  const current = useSyncExternalStore(subscribe, getSnapshot);
  const [pathname, search] = current.split('?');
  return parseRoute(pathname ?? BASE, search ? `?${search}` : '');
}

export function useNavigate(): (to: string, options?: {replace?: boolean}) => void {
  return useCallback((to: string, options?: {replace?: boolean}) => navigate(to, options), []);
}

export function goBack(fallback: string = BASE): void {
  if (history.length > 1) {
    history.back();
  } else {
    navigate(fallback, {replace: true});
  }
}
