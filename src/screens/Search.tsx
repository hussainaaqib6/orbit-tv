// Search across channels, films and series.
import { useEffect, useMemo, useState } from 'preact/hooks';
import { catalog } from '../sources/library';
import type { Channel, Movie, Series } from '../sources/types';
import { ChannelCard, PosterCard } from '../ui/cards';

const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export function find<T extends { name: string }>(list: T[], q: string, limit = 40): T[] {
  const words = fold(q).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const hits: { x: T; score: number }[] = [];
  for (const x of list) {
    const n = fold(x.name);
    if (!words.every(w => n.includes(w))) continue;
    hits.push({ x, score: (n.startsWith(words[0]) ? 0 : 1) + n.length / 1000 });
  }
  return hits.sort((a, b) => a.score - b.score).slice(0, limit).map(h => h.x);
}

export function Search() {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => { const t = setTimeout(() => setQuery(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  const c = catalog.value;
  const res = useMemo(() => ({
    live: find<Channel>(c.live, query), movies: find<Movie>(c.movies, query), series: find<Series>(c.series, query),
  }), [query, c]);
  const none = query && !res.live.length && !res.movies.length && !res.series.length;
  return (
    <div class="screen opaque">
      <div class="page" style={{ paddingBottom: '0.5rem' }}>
        <div class="page-head"><h1>Search</h1></div>
        <input class="input" type="search" placeholder="Channels, films and series" value={q} onInput={e => setQ((e.target as HTMLInputElement).value)} data-autofocus
          style={{ maxWidth: '40rem', height: '3.4rem', fontSize: '1.2rem' }} aria-label="Search" />
        {none && <p class="muted" style={{ marginTop: '1.5rem' }}>Nothing matches “{query}”. Try fewer words.</p>}
      </div>
      {res.live.length > 0 && <section class="shelf"><h2>Channels</h2><div class="shelf-row" data-nav-group>{res.live.map(x => <ChannelCard key={x.key} channel={x} list={res.live} />)}</div></section>}
      {res.movies.length > 0 && <section class="shelf"><h2>Films</h2><div class="shelf-row" data-nav-group>{res.movies.map(x => <PosterCard key={x.key} item={x} />)}</div></section>}
      {res.series.length > 0 && <section class="shelf"><h2>Series</h2><div class="shelf-row" data-nav-group>{res.series.map(x => <PosterCard key={x.key} item={x} />)}</div></section>}
    </div>
  );
}
