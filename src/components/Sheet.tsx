import {ReactNode, useEffect, useRef} from 'react';
import {createPortal} from 'react-dom';

import {navigate} from '../router';

/**
 * A bottom sheet, rendered into `document.body`.
 *
 * The portal is not decoration. Screens live inside a wrapper that animates on
 * navigation, and an element with a transform becomes the containing block for
 * its `position: fixed` descendants — so a sheet rendered in place was measured
 * against the screen rather than the viewport, and its z-index only competed
 * inside that subtree. The visible symptom was the tab bar painting straight
 * over the sheet. Pull-to-refresh sets a transform too, so the same trap was
 * waiting there.
 *
 * Rendering outside the app's subtree removes the whole class of problem.
 *
 * An open sheet is also a modal in the platform's sense, which carries three
 * obligations a plain portal does not meet:
 *
 *   back      On Android, back is the universal dismiss gesture. Opening
 *             pushes a history entry (same URL), so pressing back pops it and
 *             closes the sheet instead of leaving the screen — or the app.
 *             The scrim and Escape go through `history.back()` too, so every
 *             dismissal leaves the history stack where it started.
 *   focus     Focus moves into the dialog on open and returns to the opener
 *             on close; otherwise Tab keeps walking the content behind the
 *             scrim.
 *   inert     `.app` is inert while a sheet is up, so the background is
 *             unreachable by touch, keyboard and screen reader alike.
 */

/**
 * When a sheet closes programmatically (Apply, Install, …) its history entry
 * is still in the stack and has to be popped without the user noticing. The
 * pop is deferred a tick so that a remount in the same tick — StrictMode's
 * double-mount, or one sheet replacing another — can reclaim the live entry
 * instead of racing a `history.back()` that has not landed yet.
 */
let deferredPop: number | undefined;

function reclaimEntry(): boolean {
  if (deferredPop === undefined) {
    return false;
  }
  window.clearTimeout(deferredPop);
  deferredPop = undefined;
  return true;
}

/** Sheets can overlap briefly; `.app` stays inert until the last one is gone. */
let inertCount = 0;

export function Sheet({
  label,
  onClose,
  children,
  className = '',
}: {
  label: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closedByPop = useRef(false);
  const closing = useRef(false);
  // The latest onClose, without re-running the history effect when the parent
  // re-renders with a new closure.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Dismissal via back/scrim/Escape funnels through here: one guarded
  // `history.back()`, and the popstate it causes is what actually closes the
  // sheet — so a double tap on the scrim cannot pop two entries.
  const close = () => {
    if (closing.current || closedByPop.current) {
      return;
    }
    closing.current = true;
    history.back();
  };

  useEffect(() => {
    if (!reclaimEntry()) {
      history.pushState({sheet: true}, '', location.href);
    }
    const onPop = () => {
      closedByPop.current = true;
      onCloseRef.current();
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      if (closedByPop.current) {
        return;
      }
      deferredPop = window.setTimeout(() => {
        deferredPop = undefined;
        // The close itself may have changed the URL while our entry was on
        // top (Apply writes the filter query, Add navigates to the event), so
        // remember it, pop, and put it back. Both listeners run in the same
        // popstate dispatch, so React paints only the restored URL.
        const url = location.pathname + location.search;
        const restore = () => {
          window.removeEventListener('popstate', restore);
          navigate(url, {replace: true});
        };
        window.addEventListener('popstate', restore);
        history.back();
      });
    };
  }, []);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    const app = document.querySelector('.app');
    if (++inertCount === 1) {
      app?.setAttribute('inert', '');
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (--inertCount === 0) {
        app?.removeAttribute('inert');
      }
      opener?.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return createPortal(
    <div className="scrim" onClick={close} role="presentation">
      <div
        ref={dialogRef}
        className={`sheet ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onClick={event => event.stopPropagation()}
      >
        <div className="grip" />
        {children}
      </div>
    </div>,
    document.body
  );
}
