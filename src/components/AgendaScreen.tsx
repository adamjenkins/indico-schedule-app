import {Fragment, useState} from 'react';

import {getEventDays, setStar, StoredDay, StoredEvent} from '../db';
import {formatDay, formatMinutes, nowMinutes, todayIso} from '../format';
import {useEvents, useStars, useStored, useTicker} from '../hooks';
import {navigate} from '../router';
import {bump} from '../store';
import {BSContribution} from '../types';
import {EmptyState, Spinner} from './States';
import {TalkRow} from './TalkRow';

interface AgendaEntry {
  eventId: number;
  eventTitle: string;
  day: string;
  contribution: BSContribution;
  roomLabel: string | null;
  trackColor: string | null;
}

/**
 * The personal agenda: every starred talk, across every event, in time order.
 *
 * Two things this screen does beyond listing:
 *
 *   - **Finished talks are out of the way.** An agenda is something you consult
 *     during a conference to find out where to go next, and by the third day
 *     most of it is history. What is over is hidden behind a button rather than
 *     deleted, since the record of what you went to is still worth having.
 *   - **Clashes are drawn as a group.** Talks that overlap are boxed together
 *     with the time they collide, because the useful fact is *which* two talks
 *     you have promised yourself to, not that a clash exists somewhere.
 *
 * Starring is stored on this device only. That is a real limitation of this
 * build rather than an oversight — Indico 3.3.12 has nowhere to keep a
 * per-user starred contribution — so the screen says so instead of letting
 * someone assume their agenda is safe on the server.
 */
export function AgendaScreen() {
  const {data: events} = useEvents();
  const {data: stars, loading} = useStars();
  const [showFinished, setShowFinished] = useState(false);

  // Re-renders on a timer, which is what moves a talk from "now" to "finished"
  // without the user having to reload anything.
  useTicker();

  const {data: entries} = useStored(async () => {
    if (!events || !stars) {
      return [] as AgendaEntry[];
    }
    const byEvent = new Map<number, StoredEvent>(events.map(e => [e.id, e]));
    const starIds = new Set(stars.map(s => `${s.eventId}|${s.contributionId}`));
    const collected: AgendaEntry[] = [];

    for (const event of events) {
      const days: StoredDay[] = await getEventDays(event.id);
      for (const stored of days) {
        const rooms = new Map(stored.payload.columns.map(c => [c.id, c.title || c.label]));
        const trackColors = new Map(
          (stored.payload.tracks ?? []).filter(t => t.color).map(t => [t.id, t.color as string])
        );
        for (const contribution of stored.payload.scheduled_contributions) {
          if (!starIds.has(`${event.id}|${contribution.id}`)) {
            continue;
          }
          collected.push({
            eventId: event.id,
            eventTitle: byEvent.get(event.id)?.title ?? '',
            day: stored.day,
            contribution,
            roomLabel:
              contribution.column_id === null ? null : rooms.get(contribution.column_id) ?? null,
            trackColor:
              contribution.track_id === null
                ? null
                : trackColors.get(contribution.track_id) ?? null,
          });
        }
      }
    }

    return collected.sort(
      (a, b) =>
        a.day.localeCompare(b.day) ||
        (a.contribution.start_minutes ?? 0) - (b.contribution.start_minutes ?? 0)
    );
  }, [events?.length ?? 0, stars?.length ?? 0]);

  if (loading && !stars) {
    return <Spinner />;
  }

  const all = entries ?? [];

  if (all.length === 0) {
    return (
      <EmptyState glyph="★" title="No starred talks">
        Tap the star on any talk to build an agenda. It is kept on this device.
      </EmptyState>
    );
  }

  const finishedCount = all.filter(isFinished).length;
  const list = showFinished ? all : all.filter(entry => !isFinished(entry));
  const toggle =
    finishedCount === 0 ? null : (
      <button className="btn ghost finished-toggle" onClick={() => setShowFinished(v => !v)}>
        {showFinished
          ? 'Hide finished'
          : `Show finished (${finishedCount})`}
      </button>
    );

  if (list.length === 0) {
    return (
      <EmptyState glyph="✓" title="Nothing left today" action={toggle}>
        Every talk on your agenda has finished. They are still saved — show them to look back
        over what you went to.
      </EmptyState>
    );
  }

  return (
    <>
      <div className="banner">
        Saved on this device only — starring does not sync to your Indico account.
      </div>

      {clusters(list).map(group => {
        const first = group[0] as AgendaEntry;
        const previousDay = previousDayOf(list, first);
        return (
          <Fragment key={`${first.eventId}|${first.contribution.id}`}>
            {previousDay !== first.day ? (
              <div className="timehead">
                {formatDay(first.day).toUpperCase()}
                {list.some(other => other.eventId !== first.eventId)
                  ? ` · ${first.eventTitle}`
                  : ''}
              </div>
            ) : null}
            {group.length > 1 ? (
              <div className="clash">
                <div className="clash-head">
                  <span aria-hidden="true">⚠</span> Clash · {span(group)} · {group.length} talks
                  overlap
                </div>
                {group.map(entry => (
                  <Row key={`${entry.eventId}|${entry.contribution.id}`} entry={entry} />
                ))}
              </div>
            ) : (
              <Row entry={first} />
            )}
          </Fragment>
        );
      })}

      {toggle ? <div className="row">{toggle}</div> : null}
    </>
  );
}

