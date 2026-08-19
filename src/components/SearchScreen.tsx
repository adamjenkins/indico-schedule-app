import {Fragment, memo, useCallback, useDeferredValue, useEffect, useMemo, useState} from 'react';

import {getEventDays, setStar, StoredDay} from '../db';
import {formatDay, formatMinutes} from '../format';
import {markKey, SponsorMark, useEvents, useSponsorMarks, useStars, useStored} from '../hooks';
import {navigate, replaceSearch} from '../router';
import {bump} from '../store';
import {highlight, searchDays, SearchHit} from '../search';
import {EmptyState, ErrorState, STORAGE_ERROR} from './States';
import {TalkRow} from './TalkRow';

/**
 * A broad query matches most of a conference, and mounting a thousand rows
 * synchronously between keystrokes is how search kills its own keyboard. The
 * cap is generous enough that a query needing more of the list really needs
 * more letters instead — and the count line says so.
 */
const RESULT_CAP = 100;

/**
 * Search, across every cached event.
 *
 * Runs entirely against the local copy, which is the point: the moment you most
 * need to find a talk is standing in a corridor with one bar of signal.
 */
export function SearchScreen({query}: {query: string}) {
  const [value, setValue] = useState(query);
  const {data: events} = useEvents();
  const marks = useSponsorMarks();
  const {data: stars} = useStars();

  // Keep the URL in step so a search can be shared or reloaded, but debounce it
  // so typing does not rewrite history on every keystroke.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      replaceSearch(value.trim() ? `?q=${encodeURIComponent(value.trim())}` : '');
    }, 300);
    return () => window.clearTimeout(timer);
  }, [value]);

  // The day payloads are loaded once per data change, never per keystroke:
  // deserialising every cached day is the expensive half of a search, and the
  // query has no business re-triggering it.
  const {data: allDays, error: readError} = useStored(
    async () => {
      const days: StoredDay[] = [];
      for (const event of events ?? []) {
        days.push(...(await getEventDays(event.id)));
      }
      return days;
    },
    [events],
    ['events', 'days']
  );

  // The scan runs against the deferred query, so fast typing repaints the input
  // at full speed and the result list catches up when React finds a gap.
  const deferredQuery = useDeferredValue(value);
  const hits = useMemo(
    () => (deferredQuery.trim().length < 2 ? [] : searchDays(allDays ?? [], deferredQuery)),
    [allDays, deferredQuery]
  );
  const shown = useMemo(() => hits.slice(0, RESULT_CAP), [hits]);

  const starIds = useMemo(
    () => new Set((stars ?? []).map(s => `${s.eventId}|${s.contributionId}`)),
    [stars]
  );
  const titles = useMemo(() => new Map((events ?? []).map(e => [e.id, e.title])), [events]);
  const multipleEvents = (events?.length ?? 0) > 1;

  // Shared by every row (see TalkRow on why): the hit carries the event and day
  // that a bare contribution id cannot.
  const toggleStar = useCallback((hit: SearchHit, starred: boolean) => {
    void setStar(hit.eventId, hit.contribution.id, !starred).then(() => bump('stars'));
  }, []);
  const open = useCallback((hit: SearchHit) => {
    navigate(`event/${hit.eventId}/${hit.day}/talk/${hit.contribution.id}`);
  }, []);

  return (
    <>
      <div className="searchbar">
        <input
          className="field"
          type="search"
          inputMode="search"
          autoFocus
          placeholder="Talk, speaker, room or track"
          value={value}
          onChange={event => setValue(event.target.value)}
        />
      </div>

      {/* A read failure outranks "no matches": the saved events could not be
          searched at all, which is storage's fault, not the query's. */}
      {readError ? (
        <ErrorState error={STORAGE_ERROR} />
      ) : deferredQuery.trim().length < 2 ? (
        <EmptyState glyph="⌕" title="Search your saved events">
          Two letters is enough to start. Titles, speakers, rooms, sessions and tracks are all
          searched, and it all happens on this device — no connection needed.
        </EmptyState>
      ) : hits.length === 0 ? (
        <EmptyState glyph="🔍" title="No matches">
          Nothing in the saved events matches &ldquo;{deferredQuery.trim()}&rdquo;.
        </EmptyState>
      ) : (
        <>
          <div className="resultcount">
            {hits.length > shown.length
              ? `Showing ${shown.length} of ${hits.length} talks · searched offline`
              : `${hits.length} ${hits.length === 1 ? 'talk' : 'talks'} · searched offline`}
          </div>
          {shown.map(hit => (
            <ResultRow
              key={`${hit.eventId}|${hit.day}|${hit.contribution.id}`}
              hit={hit}
              query={deferredQuery}
              starred={starIds.has(`${hit.eventId}|${hit.contribution.id}`)}
              sponsor={marks.get(markKey(hit.eventId, hit.contribution.id)) ?? null}
              pill={`${formatDay(hit.day)} ${formatMinutes(hit.contribution.start_minutes)}${
                multipleEvents ? ` · ${titles.get(hit.eventId) ?? ''}` : ''
              }`}
              onToggleStar={toggleStar}
              onOpen={open}
            />
          ))}
        </>
      )}
    </>
  );
}

/**
 * One search result. The memo boundary sits here rather than on `TalkRow`
 * because the highlighted title is a fresh tree every time it is built — built
 * inside, it is only rebuilt when this row's own inputs change, so a star tap
 * repaints one row and the rest bail out.
 */
const ResultRow = memo(function ResultRow({
  hit,
  query,
  starred,
  sponsor,
  pill,
  onToggleStar,
  onOpen,
}: {
  hit: SearchHit;
  query: string;
  starred: boolean;
  sponsor: SponsorMark | null;
  pill: string;
  onToggleStar: (hit: SearchHit, starred: boolean) => void;
  onOpen: (hit: SearchHit) => void;
}) {
  return (
    <TalkRow
      contribution={hit.contribution}
      roomLabel={hit.roomLabel || null}
      trackColor={hit.trackColor}
      sponsor={sponsor}
      starred={starred}
      leadingPill={pill}
      title={
        <>
          {highlight(hit.contribution.title, query).map((segment, index) =>
            segment.match ? (
              <mark key={index}>{segment.text}</mark>
            ) : (
              <Fragment key={index}>{segment.text}</Fragment>
            )
          )}
        </>
      }
      onToggleStar={() => onToggleStar(hit, starred)}
      onOpen={() => onOpen(hit)}
    />
  );
});
