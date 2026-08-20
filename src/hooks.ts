/**
 * Reading stored data into components.
 *
 * Every hook here follows the same rule: render from the local copy, always.
 * The network writes to IndexedDB and bumps a revision counter; these hooks
 * notice and re-read. Nothing renders straight from a fetch, which is what
 * makes "offline" an ordinary state rather than a special case.
 */
import {useEffect, useMemo, useState, useSyncExternalStore} from 'react';

import {objectUrlFor} from './blobUrls';
import {
  getEvent,
  getEventDays,
  getSponsors,
  listSponsors,
  listEvents,
  listStars,
  StoredDay,
  StoredEvent,
  StoredStar,
} from './db';
import {Channel, getRevision, getSyncStatus, subscribe, SyncStatus} from './store';
import {SponsorEntry, SponsorsPayload} from './types';

/** The combined revision of the named channels; every channel when unnamed. */
export function useRevision(channels?: readonly Channel[]): number {
  return useSyncExternalStore(subscribe, () => getRevision(channels));
}

/** An event's sync status, re-rendering when any status changes. */
export function useSyncStatus(eventId: number): SyncStatus {
  return useSyncExternalStore(subscribe, () => getSyncStatus(eventId));
}

export interface Loaded<T> {
  data: T | null;
  loading: boolean;
  /**
   * Set when the read itself failed — storage refusing to answer, not data
   * being absent. The two must stay distinguishable: "you have no events" and
   * "this device will not let the app read its events" call for opposite
   * advice, and collapsing the second into the first tells the user to re-add
   * everything into a store that is broken.
   */
  error: unknown;
}

/**
 * Run an async read, and run it again whenever the stored data it reads from
 * changes. `channels` names which stores those are; a hook that leaves it off
 * re-reads on *every* change, so naming them is what keeps a star tap from
 * re-reading megabytes of cached days it never touches.
 */
