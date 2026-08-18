/** Small formatting helpers, kept together so the components stay about layout. */

const DAY_LABEL = new Intl.DateTimeFormat(undefined, {weekday: 'short', day: 'numeric', month: 'short'});
const DAY_LABEL_LONG = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

/**
 * Format an ISO date (`2026-09-04`) without letting it through a timezone
 * conversion — `new Date('2026-09-04')` is parsed as UTC midnight and can
 * render as the day before in a negative offset.
 */
function localDate(isoDay: string): Date {
  const [year, month, day] = isoDay.split('-').map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1);
}

export function formatDay(isoDay: string): string {
  return DAY_LABEL.format(localDate(isoDay));
}

export function formatDayLong(isoDay: string): string {
  return DAY_LABEL_LONG.format(localDate(isoDay));
}

/** Minutes past midnight, as the payload expresses times, to `09:05`. */
export function formatMinutes(minutes: number | null): string {
  if (minutes === null) {
    return '';
  }
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function formatTimeRange(start: number | null, durationMinutes: number | null): string {
  if (start === null) {
    return '';
  }
  if (durationMinutes === null) {
    return formatMinutes(start);
  }
  return `${formatMinutes(start)} – ${formatMinutes(start + durationMinutes)}`;
}

export function formatDuration(minutes: number | null): string {
  if (minutes === null) {
    return '';
  }
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

/**
 * "just now" / "12 min ago" / "3 hours ago" / "Tue 15 Sep".
 * Deliberately coarse: the exact second of the last refresh is noise.
 */
export function formatAge(timestamp: number | null): string {
  if (timestamp === null) {
    return 'never';
  }
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) {
    return 'just now';
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes} min ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return hours === 1 ? 'an hour ago' : `${hours} hours ago`;
  }
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

export function formatBytes(bytes: number | null): string {
  if (bytes === null) {
    return 'unknown';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} kB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/** Minutes past local midnight, for the "now" marker. */
export function nowMinutes(): number {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}
