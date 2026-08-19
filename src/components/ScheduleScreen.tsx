import {CSSProperties, Fragment, useCallback, useLayoutEffect, useMemo, useRef, useState} from 'react';

import {setStar} from '../db';
import {countActiveFilters, EMPTY_FILTERS, filterContributions, parseFilters, serializeFilters} from '../filters';
import {formatDay, formatTimeRange, nowMinutes, todayIso} from '../format';
import {markKey, useEventDays, useEventRecord, useSponsorMarks, useStarSet, useSyncStatus, useTicker} from '../hooks';
import {navigate, replaceSearch} from '../router';
import {bump} from '../store';
import {syncEvent} from '../sync';
import {BSContribution} from '../types';
import {FilterSheet} from './FilterSheet';
import {Sponsors} from './Sponsors';
import {Banner, EmptyState, ErrorState, Spinner, STORAGE_ERROR} from './States';
import {TalkRow, TimeHeading} from './TalkRow';

/**
 * The schedule for one day of one event.
 *
 * A time-ordered list rather than a room-by-time grid. The grid is the right
 * shape on paper and on a laptop, and the wrong shape on a phone: thirty
 * columns in 390 pixels is either unreadable or a horizontal scroll nobody can
 * navigate. The same information survives as "what is on, when, and where".
 */
