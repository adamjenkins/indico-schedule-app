/**
 * Room / group / track filtering.
 *
 * Ported from the Block Schedule plugin's `client/filters.ts`. The behaviour is
 * deliberately identical, including the part that surprises people: a track
 * filter greys out non-matching talks in the rooms it keeps rather than hiding
 * them, so you can still see the room is occupied. The URL parameter names
 * match the plugin's too, so a filtered link works in either the app or the web
 * page.
 *
 * The plugin's `syncFiltersToUrl` is not ported — this app owns its own router,
 * which writes filters into the URL as part of navigation.
 */
import {BSColumn, BSContribution, BSGridData} from './types';

export interface Filters {
  groupIds: number[];
  roomIds: number[];
  trackIds: number[];
}

export const EMPTY_FILTERS: Filters = {groupIds: [], roomIds: [], trackIds: []};

const PARAMS: [keyof Filters, string][] = [
  ['groupIds', 'groups'],
  ['roomIds', 'rooms'],
  ['trackIds', 'tracks'],
];

function parseIds(raw: string | null): number[] {
  if (!raw) {
    return [];
  }
  return [...new Set(raw.split(',').map(x => parseInt(x, 10)).filter(n => Number.isFinite(n)))];
}

/** Read filters out of a query string (`?rooms=1,2&tracks=7`). */
export function parseFilters(search: string): Filters {
  const params = new URLSearchParams(search);
  return {
    groupIds: parseIds(params.get('groups')),
    roomIds: parseIds(params.get('rooms')),
    trackIds: parseIds(params.get('tracks')),
  };
}

/** Render filters back into a query string, omitting whatever is unset. */
export function serializeFilters(filters: Filters): string {
  const params = new URLSearchParams();
  for (const [key, param] of PARAMS) {
    if (filters[key].length) {
      params.set(param, filters[key].join(','));
    }
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export function hasActiveFilters(filters: Filters): boolean {
  return PARAMS.some(([key]) => filters[key].length > 0);
}

export function countActiveFilters(filters: Filters): number {
  return PARAMS.reduce((total, [key]) => total + filters[key].length, 0);
}

export interface FilteredGrid {
  /** The columns to render, in their original order. */
  columns: BSColumn[];
  /** True when this contribution falls outside the track filter and should be greyed out. */
  isDimmed: (contribution: BSContribution) => boolean;
  /** How many columns exist in total, for "12 of 30 rooms" style summaries. */
  totalColumns: number;
}

/**
 * Apply `filters` to a grid payload.
 *
 * Room selection is the union of the selected groups' rooms and any
 * individually selected rooms — picking "9th floor" plus one hall on another
 * floor gives exactly those, which is how people describe what they want.
 *
 * The track filter deliberately does NOT remove talks from the rooms it keeps.
 * A room survives if it hosts at least one talk in the selected tracks, and its
 * other talks are then greyed out rather than hidden. Rooms with no matching
 * talk at all drop out, since they are just noise on a track sheet.
 */
export function applyFilters(gridData: BSGridData, filters: Filters): FilteredGrid {
  const allColumns = gridData.columns;
  const trackIds = new Set(filters.trackIds);
  const isDimmed = (contribution: BSContribution) =>
    trackIds.size > 0 && (contribution.track_id === null || !trackIds.has(contribution.track_id));

  // -- rooms: union of selected groups and individually selected rooms
  const selected = new Set<number>(filters.roomIds);
  if (filters.groupIds.length) {
    const groupIds = new Set(filters.groupIds);
    for (const group of gridData.groups) {
      if (groupIds.has(group.id)) {
        group.column_ids.forEach(id => selected.add(id));
      }
    }
  }
  let columns = selected.size ? allColumns.filter(c => selected.has(c.id)) : allColumns;

  // -- tracks: keep only rooms that actually host one of the selected tracks
  if (trackIds.size) {
    const columnsWithMatch = new Set(
      gridData.scheduled_contributions
        .filter(c => c.column_id !== null && c.track_id !== null && trackIds.has(c.track_id))
        .map(c => c.column_id as number)
    );
    columns = columns.filter(c => columnsWithMatch.has(c.id));
  }

  return {columns, isDimmed, totalColumns: allColumns.length};
}

/**
 * The talks a filtered view should show, in start order.
 *
 * The grid renders rooms as columns; the phone renders one time-ordered list,
 * so the same filter has to be expressed as "which talks appear, and which of
 * them are greyed" rather than "which columns survive".
 */
export function filterContributions(
  gridData: BSGridData,
  filters: Filters
): {items: BSContribution[]; dimmed: Set<number>; visibleColumns: BSColumn[]} {
  const {columns, isDimmed} = applyFilters(gridData, filters);
  const keep = new Set(columns.map(c => c.id));
  const dimmed = new Set<number>();
  const items = gridData.scheduled_contributions
    .filter(c => c.column_id !== null && keep.has(c.column_id))
    .sort((a, b) => (a.start_minutes ?? 0) - (b.start_minutes ?? 0) || a.title.localeCompare(b.title));
  for (const item of items) {
    if (isDimmed(item)) {
      dimmed.add(item.id);
    }
  }
  return {items, dimmed, visibleColumns: columns};
}
