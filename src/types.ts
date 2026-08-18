/**
 * The wire format of the Block Schedule plugin's grid-data endpoint.
 *
 * Copied from the plugin's own `client/types.ts` rather than imported: this app
 * is a separate project that talks to the plugin over HTTP, and the JSON is the
 * contract between them. Keeping a copy means the app builds without the plugin
 * checked out; the cost is that the two can drift, which is what the plugin's
 * payload-shape test exists to catch.
 */

export interface BSColumn {
  id: number;
  room_id: number | null;
  position: number;
  label: string;
  title: string;
  color: string | null;
  min_width_px: number | null;
}

export interface BSRoom {
  id: number;
  full_name: string;
}

export type BSDescriptionDisplay = 'hidden' | 'full' | 'truncated';

export interface BSContribution {
  id: number;
  title: string;
  people: string[];
  duration_minutes: number | null;
  column_id: number | null;
  start_minutes: number | null;
  start_dt: string | null;
  url: string;
  session_name: string | null;
  track_id: number | null;
  track_name: string | null;
  description: string | null;
}

export interface BSSpanningBlock {
  id: number;
  title: string;
  start_minutes: number;
  duration_minutes: number;
  color: string | null;
}

export interface BSSessionBlock {
  id: number;
  session_id: number | null;
  title: string | null;
  start_minutes: number;
  duration_minutes: number;
  color: string | null;
  column_ids: number[] | null;
}

export interface BSSession {
  id: number;
  title: string;
  color: string | null;
}

export interface BSTrack {
  id: number;
  title: string;
  /**
   * `rrggbb` chosen by the event manager, or null where none has been.
   *
   * Added by the plugin after 0.1.2. A schedule cached from an older server has
   * no such key at all, which is why every reader treats `undefined` the same as
   * null rather than assuming the field is there.
   */
  color?: string | null;
}

export interface BSGroup {
  id: number;
  title: string;
  position: number;
  column_ids: number[];
}

export interface BSGridData {
  day: string;
  event_days: string[];
  event_title: string;
  /**
   * The event's own logo from Indico's Layout page, or null when none is set.
   *
   * Optional here because a schedule cached from an older plugin has no such
   * key at all — `undefined` and `null` both mean "no logo", and neither is an
   * error.
   */
  event_logo_url?: string | null;
  columns: BSColumn[];
  groups: BSGroup[];
  roombooking_enabled: boolean;
  rooms: BSRoom[];
  sessions: BSSession[];
  tracks: BSTrack[];
  scheduled_contributions: BSContribution[];
  unscheduled_contributions: BSContribution[];
  spanning_blocks: BSSpanningBlock[];
  session_blocks: BSSessionBlock[];
  slot_minutes: number;
  day_start_time: string;
  day_end_time: string;
  working_hours_start: string;
  working_hours_end: string;
  gap_minutes: number;
  snap_minutes: number;
  row_height_px: number;
  show_session_track: boolean;
  description_display: BSDescriptionDisplay;
}

/** The keys the app genuinely depends on, for the payload sanity check. */
export const REQUIRED_KEYS: (keyof BSGridData)[] = [
  'day',
  'event_days',
  'event_title',
  'columns',
  'groups',
  'tracks',
  'scheduled_contributions',
];

export function looksLikeGridData(value: unknown): value is BSGridData {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  return REQUIRED_KEYS.every(key => key in value);
}

/**
 * The Event Sponsors plugin's payload.
 *
 * A separate plugin from Block Schedule, and an entirely optional one: an event
 * without it simply 404s the endpoint, which is why every reader here treats a
 * missing payload as "no sponsors" rather than as an error.
 *
 * `show` is the per-tier field configuration the event manager chose, already
 * resolved onto each sponsor by the server. Rendering follows it rather than
 * second-guessing it, so the phone and the web page agree about which sponsors
 * get a paragraph and which get only a logo.
 */
export interface SponsorEntry {
  id: number;
  tier_id: number;
  name: string;
  tagline: string;
  description: string;
  url: string | null;
  logo_url: string | null;
  square_logo_url: string | null;
  show: {
    show_logo: boolean;
    show_square_logo: boolean;
    show_name: boolean;
    show_tagline: boolean;
    show_description: boolean;
    linked: boolean;
    inline?: boolean;
  };
}

export interface SponsorTier {
  id: number;
  name: string;
  size: number;
  /**
   * The share of the block's width this tier's logos take, already computed
   * from the tier's size and the template's "largest logo width" setting. Used
   * as given — the arithmetic belongs to the plugin, not to every client.
   */
  width_pct: number;
  /** Lay this tier's sponsors side by side, wrapping, rather than one per row. */
  inline?: boolean;
}

export interface SponsorsPayload {
  event_id: number;
  event_title: string;
  template: {
    slug: string;
    title: string;
    layout: string;
    max_logo_pct: number;
    /** Put the block above the day's talks rather than below them. Absent on a
     * payload from a server too old to have the setting, which means below. */
    above_schedule?: boolean;
  } | null;
  tiers: SponsorTier[];
  sponsors: SponsorEntry[];
}
