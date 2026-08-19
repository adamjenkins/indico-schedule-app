/**
 * Talking to Indico.
 *
 * Every request here is same-origin, which is the single decision the whole
 * app rests on: the browser attaches the user's existing Indico session cookie
 * by itself, so there is no sign-in flow, no token to store, and no CORS to
 * negotiate. `credentials: 'same-origin'` is the default for fetch, but it is
 * spelled out because it is load-bearing rather than incidental.
 *
 * Errors are classified rather than thrown raw, because the UI has genuinely
 * different things to say: "you are offline" is reassuring, "you need to sign
 * in" is actionable, and "this event does not exist" is final.
 */
import {BSGridData, looksLikeGridData, SponsorsPayload} from './types';

/**
 * `noschedule` is not an HTTP outcome: the request succeeded and the event is
 * perfectly real, it just has no block schedule configured. It is a kind of its
 * own because "this event has nothing for the app to show" and "this event does
 * not exist" need different words on screen.
 *
 * `storage` never comes from the network at all: it is IndexedDB refusing to
 * read or write — private browsing, Lockdown Mode, a full disk. It lives in
 * this union because the error screens already speak `ApiError`, and "this
 * device is not saving data" deserves its own words as much as any HTTP fault.
 */
export type FailureKind =
  | 'offline'
  | 'auth'
  | 'notfound'
  | 'contract'
  | 'server'
  | 'noschedule'
  | 'storage';

export class ApiError extends Error {
  readonly kind: FailureKind;
  readonly status: number | null;

  constructor(kind: FailureKind, message: string, status: number | null = null) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
  }
}

/**
 * `X-Requested-With` is what makes Indico answer errors in JSON: its error
 * handlers check `request.is_xhr` (that header, verbatim) and deliberately
 * ignore `Accept`. Without it a signed-out request is not refused but
 * *redirected* to the login page — a 200 with HTML — and the real status is
 * lost before this code ever sees it.
 */