export function ScheduleScreen({
  eventId,
  day,
  search,
}: {
  eventId: number;
  day: string | null;
  search: string;
}) {
  const {data: event} = useEventRecord(eventId);
  const {data: days, loading, error: readError} = useEventDays(eventId);
  const starred = useStarSet(eventId);
  const [sheetOpen, setSheetOpen] = useState(false);

  useTicker(60_000);
  // With the other hooks and above the early returns below: a hook called after
  // a conditional return changes the hook count between renders.
  const sponsorMarks = useSponsorMarks();

  const filters = useMemo(() => parseFilters(search), [search]);
  const status = useSyncStatus(eventId);

  const selectedDay = day ?? event?.days[0] ?? days?.[0]?.day ?? null;
  const stored = days?.find(d => d.day === selectedDay);

  const view = useMemo(
    () => (stored ? filterContributions(stored.payload, filters) : null),
    [stored, filters]
  );

  // One function shared by every row, so a star tap re-renders the row it
  // changed and the memoised rest bail out. The row hands back its own
  // contribution and star state, which is what keeps these closure-free.
  const toggleStar = useCallback(
    (contribution: BSContribution, starred: boolean) => {
      void setStar(eventId, contribution.id, !starred).then(() => bump('stars'));
    },
    [eventId]
  );
  const openTalk = useCallback(
    (contribution: BSContribution) => navigate(`event/${eventId}/${selectedDay}/talk/${contribution.id}`),
    [eventId, selectedDay]
  );

  // The sticky header's measured height feeds the time headings' offset: they
  // must pin *below* it, and its height is not a constant — the day strip only
  // exists on multi-day events, and the chips row wraps on narrow screens.
  const headRef = useRef<HTMLDivElement | null>(null);
  const [headHeight, setHeadHeight] = useState(0);
  useLayoutEffect(() => {
    const head = headRef.current;
    if (!head) {
      return;
    }
    const measure = () => setHeadHeight(head.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(head);
    return () => observer.disconnect();
  }, [stored !== undefined]);

  if (loading && !days) {
    return <Spinner />;
  }

  // The stored copy could not be *read* — different from not having one, and
  // "Nothing saved for this day" below would be the wrong story to tell.
  if (readError) {
    return <ErrorState error={STORAGE_ERROR} />;
  }

  if (!stored) {
    // Nothing cached for this day. If a refresh is what failed, say why;
    // otherwise this is simply an event whose first sync has not landed.
    if (status.error) {
      return <ErrorState error={status.error} onRetry={() => void syncEvent(eventId)} hasCache={false} />;
    }
    return status.phase === 'syncing' ? (
      <Spinner />
    ) : (
      <EmptyState
        glyph="🗓"
        title="Nothing saved for this day"
        action={
          <button className="btn ghost" onClick={() => void syncEvent(eventId)}>
            Refresh
          </button>
        }
      >
        This day has not been downloaded yet.
      </EmptyState>
    );
  }

  const grid = stored.payload;
  const {items, dimmed} = view!;
  const rooms = new Map(grid.columns.map(c => [c.id, c.title || c.label]));
  const trackColors = new Map(
    (grid.tracks ?? []).filter(t => t.color).map(t => [t.id, t.color as string])
  );
  const activeCount = countActiveFilters(filters);

  const setFilters = (next: typeof filters) => {
    replaceSearch(serializeFilters(next));
    setSheetOpen(false);
  };

  const showNowLine = selectedDay === todayIso();
  const currentMinutes = nowMinutes();
  let nowDrawn = false;

  return (
    <div className="schedule-view" style={{'--schedhead-h': `${headHeight}px`} as CSSProperties}>
      {/* Day tabs and the filter row stay pinned while the list scrolls: on a
          long day they are otherwise thousands of pixels from the thumb, and
          the scroll container is .main, so not even iOS's tap-the-status-bar
          gesture would bring them back. */}
      <div className="schedhead" ref={headRef}>
        {event && event.days.length > 1 ? (
          <div className="daytabs">
            {event.days.map(candidate => (
              <button
                key={candidate}
                aria-current={candidate === selectedDay}
                onClick={() => navigate(`event/${eventId}/${candidate}${serializeFilters(filters)}`)}
              >
                {formatDay(candidate)}
              </button>
            ))}
          </div>
        ) : null}

        <div className="chips">
          <button className={activeCount ? 'chip on' : 'chip'} onClick={() => setSheetOpen(true)}>
            {activeCount ? `Filtered · ${activeCount}` : 'Filter'}
          </button>
          {activeCount ? (
            <button className="chip" onClick={() => setFilters(EMPTY_FILTERS)}>
              Clear <span className="x">×</span>
            </button>
          ) : null}
          <span className="chip" style={{border: 0, background: 'none', color: 'var(--muted)'}}>
            {view!.visibleColumns.length} of {grid.columns.length} rooms · {items.length} talks
          </span>
        </div>
      </div>

      {/* Below the sticky header rather than inside it: a failed-refresh note
          should be read once and allowed to scroll away, not pinned over the
          schedule for the rest of the day. */}
      {status.error ? (
        <Banner tone="bad" action={{label: 'Retry', onClick: () => void syncEvent(eventId)}}>
          {status.error.kind === 'offline'
            ? 'Offline — showing the copy saved on this device.'
            : `Could not refresh: ${status.error.message}.`}
        </Banner>
      ) : null}

      {/* Above the talks, but below the day tabs and the filter controls: those
          are navigation and belong where the thumb expects them. This is the
          top of the *schedule*, which is what the setting promises. */}
      <Sponsors eventId={eventId} position="above" />

      {items.length === 0 ? (
        <EmptyState
          glyph="🔍"
          title="Nothing matches"
          action={
            activeCount ? (
              <button className="btn ghost" onClick={() => setFilters(EMPTY_FILTERS)}>
                Clear the filter
              </button>
            ) : undefined
          }
        >
          {activeCount
            ? 'No talks in the selected rooms and tracks on this day.'
            : 'Nothing is scheduled on this day yet.'}
        </EmptyState>
      ) : null}

      {items.map((contribution, index) => {
        const previous = index > 0 ? items[index - 1] : undefined;
        const newTime = previous?.start_minutes !== contribution.start_minutes;
        const drawNow =
          showNowLine && !nowDrawn && (contribution.start_minutes ?? 0) > currentMinutes;
        if (drawNow) {
          nowDrawn = true;
        }
        return (
          <Fragment key={contribution.id}>
            {drawNow ? (
              <div className="nowline">
                <span className="label">NOW</span>
                <span className="bar" />
              </div>
            ) : null}
            {newTime ? <TimeHeading minutes={contribution.start_minutes} /> : null}
            <TalkRow
              contribution={contribution}
              // The heading groups talks by when they start; the pill says when
              // this one ends, which the heading cannot -- talks starting
              // together do not finish together.
              leadingPill={formatTimeRange(contribution.start_minutes, contribution.duration_minutes)}
              roomLabel={contribution.column_id === null ? null : rooms.get(contribution.column_id) ?? null}
              trackColor={
                contribution.track_id === null ? null : trackColors.get(contribution.track_id) ?? null
              }
              sponsor={sponsorMarks.get(markKey(eventId, contribution.id)) ?? null}
              dimmed={dimmed.has(contribution.id)}
              starred={starred.has(contribution.id)}
              onToggleStar={toggleStar}
              onOpen={openTalk}
            />
          </Fragment>
        );
      })}

      <Sponsors eventId={eventId} position="below" />

      {sheetOpen ? (
        <FilterSheet
          gridData={grid}
          filters={filters}
          onApply={setFilters}
          onClose={() => setSheetOpen(false)}
        />
      ) : null}
    </div>
  );
}
