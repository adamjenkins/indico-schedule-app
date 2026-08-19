import {useEffect, useMemo, useState} from 'react';

import {
  ApiError,
  CategoryListing,
  EventListing,
  EventSummary,
  fetchCategory,
  parseEventRef,
  searchEvents,
} from '../api';
import {formatDay} from '../format';
import {knownVerdicts, PROBE_BATCH, probeEvents} from '../probe';
import {addEvent} from '../sync';
import {Sheet} from './Sheet';
import {Spinner} from './States';

/**
 * Picking an event, rather than typing a URL.
 *
 * The app is served by Indico, so it already knows which server it is talking
 * to — asking for an address would be asking the user to retype something the
 * app can see. Two ways in, both reading Indico's own endpoints:
 *
 *   browse   the category tree, drilling down from the top
 *   search   Indico's search API, for when you know the name
 *
 * The id box at the bottom is a deliberate last resort: it only appears when
 * browsing has turned up nothing, which is also the situation where an event
 * might be unlisted and therefore genuinely unfindable any other way.
 *
 * Only events that actually have a block schedule are offered. Indico cannot be
 * asked that question directly, so each candidate is checked one at a time in
 * the background (see `probe.ts`) and appears once it comes back positive. That
 * is why this list fills in rather than arriving complete, and why it works
 * through a listing in batches instead of all at once.
 */
export function AddEventSheet({
  known,
  onClose,
  onAdded,
}: {
  known: Set<number>;
  onClose: () => void;
  onAdded: (eventId: number) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<EventListing | null>(null);
  const [category, setCategory] = useState<CategoryListing | null>(null);
  const [categoryId, setCategoryId] = useState(0);
  // Bumped by the Try again buttons: re-running the effect is the retry.
  const [browseAttempt, setBrowseAttempt] = useState(0);
  const [searchAttempt, setSearchAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  // Browse: load whichever category we are looking at.
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    fetchCategory(categoryId).then(
      listing => {
        if (live) {
          setCategory(listing);
          setLoading(false);
        }
      },
      (caught: unknown) => {
        if (live) {
          setError(
            caught instanceof ApiError && caught.kind === 'auth'
              ? 'You do not have access to this category.'
              : 'Could not load the list of events.'
          );
          setLoading(false);
        }
      }
    );
    return () => {
      live = false;
    };
  }, [categoryId, browseAttempt]);

  // Search, debounced so a fast typist does not queue a request per keystroke.
  // `searchEvents` reports failure as a value, so there is no rejection path.
  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setResults(null);
      return;
    }
    const timer = window.setTimeout(() => {
      void searchEvents(term).then(setResults);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query, searchAttempt]);

  const add = async (eventId: number) => {
    setBusyId(eventId);
    setError(null);
    try {
      await addEvent(eventId);
      onAdded(eventId);
    } catch (caught) {
      const kind = caught instanceof ApiError ? caught.kind : null;
      setError(
        kind === 'auth'
          ? 'You do not have access to that event.'
          : kind === 'noschedule'
            ? 'That event has no block schedule set up, so there would be nothing to show.'
            : kind === 'notfound'
              ? 'No block schedule there — either no event has that id, or its Block Schedule feature is switched off.'
              : 'Could not add that event.'
      );
      setBusyId(null);
    }
  };

  const searching = query.trim().length >= 2;
  // Whichever listing is on screen, as a discriminated result: a failed one
  // contributes no candidates, but must not be mistaken for an empty one.
  const listing = searching ? results : (category?.events ?? null);
  const listingFailed = listing !== null && listing.failed;
  const candidates = useMemo(
    () => (listing && !listing.failed ? listing.events : []),
    [listing]
  );
  const filter = useScheduleFilter(candidates);
  const listed = filter.shown;

  const retryListing = () => {
    if (searching) {
      // Back to null so the spinner shows while the retry is in flight.
      setResults(null);
      setSearchAttempt(current => current + 1);
    } else {
      setBrowseAttempt(current => current + 1);
    }
  };

  return (
    <Sheet label="Add an event" onClose={onClose} className="picker-sheet">
      <header>
          <h2>Add an event</h2>
          <button className="iconbtn" onClick={onClose}>
            Close
          </button>
        </header>

        <input
          className="field"
          type="search"
          inputMode="search"
          placeholder="Search events by name"
          value={query}
          onChange={event => setQuery(event.target.value)}
        />

        <div className="scroll" style={{marginTop: 10}}>
          {!searching && category ? (
            <Breadcrumb listing={category} onNavigate={setCategoryId} />
          ) : null}

          {loading && !searching ? <Spinner /> : null}

          {!searching && category
            ? category.subcategories.map(sub => (
                <button key={sub.id} className="option" onClick={() => setCategoryId(sub.id)}>
                  <span className="folder" aria-hidden="true">
                    ›
                  </span>
                  <span>{sub.title}</span>
                  {sub.deep_event_count ? <span className="count">{sub.deep_event_count}</span> : null}
                </button>
              ))
            : null}

          {searching && results === null ? <Spinner /> : null}

          {listed.map(event => (
            <EventOption
              key={event.id}
              event={event}
              already={known.has(event.id)}
              busy={busyId === event.id}
              onAdd={() => void add(event.id)}
            />
          ))}

          {/* A failed listing gets its own words and a retry: "no events" and
              "could not load them" call for opposite advice. */}
          {listingFailed ? (
            <div className="probe-progress">
              <p className="meta">
                {listing.error.kind === 'auth'
                  ? 'You do not have access to these events.'
                  : `Could not load ${searching ? 'search results' : 'the events here'} — the connection or the server did not answer.`}
              </p>
              <button className="btn ghost" onClick={retryListing}>
                Try again
              </button>
            </div>
          ) : null}

          <FilterProgress filter={filter} />

          {/* `unresolved` keeps the dead-end honest: with checks unanswered,
              "none of these has a schedule" would be an assertion nobody made. */}
          {!loading &&
          !listingFailed &&
          !filter.checking &&
          filter.unresolved === 0 &&
          listed.length === 0 &&
          !filter.more &&
          (!category?.subcategories.length || searching) ? (
            <NoResults
              searching={searching}
              skipped={filter.total > 0}
              onAddById={add}
            />
          ) : null}

          {error ? (
            <p className="meta" style={{color: 'var(--danger)', marginTop: 12}}>
              {error}
            </p>
          ) : null}
      </div>
    </Sheet>
  );
}

