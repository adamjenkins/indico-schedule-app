/**
 * Local storage.
 *
 * IndexedDB rather than localStorage because a single day of a 30-room
 * conference is already ~64 KB of JSON, and localStorage is both synchronous
 * and capped at around 5 MB per origin.
 *
 * Stores, deliberately flat:
 *   events  — the library: which events the user follows, and their days
 *   days    — one cached grid payload per (event, day), with the ETag that produced it
 *   stars   — the personal agenda, on this device only (see README: Plan A)
 *   details — abstracts and speaker affiliations, one record per event
 *   probes  — which events were found to have a block schedule, and when
 *   meta    — single-row odds and ends; currently the site logo
 *
 * `details` is separate from `days` because it comes from a different endpoint
 * on a different schedule, and because an event whose organisers have not
 * published its contributions simply has none — which must not look like a
 * failure to cache the schedule.
 */
import {DBSchema, IDBPDatabase, openDB} from 'idb';

import {SponsorsPayload} from './types';

import {ContributionDetail} from './api';
import {BSGridData} from './types';

export interface StoredEvent {
  id: number;
  title: string;
  days: string[];
  addedAt: number;
  lastSyncAt: number | null;
  /** Last sync failure, kept so the UI can explain itself instead of just looking stale. */
  lastError: string | null;
  /**
   * The event's logo, from Indico's Layout page.
   *
   * Kept as a blob rather than as a URL, so the events list looks the same with
   * no signal as with one. `logoUrl` is stored alongside it purely to know when
   * to re-fetch: the address contains the image's hash, so a replaced logo is a
   * different URL and a stale copy is impossible.
   */
  logoUrl?: string | null;
  logo?: Blob | null;
}

export interface StoredDay {
  key: string;
  eventId: number;
  day: string;
  payload: BSGridData;
  etag: string | null;
  fetchedAt: number;
}

export interface StoredStar {
  key: string;
  eventId: number;
  contributionId: number;
  addedAt: number;
}

export interface StoredDetails {
  eventId: number;
  /** Keyed by contribution id, matching the schedule payload's ids. */
  byContribution: Record<number, ContributionDetail>;
  fetchedAt: number;
}

/**
 * Whether an event has a block schedule configured.
 *
 * Nothing in Indico advertises this, so the only way to know is to ask for the
 * schedule and look — an expensive question, which is exactly why the answer is
 * kept. `checkedAt` exists so a "no" can expire: an organiser who sets a
 * schedule up tomorrow should not be invisible forever.
 */
export interface StoredProbe {
  eventId: number;
  hasSchedule: boolean;
  checkedAt: number;
}

/** The site logo, as taken from Indico's own page header. */
export interface StoredBranding {
  key: 'branding';
  /** Absolute URL it came from, kept so a cross-origin logo can still be shown. */
  url: string;
  alt: string;
  /** The image itself, so the logo survives offline. Null if it could not be fetched. */
  blob: Blob | null;
  /** True when the artwork is light — it then needs a dark plate behind it. */
  isLight: boolean;
  fetchedAt: number;
}

/**
 * An event's sponsors, as the plugin's app template renders them.
 *
 * The per-tier field choices arrive already resolved onto each sponsor, so the
 * app shows what the event manager configured rather than reimplementing the
 * plugin's matrix and drifting from it.
 *
 * Logos are kept as blobs against their URL. A sponsor logo that only exists as
 * a URL is a logo that disappears the moment the phone loses signal, which is
 * the one condition this app is for.
 */
export interface StoredSponsors {
  eventId: number;
  payload: SponsorsPayload;
  logos: Record<string, Blob>;
  fetchedAt: number;
}

interface ScheduleDB extends DBSchema {
  events: {key: number; value: StoredEvent};
  days: {key: string; value: StoredDay; indexes: {eventId: number}};
  stars: {key: string; value: StoredStar; indexes: {eventId: number}};
  details: {key: number; value: StoredDetails};
  probes: {key: number; value: StoredProbe};
  meta: {key: string; value: StoredBranding};
  sponsors: {key: number; value: StoredSponsors};
}

export const dayKey = (eventId: number, day: string) => `${eventId}|${day}`;
export const starKey = (eventId: number, contributionId: number) => `${eventId}|${contributionId}`;

