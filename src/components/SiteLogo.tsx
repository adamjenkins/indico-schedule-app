import {useEffect, useState} from 'react';

import {getBranding, StoredBranding} from '../db';
import {useStored} from '../hooks';

/**
 * The organisation's logo, at the top of the library screen.
 *
 * The image comes from Indico's own page header (see `branding.ts`), so the app
 * carries whatever branding the server already shows rather than needing its
 * own copy deployed alongside it.
 *
 * Two details that are not decoration. The logo sits on a plate whose colour is
 * chosen from the artwork's measured brightness — Indico's default header logo
 * is solid white, which on a pale background is simply not there. And the image
 * is rendered from a stored blob, so it appears on a cold offline start like
 * everything else in the app.
 *
 * Renders nothing at all until a logo is known, which keeps the screen from
 * jumping on first load and makes "this server has no logo" a non-event.
 */
export function SiteLogo() {
  const {data: branding} = useStored<StoredBranding | undefined>(() => getBranding(), [], ['branding']);
  const source = useBlobUrl(branding?.blob ?? null) ?? branding?.url ?? null;
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [source]);

  if (!branding || !source || failed) {
    return null;
  }

  return (
    <div className={`sitelogo${branding.isLight ? ' on-dark' : ''}`}>
      <img src={source} alt={branding.alt} onError={() => setFailed(true)} />
    </div>
  );
}

/** An object URL for a stored blob, revoked when it is replaced or unmounted. */
function useBlobUrl(blob: Blob | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const created = URL.createObjectURL(blob);
    setUrl(created);
    return () => URL.revokeObjectURL(created);
  }, [blob]);
  return url;
}