interface ScheduleFilter {
  /** Candidates confirmed to have a block schedule, in listing order. */
  shown: EventSummary[];
  checking: boolean;
  /** How many of the current batch have an answer, and how big that batch is. */
  checked: number;
  batch: number;
  /** Candidates in the listing overall, checked or not. */
  total: number;
  /** How many are still unchecked beyond the current batch. */
  more: number;
  checkMore: () => void;
  /** How many checks failed outright — connection or server, not the event. */
  unresolved: number;
  /** Ask again about the events whose checks failed. */
  retry: () => void;
}

/**
 * Narrow a listing to the events that have a block schedule.
 *
 * Each answer costs a request, so this works through the listing in batches and
 * reports progress rather than pretending to be instant. Answers already on the
 * device are applied first and cost nothing, which is why a category visited
 * twice fills in immediately.
 */
function useScheduleFilter(candidates: EventSummary[]): ScheduleFilter {
  // A verdict of `null` means the check itself failed — flaky wifi, a 500 —
  // and is never persisted (see probe.ts), so a retry really does re-ask.
  const [verdicts, setVerdicts] = useState<Map<number, boolean | null>>(new Map());
  const [batch, setBatch] = useState(PROBE_BATCH);
  const [attempt, setAttempt] = useState(0);
  // Identity of the *listing*, not of the array: a re-render must not restart
  // the queue, but navigating to another category must.
  const listingKey = candidates.map(event => event.id).join(',');

  useEffect(() => {
    setBatch(PROBE_BATCH);
  }, [listingKey]);

  useEffect(() => {
    const signal = {cancelled: false};
    const slice = candidates.slice(0, batch).map(event => event.id);
    void (async () => {
      const cached = await knownVerdicts(slice);
      if (signal.cancelled) {
        return;
      }
      if (cached.size > 0) {
        setVerdicts(previous => new Map([...previous, ...cached]));
      }
      await probeEvents(
        slice.filter(id => !cached.has(id)),
        (eventId, hasSchedule) =>
          setVerdicts(previous => new Map(previous).set(eventId, hasSchedule)),
        signal
      );
    })();
    return () => {
      // Closing the sheet, typing a new search or changing category stops the
      // queue between requests — there is no point paying for answers about a
      // list nobody is looking at any more.
      signal.cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listingKey, batch, attempt]);

  const slice = candidates.slice(0, batch);
  const checked = slice.filter(event => verdicts.has(event.id)).length;
  return {
    shown: slice.filter(event => verdicts.get(event.id) === true),
    checking: checked < slice.length,
    checked,
    batch: slice.length,
    total: candidates.length,
    more: Math.max(0, candidates.length - batch),
    checkMore: () => setBatch(current => current + PROBE_BATCH),
    unresolved: slice.filter(event => verdicts.get(event.id) === null).length,
    retry: () => {
      // Forget only the failed answers; the real ones are cached on the device
      // anyway, so the re-run pays one request per still-unanswered event.
      setVerdicts(previous => {
        const next = new Map(previous);
        for (const [id, verdict] of previous) {
          if (verdict === null) {
            next.delete(id);
          }
        }
        return next;
      });
      setAttempt(current => current + 1);
    },
  };
}

/**
 * The honest bit of this screen.
 *
 * Filtering costs one request per event, so the list arrives gradually and
 * stops at a batch boundary. Saying so — with the counts — is better than a
 * list that silently omits events the user knows exist.
 */
function FilterProgress({filter}: {filter: ScheduleFilter}) {
  if (filter.total === 0) {
    return null;
  }
  if (filter.checking) {
    return (
      <p className="meta probe-progress">
        Checking which events have a schedule… {filter.checked} of {filter.batch}
      </p>
    );
  }
  if (filter.unresolved > 0) {
    // Failed checks are not "no": saying so, and offering to ask again, is the
    // difference between "no schedules here" and the truth on flaky wifi.
    return (
      <div className="probe-progress">
        <p className="meta">
          Could not check {filter.unresolved} of these {filter.unresolved === 1 ? 'event' : 'events'} —
          the connection or the server did not answer.
        </p>
        <button className="btn ghost" onClick={filter.retry}>
          Try again
        </button>
      </div>
    );
  }
  if (filter.more > 0) {
    return (
      <div className="probe-progress">
        <p className="meta">
          Checked the first {filter.batch} of {filter.total} events here.
        </p>
        <button className="btn ghost" onClick={filter.checkMore}>
          Check {Math.min(filter.more, PROBE_BATCH)} more
        </button>
      </div>
    );
  }
  return null;
}

function Breadcrumb({
  listing,
  onNavigate,
}: {
  listing: CategoryListing;
  onNavigate: (id: number) => void;
}) {
  if (listing.path.length <= 1) {
    return null;
  }
  return (
    <div className="crumbs">
      {listing.path.map((part, index) => (
        <span key={part.id}>
          {index > 0 ? <span aria-hidden="true"> › </span> : null}
          {index === listing.path.length - 1 ? (
            <strong>{part.title}</strong>
          ) : (
            <button onClick={() => onNavigate(part.id)}>{part.title}</button>
          )}
        </span>
      ))}
    </div>
  );
}

function EventOption({
  event,
  already,
  busy,
  onAdd,
}: {
  event: EventSummary;
  already: boolean;
  busy: boolean;
  onAdd: () => void;
}) {
  const when =
    event.startDate && event.endDate && event.startDate !== event.endDate
      ? `${formatDay(event.startDate)} – ${formatDay(event.endDate)}`
      : event.startDate
        ? formatDay(event.startDate)
        : '';

  return (
    <button className="option event-option" onClick={onAdd} disabled={already || busy}>
      <span className="event-option-body">
        <span className="event-option-title">{event.title}</span>
        <span className="event-option-meta">
          {[when, event.location, event.categoryPath.slice(-1)[0]].filter(Boolean).join(' · ')}
        </span>
      </span>
      <span className="count">{already ? 'Added' : busy ? '…' : '+'}</span>
    </button>
  );
}

/**
 * The dead end, and the escape hatch from it.
 *
 * If neither browsing nor search can see anything, the event may simply be
 * unlisted — in which case its id is the only way to reach it. Offering that
 * here, and only here, keeps it out of the way of the normal path.
 */
function NoResults({
  searching,
  skipped,
  onAddById,
}: {
  searching: boolean;
  /** True when events were found but none of them had a block schedule. */
  skipped: boolean;
  onAddById: (id: number) => void;
}) {
  const [value, setValue] = useState('');
  const parsed = parseEventRef(value);

  return (
    <div className="state" style={{padding: '24px 0'}}>
      <h2>
        {skipped
          ? 'No schedules here'
          : searching
            ? 'No matching events'
            : 'No events here'}
      </h2>
      <p>
        {skipped
          ? 'These events exist, but none of them has a block schedule set up — so there would be nothing for this app to show.'
          : searching
            ? 'Nothing on this server matches that name — or the event may be unlisted.'
            : 'This category has no events you can see.'}
      </p>
      <div className="row" style={{marginTop: 8}}>
        <input
          className="field"
          inputMode="numeric"
          placeholder="Event ID or link"
          value={value}
          onChange={event => setValue(event.target.value)}
        />
        <button className="btn" disabled={parsed === null} onClick={() => parsed && onAddById(parsed)}>
          Add
        </button>
      </div>
    </div>
  );
}
