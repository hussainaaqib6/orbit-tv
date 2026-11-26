// Icons: the Lucide set (lucide.dev), mapped to the names Orbit uses.
import type { JSX } from 'preact';
import {
  House, Search, CalendarRange, Tv, Clapperboard, Layers, Star, Settings, Play, Pause, RotateCcw, RotateCw,
  ChevronUp, ChevronDown, ChevronLeft, ChevronRight, List, ListVideo, Captions, Volume2, VolumeX, Proportions,
  Gauge, Ellipsis, X, Info, RefreshCw, Trash2, Pencil, Check, FileText, History, Power, Plus, Minus, SkipForward,
  SkipBack, ArrowUpDown, MonitorPlay, Clock3,
} from 'lucide-preact';

const MAP = {
  home: House, search: Search, guide: CalendarRange, live: Tv, movies: Clapperboard, series: Layers, star: Star,
  settings: Settings, play: Play, pause: Pause, back10: RotateCcw, fwd10: RotateCw, restart: RotateCcw, list: List,
  cc: Captions, audio: Volume2, mute: VolumeX, aspect: Proportions, speed: Gauge, more: Ellipsis, close: X,
  left: ChevronLeft, right: ChevronRight, up: ChevronUp, down: ChevronDown, plus: Plus, minus: Minus,
  refresh: RefreshCw, trash: Trash2, edit: Pencil, check: Check, episodes: ListVideo, tv: MonitorPlay, file: FileText,
  info: Info, history: History, next: SkipForward, prev: SkipBack, power: Power, sort: ArrowUpDown, clock: Clock3,
} as const;

export type IconName = keyof typeof MAP;

export function Icon({ name, class: cls, style }: { name: IconName; class?: string; style?: JSX.CSSProperties }) {
  const C = MAP[name];
  const solid = name === 'play' || name === 'pause';
  return <C class={cls} style={style} aria-hidden="true" strokeWidth={solid ? 0 : 2} fill={solid ? 'currentColor' : 'none'} absoluteStrokeWidth={false} />;
}

/** Orbit's mark: a planet and its ring, in the brand gradient. */
export const OrbitMark = (p: JSX.SVGAttributes<SVGSVGElement>) => (
  <svg viewBox="0 0 32 32" aria-hidden="true" {...p}>
    <defs>
      <linearGradient id="orbit-g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#8b5cff" /><stop offset=".55" stop-color="#3d7bff" /><stop offset="1" stop-color="#19c6f0" />
      </linearGradient>
    </defs>
    <circle cx="16" cy="16" r="6.5" fill="url(#orbit-g)" />
    <ellipse cx="16" cy="16" rx="14" ry="5.6" fill="none" stroke="url(#orbit-g)" stroke-width="2.2" transform="rotate(-24 16 16)" />
  </svg>
);
