/**
 * Track colours.
 *
 * A track's colour is chosen by the event manager and arrives in the grid-data
 * payload. Where nobody has chosen one — or where the schedule was cached from
 * a server too old to send any — the app falls back to a colour derived from
 * the track id, so a schedule is never a wall of identical grey.
 *
 * The fallback is derived from the id rather than from position, so a track's
 * colour stays the same when another track is added: a colour that shifts under
 * you is worse than no colour at all.
 *
 * Colour is decoration and never the only carrier of meaning — the track name
 * is on the card too.
 */
const TRACK_COLORS = [
  '#2f6fb0',
  '#b4632a',
  '#4a8a52',
  '#7a4f9c',
  '#b0413e',
  '#2b8a8a',
  '#8a7638',
  '#5b6bb5',
  '#9c4f7a',
  '#547a4f',
];

/**
 * The colour for a track: the manager's if there is one, otherwise the derived
 * fallback. `chosen` is whatever the payload carried, with or without a `#`.
 */
export function trackColor(trackId: number | null, chosen?: string | null): string {
  if (chosen) {
    return chosen.startsWith('#') ? chosen : `#${chosen}`;
  }
  if (trackId === null) {
    return 'var(--rule)';
  }
  const index = ((trackId % TRACK_COLORS.length) + TRACK_COLORS.length) % TRACK_COLORS.length;
  return TRACK_COLORS[index] as string;
}

function relativeLuminance(hex: string): number {
  const normalized = hex.replace('#', '');
  const linear = [0, 2, 4].map(offset => {
    const channel = parseInt(normalized.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

/** WCAG contrast ratio between two colours, from 1 (identical) to 21 (black on white). */
export function contrastRatio(a: string, b: string): number {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Black or white on `hex`, whichever reads better — the same rule the plugin
 * applies to its own badges, so a track looks the same on the phone as on the
 * printed grid.
 *
 * Taking the better of only those two can never fall below 4.58:1, so every
 * colour a manager can pick clears WCAG AA for normal text.
 */
export function readableTextColor(hex: string): string {
  if (!hex.startsWith('#') || hex.length < 7) {
    // A CSS variable rather than a colour: leave the stylesheet's own text colour alone.
    return 'inherit';
  }
  return contrastRatio(hex, '#000000') >= contrastRatio(hex, '#ffffff') ? '#000000' : '#ffffff';
}
