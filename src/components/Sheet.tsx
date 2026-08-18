import {ReactNode} from 'react';
import {createPortal} from 'react-dom';

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
 */
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
  return createPortal(
    <div className="scrim" onClick={onClose} role="presentation">
      <div
        className={`sheet ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={event => event.stopPropagation()}
      >
        <div className="grip" />
        {children}
      </div>
    </div>,
    document.body
  );
}
