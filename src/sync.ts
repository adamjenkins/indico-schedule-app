/**
 * Keeping the local copy current.
 *
 * The refresh rule is deliberately simple: **fetch once when the app starts,
 * and otherwise only when asked**. There is no background timer.
 *
 * That is a choice, not a limitation. A schedule changes a handful of times
 * over a conference, so a timer spends the battery re-fetching identical data,
 * and on iOS it would not run in the background anyway (Periodic Background
 * Sync is Chromium-only). Startup covers the case that matters — an installed
 * app that has been swapped out and reopened does a fresh start — and the
 * Refresh control covers the rest.
 */
import {ApiError, fetchContributionDetails, fetchGridData} from './api';
import {refreshBranding} from './branding';
import {
  getDetails,
  getEvent,
  getEventDays,
  listEvents,
  pruneDays,
  putDay,
  putDetails,
  putEvent,
  putProbe,
  StoredDay,
  StoredEvent,
} from './db';
import {todayIso} from './format';
import {syncSponsors} from './sponsors';
import {bump, setSyncStatus} from './store';

/**
 * How long a details record stays fresh enough to skip re-downloading.
 *
 * The abstracts export is the heaviest fetch the app makes and abstracts barely
 * change once an event is underway, so an unchanged schedule within this window
 * keeps the stored copy. Any day changing refetches regardless — a moved talk
 * is the moment its abstract is most likely to have been edited too.
 */
const DETAILS_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/** How often an event whose last day has passed is still worth re-checking. */
const FINISHED_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Fetch one day and store it. Returns true when the payload actually changed.
 *
 * A null `day` asks for the server's default day. The record is keyed on the
 * day the *answer* names either way — the one fact about which day this is
 * that cannot be stale.
 */
async function syncDay(
  eventId: number,
  day: string | null,
  cached: StoredDay | undefined
): Promise<boolean> {
  const result = await fetchGridData(eventId, day, cached?.etag ?? null);
  if (result.notModified || !result.payload) {
    return false;
  }
  const changed = dayChanged(cached, result.payload);
  await putDay({
    key: `${eventId}|${result.payload.day}`,
    eventId,
    day: result.payload.day,
    payload: result.payload,
    etag: result.etag,
    fetchedAt: Date.now(),
  });
  return changed;
}

/**
 * Whether a freshly fetched payload differs from the stored one — by value,
 * because the server does not send ETags yet, so today every answer is a 200
 * and "not a 304" would call every refresh a change. Once ETags exist the 304
 * path above short-circuits this and the comparison stays as the fallback.
 */
function dayChanged(cached: StoredDay | undefined, payload: StoredDay['payload']): boolean {
  return !cached || JSON.stringify(cached.payload) !== JSON.stringify(payload);
}

/**
 * One promise per event id, so overlapping refreshes collapse into one run.
 *
 * `syncEvent` is reachable from startup, pull-to-refresh, several buttons and
 * `addEvent` — overlap is normal, not a corner case. Without this guard the
 * failing run's catch could write its stale snapshot over the succeeding run's
 * fresh one, and both would download every day twice over a struggling link.
 */
const inFlight = new Map<number, Promise<void>>();

/**
 * Refresh every day of an event.
 *
 * Days are fetched in sequence rather than in parallel. A conference week is at
 * most a handful of requests, and a phone on conference wifi does better with
 * one request at a time than with five competing for a bad connection.
 */
export function syncEvent(eventId: number): Promise<void> {
  const running = inFlight.get(eventId);
  if (running) {
    return running;
  }
  const task = doSyncEvent(eventId).finally(() => inFlight.delete(eventId));
  inFlight.set(eventId, task);
  return task;
}

