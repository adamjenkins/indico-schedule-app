/**
 * The organisation's logo, taken from Indico's own page header.
 *
 * Indico exposes no logo through any API: `LOGO_URL` is a server config value
 * that reaches exactly one place, the `<img class="header-logo">` in the site
 * header. So the app reads the home page once and lifts the logo from it.
 *
 * That is HTML scraping, and it is worth being honest about the cost: core's
 * header markup could change between Indico releases, and if it does the logo
 * quietly disappears rather than breaking anything. Every failure here is
 * silent for that reason — no logo is a fine outcome, an error screen is not.
 *
 * Nothing is parsed as HTML into the page: the document is inspected with
 * `DOMParser`, which never runs scripts, and only an attribute is read out.
 */
import {getBranding, putBranding, StoredBranding} from './db';
import {bump} from './store';

/** Checked at most this often — a logo changes about as rarely as anything can. */
const TTL = 7 * 24 * 60 * 60 * 1000;

/** Above this average luminance the artwork is treated as light-on-transparent. */
const LIGHT_THRESHOLD = 0.62;

function findLogo(html: string): {url: string; alt: string} | null {
  const document_ = new DOMParser().parseFromString(html, 'text/html');
  const image =
    document_.querySelector('img.header-logo') ?? document_.querySelector('header img[src]');
  const source = image?.getAttribute('src');
  if (!source) {
    return null;
  }
  const url = new URL(source, window.location.origin);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return null;
  }
  return {url: url.href, alt: image?.getAttribute('alt')?.trim() || 'Logo'};
}

/**
 * Is the artwork light?
 *
 * This matters more than it sounds. Indico's own default header logo is
 * `logo_indico_bw.svg`, which is solid white — it sits on the header's dark
 * band and is completely invisible on anything pale. Since the app cannot know
 * what a site has configured, it measures: the image is drawn to a canvas and
 * the average luminance of its non-transparent pixels decides whether the logo
 * needs a dark plate behind it.
 *
 * Returns null when the image cannot be measured (an SVG with no intrinsic
 * size, say), which the caller treats as "assume it needs the dark plate" —
 * the safe direction, since a dark logo on a dark plate is merely low
 * contrast, while a white logo on white is nothing at all.
 */
async function isLightArtwork(blob: Blob): Promise<boolean | null> {
  const url = URL.createObjectURL(blob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('could not decode the logo'));
      element.src = url;
    });
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    if (!width || !height) {
      return null;
    }
    // Downsampled: this is a brightness question, and a 64px-wide copy answers
    // it as well as the original while costing almost nothing to read back.
    const scale = Math.min(1, 64 / width);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d');
    if (!context) {
      return null;
    }
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const {data} = context.getImageData(0, 0, canvas.width, canvas.height);
    let total = 0;
    let counted = 0;
    for (let index = 0; index < data.length; index += 4) {
      const alpha = data[index + 3] ?? 0;
      if (alpha < 32) {
        continue;
      }
      const r = data[index] ?? 0;
      const g = data[index + 1] ?? 0;
      const b = data[index + 2] ?? 0;
      total += (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      counted += 1;
    }
    return counted === 0 ? null : total / counted > LIGHT_THRESHOLD;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Fetch the logo if we have none, or if the one we have is a week old.
 *
 * Runs at startup alongside the schedule refresh. Everything is best-effort:
 * offline, or on a server whose header has changed shape, this does nothing at
 * all and the app carries on without a logo.
 */
export async function refreshBranding(): Promise<void> {
  const existing = await getBranding();
  if (existing && Date.now() - existing.fetchedAt < TTL) {
    return;
  }
  try {
    const response = await fetch('/', {credentials: 'same-origin', headers: {Accept: 'text/html'}});
    if (!response.ok) {
      return;
    }
    const found = findLogo(await response.text());
    if (!found) {
      return;
    }
    // Kept as a blob rather than as a URL so the logo is there offline too —
    // the service worker deliberately caches only the app shell, and the logo
    // may well live outside it.
    let blob: Blob | null = null;
    let isLight = true;
    try {
      const image = await fetch(found.url, {credentials: 'same-origin'});
      if (image.ok) {
        blob = await image.blob();
        isLight = (await isLightArtwork(blob)) ?? true;
      }
    } catch {
      // A cross-origin logo cannot be read into a blob; it is still perfectly
      // usable as a plain <img src>, just not offline.
      blob = null;
    }
    const branding: StoredBranding = {
      key: 'branding',
      url: found.url,
      alt: found.alt,
      blob,
      isLight,
      fetchedAt: Date.now(),
    };
    await putBranding(branding);
    bump();
  } catch {
    // Offline, or the home page is not reachable. Nothing to say about it.
  }
}