let dbPromise: Promise<IDBPDatabase<ScheduleDB>> | null = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB<ScheduleDB>('indico-schedule', 4, {
      upgrade(db, oldVersion) {
        // Additive steps, so an existing install keeps its cached schedule and
        // its starred talks across the upgrade.
        if (oldVersion < 1) {
          db.createObjectStore('events', {keyPath: 'id'});
          db.createObjectStore('days', {keyPath: 'key'}).createIndex('eventId', 'eventId');
          db.createObjectStore('stars', {keyPath: 'key'}).createIndex('eventId', 'eventId');
        }
        if (oldVersion < 2) {
          db.createObjectStore('details', {keyPath: 'eventId'});
        }
        if (oldVersion < 3) {
          db.createObjectStore('probes', {keyPath: 'eventId'});
          db.createObjectStore('meta', {keyPath: 'key'});
        }
        if (oldVersion < 4) {
          db.createObjectStore('sponsors', {keyPath: 'eventId'});
        }
      },
    });
  }
  return dbPromise;
}

// -- events ---------------------------------------------------------------

export async function listEvents(): Promise<StoredEvent[]> {
  const db = await getDb();
  const events = await db.getAll('events');
  return events.sort((a, b) => a.addedAt - b.addedAt);
}

export async function getEvent(id: number): Promise<StoredEvent | undefined> {
  return (await getDb()).get('events', id);
}

export async function putEvent(event: StoredEvent): Promise<void> {
  await (await getDb()).put('events', event);
}

export async function removeEvent(id: number): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(['events', 'days', 'stars', 'details'], 'readwrite');
  await tx.objectStore('events').delete(id);
  await tx.objectStore('details').delete(id);
  for (const store of ['days', 'stars'] as const) {
    // Removing an event should not leave its cached days and stars behind:
    // re-adding it later would otherwise resurrect a stale agenda.
    let cursor = await tx.objectStore(store).index('eventId').openCursor(id);
    while (cursor) {
      await cursor.delete();
      cursor = await cursor.continue();
    }
  }
  await tx.done;
}

// -- days -----------------------------------------------------------------

export async function getDay(eventId: number, day: string): Promise<StoredDay | undefined> {
  return (await getDb()).get('days', dayKey(eventId, day));
}

export async function getEventDays(eventId: number): Promise<StoredDay[]> {
  const db = await getDb();
  const days = await db.getAllFromIndex('days', 'eventId', eventId);
  return days.sort((a, b) => a.day.localeCompare(b.day));
}

export async function putDay(day: StoredDay): Promise<void> {
  await (await getDb()).put('days', day);
}

// -- abstracts ------------------------------------------------------------

export async function getDetails(eventId: number): Promise<StoredDetails | undefined> {
  return (await getDb()).get('details', eventId);
}

export async function putDetails(details: StoredDetails): Promise<void> {
  await (await getDb()).put('details', details);
}

// -- block-schedule probes ------------------------------------------------

export async function getProbe(eventId: number): Promise<StoredProbe | undefined> {
  return (await getDb()).get('probes', eventId);
}

export async function putProbe(probe: StoredProbe): Promise<void> {
  await (await getDb()).put('probes', probe);
}

// -- branding -------------------------------------------------------------

export async function getBranding(): Promise<StoredBranding | undefined> {
  return (await getDb()).get('meta', 'branding');
}

export async function getSponsors(eventId: number): Promise<StoredSponsors | undefined> {
  return (await getDb()).get('sponsors', eventId);
}

export async function putSponsors(sponsors: StoredSponsors): Promise<void> {
  const db = await getDb();
  await db.put('sponsors', sponsors);
}

export async function putBranding(branding: StoredBranding): Promise<void> {
  await (await getDb()).put('meta', branding);
}

// -- stars ----------------------------------------------------------------

export async function listStars(eventId?: number): Promise<StoredStar[]> {
  const db = await getDb();
  const stars =
    eventId === undefined
      ? await db.getAll('stars')
      : await db.getAllFromIndex('stars', 'eventId', eventId);
  return stars;
}

export async function setStar(eventId: number, contributionId: number, starred: boolean) {
  const db = await getDb();
  const key = starKey(eventId, contributionId);
  if (starred) {
    await db.put('stars', {key, eventId, contributionId, addedAt: Date.now()});
  } else {
    await db.delete('stars', key);
  }
}

/** Wipe everything. Used by the "remove all data" control in Settings. */
export async function clearAll() {
  const db = await getDb();
  const tx = db.transaction(['events', 'days', 'stars', 'details', 'probes', 'meta', 'sponsors'],
    'readwrite');
  await Promise.all([
    tx.objectStore('events').clear(),
    tx.objectStore('days').clear(),
    tx.objectStore('stars').clear(),
    tx.objectStore('details').clear(),
    tx.objectStore('probes').clear(),
    tx.objectStore('meta').clear(),
    tx.objectStore('sponsors').clear(),
  ]);
  await tx.done;
}

export async function estimateUsage(): Promise<number | null> {
  if (!navigator.storage?.estimate) {
    return null;
  }
  const {usage} = await navigator.storage.estimate();
  return usage ?? null;
}
