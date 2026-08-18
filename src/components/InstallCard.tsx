import {useSyncExternalStore} from 'react';

import {
  dismiss,
  getInstallState,
  InstallState,
  isDismissed,
  promptInstall,
  subscribeInstall,
} from '../install';

function useInstallState(): InstallState {
  return useSyncExternalStore(subscribeInstall, getInstallState, getInstallState);
}

/**
 * The card that explains why there is still an address bar.
 *
 * It is deliberately specific about the reason. "Install this app" is useless
 * advice on iOS, where there is no install button; and it is actively
 * misleading on an http:// host, where installation is impossible no matter
 * what the user taps. Each case gets the instruction that actually applies.
 */
export function InstallCard({compact = false}: {compact?: boolean}) {
  const state = useInstallState();
  const hidden = useSyncExternalStore(subscribeInstall, isDismissed, isDismissed);

  if (state.kind === 'installed' || (hidden && !compact)) {
    return null;
  }

  if (state.kind === 'needs-https') {
    return (
      <div className="install install-warn">
        <div className="install-body">
          <strong>This app cannot be installed over http://</strong>
          <p>
            Home-screen installation and offline access need a secure connection. Ask for HTTPS
            on this server and the option will appear by itself — everything else here works in
            the meantime.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="install">
      <div className="install-icon" aria-hidden="true">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="6" y="2.5" width="12" height="19" rx="2.5" />
          <path d="M11 18.5h2" />
        </svg>
      </div>
      <div className="install-body">
        <strong>Add to your home screen</strong>
        {state.kind === 'ios-manual' ? (
          <p>
            Tap <ShareGlyph /> in Safari&rsquo;s toolbar, then <strong>Add to Home Screen</strong>.
            It then opens full-screen, with no address bar, and works with no signal.
          </p>
        ) : state.kind === 'promptable' ? (
          <p>Opens full-screen, with no address bar, and works with no signal.</p>
        ) : (
          <p>
            Open your browser&rsquo;s menu and choose <strong>Install app</strong> (or{' '}
            <strong>Add to Home screen</strong>). It then opens full-screen, with no address bar,
            and works with no signal.
          </p>
        )}
        <div className="install-actions">
          {state.kind === 'promptable' ? (
            <button className="btn" onClick={() => void promptInstall()}>
              Install
            </button>
          ) : null}
          {!compact ? (
            <button className="btn ghost" onClick={dismiss}>
              Not now
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** iOS's share icon, drawn rather than described — the word "Share" is not on it. */
function ShareGlyph() {
  return (
    <svg className="inline-glyph" width="15" height="15" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"
         aria-label="the Share button">
      <path d="M12 3v12" />
      <path d="M8 7l4-4 4 4" />
      <path d="M5 13v6.5a1.5 1.5 0 001.5 1.5h11a1.5 1.5 0 001.5-1.5V13" />
    </svg>
  );
}
