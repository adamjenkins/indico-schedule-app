import {Fragment, useMemo, useState} from 'react';

import {setStar} from '../db';
import {countActiveFilters, EMPTY_FILTERS, filterContributions, parseFilters, serializeFilters} from '../filters';
import {formatDay, formatTimeRange, nowMinutes, todayIso} from '../format';
import {markKey, useEventDays, useEventRecord, useSponsorMarks, useStarSet, useTicker} from '../hooks';
import {navigate, replaceSearch} from '../router';
import {bump, getSyncStatus} from '../store';
import {syncEvent} from '../sync';
import {FilterSheet} from './FilterSheet';
import {Sponsors} from './Sponsors';
import {Banner, EmptyState, ErrorState, Spinner} from './States';
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
  const {data: days, loading} = useEventDays(eventId);
  const starred = useStarSet(eventId);
  const [sheetOpen, setSheetOpen] = useState(false);

  useTicker(60_000);
  // With the other hooks and above the early returns below: a hook called after
  // a conditional return changes the hook count between renders.
  const sponsorMarks = useSponsorMarks();

  const filters = useMemo(() => parseFilters(search), [search]);
  const status = getSyncStatus(eventId);

  const selectedDay = day ?? event?.days[0] ?? days?.[0]?.day ?? null;
  const stored = days?.find(d => d.day === selectedDay);

  const view = useMemo(
    () => (stored ? filterContributions(stored.payload, filters) : null),
    [stored, filters]
  );

  if (loading && !days) {
    return <Spinner />;
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
    <>
      {event && event.days.length > 1 ? (
        <div className="daytabs" style={{margin: '-12px -14px 12px'}}>
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

      {status.error ? (
        <Banner tone="bad" action={{label: 'Retry', onClick: () => void syncEvent(eventId)}}>
          {status.error.kind === 'offline'
            ? 'Offline — showing the copy saved on this device.'
            : `Could not refresh: ${status.error.message}.`}
        </Banner>
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
              onToggleStar={async () => {
                await setStar(eventId, contribution.id, !starred.has(contribution.id));
                bump();
              }}
              onOpen={() => navigate(`event/${eventId}/${selectedDay}/talk/${contribution.id}`)}
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
    </>
  );
}
