/**
 * Working out which events actually have a block schedule.
 *
 * Indico advertises this nowhere. The plugin's `grid-data` endpoint answers for
 * *any* event — an event with no schedule simply comes back with an empty list
 * of columns — so the only way to know is to ask, one event at a time.
 *
 * That is an expensive question. `grid-data` builds the whole day's payload
 * server-side, tens of kilobytes for a real conference, and a category listing
 * can hold hundreds of events. Everything here exists to keep that cost down:
 *
 *   - every answer is written to IndexedDB, so an event is asked about once
 *   - at most `CONCURRENCY` requests are in flight, so a listing cannot flood
 *     the server or a phone's connection
 *   - only a bounded slice of a listing is checked at a time; the rest waits
 *     for the user to ask for more
 *
 * A "no" expires after a day, because an organiser who configures a schedule
 * tomorrow should not stay invisible; a "yes" is kept far longer, since
 * schedules are not usually torn down.
 */
import {fetchGridData} from './api';
import {getProbe, putProbe} from './db';

const CONCURRENCY = 3;
const NEGATIVE_TTL = 24 * 60 * 60 * 1000;
const POSITIVE_TTL = 30 * 24 * 60 * 60 * 1000;

/** How many events one round of checking covers. */
export const PROBE_BATCH = 25;

function isFresh(checkedAt: number, hasSchedule: boolean): boolean {
  return Date.now() - checkedAt < (hasSchedule ? POSITIVE_TTL : NEGATIVE_TTL);
}

/**
 * Does this event have a block schedule configured?
 *
 * An event we cannot see at all (403/404) counts as "no": it would be no use in
 * the library either way, and the picker should not offer it.
 */
async function probeOne(eventId: number): Promise<boolean> {
  const cached = await getProbe(eventId);
  if (cached && isFresh(cached.checkedAt, cached.hasSchedule)) {
    return cached.hasSchedule;
  }
  let hasSchedule = false;
  try {
    const {payload} = await fetchGridData(eventId, null, null);
    hasSchedule = !!payload && payload.columns.length > 0;
  } catch {
    hasSchedule = false;
  }
  await putProbe({eventId, hasSchedule, checkedAt: Date.now()});
  return hasSchedule;
}

/**
 * Check a list of events, reporting each answer as it arrives.
 *
 * Results are announced one by one rather than returned together so the picker
 * can fill in as it goes: on a slow connection a list that appears a row at a
 * time is far better than a spinner that eventually produces everything.
 *
 * `signal` is honoured between requests, so closing the picker or typing a new
 * search stops the queue rather than letting it run on in the background.
 */
export async function probeEvents(
  eventIds: number[],
  onResult: (eventId: number, hasSchedule: boolean) => void,
  signal?: {cancelled: boolean}
): Promise<void> {
  const queue = [...eventIds];
  const workers = Array.from({length: Math.min(CONCURRENCY, queue.length)}, async () => {
    for (;;) {
      const next = queue.shift();
      if (next === undefined || signal?.cancelled) {
        return;
      }
      const hasSchedule = await probeOne(next);
      if (signal?.cancelled) {
        return;
      }
      onResult(next, hasSchedule);
    }
  });
  await Promise.all(workers);
}

/** Answers already on the device, so a repeat visit renders without asking. */
export async function knownVerdicts(eventIds: number[]): Promise<Map<number, boolean>> {
  const verdicts = new Map<number, boolean>();
  for (const eventId of eventIds) {
    const cached = await getProbe(eventId);
    if (cached && isFresh(cached.checkedAt, cached.hasSchedule)) {
      verdicts.set(eventId, cached.hasSchedule);
    }
  }
  return verdicts;
}
