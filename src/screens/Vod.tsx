// Movies and Series: categories on the left, a poster wall on the right, with search and sorting.
// Yellow (or the Sort button) changes the order.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { catalog, favourites, resume, watched, groupsOf, settings, updateSettings, sources } from '../sources/library';
import { VirtualList, rowProps } from '../ui/VirtualList';
import { openSheet, closeAllSheets, SheetItem } from '../ui/overlays';
import type { Movie, Series } from '../sources/types';
import { VirtualGrid } from '../ui/VirtualGrid';
import { PosterCard, PosterRow } from '../ui/cards';
import { onAction } from '../nav/keys';
import { focusEl } from '../nav/focus';
import { Icon } from '../ui/icons';
import { useSectionSearch, SearchBox } from '../ui/sectionSearch';

type Sort = 'default' | 'added' | 'az' | 'za' | 'rating' | 'year' | 'watched' | 'playlist-az';
const SORTS: { id: Sort; label: string }[] = [
  { id: 'added', label: 'Recently added' }, { id: 'default', label: 'Playlist order' }, { id: 'az', label: 'A–Z' }, { id: 'za', label: 'Z–A' },
  { id: 'rating', label: 'Rating' }, { id: 'year', label: 'Release year' }, { id: 'watched', label: 'Recently watched' }, { id: 'playlist-az', label: 'Playlist, then A–Z' },
];
type View = 'grid' | 'list' | 'compact';
const VIEWS: { id: View; label: string }[] = [{ id: 'grid', label: 'Posters' }, { id: 'list', label: 'Detailed list' }, { id: 'compact', label: 'Compact list' }];

/** Sorts films or series. `lastSeen` maps key -> when it was last watched. */
export function sortItems<T extends { name: string; added: number; rating: number; year: number; sourceId: string; key: string }>(base: T[], sort: Sort, lastSeen: Map<string, number>, sourceOrder: string[]): T[] {
  const out = [...base];
  const name = (x: T) => x.name.replace(/^\s*[A-Z]{2,3}\s*[-:|]\s+/, '');
  const az = (a: T, b: T) => name(a).localeCompare(name(b), undefined, { numeric: true, sensitivity: 'base' });
  switch (sort) {
    case 'az': return out.sort(az);
    case 'za': return out.sort((a, b) => az(b, a));
    case 'rating': return out.sort((a, b) => b.rating - a.rating);
    case 'year': return out.sort((a, b) => b.year - a.year);
    case 'watched': return out.sort((a, b) => (lastSeen.get(b.key) ?? 0) - (lastSeen.get(a.key) ?? 0));
    case 'playlist-az': return out.sort((a, b) => sourceOrder.indexOf(a.sourceId) - sourceOrder.indexOf(b.sourceId) || az(a, b));
    case 'added': return out.some(x => x.added) ? out.sort((a, b) => b.added - a.added) : out;
    default: return out;
  }
}
const ALL = '\u0001all', FAV = '\u0001fav', CONT = '\u0001cont';