function Row({entry}: {entry: AgendaEntry}) {
  return (
    <TalkRow
      contribution={entry.contribution}
      roomLabel={entry.roomLabel}
      trackColor={entry.trackColor}
      starred
      dimmed={isFinished(entry)}
      leadingPill={formatMinutes(entry.contribution.start_minutes)}
      onToggleStar={async () => {
        await setStar(entry.eventId, entry.contribution.id, false);
        bump();
      }}
      onOpen={() => navigate(`event/${entry.eventId}/${entry.day}/talk/${entry.contribution.id}`)}
    />
  );
}

function endOf(entry: AgendaEntry): number {
  return (entry.contribution.start_minutes ?? 0) + (entry.contribution.duration_minutes ?? 0);
}

/**
 * Has this talk already ended?
 *
 * Times in the payload are the event's own wall clock with no zone attached, so
 * this compares them against the device's clock. At a conference those are the
 * same clock; reading the agenda for next week's conference three time zones
 * away is the case where the boundary can be an hour or two out, which is why
 * finished talks are hidden rather than discarded.
 */
function isFinished(entry: AgendaEntry): boolean {
  if (entry.contribution.start_minutes === null) {
    return false;
  }
  const today = todayIso();
  if (entry.day !== today) {
    return entry.day < today;
  }
  return endOf(entry) <= nowMinutes();
}

/**
 * Split the list into runs of talks that overlap each other.
 *
 * A run is grown while the next talk starts before the furthest end seen so
 * far, which makes the grouping transitive: A overlapping B and B overlapping C
 * puts all three together even when A and C never touch. Entries are already
 * sorted by day and start time, and connected runs of intervals are contiguous
 * in that order, so one pass is enough.
 */
function clusters(entries: AgendaEntry[]): AgendaEntry[][] {
  const out: AgendaEntry[][] = [];
  let current: AgendaEntry[] = [];
  let reach = -Infinity;

  for (const entry of entries) {
    const start = entry.contribution.start_minutes;
    const sameDay = current.length > 0 && (current[0] as AgendaEntry).day === entry.day;
    if (current.length === 0 || !sameDay || start === null || start >= reach) {
      if (current.length) {
        out.push(current);
      }
      current = [entry];
      reach = start === null ? -Infinity : endOf(entry);
    } else {
      current.push(entry);
      reach = Math.max(reach, endOf(entry));
    }
  }
  if (current.length) {
    out.push(current);
  }
  return out;
}

/** The window a clash covers: first start to last end. */
function span(group: AgendaEntry[]): string {
  const start = (group[0] as AgendaEntry).contribution.start_minutes;
  const end = Math.max(...group.map(endOf));
  return `${formatMinutes(start)}–${formatMinutes(end)}`;
}

function previousDayOf(list: AgendaEntry[], entry: AgendaEntry): string | null {
  const index = list.indexOf(entry);
  return index > 0 ? (list[index - 1] as AgendaEntry).day : null;
}
