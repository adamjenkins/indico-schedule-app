/**
 * Object URLs for stored blobs, made once and kept.
 *
 * Every read from IndexedDB hands back a *new* Blob object for the same bytes,
 * and the screens re-read whenever anything syncs. So these are keyed by the
 * address the blob came from, never by the blob itself — and they are never
 * revoked. Revoking is what caused the bug this module exists to prevent: a URL
 * released while an `<img>` was still displaying it, which breaks the image for
 * no reason a user could see.
 *
 * Not revoking leaks, in the sense that a replaced logo's URL is held until the
 * tab closes. The bound is the number of distinct images an event has ever
 * shown this session — a handful — against the certainty of broken pictures the
 * other way round. A sponsor logo's address contains its stored file id, so a
 * replaced image is a different key and a stale one is never served.
 */
const urls = new Map<string, string>();

export function objectUrlFor(key: string, blob: Blob): string {
  let url = urls.get(key);
  if (!url) {
    url = URL.createObjectURL(blob);
    urls.set(key, url);
  }
  return url;
}
