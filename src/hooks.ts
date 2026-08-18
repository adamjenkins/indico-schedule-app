/**
 * Reading stored data into components.
 *
 * Every hook here follows the same rule: render from the local copy, always.
 * The network writes to IndexedDB and bumps a revision counter; these hooks
 * notice and re-read. Nothing renders straight from a fetch, which is what
 * makes "offline" an ordinary state rather than a special case.
 */
import {useEffect, useState, useSyncExternalStore} from 'react';

import {objectUrlFor} from './blobUrls';
import {
  getEvent,
  getEventDays,
  listSponsors,
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


/** A sponsor's mark on a talk: the logo to draw and whose it is. */
export interface SponsorMark {
  url: string;
  name: string;
}

/** The key a mark is stored under: contribution ids only mean something inside
 * their own event, and search results mix events freely. */
export const markKey = (eventId: number, contributionId: number) => `${eventId}|${contributionId}`;

/**
 * Which talks carry a sponsor's logo.
 *
 * Built from the stored sponsor records for every event at once, so one hook
 * serves the schedule, the agenda and search — the last of which mixes events
 * and could not use a per-event one. Works offline like everything else,
 * because it reads what is on the device.
 *
 * Where several sponsors are attached to the same talk only the first is
 * marked: a row is a row, and stacking logos into it would cost more than the
 * second sponsor is worth. The sponsors block on the schedule is where every
 * sponsor is listed.
 */
export function useSponsorMarks(): Map<string, SponsorMark> {
  const {data: records} = useStored(() => listSponsors(), []);
  const marks = new Map<string, SponsorMark>();
  for (const record of records ?? []) {
    for (const sponsor of record.payload.sponsors) {
      const source = sponsor.logo_url ?? sponsor.square_logo_url;
      const blob = source ? record.logos[source] : undefined;
      if (!source || !blob) {
        continue;
      }
      for (const contributionId of sponsor.contribution_ids ?? []) {
        const key = markKey(record.eventId, contributionId);
        if (!marks.has(key)) {
          marks.set(key, {url: objectUrlFor(source, blob), name: sponsor.name});
        }
      }
    }
  }
  return marks;
}
