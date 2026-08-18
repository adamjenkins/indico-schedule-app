import {useEffect, useRef, useState} from 'react';

import {removeEvent, StoredEvent} from '../db';
import {formatAge, formatDay} from '../format';
import {useEvents, useTicker} from '../hooks';
import {navigate} from '../router';
import {bump, getSyncStatus} from '../store';
import {syncEvent} from '../sync';
import {AddEventSheet} from './AddEventSheet';
import {InstallCard} from './InstallCard';
import {SiteLogo} from './SiteLogo';
import {EmptyState, Spinner} from './States';

/**
 * The library: which events this device follows.
 *
 * Events are picked from Indico's own category tree or its search, never typed
 * as a URL: the app is served by Indico, so it already knows which server it is
 * talking to.
 */
export function EventsScreen() {
  const {data: events, loading} = useEvents();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);

  useTicker();

  if (loading && !events) {
    return <Spinner />;
  }

  const list = events ?? [];

  return (
    <>
      <SiteLogo />
      <InstallCard />

      {list.length === 0 ? (
        <EmptyState
          glyph="🗓"
          title="No events yet"
          action={
            <button className="btn" onClick={() => setAdding(true)}>
              Add an event
            </button>
          }
        >
          Pick a conference from this Indico server and it will be saved to this device, so the
          whole schedule works with no signal.
        </EmptyState>
      ) : null}

      {list.map(event => (
        <EventCard
          key={event.id}
          event={event}
          editing={editing}
          onRemove={async () => {
            await removeEvent(event.id);
            bump();
          }}
        />
      ))}

      {list.length > 0 ? (
        <div className="row" style={{marginTop: 4}}>
          <button className="btn ghost" onClick={() => setAdding(true)}>
            Add event
          </button>
          <button className="btn ghost" onClick={() => setEditing(e => !e)}>
            {editing ? 'Done' : 'Edit'}
          </button>
        </div>
      ) : null}

      {adding ? (
        <AddEventSheet
          known={new Set(list.map(event => event.id))}
          onClose={() => setAdding(false)}
          onAdded={eventId => {
            setAdding(false);
            navigate(`event/${eventId}`);
          }}
        />
      ) : null}
    </>
  );
}

function EventCard({
  event,
  editing,
  onRemove,
}: {
  event: StoredEvent;
  editing: boolean;
  onRemove: () => void;
}) {
  const status = getSyncStatus(event.id);
  const failed = status.phase === 'error' || event.lastError !== null;
  const stale = event.lastSyncAt !== null && Date.now() - event.lastSyncAt > 60 * 60 * 1000;

  const dayRange =
    event.days.length === 0
      ? 'No days'
      : event.days.length === 1
        ? formatDay(event.days[0] as string)
        : `${formatDay(event.days[0] as string)} – ${formatDay(event.days[event.days.length - 1] as string)}`;

  const logo = useLogoUrl(event.logo, event.logoUrl);

  return (
    <div className="card">
      <div
        role="button"
        tabIndex={0}
        onClick={() => navigate(`event/${event.id}`)}
        onKeyDown={e => (e.key === 'Enter' ? navigate(`event/${event.id}`) : undefined)}
      >
        {logo ? (
          <div className="ev-logo">
            <img src={logo} alt="" />
          </div>
        ) : null}
        <h2>{event.title}</h2>
        <div className="meta">
          {dayRange} · {event.days.length} {event.days.length === 1 ? 'day' : 'days'}
        </div>
      </div>
      <div className="status">
        <span
          className={`dot${status.phase === 'syncing' ? '' : failed ? ' bad' : stale ? ' stale' : ''}`}
        />
        {status.phase === 'syncing'
          ? 'Refreshing…'
          : failed
            ? `Last refresh failed · saved copy from ${formatAge(event.lastSyncAt)}`
            : `Updated ${formatAge(event.lastSyncAt)}`}
        {editing ? (
          <button
            className="iconbtn"
            style={{marginLeft: 'auto', color: 'var(--danger)'}}
            onClick={onRemove}
          >
            Remove
          </button>
        ) : (
          <button
            className="iconbtn"
            style={{marginLeft: 'auto'}}
            onClick={() => void syncEvent(event.id)}
          >
            Refresh
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * An object URL for the event's stored logo, or null when it has none.
 *
 * Keyed on the logo's address rather than on the blob, because every read from
 * IndexedDB hands back a *new* Blob object for the same bytes — and the events
 * list re-reads its records whenever anything syncs. Keyed on the blob, this
 * would mint and revoke a URL on every sync, and revoking one an `<img>` is
 * still displaying is how a logo becomes a broken image for no reason the user
 * can see. The address contains the image's hash, so a replaced logo is a
 * different key and this can never show a stale one.
 */
function useLogoUrl(blob: Blob | null | undefined, key: string | null | undefined): string | null {
  const held = useRef<{key: string; url: string} | null>(null);

  useEffect(
    () => () => {
      if (held.current) {
        URL.revokeObjectURL(held.current.url);
        held.current = null;
      }
    },
    []
  );

  if (!blob || !key) {
    if (held.current) {
      URL.revokeObjectURL(held.current.url);
      held.current = null;
    }
    return null;
  }
  if (held.current?.key !== key) {
    if (held.current) {
      URL.revokeObjectURL(held.current.url);
    }
    held.current = {key, url: URL.createObjectURL(blob)};
  }
  return held.current.url;
}