export function Vod({ kind }: { kind: 'movies' | 'series' }) {
  const items: (Movie | Series)[] = kind === 'movies' ? catalog.value.movies : catalog.value.series;
  const groups = useMemo(() => groupsOf(items), [items]);
  const favSet = useMemo(() => new Set(favourites.value), [favourites.value]);
  const favs = useMemo(() => items.filter(x => favSet.has(x.key)), [items, favSet]);
  const inProgress = useMemo(() => {
    const keys = new Set(Object.entries(resume.value).map(([k, r]) => r.seriesKey ?? k));
    return items.filter(x => keys.has(x.key));
  }, [items, resume.value]);

  // Items per category, worked out once so switching category is instant.
  const byGroup = useMemo(() => {
    const m = new Map<string, (Movie | Series)[]>();
    for (const x of items) { let l = m.get(x.group); if (!l) m.set(x.group, (l = [])); l.push(x); }
    return m;
  }, [items]);
  const [group, setGroup] = useState<string>(ALL);
  const s0 = settings.value;
  const sortKey = `${kind}:${group}`;
  const sort = (s0.sortByGroup[sortKey] ?? s0.sortDefault[kind] ?? 'added') as Sort;
  const view: View = s0.vodView[kind] ?? 'grid';
  const screen = useRef<HTMLDivElement>(null);
  const catTimer = useRef(0);
  const catsRef = useRef<HTMLElement>(null);
  const pendingGroup = useRef<string | null>(null);
  // Right from the categories: switch to the highlighted category now, then go to the first poster.
  useEffect(() => onAction(catsRef.current!, a => {
    if (a !== 'right') return;
    clearTimeout(catTimer.current);
    const g = pendingGroup.current;
    pendingGroup.current = null;
    if (g !== null) setGroup(g);
    requestAnimationFrame(() => requestAnimationFrame(() => focusEl(screen.current!.querySelector<HTMLElement>('[data-cell="0"] > *'))));
    return true;
  }), []);

  const lastSeen = useMemo(() => {
    const m = new Map<string, number>();
    for (const [k, r] of Object.entries(resume.value)) { const key = r.seriesKey ?? k; m.set(key, Math.max(m.get(key) ?? 0, r.at)); }
    for (const [k, at] of Object.entries(watched.value)) { const key = k.split(':').slice(0, 3).join(':'); m.set(key, Math.max(m.get(key) ?? 0, at)); m.set(k, Math.max(m.get(k) ?? 0, at)); }
    return m;
  }, [resume.value, watched.value]);
  // Search covers the whole section (every category), not just the one picked.
  const search = useSectionSearch(items, x => x.name);
  const clearSearch = useRef(search.clear);
  clearSearch.current = search.clear;
  const list = useMemo(() => {
    const base = search.results ?? (group === ALL ? items : group === FAV ? favs : group === CONT ? inProgress : byGroup.get(group) ?? []);
    return sortItems(base, sort, lastSeen, sources.value.map(x => x.id));
  }, [group, sort, items, favs, inProgress, byGroup, lastSeen, search.results]);

  /** Order: for everything, or (when chosen) for this category only. */
  const chooseSort = () => chooseSortWith(!!settings.value.sortByGroup[sortKey])();
  const chooseSortWith = (onlyHere: boolean) => () => openSheet('Order', () => (
    <>
      <SheetItem label="For this category only" checked={onlyHere} onClick={() => { closeAllSheets(); setTimeout(chooseSortWith(!onlyHere), 0); }} />
      {SORTS.map(x => <SheetItem key={x.id} label={x.label} checked={x.id === sort} autofocus={x.id === sort} onClick={() => setSortTo(x.id, onlyHere)} />)}
    </>
  ));
  const setSortTo = (id: Sort, onlyHere: boolean) => {
    const s = settings.value;
    const byGroup = { ...s.sortByGroup };
    if (onlyHere) byGroup[sortKey] = id; else delete byGroup[sortKey];
    updateSettings(onlyHere ? { sortByGroup: byGroup } : { sortByGroup: byGroup, sortDefault: { ...s.sortDefault, [kind]: id } });
    closeAllSheets();
  };
  const cycleSort = () => setSortTo(SORTS[(SORTS.findIndex(x => x.id === sort) + 1) % SORTS.length].id, !!settings.value.sortByGroup[sortKey]);
  const cycleView = () => updateSettings({ vodView: { ...settings.value.vodView, [kind]: VIEWS[(VIEWS.findIndex(v => v.id === view) + 1) % VIEWS.length].id } });
  useEffect(() => {
    const el = screen.current!;
    const off = onAction(el, a => {
      if (a === 'yellow') { cycleSort(); return true; }
      // Back from the posters goes to the categories (which stay on screen, as in GalaxyXC: folding
      // them away re-laid the whole poster grid each time, a visible stutter on a TV stick).
      if (a === 'back' && document.activeElement?.closest('.grid-wrap')) {
        clearSearch.current();
        requestAnimationFrame(() => focusEl(el.querySelector<HTMLElement>('.cat[data-autofocus]') ?? el.querySelector<HTMLElement>('.cat')));
        return true;
      }
    });
    return off;
  }, []);

  const cat = (key: string, label: string, n: number) => (
    <button key={key} data-autofocus={group === key || undefined} class={`cat${group === key ? ' on' : ''}`}
      onFocus={() => {
        clearTimeout(catTimer.current);
        pendingGroup.current = key;
        catTimer.current = window.setTimeout(() => { pendingGroup.current = null; setGroup(key); }, 400);
      }}
      onClick={() => { clearTimeout(catTimer.current); pendingGroup.current = null; search.clear(); setGroup(key); requestAnimationFrame(() => focusEl(screen.current!.querySelector<HTMLElement>('[data-cell="0"] > *'))); }}>
      <span class="clip">{label}</span><span class="n">{n}</span>
    </button>
  );
  const title = kind === 'movies' ? 'Movies' : 'Series';
  const label = search.results ? `Results for “${search.text.trim()}”` : group === ALL ? `All ${title.toLowerCase()}` : group === FAV ? 'Favourites' : group === CONT ? 'Continue watching' : group;

  return (
    <div class="screen opaque" ref={screen}>
      <div class="browse">
        <aside class="cats" data-nav-group="cats" data-nav-scope="left right" ref={catsRef}>
          <div class="cats-head"><h1>{title}</h1></div>
          <div class="cats-list">
            {cat(ALL, `All ${title.toLowerCase()}`, items.length)}
            {inProgress.length > 0 && cat(CONT, 'Continue watching', inProgress.length)}
            {favs.length > 0 && cat(FAV, 'Favourites', favs.length)}
            <div class="cat-sep">Categories</div>
            {groups.map(g => cat(g.name, g.name, g.count))}
          </div>
        </aside>
        <section class="vod-main">
          <div class="vod-head">
            <h2 class="clip">{label}</h2>
            <span class="muted">{list.length}</span>
            <span style={{ flex: 1 }} />
            <SearchBox text={search.text} onText={search.setText} placeholder={`Search ${title.toLowerCase()}`} />
            <button class="chip" onClick={chooseSort} aria-label="Change order"><Icon name="sort" />{SORTS.find(s => s.id === sort)!.label}{settings.value.sortByGroup[sortKey] ? ' (this category)' : ''}</button>
            <button class="chip" onClick={cycleView} aria-label="Change view"><Icon name="list" />{VIEWS.find(v => v.id === view)!.label}</button>
          </div>
          {!list.length ? <div class="empty"><p>{search.results ? `No ${title.toLowerCase()} match “${search.text.trim()}”.` : 'Nothing here yet.'}</p></div>
            : view === 'grid' ? <VirtualGrid items={list} minRem={9} ratio={1.5} extraRem={2.9} keyOf={x => x.key} render={x => <PosterCard item={x} />} />
            : <div class="grid-wrap vlist"><VirtualList items={list} rowRem={view === 'list' ? 7.4 : 3.6} keyOf={x => x.key} navGroup="vod"
                onRowAction={a => { if (a === 'left') return false; }}
                render={(x, i) => <PosterRow key={x.key} item={x} index={i} compact={view === 'compact'} rowProps={rowProps(i)} />} /></div>}
        </section>
      </div>
    </div>
  );
}
