import {useEffect, useState} from 'react';

import {detectPlatform, dismiss, promptInstall} from '../install';
import {IconBolt, IconFullscreen, IconStar} from './Icons';
import {useInstallState} from './InstallCard';
import {Sheet} from './Sheet';

/**
 * The unprompted invitation to install.
 *
 * What is and is not possible, because it is easy to promise too much:
 *
 *   Android/Chrome — a real native install dialog, but only from a user
 *                    gesture. The browser refuses `prompt()` on page load, so
 *                    the most automatic thing possible is to raise our own
 *                    sheet by itself and put the native dialog one tap away.
 *   iOS/Safari     — no install API of any kind. Instructions are the ceiling.
 *
 * So this appears on its own, once, a few seconds after the app is first
 * opened in a browser tab. Once dismissed or installed it never returns; the
 * quieter card on the Events screen remains for anyone who wants it later.
 *
 * The delay is deliberate. A modal that lands before the user has seen what
 * the app is gets dismissed reflexively, and dismissal is permanent.
 */
const SHOWN_KEY = 'indico-schedule:install-sheet-shown';
const DELAY_MS = 6000;

export function InstallSheet() {
  const [open, setOpen] = useState(false);
  // Subscribed, not sampled: on Android Chrome `beforeinstallprompt` lands
  // after this mounts, and this sheet is one-shot — a snapshot taken too early
  // would show "Not now" and nothing else on the one platform with a real
  // install dialog, then never return.
  const state = useInstallState();
  const platform = detectPlatform();

  useEffect(() => {
    if (
      localStorage.getItem(SHOWN_KEY) === '1' ||
      state.kind === 'installed' ||
      state.kind === 'needs-https' ||
      platform === 'desktop'
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      localStorage.setItem(SHOWN_KEY, '1');
      setOpen(true);
    }, DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [state.kind, platform]);

  if (!open) {
    return null;
  }

  const close = () => setOpen(false);

  return (
    <Sheet label="Add this app to your home screen" onClose={close} className="install-sheet">
      <div className="install-hero" aria-hidden="true">
          <img src={`${import.meta.env.BASE_URL}icons/icon-192.png`} alt="" width={64} height={64} />
        </div>

        <h2 id="install-sheet-title">Keep the schedule on your phone</h2>
        <ul className="install-points">
          <li>
            <IconStar /> Works with no signal, anywhere in the building
          </li>
          <li>
            <IconFullscreen /> Opens full screen, without the browser bar
          </li>
          <li>
            <IconBolt /> Starts instantly from your home screen
          </li>
        </ul>

        {state.kind === 'ios-manual' ? (
          <ol className="install-steps">
            <li>
              Tap <ShareGlyph /> at the bottom of Safari
            </li>
            <li>
              Choose <strong>Add to Home Screen</strong>
            </li>
            <li>
              Tap <strong>Add</strong>
            </li>
          </ol>
        ) : null}

        <div className="install-sheet-actions">
          {state.kind === 'promptable' ? (
            <button
              className="btn block"
              onClick={async () => {
                const accepted = await promptInstall();
                if (accepted) {
                  dismiss();
                }
                close();
              }}
            >
              Install
            </button>
          ) : null}
          <button className="btn ghost block" onClick={close}>
            {state.kind === 'ios-manual' ? 'Got it' : 'Not now'}
          </button>
      </div>
    </Sheet>
  );
}

function ShareGlyph() {
  return (
    <svg
      className="inline-glyph"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-label="the Share button"
    >
      <path d="M12 3v12" />
      <path d="M8 7l4-4 4 4" />
      <path d="M5 13v6.5a1.5 1.5 0 001.5 1.5h11a1.5 1.5 0 001.5-1.5V13" />
    </svg>
  );
}
