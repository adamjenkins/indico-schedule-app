import {useEffect, useState} from 'react';

import {fetchCurrentUser, loginUrl} from '../api';
import {clearAll, estimateUsage} from '../db';
import {formatAge, formatBytes} from '../format';
import {useEvents, useStars} from '../hooks';
import {navigate} from '../router';
import {bump} from '../store';
import {syncAll} from '../sync';
import {fetchBuildId} from '../update';
import {InstallCard} from './InstallCard';

/**
 * Settings, and the place where the app explains itself.
 *
 * Two things belong here rather than in a help page nobody opens: how refresh
 * actually works, and the fact that starred talks live on this device only.
 * Both are limitations a user would otherwise discover at the worst moment.
 */
export function SettingsScreen() {
  const {data: events} = useEvents();
  const {data: stars} = useStars();
  const [usage, setUsage] = useState<number | null>(null);
  const [user, setUser] = useState<{name: string} | null | undefined>(undefined);
  const [buildId, setBuildId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    void estimateUsage().then(setUsage);
    void fetchBuildId().then(setBuildId);
    void fetchCurrentUser().then(current =>
      setUser(current ? {name: current.full_name ?? current.email ?? 'signed in'} : null)
    );
  }, []);

  const lastSync = (events ?? [])
    .map(event => event.lastSyncAt)
    .filter((value): value is number => value !== null)
    .sort((a, b) => b - a)[0];

  return (
    <>
      {/* compact: always shown here, even after being dismissed on the events
          screen, so there is one place the instructions can be found again. */}
      <InstallCard compact />

      <div className="settings-group">
        <h2>INDICO</h2>
        <div className="kv">
          <span>Signed in as</span>
          <span>
            {user === undefined ? '…' : user ? user.name : 'Not signed in'}
          </span>
        </div>
        {user === null ? (
          <p className="meta" style={{marginTop: 10}}>
            Public events work without signing in. <a href={loginUrl()}>Sign in to Indico</a> to see
            events restricted to your account.
          </p>
        ) : null}
      </div>

      <div className="settings-group">
        <h2>SAVED DATA</h2>
        <div className="kv">
          <span>Events</span>
          <span>{events?.length ?? 0}</span>
        </div>
        <div className="kv">
          <span>Starred talks</span>
          <span>{stars?.length ?? 0}</span>
        </div>
        <div className="kv">
          <span>On this device</span>
          <span>{formatBytes(usage)}</span>
        </div>
        <div className="kv">
          <span>Last refresh</span>
          <span>{formatAge(lastSync ?? null)}</span>
        </div>
      </div>

      <div className="settings-group">
        <h2>HOW REFRESH WORKS</h2>
        <p className="meta">
          The app fetches the schedule <strong>once when it starts</strong>, and otherwise only when
          you ask it to. There is no background timer, so it never refreshes while you are not
          looking at it. Everything you see is drawn from the copy on this device, which is why it
          works with no connection.
        </p>
        <button className="btn ghost block" style={{marginTop: 10}} onClick={() => void syncAll()}>
          Refresh everything now
        </button>
      </div>

      <div className="settings-group">
        <h2>STARRED TALKS</h2>
        <p className="meta">
          Your agenda is stored on this device and does not sync to your Indico account. Clearing
          the data below, or removing the app, removes it.
        </p>
      </div>

      <div className="settings-group">
        <h2>RESET</h2>
        {confirming ? (
          <div className="row">
            <button
              className="btn danger"
              style={{flex: 1}}
              onClick={async () => {
                await clearAll();
                bump();
                setConfirming(false);
                navigate('');
              }}
            >
              Delete everything
            </button>
            <button className="btn ghost" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <button className="btn ghost block" onClick={() => setConfirming(true)}>
            Remove all saved data
          </button>
        )}
      </div>

      <div className="settings-group">
        <h2>APP</h2>
        <div className="kv">
          <span>Version</span>
          {/* The deployed build's id — the thing to quote in a bug report.
              A dash on the dev server, which has no asset manifest. */}
          <span>{buildId ?? '—'}</span>
        </div>
      </div>
    </>
  );
}
