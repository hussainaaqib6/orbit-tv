// Movies and Series: categories on the left, a poster wall on the right, with sorting.
// Yellow (or the Sort button) changes the order.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { catalog, favourites, resume, groupsOf } from '../sources/library';
import type { Movie, Series } from '../sources/types';
import { VirtualGrid } from '../ui/VirtualGrid';
import { PosterCard } from '../ui/cards';
import { onAction } from '../nav/keys';
import { focusEl } from '../nav/focus';
import { Icon } from '../ui/icons';

type Sort = 'added' | 'az' | 'rating' | 'year';
const SORTS: { id: Sort; label: string }[] = [
  { id: 'added', label: 'Recently added' }, { id: 'az', label: 'A–Z' }, { id: 'rating', label: 'Rating' }, { id: 'year', label: 'Year' },
];
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
  // The category column folds away while browsing posters, so more fit on a row.
  const [browsing, setBrowsing] = useState(false);
  const [sort, setSort] = useState<Sort>('added');
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

  const list = useMemo(() => {
    const base = group === ALL ? items : group === FAV ? favs : group === CONT ? inProgress : byGroup.get(group) ?? [];
    const out = [...base];
    if (sort === 'az') out.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === 'rating') out.sort((a, b) => b.rating - a.rating);
    else if (sort === 'year') out.sort((a, b) => b.year - a.year);
    else if (items.some(x => x.added)) out.sort((a, b) => b.added - a.added);
    return out;
  }, [group, sort, items, favs, inProgress, byGroup]);

  const cycleSort = () => setSort(s => SORTS[(SORTS.findIndex(x => x.id === s) + 1) % SORTS.length].id);
  useEffect(() => {
    const el = screen.current!;
    const off = onAction(el, a => {
      if (a === 'yellow') { cycleSort(); return true; }
      // Back, or Left from the first column, brings the categories back.
      if ((a === 'back' || a === 'left') && document.activeElement?.closest('.grid-wrap')) {
        setBrowsing(false);
        requestAnimationFrame(() => focusEl(el.querySelector<HTMLElement>('.cat.on')));
        return true;
      }
    });
    const onFocus = () => setBrowsing(!!document.activeElement?.closest('.grid-wrap'));
    el.addEventListener('focusin', onFocus);
    return () => { off(); el.removeEventListener('focusin', onFocus); };
  }, []);

  const cat = (key: string, label: string, n: number) => (
    <button key={key} class={`cat${group === key ? ' on' : ''}`}
      onFocus={() => {
        clearTimeout(catTimer.current);
        pendingGroup.current = key;
        catTimer.current = window.setTimeout(() => { pendingGroup.current = null; setGroup(key); }, 400);
      }}
      onClick={() => { clearTimeout(catTimer.current); pendingGroup.current = null; setGroup(key); requestAnimationFrame(() => focusEl(screen.current!.querySelector<HTMLElement>('[data-cell="0"] > *'))); }}>
      <span class="clip">{label}</span><span class="n">{n}</span>
    </button>
  );
  const title = kind === 'movies' ? 'Movies' : 'Series';
  const label = group === ALL ? `All ${title.toLowerCase()}` : group === FAV ? 'Favourites' : group === CONT ? 'Continue watching' : group;

  return (
    <div class="screen opaque" ref={screen}>
      <div class={`browse${browsing ? ' folded' : ''}`}>
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
            <button class="chip" onClick={cycleSort} aria-label="Change order"><Icon name="sort" />{SORTS.find(s => s.id === sort)!.label}</button>
          </div>
          {list.length ? (
            <VirtualGrid items={list} minRem={9} ratio={1.5} extraRem={2.9} keyOf={x => x.key} render={x => <PosterCard item={x} />} />
          ) : <div class="empty"><p>Nothing here yet.</p></div>}
        </section>
      </div>
    </div>
  );
}