export function useStored<T>(
  load: () => Promise<T>,
  deps: unknown[],
  channels?: readonly Channel[]
): Loaded<T> {
  const revision = useRevision(channels);
  const [state, setState] = useState<Loaded<T>>({data: null, loading: true, error: null});

  useEffect(() => {
    let live = true;
    // Deliberately not clearing `data` first: a refresh should update the
    // screen in place, not blank it out and flash a spinner.
    setState(previous => ({data: previous.data, loading: true, error: previous.error}));
    load().then(
      data => live && setState({data, loading: false, error: null}),
      (error: unknown) => live && setState({data: null, loading: false, error})
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision, ...deps]);

  return state;
}

export function useEvents(): Loaded<StoredEvent[]> {
  return useStored(() => listEvents(), [], ['events']);
}

export function useEventRecord(eventId: number): Loaded<StoredEvent | undefined> {
  return useStored(() => getEvent(eventId), [eventId], ['events']);
}

export function useEventDays(eventId: number): Loaded<StoredDay[]> {
  return useStored(() => getEventDays(eventId), [eventId], ['days']);
}

export function useStars(eventId?: number): Loaded<StoredStar[]> {
  return useStored(() => listStars(eventId), [eventId], ['stars']);
}

/** Starred contribution ids for one event, as a set for cheap lookups. */
export function useStarSet(eventId?: number): Set<number> {
  const {data} = useStars(eventId);
  // Memoised so an unrelated re-render does not hand every memoised row a
  // fresh Set and defeat its bail-out.
  return useMemo(() => new Set((data ?? []).map(star => star.contributionId)), [data]);
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


/** A sponsor's mark on a talk: the logo to draw, whose it is, and how wide the
 * event manager asked for it to be. */
export interface SponsorMark {
  url: string;
  name: string;
  /**
   * The configured width and its unit, both absent together when the event's
   * payload carried no `contribution_marks` at all. Absent does not mean "use
   * some default width" — it means the server never had the setting, so the
   * mark must be drawn exactly as this app has always drawn it, at the fixed
   * size the stylesheet gives `.talk-sponsor`. Whoever renders a mark writes no
   * inline width in that case rather than inventing one here.
   */
  width?: number;
  unit?: string;
}

/**
 * The size an event configured for its marks, or nothing when its payload has
 * no `contribution_marks` key — the older-plugin case, which every reader has
 * to leave looking exactly like it did before the setting existed.
 */
function markSize(payload: SponsorsPayload): {width: number; unit: string} | undefined {
  const config = payload.contribution_marks;
  return config ? {width: config.width, unit: config.unit} : undefined;
}

/**
 * The stored logo for a sponsor's mark, or null when there is none on the
 * device.
 *
 * The preference is the wide logo, falling back to the square one — the order
 * the marks have always used, and deliberately not the tier's
 * `show_square_logo` choice: that governs the sponsors block, where a logo has
 * room to be whatever shape it was drawn as. A mark is a small sliver beside
 * other content, so the wide artwork is the better picture for it wherever
 * both exist.
 *
 * Never a live URL: the sponsor's address is only ever the key the downloaded
 * bytes were stored under, and what reaches an `<img>` is an object URL for
 * those bytes. A logo that needs the network is a logo that vanishes in a
 * basement, which is the one condition this app exists for.
 */
function markLogo(sponsor: SponsorEntry, logos: Record<string, Blob>): string | null {
  const source = sponsor.logo_url ?? sponsor.square_logo_url;
  const blob = source ? logos[source] : undefined;
  return source && blob ? objectUrlFor(source, blob) : null;
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
 *
 * An event whose manager switched the row marks off contributes nothing here,
 * and each mark carries the width its event configured so the row can size it.
 * Both of those come from `contribution_marks`, and an event whose payload has
 * no such key — a plugin older than the setting — is treated as it always was:
 * marked, at the stylesheet's fixed size. Only an explicit `on_rows: false`
 * turns a mark off.
 */
export function useSponsorMarks(): Map<string, SponsorMark> {
  const {data: records} = useStored(() => listSponsors(), [], ['sponsors']);
  // Memoised on the stored records: the map and the mark objects inside it keep
  // their identity across unrelated re-renders, which is what lets a memoised
  // row treat its `sponsor` prop as unchanged.
  return useMemo(() => {
    const marks = new Map<string, SponsorMark>();
    for (const record of records ?? []) {
      const config = record.payload.contribution_marks;
      if (config && !config.on_rows) {
        continue;
      }
      const size = markSize(record.payload);
      for (const sponsor of record.payload.sponsors) {
        const url = markLogo(sponsor, record.logos);
        if (!url) {
          continue;
        }
        for (const contributionId of sponsor.contribution_ids ?? []) {
          const key = markKey(record.eventId, contributionId);
          if (!marks.has(key)) {
            marks.set(key, {url, name: sponsor.name, ...size});
          }
        }
      }
    }
    return marks;
  }, [records]);
}

/**
 * A mark that is known to carry a size. The detail logo only exists at all when
 * the event configured one, so its width and unit are never absent there —
 * saying so in the type keeps the screen from having to guess at a fallback
 * that cannot happen.
 */
export type SizedSponsorMark = SponsorMark & {width: number; unit: string};

/**
 * The sponsor's logo for one talk's own screen, or null when it has none to
 * show.
 *
 * Separate from `useSponsorMarks` rather than another field on it: this is a
 * different surface with its own switch, and it needs one event's record rather
 * than every event's — a talk screen always knows which event it is in.
 *
 * The default is the opposite way round from the row marks, and deliberately
 * so. A payload without `contribution_marks` comes from a plugin that has no
 * detail-logo setting at all, so nothing is drawn: the row mark already existed
 * and must not change, while this logo never existed and must not start
 * appearing on events that never asked for it.
 *
 * Only the first sponsor attached to the talk is shown, for the same reason the
 * rows show one — the sponsors block is where the full list belongs.
 */
export function useSponsorDetailMark(
  eventId: number,
  contributionId: number
): SizedSponsorMark | null {
  const {data: record} = useStored(() => getSponsors(eventId), [eventId], ['sponsors']);
  // Memoised so the screen hands the same object to the same `<img>` across
  // unrelated re-renders rather than churning its `src`.
  return useMemo(() => {
    const config = record?.payload.contribution_marks;
    if (!record || !config || !config.on_detail) {
      return null;
    }
    for (const sponsor of record.payload.sponsors) {
      if (!(sponsor.contribution_ids ?? []).includes(contributionId)) {
        continue;
      }
      const url = markLogo(sponsor, record.logos);
      if (url) {
        return {url, name: sponsor.name, width: config.width, unit: config.unit};
      }
    }
    return null;
  }, [record, contributionId]);
}
