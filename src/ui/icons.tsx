// Icons: the Lucide set (lucide.dev), mapped to the names Orbit uses.
import type { JSX } from 'preact';
import {
  House, Search, CalendarRange, Tv, Clapperboard, Layers, Star, Settings, Play, Pause, RotateCcw, RotateCw,
  ChevronUp, ChevronDown, ChevronLeft, ChevronRight, List, ListVideo, Captions, Volume2, VolumeX, Proportions,
  Gauge, Ellipsis, X, Info, RefreshCw, Trash2, Pencil, Check, FileText, History, Power, Plus, Minus, SkipForward,
  SkipBack, ArrowUpDown, MonitorPlay, Clock3, Trophy, Heart, Undo2, EyeOff,
} from 'lucide-preact';

const MAP = {
  home: House, search: Search, guide: CalendarRange, live: Tv, movies: Clapperboard, series: Layers, star: Star,
  settings: Settings, play: Play, pause: Pause, back10: RotateCcw, fwd10: RotateCw, restart: RotateCcw, list: List,
  cc: Captions, audio: Volume2, mute: VolumeX, aspect: Proportions, speed: Gauge, more: Ellipsis, close: X,
  left: ChevronLeft, right: ChevronRight, up: ChevronUp, down: ChevronDown, plus: Plus, minus: Minus,
  refresh: RefreshCw, trash: Trash2, edit: Pencil, check: Check, episodes: ListVideo, tv: MonitorPlay, file: FileText,
  info: Info, history: History, next: SkipForward, prev: SkipBack, power: Power, sort: ArrowUpDown, clock: Clock3, sports: Trophy, heart: Heart, last: Undo2, hidden: EyeOff,
} as const;

export type IconName = keyof typeof MAP;

export function Icon({ name, class: cls, style }: { name: IconName; class?: string; style?: JSX.CSSProperties }) {
  const C = MAP[name];
  const solid = name === 'play' || name === 'pause';
  // Favourites are always a red heart (stars are kept for ratings).
  if (name === 'heart') cls = `i-heart ${cls ?? ''}`;
  return <C class={cls} style={style} aria-hidden="true" strokeWidth={solid ? 0 : 2} fill={solid ? 'currentColor' : 'none'} absoluteStrokeWidth={false} />;
}

