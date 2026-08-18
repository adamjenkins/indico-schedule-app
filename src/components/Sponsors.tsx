import React, {useEffect, useMemo, useRef} from 'react';

import {getSponsors} from '../db';
import {useStored} from '../hooks';
import {SponsorEntry, SponsorTier} from '../types';

/**
 * The sponsors block at the foot of an event's schedule.
 *
 * Renders exactly what the event manager configured: the per-tier field choices
 * arrive resolved onto each sponsor, so this decides nothing about *what* to
 * show — only how to lay it out on a phone.
 *
 * Logo sizes are the plugin's `width_pct`, used exactly as given. It already
 * combines the tier's size with the template's "largest logo width" setting, so
 * scaling it here would quietly override a setting the manager can see and
 * change — which is what an earlier version of this did, and it made that box
 * on the settings page do nothing at all in the app.
 *
 * The app has its own template, so the manager can size it for a phone
 * independently of the printed page.
 */
export function Sponsors({eventId, position}: {eventId: number; position: 'above' | 'below'}) {
  const {data: stored} = useStored(() => getSponsors(eventId), [eventId]);

  const urls = useObjectUrls(stored?.logos);
  const byTier = useMemo(() => {
    if (!stored) {
      return [] as {tier: SponsorTier; sponsors: SponsorEntry[]}[];
    }
    return stored.payload.tiers
      .map(tier => ({
        tier,
        sponsors: stored.payload.sponsors.filter(s => s.tier_id === tier.id),
      }))
      .filter(group => group.sponsors.length > 0);
  }, [stored]);

  // Where the block goes is the event manager's choice, made in the plugin. The
  // screen renders this component in both places and each one bows out unless
  // it is the one that was asked for -- which is what stops a block from ever
  // appearing twice.
  const wanted = stored?.payload.template?.above_schedule ? 'above' : 'below';
  if (!stored || byTier.length === 0 || wanted !== position) {
    return null;
  }

  // A `list` template stacks its sponsors one per row unless the tier is marked
  // to flow inline — the same rule the plugin applies to the page, so a manager
  // who arranges a headline tier on its own row gets that on the phone too.
  const stacked = stored.payload.template?.layout === 'list';

  return (
    <section className={`sponsors sponsors-${position}`} aria-label="Sponsors">
      <h2 className="sponsors-head">Sponsors</h2>
      {byTier.map(({tier, sponsors}) => (
        <div
          key={tier.id}
          className={stacked && !tier.inline ? 'sponsor-tier stacked' : 'sponsor-tier'}
          data-tier={tier.name}
        >
          {sponsors.map(sponsor => (
            <SponsorCard
              key={sponsor.id}
              sponsor={sponsor}
              src={pickLogo(sponsor, urls)}
              width={`${tier.width_pct}%`}
            />
          ))}
        </div>
      ))}
    </section>
  );
}

function SponsorCard({
  sponsor,
  src,
  width,
}: {
  sponsor: SponsorEntry;
  src: string | null;
  width: string;
}) {
  const {show} = sponsor;
  const body = (
    <>
      {src ? (
        <span className="sponsor-logo">
          <img src={src} alt={sponsor.name} loading="lazy" />
        </span>
      ) : null}
      {show.show_name ? <span className="sponsor-name">{sponsor.name}</span> : null}
      {show.show_tagline && sponsor.tagline ? (
        <span className="sponsor-tagline">{sponsor.tagline}</span>
      ) : null}
      {show.show_description && sponsor.description ? (
        <span className="sponsor-description">{sponsor.description}</span>
      ) : null}
    </>
  );

  // The width goes on the card, not on the logo inside it. A percentage width
  // resolves against the parent's content box, and the card is sized by its own
  // contents — so a percentage there measured itself and came out arbitrary,
  // which is why the setting appeared to do nothing.
  const style = {'--sp-w': width} as React.CSSProperties;

  // Offline, an external link is a dead end — but it is the sponsor's own
  // address and worth keeping rather than second-guessing the connection.
  return show.linked && sponsor.url ? (
    <a className="sponsor" style={style} href={sponsor.url} target="_blank" rel="noopener noreferrer">
      {body}
    </a>
  ) : (
    <span className="sponsor" style={style}>
      {body}
    </span>
  );
}

function pickLogo(sponsor: SponsorEntry, urls: Record<string, string>): string | null {
  const {show} = sponsor;
  // A template asking for the square logo falls back to the ordinary one rather
  // than rendering a gap — "square" is a preference about shape, not a promise
  // that somebody uploaded two files. Same rule the plugin applies.
  const preferred = show.show_square_logo ? sponsor.square_logo_url : sponsor.logo_url;
  const fallback = show.show_square_logo ? sponsor.logo_url : sponsor.square_logo_url;
  if (!show.show_logo && !show.show_square_logo) {
    return null;
  }
  for (const url of [preferred, fallback]) {
    if (url && urls[url]) {
      return urls[url] as string;
    }
  }
  return null;
}

/**
 * Object URLs for the stored blobs, made once and kept until the screen goes.
 *
 * Keyed by the logo's own URL rather than by the blob, because every read from
 * IndexedDB hands back a *new* Blob object for the same bytes — so keying by
 * the blob would mint a fresh object URL on every re-read.
 *
 * Revoking on each change is what the obvious version of this does, and it is
 * wrong: any refresh bumps the store's revision, the record is re-read, and the
 * URLs the images are currently displaying get revoked out from under them. The
 * images then break, and they break most reliably offline, where the startup
 * refresh fails immediately instead of taking a moment. A logo's URL contains
 * its stored file id, so a replaced logo is a different key and this can never
 * serve a stale image; the handful of superseded entries are released together
 * when the screen unmounts.
 */
function useObjectUrls(logos: Record<string, Blob> | undefined): Record<string, string> {
  const cache = useRef(new Map<string, string>());

  useEffect(
    () => () => {
      cache.current.forEach(url => URL.revokeObjectURL(url));
      cache.current.clear();
    },
    []
  );

  return useMemo(() => {
    const urls: Record<string, string> = {};
    for (const [key, blob] of Object.entries(logos ?? {})) {
      let url = cache.current.get(key);
      if (!url) {
        url = URL.createObjectURL(blob);
        cache.current.set(key, url);
      }
      urls[key] = url;
    }
    return urls;
  }, [logos]);
}
