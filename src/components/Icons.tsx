/**
 * Tab-bar icons.
 *
 * Inline SVG rather than emoji or font glyphs. Emoji are rendered by the
 * platform, so a set mixing 🗓 with ★ comes out as one colour picture beside
 * three pieces of monochrome text — different weights, different sizes, and
 * different again on every OS. These are drawn on one 24-unit grid with one
 * stroke width, so the row reads as a set.
 */
const COMMON = {
  width: 22,
  height: 22,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

export function IconEvents() {
  return (
    <svg {...COMMON}>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="M7 9h10M7 13h10M7 17h6" />
    </svg>
  );
}

export function IconSchedule() {
  return (
    <svg {...COMMON}>
      <rect x="3" y="5" width="18" height="16" rx="2.5" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  );
}

export function IconStar({filled = false}: {filled?: boolean}) {
  return (
    <svg {...COMMON} fill={filled ? 'currentColor' : 'none'}>
      <path d="M12 4.2l2.35 4.76 5.25.77-3.8 3.7.9 5.23L12 16.19l-4.7 2.47.9-5.23-3.8-3.7 5.25-.77z" />
    </svg>
  );
}

export function IconSearch() {
  return (
    <svg {...COMMON}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
    </svg>
  );
}

export function IconSettings() {
  return (
    <svg {...COMMON} width={20} height={20}>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 14.5a1.7 1.7 0 00.35 1.87l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.7 1.7 0 00-1.87-.35 1.7 1.7 0 00-1.04 1.56V21a2 2 0 11-4 0v-.11a1.7 1.7 0 00-1.1-1.56 1.7 1.7 0 00-1.88.35l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.7 1.7 0 00.35-1.87 1.7 1.7 0 00-1.56-1.05H3a2 2 0 110-4h.11a1.7 1.7 0 001.56-1.1 1.7 1.7 0 00-.35-1.88l-.06-.06a2 2 0 112.83-2.83l.06.06a1.7 1.7 0 001.87.35H9a1.7 1.7 0 001-1.56V3a2 2 0 114 0v.11a1.7 1.7 0 001.05 1.56 1.7 1.7 0 001.87-.35l.06-.06a2 2 0 112.83 2.83l-.06.06a1.7 1.7 0 00-.35 1.87V9a1.7 1.7 0 001.56 1H21a2 2 0 110 4h-.11a1.7 1.7 0 00-1.56 1.05z" />
    </svg>
  );
}

export function IconBack() {
  return (
    <svg {...COMMON} width={20} height={20}>
      <path d="M15 5l-7 7 7 7" />
    </svg>
  );
}

export function IconFullscreen() {
  return (
    <svg {...COMMON}>
      <path d="M9 4H4v5M15 4h5v5M15 20h5v-5M9 20H4v-5" />
    </svg>
  );
}

export function IconBolt() {
  return (
    <svg {...COMMON}>
      <path d="M13 3L5.5 13.5H11l-1 7.5 7.5-10.5H12z" />
    </svg>
  );
}