async function doSyncEvent(eventId: number): Promise<void> {
  const event = await getEvent(eventId);
  if (!event) {
    return;
  }
  setSyncStatus(eventId, {phase: 'syncing', error: null});
  try {
    const cached = new Map((await getEventDays(eventId)).map(d => [d.day, d]));
    // Ask for the server's default day, never a cached one: days get added and
    // *removed* while an event runs, and asking for a day the event no longer
    // has is a 400 — which would make every refresh fail forever, since the
    // day list is only corrected by a refresh that succeeds. The reply carries
    // the current day list, which is exactly what this first call is for.
    const first = await fetchGridData(eventId, null, null);
    if (!first.payload) {
      throw new ApiError('contract', 'Empty response');
    }
    const days = first.payload.event_days;
    let changed = dayChanged(cached.get(first.payload.day), first.payload);
    await putDay({
      key: `${eventId}|${first.payload.day}`,
      eventId,
      day: first.payload.day,
      payload: first.payload,
      etag: first.etag,
      fetchedAt: Date.now(),
    });

    for (const day of days) {
      if (day === first.payload.day) {
        continue;
      }
      try {
        changed = (await syncDay(eventId, day, cached.get(day))) || changed;
      } catch (error) {
        // A 400 for a specific day means the dates moved between the first
        // fetch and this one. Ask once more with no day — the server's answer
        // is always valid — rather than record a failure over a day that no
        // longer exists; the next refresh starts from the corrected list.
        if (!(error instanceof ApiError && error.status === 400)) {
          throw error;
        }
        changed = (await syncDay(eventId, null, undefined)) || changed;
      }
    }

    // The server's list is authoritative in both directions: a cached day it
    // no longer names is a day whose talks no longer exist.
    await pruneDays(eventId, days);

    await putEvent({
      ...event,
      title: first.payload.event_title,
      days,
      lastSyncAt: Date.now(),
      lastError: null,
      ...(await eventLogo(event, first.payload.event_logo_url ?? null)),
    });

    // Abstracts come from a different endpoint and are a bonus, not a
    // requirement: a failure here must not mark the schedule as unsynced.
    // They are also the biggest download of the lot, so an unchanged schedule
    // with a reasonably fresh stored copy keeps it instead of re-fetching.
    const details = await getDetails(eventId);
    if (changed || !details || Date.now() - details.fetchedAt > DETAILS_MAX_AGE_MS) {
      await syncDetails(eventId);
    }

    // Sponsors come from a second plugin that most events will not have. Same
    // rule, and `syncSponsors` never throws in the first place.
    await syncSponsors(eventId);

    setSyncStatus(eventId, {phase: 'idle', error: null, lastSyncAt: Date.now()});
  } catch (error) {
    const apiError =
      error instanceof ApiError ? error : new ApiError('server', 'Could not refresh');
    // A failed refresh must never destroy the cached copy — being offline at a
    // conference is normal, and the schedule from ten minutes ago is far more
    // useful than an error screen. Re-read before writing: the snapshot from
    // the top of this run predates everything that happened during it, and
    // writing it back wholesale would revert another writer's work.
    const latest = (await getEvent(eventId)) ?? event;
    await putEvent({...latest, lastError: apiError.kind});
    setSyncStatus(eventId, {phase: 'error', error: apiError});
  }
  bump('events', 'days', 'details', 'sponsors');
}

/**
 * Fetch the event's abstracts and speaker affiliations.
 *
 * Best-effort by design: a failure here must not mark the schedule as unsynced,
 * so it is swallowed. But a *successful* fetch is always recorded, even when it
 * found nothing — that empty record is what lets the talk screen say "no
 * abstract was published" instead of "still downloading", which are different
 * things and should not read the same.
 */
async function syncDetails(eventId: number): Promise<void> {
  try {
    const details = await fetchContributionDetails(eventId);
    if (details === null) {
      return;
    }
    await putDetails({
      eventId,
      byContribution: Object.fromEntries(details),
      fetchedAt: Date.now(),
    });
  } catch {
    // Deliberately swallowed: see the docstring.
  }
}

/**
 * The logo fields for an event record, downloading the image only when needed.
 *
 * The URL carries the image's hash, so an unchanged URL means an unchanged
 * image and the stored blob can be carried over untouched. A failed download
 * leaves the event with no logo rather than failing the sync: a logo is
 * decoration, and a schedule that will not refresh because a picture is
 * missing would be a poor trade.
 */
