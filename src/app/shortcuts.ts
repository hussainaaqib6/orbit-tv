// Remote button shortcuts (Settings → Remote buttons). A button can open a screen or do something,
// from anywhere; in the player, a mapped button does its mapped job instead of its usual one.
import { goRoot, type RootName } from '../nav/router';
import type { Action } from '../nav/keys';

export type ShortcutTarget =
  | 'none' | 'home' | 'live' | 'guide' | 'movies' | 'series' | 'sports' | 'favourites' | 'search' | 'settings'
  | 'last' | 'recent' | 'subtitles' | 'audio' | 'player-options';

export const TARGETS: { v: ShortcutTarget; label: string }[] = [
  { v: 'none', label: 'Nothing / usual job' }, { v: 'home', label: 'Home' }, { v: 'live', label: 'Live TV' }, { v: 'guide', label: 'TV Guide' },
  { v: 'movies', label: 'Movies' }, { v: 'series', label: 'Series' }, { v: 'sports', label: 'Live Sports' }, { v: 'favourites', label: 'Favourites' },
  { v: 'search', label: 'Search' }, { v: 'settings', label: 'Settings' }, { v: 'last', label: 'Last channel' }, { v: 'recent', label: 'Recently watched' },
  { v: 'subtitles', label: 'Subtitles (player)' }, { v: 'audio', label: 'Audio tracks (player)' }, { v: 'player-options', label: 'Player options' },
];

/** Buttons that can be given a job. Fire TV remotes have few spare buttons; TV remotes have more. */
export const BUTTONS: { key: Action; label: string; where: string }[] = [
  { key: 'red', label: 'Red', where: 'Android TV remotes' },
  { key: 'green', label: 'Green', where: 'Android TV remotes' },
  { key: 'yellow', label: 'Yellow', where: 'Android TV remotes' },
  { key: 'blue', label: 'Blue', where: 'Android TV remotes' },
  { key: 'guide', label: 'Guide', where: 'Fire TV and Android TV remotes with a Guide button' },
  { key: 'search', label: 'Search', where: 'Remotes with a Search button' },
  { key: 'fav', label: 'Bookmark', where: 'Remotes with a Bookmark button' },
  { key: 'playpause', label: 'Play/Pause (outside the player)', where: 'Every remote' },
  { key: 'ff', label: 'Fast-forward (outside the player)', where: 'Every remote' },
  { key: 'rw', label: 'Rewind (outside the player)', where: 'Every remote' },
];

/** What each button does when nothing is set. */
export const DEFAULT_MAP: Partial<Record<Action, ShortcutTarget>> = { yellow: 'last', guide: 'guide', search: 'search' };

const SCREENS: Partial<Record<ShortcutTarget, RootName>> = {
  home: 'home', live: 'live', guide: 'guide', movies: 'movies', series: 'series', sports: 'sports', favourites: 'favourites', search: 'search', settings: 'settings',
};

/** Runs a shortcut. Player-only jobs are passed to `player` (null outside the player). */
export function runShortcut(t: ShortcutTarget, h: { last: () => void; recent: () => void; player?: (t: ShortcutTarget) => boolean }): boolean {
  if (t === 'none') return false;
  if (h.player && h.player(t)) return true;
  const screen = SCREENS[t];
  if (screen) { goRoot({ name: screen } as never); return true; }
  if (t === 'last') { h.last(); return true; }
  if (t === 'recent') { h.recent(); return true; }
  return false;
}

/** Buttons sharing a job, for a gentle warning in settings. */
export function conflicts(map: Partial<Record<Action, ShortcutTarget>>): Action[] {
  const seen = new Map<ShortcutTarget, Action>();
  const out: Action[] = [];
  for (const [k, v] of Object.entries(map) as [Action, ShortcutTarget][]) {
    if (!v || v === 'none') continue;
    if (seen.has(v)) out.push(k, seen.get(v)!);
    else seen.set(v, k);
  }
  return [...new Set(out)];
}
