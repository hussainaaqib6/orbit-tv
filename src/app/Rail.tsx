// Screen list and focus helpers. (The app used to have a side menu; Home's tiles replace it.)
import { focusFirst } from '../nav/focus';
import type { RootName } from '../nav/router';
import type { IconName } from '../ui/icons';

interface Entry { name: RootName; label: string; icon: IconName }
/** Every top-level screen; Settings → Remote buttons and older saved menu orders still refer to these. */
export const MENU_ITEMS: Entry[] = [
  { name: 'home', label: 'Home', icon: 'home' }, { name: 'search', label: 'Search', icon: 'search' }, { name: 'guide', label: 'TV Guide', icon: 'guide' },
  { name: 'live', label: 'Live TV', icon: 'live' }, { name: 'sports', label: 'Live Sports', icon: 'sports' }, { name: 'movies', label: 'Movies', icon: 'movies' },
  { name: 'series', label: 'Series', icon: 'series' }, { name: 'favourites', label: 'Favourites', icon: 'heart' },
];
/** Menu items in the viewer's order (new items they haven't placed go at the end). */
export function menuEntries(order: string[]): Entry[] {
  const rank = (n: string) => { const i = order.indexOf(n); return i < 0 ? 100 + MENU_ITEMS.findIndex(e => e.name === n) : i; };
  return [...MENU_ITEMS].sort((a, b) => rank(a.name) - rank(b.name));
}

/** Moves focus into the current screen. */
export function focusScreen() {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const area = document.querySelector<HTMLElement>('.screen-area');
    if (area) focusFirst(area);
  }));
}
