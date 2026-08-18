import {ReactNode, useCallback, useEffect, useRef, useState} from 'react';

/**
 * Pull-to-refresh.
 *
 * Worth the code because refresh is otherwise a button in a corner: this is the
 * gesture people already reach for, and having it is a large part of what makes
 * something feel like an app rather than a page.
 *
 * The browser's own pull-to-refresh is already suppressed by
 * `overscroll-behavior-y: none`, so this replaces it rather than fighting it.
 * Only vertical drags starting at the very top of the scroller count, and a
 * drag that is mostly horizontal is handed back immediately — otherwise the
 * gesture steals sideways scrolls from the day-tab strip.
 */
const THRESHOLD = 72;
const MAX_PULL = 110;

export function PullToRefresh({
  onRefresh,
  scrollRef,
  children,
}: {
  onRefresh: () => Promise<void> | void;
  scrollRef: React.RefObject<HTMLElement>;
  children: ReactNode;
}) {
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const start = useRef<{x: number; y: number} | null>(null);
  const decided = useRef<'vertical' | 'horizontal' | null>(null);

  const finish = useCallback(async () => {
    setBusy(true);
    setPull(0);
    try {
      await onRefresh();
    } finally {
      setBusy(false);
    }
  }, [onRefresh]);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) {
      return;
    }

    const onTouchStart = (event: TouchEvent) => {
      if (busy || node.scrollTop > 0 || event.touches.length !== 1) {
        start.current = null;
        return;
      }
      const touch = event.touches[0] as Touch;
      start.current = {x: touch.clientX, y: touch.clientY};
      decided.current = null;
    };

    const onTouchMove = (event: TouchEvent) => {
      const origin = start.current;
      if (!origin || busy) {
        return;
      }
      const touch = event.touches[0] as Touch;
      const dx = touch.clientX - origin.x;
      const dy = touch.clientY - origin.y;

      if (decided.current === null) {
        if (Math.abs(dx) < 4 && Math.abs(dy) < 4) {
          return;
        }
        decided.current = Math.abs(dy) > Math.abs(dx) ? 'vertical' : 'horizontal';
      }
      if (decided.current === 'horizontal' || dy <= 0 || node.scrollTop > 0) {
        start.current = null;
        setPull(0);
        return;
      }

      // Resistance, so the sheet does not track the finger 1:1 — the drag feels
      // like it is stretching something rather than dragging a panel.
      const distance = Math.min(MAX_PULL, dy * 0.5);
      setPull(distance);
      if (event.cancelable) {
        event.preventDefault();
      }
    };

    const onTouchEnd = () => {
      if (!start.current) {
        return;
      }
      start.current = null;
      setPull(current => {
        if (current >= THRESHOLD) {
          void finish();
        }
        return 0;
      });
    };

    node.addEventListener('touchstart', onTouchStart, {passive: true});
    node.addEventListener('touchmove', onTouchMove, {passive: false});
    node.addEventListener('touchend', onTouchEnd);
    node.addEventListener('touchcancel', onTouchEnd);
    return () => {
      node.removeEventListener('touchstart', onTouchStart);
      node.removeEventListener('touchmove', onTouchMove);
      node.removeEventListener('touchend', onTouchEnd);
      node.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [scrollRef, busy, finish]);

  const active = pull > 0 || busy;
  const ready = pull >= THRESHOLD;

  return (
    <>
      <div
        className={`ptr${active ? ' active' : ''}${busy ? ' busy' : ''}`}
        style={{height: busy ? THRESHOLD * 0.7 : pull, opacity: active ? 1 : 0}}
        aria-hidden={!active}
      >
        <span
          className="ptr-spinner"
          style={{
            transform: busy ? undefined : `rotate(${Math.min(1, pull / THRESHOLD) * 270}deg)`,
            opacity: Math.min(1, pull / 28),
          }}
        />
        <span className="ptr-label">{busy ? 'Refreshing…' : ready ? 'Release to refresh' : 'Pull to refresh'}</span>
      </div>
      <div style={{transform: pull ? `translateY(${pull}px)` : undefined}} className="ptr-content">
        {children}
      </div>
    </>
  );
}
