/**
 * Reading stored data into components.
 *
 * Every hook here follows the same rule: render from the local copy, always.
 * The network writes to IndexedDB and bumps a revision counter; these hooks
 * notice and re-read. Nothing renders straight from a fetch, which is what
 * makes "offline" an ordinary state rather than a special case.
 */
import {useEffect, useState, useSyncExternalStore} from 'react';

import {
  getEvent,
  getEventDays,
  listEvents,
  listStars,
  StoredDay,
  StoredEvent,
  StoredStar,
} from './db';
import {getRevision, subscribe} from './store';

export function useRevision(): number {
  return useSyncExternalStore(subscribe, getRevision);
}

export interface Loaded<T> {
  data: T | null;
  loading: boolean;
}

/** Run an async read, and run it again whenever stored data changes. */
export function useStored<T>(load: () => Promise<T>, deps: unknown[]): Loaded<T> {
  const revision = useRevision();
  const [state, setState] = useState<Loaded<T>>({data: null, loading: true});

  useEffect(() => {
    let live = true;
    // Deliberately not clearing `data` first: a refresh should update the
    // screen in place, not blank it out and flash a spinner.
    setState(previous => ({data: previous.data, loading: true}));
    load().then(
      data => live && setState({data, loading: false}),
      () => live && setState({data: null, loading: false})
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision, ...deps]);

  return state;
}

export function useEvents(): Loaded<StoredEvent[]> {
  return useStored(() => listEvents(), []);
}

export function useEventRecord(eventId: number): Loaded<StoredEvent | undefined> {
  return useStored(() => getEvent(eventId), [eventId]);
}

export function useEventDays(eventId: number): Loaded<StoredDay[]> {
  return useStored(() => getEventDays(eventId), [eventId]);
}

export function useStars(eventId?: number): Loaded<StoredStar[]> {
  return useStored(() => listStars(eventId), [eventId]);
}

/** Starred contribution ids for one event, as a set for cheap lookups. */
export function useStarSet(eventId?: number): Set<number> {
  const {data} = useStars(eventId);
  return new Set((data ?? []).map(star => star.contributionId));
}

/** Whether the browser currently believes it has a connection. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}

/** Re-render on a timer, so relative timestamps ("2 min ago") stay honest. */
export function useTicker(intervalMs = 30_000): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setTick(t => t + 1), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
}
