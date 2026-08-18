import {ReactNode} from 'react';

import {readableTextColor, trackColor} from '../colors';
import {formatMinutes} from '../format';
import {BSContribution} from '../types';

/**
 * One talk in a list — the app's most repeated element, so it is shared by the
 * schedule, the agenda and the search results rather than reimplemented three
 * times with drifting details.
 *
 * The star is a separate button inside the row: tapping the row opens the talk,
 * tapping the star only stars it. Nesting a real button inside another would be
 * invalid, so the row is a div with a click handler and an explicit role.
 */
export function TalkRow({
  contribution,
  roomLabel,
  dimmed = false,
  starred,
  onToggleStar,
  onOpen,
  leadingPill,
  title,
  trackColor: chosenTrackColor,
}: {
  contribution: BSContribution;
  roomLabel: string | null;
  dimmed?: boolean;
  starred: boolean;
  onToggleStar: () => void;
  onOpen: () => void;
  /** Shown before the room, for lists where the time is not implied by a heading. */
  leadingPill?: string;
  /** Overrides the plain title, so search results can highlight the match. */
  title?: ReactNode;
  /** The manager's colour for this contribution's track, if the payload carried one. */
  trackColor?: string | null;
}) {
  const accent = trackColor(contribution.track_id, chosenTrackColor);
  // Only a real colour gets a coloured pill. The fallback palette already shows on the
  // stripe, and repeating it on the pill turns every card into two competing colour blocks.
  const trackPillStyle = chosenTrackColor
    ? {backgroundColor: accent, color: readableTextColor(accent)}
    : undefined;

  return (
    <div
      className={dimmed ? 'talk dim' : 'talk'}
      style={{borderLeftColor: accent}}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      <div className="body">
        <div className="title">{title ?? contribution.title}</div>
        {contribution.people.length > 0 ? (
          <div className="who">{contribution.people.join(', ')}</div>
        ) : null}
        <div className="tags">
          {leadingPill ? <span className="pill">{leadingPill}</span> : null}
          {roomLabel ? <span className="pill room">{roomLabel}</span> : null}
          {contribution.track_name ? (
            <span className="pill" style={trackPillStyle}>
              {contribution.track_name}
            </span>
          ) : null}
          {contribution.session_name ? (
            <span className="pill">{contribution.session_name}</span>
          ) : null}
        </div>
      </div>
      <button
        className={starred ? 'starbtn on' : 'starbtn'}
        aria-pressed={starred}
        aria-label={starred ? 'Remove from my agenda' : 'Add to my agenda'}
        onClick={event => {
          event.stopPropagation();
          onToggleStar();
        }}
      >
        {starred ? '★' : '☆'}
      </button>
    </div>
  );
}

/** A time heading above a run of talks that all start at the same minute. */
export function TimeHeading({minutes}: {minutes: number | null}) {
  return <div className="timehead">{formatMinutes(minutes)}</div>;
}
