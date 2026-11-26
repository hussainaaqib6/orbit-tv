// Search across channels, films and series.
import { useEffect, useMemo, useState } from 'preact/hooks';
import { catalog, guideLinks } from '../sources/library';
import type { Channel, Movie, Programme, Series } from '../sources/types';
import { ChannelCard, PosterCard } from '../ui/cards';
import { searchProgrammes } from '../sources/guideStore';
import { LEAGUES, fixturesFor, type Fixture } from '../services/sports';
import { clock, dayLabel } from '../core/format';
import { cleanChannelName } from '../core/names';
import { goRoot } from '../nav/router';
import { ProgrammeMeta } from '../ui/programme';
import * as P from '../player/controller';

type Tab = 'all' | 'live' | 'movies' | 'series' | 'tv' | 'sports';
const TABS: { id: Tab; label: string }[] = [
  { id: 'all', label: 'Everything' }, { id: 'live', label: 'Channels' }, { id: 'movies', label: 'Films' }, { id: 'series', label: 'Series' },
  { id: 'tv', label: 'TV programmes' }, { id: 'sports', label: 'Sports' },
];
/** Competitions searched for team names (fixtures are cached for five minutes). */
const SPORT_SEARCH = ['epl', 'ucl', 'laliga', 'seriea', 'bundesliga', 'ligue1', 'championship', 'europa', 'spfl', 'nfl', 'nba', 'ufc'];

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
  const [tab, setTab] = useState<Tab>('all');
  const [progs, setProgs] = useState<{ ch: Channel; p: Programme }[]>([]);
  const [games, setGames] = useState<Fixture[]>([]);
  useEffect(() => { const t = setTimeout(() => setQuery(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  const c = catalog.value;
  const res = useMemo(() => ({
    live: find<Channel>(c.live, query), movies: find<Movie>(c.movies, query), series: find<Series>(c.series, query),
  }), [query, c]);

  // TV programmes from the guide, matched back to the playlist's channels.
  const byGuideId = useMemo(() => {
    const m = new Map<string, Channel>();
    const keyIdx = new Map(c.live.map(x => [x.key, x]));
    for (const [key, id] of guideLinks.value) { const ch = keyIdx.get(key); if (ch && !m.has(id)) m.set(id, ch); }
    return m;
  }, [c, guideLinks.value]);
  useEffect(() => {
    let alive = true;
    if (query.length < 2 || (tab !== 'all' && tab !== 'tv')) { setProgs([]); return; }
    searchProgrammes(query, 80).then(r => {
      if (!alive) return;
      setProgs(r.map(([id, p]) => ({ ch: byGuideId.get(id)!, p })).filter(x => x.ch).slice(0, 40));
    });
    return () => { alive = false; };
  }, [query, tab, byGuideId]);

  // Sports: fixtures whose team names match.
  useEffect(() => {
    let alive = true;
    if (query.length < 3 || (tab !== 'all' && tab !== 'sports')) { setGames([]); return; }
    const ql = query.toLowerCase();
    Promise.allSettled(SPORT_SEARCH.map(id => fixturesFor(LEAGUES.find(l => l.id === id)!))).then(rs => {
      if (!alive) return;
      const all = rs.flatMap(r => (r.status === 'fulfilled' ? r.value : []));
      setGames(all.filter(f => f.state !== 'post' && [f.home?.name, f.away?.name, f.title].some(n => n?.toLowerCase().includes(ql))).slice(0, 20));
    });
    return () => { alive = false; };
  }, [query, tab]);

  const show = (t: Tab) => tab === 'all' || tab === t;
  const none = query && !res.live.length && !res.movies.length && !res.series.length && !progs.length && !games.length;
  const leagueName = (id: string) => LEAGUES.find(l => l.id === id)?.name ?? '';
  return (
    <div class="screen opaque">
      <div class="page" style={{ paddingBottom: '0.5rem' }}>
        <div class="page-head"><h1>Search</h1></div>
        <input class="input" type="search" placeholder="Channels, films, series, programmes, teams" value={q} onInput={e => setQ((e.target as HTMLInputElement).value)} data-autofocus
          style={{ maxWidth: '40rem', height: '3.4rem', fontSize: '1.2rem' }} aria-label="Search" />
        <div class="choice" data-nav-group style={{ marginTop: '0.9rem' }}>
          <span class="muted" style={{ alignSelf: 'center', marginRight: '0.3rem' }}>Search in</span>
          {TABS.map(t => <button key={t.id} class={`chip${tab === t.id ? ' on' : ''}`} onClick={() => setTab(t.id)}>{t.label}</button>)}
        </div>
        {none && <p class="muted" style={{ marginTop: '1.5rem' }}>Nothing matches “{query}”. Try fewer words.</p>}
      </div>
      {show('live') && res.live.length > 0 && <section class="shelf"><h2>Channels</h2><div class="shelf-row" data-nav-group>{res.live.map(x => <ChannelCard key={x.key} channel={x} list={res.live} />)}</div></section>}
      {show('tv') && progs.length > 0 && (
        <section class="shelf"><h2>On TV</h2><div class="shelf-row" data-nav-group>
          {progs.map(({ ch, p }) => {
            const on = p.start <= Date.now();
            return (
              <button key={`${ch.key}${p.start}`} class="prog-card" onClick={() => (on ? P.playChannel(ch) : goRoot({ name: 'guide' }))}>
                <span class="when tnum">{on ? <><span class="dot-live" />On now</> : `${dayLabel(p.start)} ${clock(p.start)}`}</span>
                <b class="clamp2">{p.title}</b>
                <ProgrammeMeta p={p} />
                <span class="muted clip">{cleanChannelName(ch.name).name}</span>
              </button>
            );
          })}
        </div></section>
      )}
      {show('sports') && games.length > 0 && (
        <section class="shelf"><h2>Matches</h2><div class="shelf-row" data-nav-group>
          {games.map(f => (
            <button key={f.id} class="prog-card" onClick={() => goRoot({ name: 'sports' })}>
              <span class="when tnum">{f.state === 'in' ? <><span class="dot-live" />Live {f.home?.score}–{f.away?.score}</> : `${dayLabel(f.start)} ${clock(f.start)}`}</span>
              <b class="clamp2">{f.home && f.away ? `${f.home.short} v ${f.away.short}` : f.title}</b>
              <span class="muted clip">{leagueName(f.leagueId)}</span>
            </button>
          ))}
        </div></section>
      )}
      {show('movies') && res.movies.length > 0 && <section class="shelf"><h2>Films</h2><div class="shelf-row" data-nav-group>{res.movies.map(x => <PosterCard key={x.key} item={x} />)}</div></section>}
      {show('series') && res.series.length > 0 && <section class="shelf"><h2>Series</h2><div class="shelf-row" data-nav-group>{res.series.map(x => <PosterCard key={x.key} item={x} />)}</div></section>}
    </div>
  );
}
