/**
 * Sponsors, kept on the device.
 *
 * Fetched with the schedule and stored whole, logos included. A logo held only
 * as a URL is a logo that vanishes the moment the phone loses signal, which is
 * the one condition this app exists for — so each image is downloaded once and
 * kept as a blob against the URL it came from.
 *
 * Everything here is best-effort and silent. Sponsors are a courtesy block at
 * the foot of a screen; a site with no sponsors plugin, an event that never
 * switched the feature on, and a failed request all look the same from here,
 * and none of them is worth an error on a screen somebody opened to find out
 * where their next talk is.
 */
import {fetchSponsors} from './api';
import {getSponsors, putSponsors, StoredSponsors} from './db';
import {SponsorsPayload} from './types';

/** Re-download a logo only if it is not already held, keyed by its URL. */
async function collectLogos(
  payload: SponsorsPayload,
  existing: Record<string, Blob>
): Promise<Record<string, Blob>> {
  const wanted = new Set<string>();
  for (const sponsor of payload.sponsors) {
    for (const url of [sponsor.logo_url, sponsor.square_logo_url]) {
      if (url) {
        wanted.add(url);
      }
    }
  }
  const logos: Record<string, Blob> = {};
  for (const url of wanted) {
    // Carried over rather than re-fetched: the URL contains the stored file's
    // id, so a changed logo is a changed URL and this can never serve a stale
    // image for a new one.
    const held = existing[url];
    if (held) {
      logos[url] = held;
      continue;
    }
    try {
      const response = await fetch(url, {credentials: 'same-origin'});
      if (response.ok) {
        logos[url] = await response.blob();
      }
    } catch {
      // A missing logo renders as no logo. Nothing else is affected.
    }
  }
  return logos;
}

/** Refresh one event's sponsors. Never throws. */
export async function syncSponsors(eventId: number): Promise<void> {
  const payload = await fetchSponsors(eventId);
  if (payload === null) {
    return;
  }
  const existing = await getSponsors(eventId);
  const logos = await collectLogos(payload, existing?.logos ?? {});
  const record: StoredSponsors = {eventId, payload, logos, fetchedAt: Date.now()};
  await putSponsors(record);
}
