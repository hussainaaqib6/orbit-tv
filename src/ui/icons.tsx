// Line icons drawn for Orbit (24px grid, 1.8 stroke).
import type { JSX } from 'preact';

const P: Record<string, string> = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  live: 'M3 7h18v12H3zM8 3l4 4 4-4',
  guide: 'M3 5h18M3 12h18M3 19h18M9 5v4M15 12v4M7 19v0',
  movies: 'M4 4h16v16H4zM8 4v16M16 4v16M4 9h4M4 15h4M16 9h4M16 15h4',
  series: 'M7 4h13v12H7zM4 8v12h12',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  play: 'M7 4.5v15l12.5-7.5z',
  pause: 'M7 4.5h3.5v15H7zM13.5 4.5H17v15h-3.5z',
  back10: 'M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4',
  fwd10: 'M20 12a8 8 0 1 1-2.4-5.7M20 4v4h-4',
  restart: 'M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4M10 9v6l5-3z',
  list: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01',
  cc: 'M3 5h18v14H3zM10 10.5a2 2 0 1 0 0 3M17 10.5a2 2 0 1 0 0 3',
  audio: 'M4 9v6h4l5 4V5L8 9zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12',
  mute: 'M4 9v6h4l5 4V5L8 9zM17 9l5 6M22 9l-5 6',
  aspect: 'M3 5h18v14H3zM7 9v-.5h3M17 15v.5h-3',
  speed: 'M12 20a8 8 0 1 1 8-8M12 12l4-3',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  close: 'M6 6l12 12M18 6 6 18',
  left: 'M15 5l-7 7 7 7',
  right: 'M9 5l7 7-7 7',
  up: 'M5 15l7-7 7 7',
  down: 'M5 9l7 7 7-7',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13 7l4 4',
  check: 'M5 12l5 5 9-10',
  episodes: 'M4 5h16M4 10h16M4 15h10M4 20h7',
  tv: 'M3 6h18v12H3zM8 21h8',
  file: 'M6 3h8l4 4v14H6zM14 3v4h4',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01',
  history: 'M3 12a9 9 0 1 0 3-6.7M3 4v5h5M12 8v4l3 2',
  next: 'M5 5v14l10-7zM18 5v14',
  prev: 'M19 5v14L9 12zM6 5v14',
  power: 'M12 3v8M6.3 6.3a8 8 0 1 0 11.4 0',
  zoomin: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4M8 11h6M11 8v6',
};

export type IconName = keyof typeof P;

export function Icon({ name, ...rest }: { name: IconName } & JSX.SVGAttributes<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill={name === 'play' || name === 'pause' ? 'currentColor' : 'none'} stroke="currentColor" stroke-width={name === 'more' ? 3.6 : 1.8} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" {...rest}>
      <path d={P[name]} />
    </svg>
  );
}

export const OrbitMark = (p: JSX.SVGAttributes<SVGSVGElement>) => (
  <svg viewBox="0 0 32 32" aria-hidden="true" {...p}>
    <circle cx="16" cy="16" r="6" fill="currentColor" />
    <ellipse cx="16" cy="16" rx="14" ry="6" fill="none" stroke="currentColor" stroke-width="2" transform="rotate(-25 16 16)" />
  </svg>
);
