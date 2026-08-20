import {getDetails, setStar} from '../db';
import {formatDayLong, formatDuration, formatTimeRange} from '../format';
import {useEventDays, useSponsorDetailMark, useStarSet, useStored} from '../hooks';
import {RichText} from '../richtext';
import {bump} from '../store';
import {EmptyState, Spinner} from './States';

/**
 * One talk.
 *
 * Everything here comes from the local copy — opening a talk never makes a
 * request, so it works in a lift. That includes the abstract: the schedule
 * payload only carries a short preview sized for a grid cell (and often not
 * even that), so the full text is fetched separately when the event is synced
 * and stored alongside it.
 */
export function TalkScreen({
  eventId,
  day,
  contributionId,
}: {
  eventId: number;
  day: string;
  contributionId: number;
}) {
  const {data: days, loading} = useEventDays(eventId);
  const {data: details} = useStored(() => getDetails(eventId), [eventId], ['details']);
  const starred = useStarSet(eventId);
  // Read before the early returns below, because a hook cannot be skipped. Null
  // whenever this talk has no sponsor with a stored logo, and null too for an
  // event whose payload predates the setting or whose manager switched the
  // detail logo off — this surface only appears when an event asks for it.
  const sponsor = useSponsorDetailMark(eventId, contributionId);

  if (loading && !days) {
    return <Spinner />;
  }

  const stored = days?.find(d => d.day === day);
  const contribution = stored?.payload.scheduled_contributions.find(c => c.id === contributionId);

  if (!stored || !contribution) {
    return (
      <EmptyState glyph="🔍" title="Talk not found">
        It may have been moved or unscheduled since this day was last downloaded.
      </EmptyState>
    );
  }

  const column = stored.payload.columns.find(c => c.id === contribution.column_id);
  const room = column ? column.title || column.label : null;
  const group = stored.payload.groups.find(g => column && g.column_ids.includes(column.id));
  const isStarred = starred.has(contribution.id);

  const detail = details?.byContribution[contribution.id];
  // Prefer the full abstract; fall back to the grid's preview, which is all
  // there is when the event's contributions have not been published.
  const abstract = detail?.description ?? contribution.description ?? null;
  const speakers = detail?.speakers.length
    ? detail.speakers
    : contribution.people.map(name => ({name, affiliation: null}));

  return (
    <div className="detail">
      <h1>{contribution.title}</h1>

      {speakers.length > 0 ? (
        <div className="speakers">
          {speakers.map(person => (
            <div key={person.name} className="speaker">
              <span>{person.name}</span>
              {person.affiliation ? <span className="affiliation">{person.affiliation}</span> : null}
            </div>
          ))}
        </div>
      ) : null}

      <dl className="facts">
        <div>
          <dt>When</dt>
          <dd>
            {formatDayLong(day)},{' '}
            {formatTimeRange(contribution.start_minutes, contribution.duration_minutes)}
            {contribution.duration_minutes
              ? ` (${formatDuration(contribution.duration_minutes)})`
              : ''}
          </dd>
        </div>
        {room ? (
          <div>
            <dt>Room</dt>
            <dd>
              {room}
              {group ? ` (${group.title})` : ''}
            </dd>
          </div>
        ) : null}
        {contribution.track_name ? (
          <div>
            <dt>Track</dt>
            <dd>{contribution.track_name}</dd>
          </div>
        ) : null}
        {contribution.session_name ? (
          <div>
            <dt>Session</dt>
            <dd>{contribution.session_name}</dd>
          </div>
        ) : null}
      </dl>

      {abstract ? (
        <section className="abstract">
          <h2>Abstract</h2>
          <RichText html={abstract} />
        </section>
      ) : details ? (
        <p className="meta abstract-missing">No abstract was published for this talk.</p>
      ) : (
        <p className="meta abstract-missing">
          Abstracts have not been downloaded yet — pull down to refresh.
        </p>
      )}

      {/* Under the abstract, at the width the event manager configured. The logo
          comes from the blob stored on the device, addressed by an object URL —
          the same rule as every other logo here, and the reason a talk screen
          still shows it with the phone in flight mode. Not a link: this is a
          credit on a page about the talk, not an invitation to leave it. */}
      {sponsor ? (
        <div className="detail-sponsor" style={{width: `${sponsor.width}${sponsor.unit}`}}>
          <img src={sponsor.url} alt={`Sponsored by ${sponsor.name}`} title={sponsor.name} />
        </div>
      ) : null}

      <div className="row" style={{margin: '18px 0 12px'}}>
        <button
          className={isStarred ? 'btn' : 'btn ghost'}
          style={{flex: 1}}
          aria-pressed={isStarred}
          onClick={async () => {
            await setStar(eventId, contribution.id, !isStarred);
            bump('stars');
          }}
        >
          {isStarred ? '★ In my agenda' : '☆ Add to my agenda'}
        </button>
      </div>

      <a href={contribution.url} target="_blank" rel="noreferrer">
        Open in Indico ↗
      </a>
    </div>
  );
}
