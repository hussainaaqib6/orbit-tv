// The side menu. It folds to icons while you browse and opens with names when focus moves onto it.
import { useEffect, useRef, useState } from 'preact/hooks';
import { route, goRoot, type RootName, type Route } from '../nav/router';
import { Icon, type IconName } from '../ui/icons';
import { Monogram, Wordmark } from '../ui/brand';
import { focusFirst } from '../nav/focus';
import { clock } from '../core/format';
import { favourites, settings, recentChannels } from '../sources/library';
import { lastChannel, lastChannelTarget } from '../player/controller';
import { cleanChannelName } from '../core/names';

interface Entry { name: RootName; label: string; icon: IconName }
/** The menu as it comes; Settings → Side menu can reorder and hide items (Home always stays). */
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

const rootOf = (r: Route): RootName => (r.name === 'movie' ? 'movies' : r.name === 'show' ? 'series' : r.name);

/** Moves focus into the current screen. */
export function focusScreen() {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const area = document.querySelector<HTMLElement>('.screen-area');
    if (area) focusFirst(area);
  }));
}

export function Rail() {
  const ref = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15000);
    const el = ref.current!;
    const onIn = () => setOpen(true);
    const onOut = (e: FocusEvent) => { if (!el.contains(e.relatedTarget as Node)) setOpen(false); };
    el.addEventListener('focusin', onIn);
    el.addEventListener('focusout', onOut);
    return () => { clearInterval(t); el.removeEventListener('focusin', onIn); el.removeEventListener('focusout', onOut); };
  }, []);
  const active = rootOf(route.value);
  const go = (name: RootName) => {
    if (route.value.name !== name) goRoot({ name } as Route);
    focusScreen();
  };
  const item = (g: Entry) => {
    if (g.name === 'favourites' && !favourites.value.length) return null;
    return (
      <button key={g.name} class={`rail-item${active === g.name ? ' on' : ''}`} onClick={() => go(g.name)} aria-label={g.label}>
        <Icon name={g.icon} /><span>{g.label}</span>
      </button>
    );
  };
  return (
    // The rail keeps a fixed width in the layout; the panel inside opens over the screen, so opening
    // the menu never makes the screen beside it re-layout (which is slow on a TV stick).
    <nav class={`rail${open ? ' open' : ''}`} ref={ref} aria-label="Main menu" data-nav-group="rail" data-nav-scope="right">
      <div class="rail-panel">
        <div class="rail-brand"><Monogram /><Wordmark class="rail-word" /></div>
        {menuEntries(settings.value.menuOrder).filter(e => e.name === 'home' || !settings.value.menuHidden.includes(e.name)).map(item)}
        {settings.value.lastChannelButton && recentChannels.value.length > 0 && <LastChannelItem />}
        <div class="rail-grow" />
        {item({ name: 'settings', label: 'Settings', icon: 'settings' })}
        <div class="rail-clock tnum">{clock(now)}</div>
      </div>
    </nav>
  );
}

/** Moves focus to the highlighted menu item. */
export function focusRail() {
  const el = document.querySelector<HTMLElement>('.rail-item.on') ?? document.querySelector<HTMLElement>('.rail-item');
  el?.focus();
}

/** Side-menu shortcut back to the last channel watched (Settings → Appearance → Last channel). */
function LastChannelItem() {
  const c = lastChannelTarget();
  if (!c) return null;
  const name = cleanChannelName(c.name).name;
  return (
    <button class="rail-item" onClick={() => lastChannel()} aria-label={`Last channel: ${name}`}>
      <Icon name="last" /><span class="clip">{name}</span>
    </button>
  );
}
