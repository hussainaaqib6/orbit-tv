// Screen history. Back pops a screen; the root screens are the ones opened from the Home tiles.
import { signal, computed } from '@preact/signals';

export type Route =
  | { name: 'home' } | { name: 'live'; group?: string } | { name: 'sports' } | { name: 'guide' } | { name: 'movies' } | { name: 'series' }
  | { name: 'search' } | { name: 'favourites' } | { name: 'settings'; section?: string; highlight?: string }
  | { name: 'movie'; key: string } | { name: 'show'; key: string };

export type RootName = 'home' | 'live' | 'sports' | 'guide' | 'movies' | 'series' | 'search' | 'favourites' | 'settings';

export const stack = signal<Route[]>([{ name: 'home' }]);
export const route = computed(() => stack.value[stack.value.length - 1]);

/**
 * Where focus was on each screen when another was opened on top of it (by depth), so Back lands on
 * the same poster or row you picked it from.
 */
const returnFocus: (Element | null)[] = [];

/** Switch to a top-level screen (clears history). */
export function goRoot(r: Route) {
  returnFocus.length = 0;
  stack.value = [r];
}

/** Open a screen on top of the current one. */
export function push(r: Route) {
  returnFocus[stack.value.length - 1] = typeof document !== 'undefined' ? document.activeElement : null;
  stack.value = [...stack.value, r];
}

/** After the stack changes: the element to focus on the screen now on top (set when it was left). */
export function takeReturnFocus(): Element | null {
  const depth = stack.value.length;
  const el = returnFocus[depth - 1] ?? null;
  returnFocus.length = depth - 1;
  return el;
}

/** Returns false when already at a root screen. */
export function pop(): boolean {
  if (stack.value.length <= 1) return false;
  stack.value = stack.value.slice(0, -1);
  return true;
}
