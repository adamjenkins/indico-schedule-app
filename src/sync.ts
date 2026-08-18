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
  getEvent,
  getEventDays,
  listEvents,
  putDay,
  putDetails,
  putEvent,
  putProbe,
  StoredEvent,
} from './db';
import {syncSponsors} from './sponsors';
import {bump, setSyncStatus} from './store';

/** Fetch one day and store it. Returns true when the payload actually changed. */
async function syncDay(eventId: number, day: string, etag: string | null): Promise<boolean> {
  const result = await fetchGridData(eventId, day, etag);
  if (result.notModified || !result.payload) {
    return false;
  }
  await putDay({
    key: `${eventId}|${day}`,
    eventId,
    day,
    payload: result.payload,
    etag: result.etag,
    fetchedAt: Date.now(),
  });
  return true;
}

/**
 * Refresh every day of an event.
 *
 * Days are fetched in sequence rather than in parallel. A conference week is at
 * most a handful of requests, and a phone on conference wifi does better with
 * one request at a time than with five competing for a bad connection.
 */
export async function syncEvent(eventId: number): Promise<void> {
  const event = await getEvent(eventId);
  if (!event) {
    return;
  }
  setSyncStatus(eventId, {phase: 'syncing', error: null});
  try {
    const cached = new Map((await getEventDays(eventId)).map(d => [d.day, d]));
    // Re-read the day list from the server each time: days get added to an
    // event while it is running, and a cached day list would never notice.
    const first = await fetchGridData(eventId, event.days[0] ?? null, null);
    if (!first.payload) {
      throw new ApiError('contract', 'Empty response');
    }
    const days = first.payload.event_days;
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
      await syncDay(eventId, day, cached.get(day)?.etag ?? null);
    }

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
    await syncDetails(eventId);

    // Sponsors come from a second plugin that most events will not have. Same
    // rule, and `syncSponsors` never throws in the first place.
    await syncSponsors(eventId);

    setSyncStatus(eventId, {phase: 'idle', error: null, lastSyncAt: Date.now()});
  } catch (error) {
    const apiError =
      error instanceof ApiError ? error : new ApiError('server', 'Could not refresh');
    // A failed refresh must never destroy the cached copy — being offline at a
    // conference is normal, and the schedule from ten minutes ago is far more
    // useful than an error screen.
    await putEvent({...event, lastError: apiError.kind});
    setSyncStatus(eventId, {phase: 'error', error: apiError});
  }
  bump();
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
  bump();

  // The remaining days can arrive after the UI has already shown the first one.
  void syncEvent(eventId);
  return event;
}

export async function syncAll(): Promise<void> {
  for (const event of await listEvents()) {
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