const JSON_HEADERS = {Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest'};

/**
 * Every request gets a deadline. A captive portal or a wifi network that
 * accepts TCP and then goes silent — the standard conference-hotel failure —
 * leaves an unsignalled fetch pending forever, and everything queued behind it
 * with it. Generous enough for a big day payload on a bad connection.
 */
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Indico renders an HTML error page unless the request asks for JSON, so every
 * call sends `Accept: application/json` and gets a machine-readable body back.
 */
async function request(url: string, init: RequestInit = {}): Promise<Response> {
  // Feature-detected: a browser without AbortSignal.timeout just loses the
  // deadline — a worse experience on a stalled network, but a working app,
  // where an unguarded call would fail every request before it started.
  const timeout =
    typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(REQUEST_TIMEOUT_MS) : undefined;
  const signal =
    init.signal && timeout && typeof AbortSignal.any === 'function'
      ? AbortSignal.any([init.signal, timeout])
      : init.signal ?? timeout;
  try {
    return await fetch(url, {
      credentials: 'same-origin',
      ...init,
      signal,
      headers: {...JSON_HEADERS, ...(init.headers ?? {})},
    });
  } catch (cause) {
    // fetch only rejects for network-level failures — every HTTP status
    // resolves normally. A timeout lands here too, and counts as offline: a
    // connection that never answers and no connection at all get the same
    // words on screen, and the same cached copy behind them.
    const timedOut = cause instanceof DOMException && cause.name === 'TimeoutError';
    throw new ApiError('offline', timedOut ? 'The connection timed out' : 'No connection', null);
  }
}

function classify(response: Response): ApiError | null {
  // Belt and braces alongside `X-Requested-With`: if Indico redirected us to
  // the login page anyway, this was an authentication refusal whatever the
  // final status says — never let it reach a JSON parse as a "200".
  if (response.redirected && new URL(response.url).pathname.startsWith('/login')) {
    return new ApiError('auth', 'Not signed in', response.status);
  }
  if (response.ok || response.status === 304) {
    return null;
  }
  if (response.status === 401 || response.status === 403) {
    return new ApiError('auth', 'Not permitted', response.status);
  }
  if (response.status === 404) {
    return new ApiError('notfound', 'No such event', response.status);
  }
  return new ApiError('server', `Indico returned ${response.status}`, response.status);
}

export interface CurrentUser {
  id: number;
  first_name?: string;
  last_name?: string;
  full_name?: string;
  email?: string;
}

/**
 * Who, if anyone, is signed in. Anonymous requests get a literal `null` body
 * rather than a 401, which is what lets the UI tell "sign in" apart from "you
 * are signed in but cannot see this event" — two very different dead ends.
 */
export async function fetchCurrentUser(): Promise<CurrentUser | null> {
  const response = await request('/api/user/');
  if (!response.ok) {
    return null;
  }
  try {
    return (await response.json()) as CurrentUser | null;
  } catch {
    return null;
  }
}

export interface GridFetch {
  /** Null when the server answered 304 and the cached copy is still current. */
  payload: BSGridData | null;
  etag: string | null;
  notModified: boolean;
}

/**
 * Fetch one day of an event's block schedule.
 *
 * `etag` is sent as `If-None-Match` when we hold one. Indico does not currently
 * set ETags on this endpoint, so today the server always answers 200 and this
 * is simply inert — it costs one header. If the plugin gains ETag support (a
 * three-line change), refreshes start collapsing to 304s with no app release.
 */
export async function fetchGridData(
  eventId: number,
  day: string | null,
  etag: string | null = null
): Promise<GridFetch> {
  const query = day ? `?day=${encodeURIComponent(day)}` : '';
  const headers: Record<string, string> = {};
  if (etag) {
    headers['If-None-Match'] = etag;
  }
  const response = await request(`/event/${eventId}/block-schedule/grid-data${query}`, {headers});

  const failure = classify(response);
  if (failure) {
    throw failure;
  }
  if (response.status === 304) {
    return {payload: null, etag, notModified: true};
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    // Most often this is a login or error page arriving with a 200, which is
    // worth naming precisely rather than reporting as "invalid JSON".
    throw new ApiError('contract', 'Indico returned something that is not schedule data');
  }
  if (!looksLikeGridData(body)) {
    throw new ApiError('contract', 'Schedule data is missing fields this app needs');
  }
  return {payload: body, etag: response.headers.get('ETag'), notModified: false};
}

/**
 * Pull an event id out of whatever the user typed — a full event URL, a
 * management URL, a bare id. Only used as a fallback when browsing and search
 * are both unavailable; the normal way to add an event is to pick it off a list.
 */
export function parseEventRef(input: string): number | null {
  const trimmed = input.trim();
  if (/^\d+$/.test(trimmed)) {
    return parseInt(trimmed, 10);
  }
  const match = trimmed.match(/\/event\/(\d+)/);
  return match?.[1] ? parseInt(match[1], 10) : null;
}

// -- finding events -------------------------------------------------------

export interface EventSummary {
  id: number;
  title: string;
  startDate: string | null;
  endDate: string | null;
  location: string | null;
  categoryPath: string[];
}

interface LegacyDate {
  date?: string;
}

/**
 * A listing request that failed is not a listing that is empty.
 *
 * "No events here" invites giving up; "could not load them" invites retrying,
 * and the picker needs to know which words to use. The outcome is a value
 * rather than a thrown error because a 404 or 422 — no such listing, query
 * rejected — genuinely *is* an empty answer and flows to the same caller.
 */
export type EventListing =
  | {failed: false; events: EventSummary[]}
  | {failed: true; error: ApiError};

/** Wrap a network-level failure as a failed listing rather than a throw. */
function failedListing(caught: unknown): EventListing {
  const error = caught instanceof ApiError ? caught : new ApiError('offline', 'No connection');
  return {failed: true, error};
}

/**
 * Browse a category: its sub-categories and the events directly in it.
 *
 * Two requests because Indico splits them: `/category/<id>/info` knows the tree,
 * and the legacy export knows the events. Neither needs a plugin, and both
 * return only what the current user is allowed to see.
 */
export interface CategoryListing {
  id: number;
  title: string;
  path: {id: number; title: string}[];
  subcategories: {id: number; title: string; deep_event_count?: number}[];
  events: EventListing;
}

export async function fetchCategory(categoryId: number): Promise<CategoryListing> {
  const infoResponse = await request(`/category/${categoryId}/info`);
  const failure = classify(infoResponse);
  if (failure) {
    throw failure;
  }
  const info = (await infoResponse.json()) as {
    category: {id: number; title: string; path: {id: number; title: string}[]};
    subcategories: {id: number; title: string; deep_event_count?: number}[];
  };

  return {
    id: info.category.id,
    title: info.category.title,
    path: info.category.path ?? [],
    subcategories: info.subcategories ?? [],
    events: await fetchCategoryEvents(categoryId),
  };
}

async function fetchCategoryEvents(categoryId: number): Promise<EventListing> {
  // A wide window rather than "upcoming": people look up a conference that
  // started yesterday at least as often as one starting tomorrow.
  //
  // Days, not years: Indico's date parser rejects `-1y` with
  // "Impossible to parse '-1y'", and only the `d`/`w`/`m` units are safe.
  const params = new URLSearchParams({from: '-365d', to: '730d', limit: '200', pretty: 'no'});
  let response: Response;
  try {
    response = await request(`/export/categ/${categoryId}.json?${params}`);
  } catch (caught) {
    return failedListing(caught);
  }
  if (!response.ok) {
    // 404 and 422 are answers — no such listing, rejected query. Everything
    // else (403, 429, a 500) must keep its identity: presenting it as an
    // empty category would tell the user there is nothing here to add.
    if (response.status === 404 || response.status === 422) {
      return {failed: false, events: []};
    }
    return {failed: true, error: classify(response) ?? new ApiError('server', `Indico returned ${response.status}`, response.status)};
  }
  let body: {
    results?: {
      id: string;
      title: string;
      startDate?: LegacyDate;
      endDate?: LegacyDate;
      location?: string;
    }[];
  };
  try {
    body = await response.json();
  } catch {
    return {failed: true, error: new ApiError('contract', 'Indico returned something that is not an event list')};
  }
  const events = (body.results ?? [])
    .map(item => ({
      id: parseInt(item.id, 10),
      title: item.title,
      startDate: item.startDate?.date ?? null,
      endDate: item.endDate?.date ?? null,
      location: item.location || null,
      categoryPath: [],
    }))
    .filter(item => Number.isFinite(item.id))
    .sort((a, b) => (b.startDate ?? '').localeCompare(a.startDate ?? ''));
  return {failed: false, events};
}

/** Search events by title, using Indico's own search API. */
export async function searchEvents(query: string): Promise<EventListing> {
  const params = new URLSearchParams({q: query, type: 'event'});
  let response: Response;
  try {
    response = await request(`/search/api/search?${params}`);
  } catch (caught) {
    return failedListing(caught);
  }
  if (!response.ok) {
    // 422 simply means the query was rejected (too short, say) — not an error
    // worth showing, just no results. Anything else is a search that did not
    // happen, which must not read as "no matching events".
    if (response.status === 404 || response.status === 422) {
      return {failed: false, events: []};
    }
    return {failed: true, error: classify(response) ?? new ApiError('server', `Indico returned ${response.status}`, response.status)};
  }
  let body: {
    results?: {
      event_id: number;
      title: string;
      start_dt?: string;
      end_dt?: string;
      location?: {venue_name?: string; room_name?: string};
      category_path?: {title: string}[];
    }[];
  };
  try {
    body = await response.json();
  } catch {
    return {failed: true, error: new ApiError('contract', 'Indico returned something that is not a result list')};
  }
  const events = (body.results ?? []).map(item => ({
    id: item.event_id,
    title: item.title,
    startDate: item.start_dt?.slice(0, 10) ?? null,
    endDate: item.end_dt?.slice(0, 10) ?? null,
    location: item.location?.venue_name || item.location?.room_name || null,
    categoryPath: (item.category_path ?? []).map(part => part.title),
  }));
  return {failed: false, events};
}

// -- abstracts ------------------------------------------------------------

export interface ContributionDetail {
  /** Full abstract, as HTML from Indico. Rendered through an allow-list. */
  description: string | null;
  speakers: {name: string; affiliation: string | null}[];
}

interface LegacyPerson {
  fullName?: string;
  first_name?: string;
  last_name?: string;
  affiliation?: string;
}

function personName(person: LegacyPerson): string {
  return (
    person.fullName ||
    [person.first_name, person.last_name].filter(Boolean).join(' ') ||
    ''
  ).trim();
}

/**
 * Abstracts and speaker affiliations for a whole event, in one request.
 *
 * The block-schedule payload deliberately carries only a short preview (and
 * often not even that — the plugin's `description_display` defaults to
 * `hidden`), because it is sized for a grid cell. The detail screen wants the
 * real thing, so it comes from Indico's export API instead.
 *
 * Returns an **empty map** when the organisers have not published the event's
 * contributions — their decision, and a real answer — but **null** when the
 * request itself failed. The difference matters downstream: "nobody published
 * an abstract" and "we have not fetched them yet" look identical on screen
 * unless the app keeps them apart.
 */
export async function fetchContributionDetails(
  eventId: number
): Promise<Map<number, ContributionDetail> | null> {
  const response = await request(`/export/event/${eventId}.json?detail=contributions`);
  const details = new Map<number, ContributionDetail>();
  if (!response.ok) {
    return null;
  }
  let body: {
    results?: {
      contributions?: {
        db_id?: number;
        id?: number | string;
        description?: string;
        speakers?: LegacyPerson[];
        primaryauthors?: LegacyPerson[];
      }[];
    }[];
  };
  try {
    body = await response.json();
  } catch {
    return null;
  }

  for (const contribution of body.results?.[0]?.contributions ?? []) {
    // `db_id` is the real contribution id; `id` is the per-event friendly
    // number, which does NOT match the schedule payload's ids.
    const id = contribution.db_id;
    if (typeof id !== 'number') {
      continue;
    }
    const people = [...(contribution.speakers ?? []), ...(contribution.primaryauthors ?? [])];
    const seen = new Set<string>();
    const speakers: ContributionDetail['speakers'] = [];
    for (const person of people) {
      const name = personName(person);
      if (!name || seen.has(name)) {
        continue;
      }
      seen.add(name);
      speakers.push({name, affiliation: person.affiliation?.trim() || null});
    }
    details.set(id, {description: contribution.description?.trim() || null, speakers});
  }
  return details;
}

/** Where to send someone who needs to sign in, returning them here afterwards. */
export function loginUrl(): string {
  const here = window.location.pathname + window.location.search;
  return `/login/?next=${encodeURIComponent(here)}`;
}

/**
 * The event's sponsors, or null when there are none to have.
 *
 * The Event Sponsors plugin is optional and its feature is off by default, so a
 * 404 here is the ordinary case rather than a fault — most events will never
 * have sponsors, and none of them should see an error because of it. Every
 * failure returns null for the same reason: sponsors are a courtesy block at the
 * foot of a screen, and nothing about them should be able to break a schedule.
 */
export async function fetchSponsors(eventId: number): Promise<SponsorsPayload | null> {
  let response: Response;
  try {
    response = await request(`/event/${eventId}/sponsors/data`);
  } catch {
    return null;
  }
  if (!response.ok) {
    return null;
  }
  try {
    const payload = (await response.json()) as SponsorsPayload;
    return payload && Array.isArray(payload.sponsors) ? payload : null;
  } catch {
    return null;
  }
}
