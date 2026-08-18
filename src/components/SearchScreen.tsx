import {Fragment, useEffect, useState} from 'react';

import {getEventDays, setStar, StoredDay} from '../db';
import {formatDay, formatMinutes} from '../format';
import {useEvents, useStars, useStored} from '../hooks';
import {navigate, replaceSearch} from '../router';
import {bump} from '../store';
import {highlight, searchDays, SearchHit} from '../search';
import {EmptyState} from './States';
import {TalkRow} from './TalkRow';

/**
 * Search, across every cached event.
 *
 * Runs entirely against the local copy, which is the point: the moment you most
 * need to find a talk is standing in a corridor with one bar of signal.
 */
export function SearchScreen({query}: {query: string}) {
  const [value, setValue] = useState(query);
  const {data: events} = useEvents();
  const {data: stars} = useStars();

  // Keep the URL in step so a search can be shared or reloaded, but debounce it
  // so typing does not rewrite history on every keystroke.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      replaceSearch(value.trim() ? `?q=${encodeURIComponent(value.trim())}` : '');
    }, 300);
    return () => window.clearTimeout(timer);
  }, [value]);

  const {data: hits} = useStored(async () => {
    if (value.trim().length < 2 || !events) {
      return [] as SearchHit[];
    }
    const days: StoredDay[] = [];
    for (const event of events) {
      days.push(...(await getEventDays(event.id)));
    }
    return searchDays(days, value);
  }, [value, events?.length ?? 0]);

  const starIds = new Set((stars ?? []).map(s => `${s.eventId}|${s.contributionId}`));
  const results = hits ?? [];
  const titles = new Map((events ?? []).map(e => [e.id, e.title]));
  const multipleEvents = (events?.length ?? 0) > 1;

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

      {value.trim().length < 2 ? (
        <EmptyState glyph="⌕" title="Search your saved events">
          Two letters is enough to start. Titles, speakers, rooms, sessions and tracks are all
          searched, and it all happens on this device — no connection needed.
        </EmptyState>
      ) : results.length === 0 ? (
        <EmptyState glyph="🔍" title="No matches">
          Nothing in the saved events matches &ldquo;{value.trim()}&rdquo;.
        </EmptyState>
      ) : (
        <>
          <div className="resultcount">
            {results.length} {results.length === 1 ? 'talk' : 'talks'} · searched offline
          </div>
          {results.map(hit => (
            <Fragment key={`${hit.eventId}|${hit.day}|${hit.contribution.id}`}>
              <TalkRow
                contribution={hit.contribution}
                roomLabel={hit.roomLabel || null}
                trackColor={hit.trackColor}
                starred={starIds.has(`${hit.eventId}|${hit.contribution.id}`)}
                leadingPill={`${formatDay(hit.day)} ${formatMinutes(hit.contribution.start_minutes)}${
                  multipleEvents ? ` · ${titles.get(hit.eventId) ?? ''}` : ''
                }`}
                title={
                  <>
                    {highlight(hit.contribution.title, value).map((segment, index) =>
                      segment.match ? (
                        <mark key={index}>{segment.text}</mark>
                      ) : (
                        <Fragment key={index}>{segment.text}</Fragment>
                      )
                    )}
                  </>
                }
                onToggleStar={async () => {
                  const key = `${hit.eventId}|${hit.contribution.id}`;
                  await setStar(hit.eventId, hit.contribution.id, !starIds.has(key));
                  bump();
                }}
                onOpen={() => navigate(`event/${hit.eventId}/${hit.day}/talk/${hit.contribution.id}`)}
              />
            </Fragment>
          ))}
        </>
      )}
    </>
  );
}
