import {memo, ReactNode} from 'react';

import {readableTextColor, trackColor} from '../colors';
import {formatMinutes} from '../format';
import {BSContribution} from '../types';

/**
 * One talk in a list — the app's most repeated element, so it is shared by the
 * schedule, the agenda and the search results rather than reimplemented three
 * times with drifting details.
 *
 * The row is a plain container holding two sibling buttons: one around the
 * text that opens the talk, and the star. A row that is itself a
 * `role="button"` reads to assistive tech as a single leaf control named by
 * its whole concatenated content, with the nested star — and its
 * `aria-pressed` — swallowed. Two real siblings keep both reachable. Tapping
 * anywhere on the row still opens the talk: the open button stretches an
 * `::after` overlay across the card, and the star column stacks above it.
 *
 * Memoised, because a schedule day is hundreds of these and a star tap must
 * repaint one of them, not the list. That only holds if the callbacks keep
 * their identity across renders, which is why they receive the row's own
 * contribution (and starred state) as arguments: the parent can pass the same
 * function to every row instead of minting a closure per row per render.
 */
export const TalkRow = memo(function TalkRow({
  contribution,
  roomLabel,
  dimmed = false,
  starred,
  onToggleStar,
  onOpen,
  leadingPill,
  title,
  trackColor: chosenTrackColor,
  sponsor,
}: {
  contribution: BSContribution;
  roomLabel: string | null;
  dimmed?: boolean;
  starred: boolean;
  onToggleStar: (contribution: BSContribution, starred: boolean) => void;
  onOpen: (contribution: BSContribution) => void;
  /** Shown before the room, for lists where the time is not implied by a heading. */
  leadingPill?: string;
  /** Overrides the plain title, so search results can highlight the match. */
  title?: ReactNode;
  /** The manager's colour for this contribution's track, if the payload carried one. */
  trackColor?: string | null;
  /** A sponsor attached to this talk, drawn small in the corner. */
  sponsor?: {url: string; name: string} | null;
}) {
  const accent = trackColor(contribution.track_id, chosenTrackColor);
  // Only a real colour gets a coloured pill. The fallback palette already shows on the
  // stripe, and repeating it on the pill turns every card into two competing colour blocks.
  const trackPillStyle = chosenTrackColor
    ? {backgroundColor: accent, color: readableTextColor(accent)}
    : undefined;

  return (
    <div className={dimmed ? 'talk dim' : 'talk'} style={{borderLeftColor: accent}}>
      <div className="body">
        {/* Buttons only take phrasing content, so the lines inside are spans
            made block by the stylesheet. */}
        <button className="talk-open" onClick={() => onOpen(contribution)}>
          <span className="title">{title ?? contribution.title}</span>
          {contribution.people.length > 0 ? (
            <span className="who">{contribution.people.join(', ')}</span>
          ) : null}
          <span className="tags">
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
          </span>
        </button>
      </div>
      <div className="talk-side">
      <button
        className={starred ? 'starbtn on' : 'starbtn'}
        aria-pressed={starred}
        aria-label={starred ? 'Remove from my agenda' : 'Add to my agenda'}
        onClick={() => onToggleStar(contribution, starred)}
      >
        {starred ? '★' : '☆'}
      </button>
      {/* Lower right, under the star: small enough to be a credit rather than a
          claim on the row, and never a link -- tapping a talk should open the
          talk, whoever is sponsoring it. */}
      {sponsor ? (
        <span className="talk-sponsor">
          <img src={sponsor.url} alt={`Sponsored by ${sponsor.name}`} title={sponsor.name} loading="lazy" />
        </span>
      ) : null}
      </div>
    </div>
  );
});

/** A time heading above a run of talks that all start at the same minute. */
export function TimeHeading({minutes}: {minutes: number | null}) {
  return <div className="timehead">{formatMinutes(minutes)}</div>;
}
