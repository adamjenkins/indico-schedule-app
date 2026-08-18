/**
 * Local search.
 *
 * Runs entirely against the cached copy, which is the point: search has to work
 * in a basement conference room with no signal. A whole conference is a few
 * hundred talks, so a linear scan is imperceptible and buying an index would
 * cost more in complexity than it saves in milliseconds.
 */
import {StoredDay} from './db';
import {BSContribution} from './types';

export interface SearchHit {
  contribution: BSContribution;
  day: string;
  eventId: number;
  roomLabel: string;
  /** The manager's colour for this hit's track, resolved here because results mix events
   * and a track id only means something inside the event it came from. */
  trackColor: string | null;
}

/** Where a query matched, so the UI can show the term in context. */
export interface Segment {
  text: string;
  match: boolean;
}

function normalise(value: string): string {
  // Fold accents so "Fournier" is found by typing "fournier", and diacritics
  // are not a barrier for anyone typing on a phone keyboard.
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/** Split `text` into matched and unmatched runs for `query`. */
export function highlight(text: string, query: string): Segment[] {
  const needle = normalise(query.trim());
  if (!needle) {
    return [{text, match: false}];
  }
  const haystack = normalise(text);
  const segments: Segment[] = [];
  let cursor = 0;
  let found = haystack.indexOf(needle, cursor);
  while (found !== -1) {
    if (found > cursor) {
      segments.push({text: text.slice(cursor, found), match: false});
    }
    segments.push({text: text.slice(found, found + needle.length), match: true});
    cursor = found + needle.length;
    found = haystack.indexOf(needle, cursor);
  }
  if (cursor < text.length) {
    segments.push({text: text.slice(cursor), match: false});
  }
  return segments;
}

/**
 * Search a set of cached days.
 *
 * Title, speakers, track, session and room are all searchable, because people
 * look for talks by whichever of those they happen to remember.
 */
export function searchDays(days: StoredDay[], query: string): SearchHit[] {
  const needle = normalise(query.trim());
  if (needle.length < 2) {
    return [];
  }

  const hits: SearchHit[] = [];
  for (const stored of days) {
    const rooms = new Map(stored.payload.columns.map(c => [c.id, c.title || c.label]));
    const trackColors = new Map(
      (stored.payload.tracks ?? []).filter(t => t.color).map(t => [t.id, t.color as string])
    );
    for (const contribution of stored.payload.scheduled_contributions) {
      const roomLabel = contribution.column_id === null ? '' : rooms.get(contribution.column_id) ?? '';
      const haystack = normalise(
        [
          contribution.title,
          contribution.people.join(' '),
          contribution.track_name ?? '',
          contribution.session_name ?? '',
          roomLabel,
        ].join(' ')
      );
      if (haystack.includes(needle)) {
        hits.push({
          contribution,
          day: stored.day,
          eventId: stored.eventId,
          roomLabel,
          trackColor:
            contribution.track_id === null ? null : trackColors.get(contribution.track_id) ?? null,
        });
      }
    }
  }

  return hits.sort(
    (a, b) =>
      a.day.localeCompare(b.day) ||
      (a.contribution.start_minutes ?? 0) - (b.contribution.start_minutes ?? 0)
  );
}