async function eventLogo(
  existing: StoredEvent | undefined,
  logoUrl: string | null
): Promise<{logoUrl: string | null; logo: Blob | null}> {
  if (!logoUrl) {
    return {logoUrl: null, logo: null};
  }
  if (existing?.logoUrl === logoUrl && existing.logo) {
    return {logoUrl, logo: existing.logo};
  }
  try {
    const response = await fetch(logoUrl, {credentials: 'same-origin'});
    return response.ok ? {logoUrl, logo: await response.blob()} : {logoUrl, logo: null};
  } catch {
    return {logoUrl, logo: null};
  }
}

/** Add an event to the library, fetching it once so it is immediately usable. */
export async function addEvent(eventId: number): Promise<StoredEvent> {
  const existing = await getEvent(eventId);
  if (existing) {
    await syncEvent(eventId);
    return (await getEvent(eventId)) ?? existing;
  }

  // Fetch before storing: adding an event that turns out to be inaccessible
  // should fail visibly at the moment of adding, not leave a broken card behind.
  const result = await fetchGridData(eventId, null, null);
  if (!result.payload) {
    throw new ApiError('contract', 'Empty response');
  }
  // The block-schedule endpoint answers for every event, whether or not anyone
  // has set a schedule up — an event with no columns would be added happily and
  // then show an empty grid forever. The picker already filters these out; this
  // is the same rule enforced where it cannot be bypassed, which also covers
  // adding by id. The verdict is recorded so the picker need not ask again.
  const hasSchedule = result.payload.columns.length > 0;
  await putProbe({eventId, hasSchedule, checkedAt: Date.now()});
  if (!hasSchedule) {
    throw new ApiError('noschedule', 'That event has no block schedule');
  }
  const event: StoredEvent = {
    id: eventId,
    title: result.payload.event_title,
    days: result.payload.event_days,
    addedAt: Date.now(),
    lastSyncAt: Date.now(),
    lastError: null,
    ...(await eventLogo(undefined, result.payload.event_logo_url ?? null)),
  };
  await putEvent(event);
  await putDay({
    key: `${eventId}|${result.payload.day}`,
    eventId,
    day: result.payload.day,
    payload: result.payload,
    etag: result.etag,
    fetchedAt: Date.now(),
  });
  bump('events', 'days');

  // The remaining days can arrive after the UI has already shown the first one.
  void syncEvent(eventId);
  return event;
}

/**
 * Whether a bulk refresh can leave this event alone: its last day has passed
 * and a sync succeeded recently enough. A finished conference still gets an
 * occasional look — organisers do tidy things up afterwards — but not a full
 * download on every app start. The Refresh control on the event itself calls
 * `syncEvent` directly and is never skipped.
 */
function restingQuietly(event: StoredEvent): boolean {
  const lastDay = event.days[event.days.length - 1];
  if (!lastDay || lastDay >= todayIso()) {
    return false;
  }
  if (event.lastError !== null) {
    // A failed refresh is not a resting state; the next pass should retry it.
    return false;
  }
  return event.lastSyncAt !== null && Date.now() - event.lastSyncAt < FINISHED_MAX_AGE_MS;
}

export async function syncAll(): Promise<void> {
  for (const event of await listEvents()) {
    if (restingQuietly(event)) {
      continue;
    }
    await syncEvent(event.id);
  }
}

/**
 * Refresh everything once, at startup.
 *
 * Called exactly once when the app boots. Every other refresh in the app is
 * something the user asked for — the Refresh control on an event, or adding an
 * event, which fetches it there and then. Nothing runs on a timer.
 *
 * Failures are swallowed here on purpose: `syncEvent` already records them per
 * event, and the screens render from the cached copy regardless. A startup
 * refresh that fails offline should be invisible, not a dialog.
 */
export function runStartupSync(): void {
  void syncAll();
  // Separate from the schedule refresh and never awaited with it: the logo is
  // decoration, and a site whose header cannot be read must not delay or fail
  // the thing the app is actually for.
  void refreshBranding();
}
