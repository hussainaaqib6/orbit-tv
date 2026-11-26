// Home: a spotlight at the top, then rows built from what the viewer actually watches.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { catalog, favourites, recentChannels, resume, watched, itemIndex, errors, loaded, loading, loadingSince, reload, settings } from '../sources/library';
import { homeRows, ROW_LABELS } from './homeRows';
import { newEpisodeOf, episodeTracks } from '../services/newEpisodes';
import { LEAGUES, fixturesFor, indexChannels, matchStreams, type Fixture } from '../services/sports';
import { clock } from '../core/format';
import type { Channel, Movie, Series } from '../sources/types';
import { ChannelCard, PosterCard, openItem } from '../ui/cards';
import { Img } from '../ui/Img';
import { Icon } from '../ui/icons';
import { tmdbLookup, type TmdbInfo } from '../services/tmdb';
import * as P from '../player/controller';
import { moviePlayable, episodePlayable } from '../player/playables';
import { goRoot } from '../nav/router';
import { minutesLabel } from '../core/format';
import { cleanTitle } from '../core/names';
import { Fragment, type ComponentChildren } from 'preact';

function Shelf({ title, children }: { title: string; children: ComponentChildren }) {
  return (
    <section class="shelf">
      <h2>{title}</h2>
      <div class="shelf-row" data-nav-group>{children}</div>
    </section>
  );
}

/** The n newest items, without sorting the whole list (playlists can hold 200,000 films). */
function newest<T extends { added: number }>(list: T[], n: number, keep: (x: T) => boolean = () => true): T[] {
  const top: T[] = [];
  for (const x of list) {
    if (top.length === n && x.added <= top[n - 1].added) continue;
    if (!keep(x)) continue;
    let i = top.length;
    while (i > 0 && top[i - 1].added < x.added) i--;
    top.splice(i, 0, x);
    if (top.length > n) top.pop();
  }
  return top;
}

export function Home() {
  const c = catalog.value;
  const idx = itemIndex.value;

  const continueItems = useMemo(() => Object.entries(resume.value).sort((a, b) => b[1].at - a[1].at).slice(0, 20), [resume.value]);
  const favChannels = favourites.value.map(k => idx.get(k)).filter((x): x is Channel => x?.kind === 'live');
  const favVod = favourites.value.map(k => idx.get(k)).filter((x): x is Movie | Series => !!x && x.kind !== 'live');
  const recent = recentChannels.value.map(k => idx.get(k)).filter((x): x is Channel => x?.kind === 'live').slice(0, 20);
  const newMovies = useMemo(() => newest(c.movies, 24), [c.movies]);
  const newSeries = useMemo(() => newest(c.series, 24), [c.series]);

  // Spotlight: what you were last watching, otherwise the newest film.
  const spotKey = continueItems[0]?.[1].seriesKey ?? continueItems[0]?.[0] ?? newMovies[0]?.key ?? newSeries[0]?.key;
  const spot = spotKey ? idx.get(spotKey) as Movie | Series | undefined : undefined;

  const watchedSet = useMemo(() => new Set(Object.keys(watched.value)), [watched.value]);
  const started = useMemo(() => new Set(Object.entries(resume.value).map(([k, r]) => r.seriesKey ?? k)), [resume.value]);
  const rowOn = (id: string) => homeRows(settings.value.homeRows).some(r => r.id === id && r.on);
  const unwatchedMovies = useMemo(() => (rowOn('unwatchedMovies') ? newest(c.movies, 24, m => !watchedSet.has(m.key) && !started.has(m.key)) : []), [c.movies, watchedSet, started, settings.value.homeRows]);
  const watchedSeries = useMemo(() => new Set([...watchedSet].map(k => k.split(':').slice(0, 3).join(':'))), [watchedSet]);
  const unwatchedSeries = useMemo(() => (rowOn('unwatchedSeries') ? newest(c.series, 24, x => !started.has(x.key) && !watchedSeries.has(x.key)) : []), [c.series, watchedSeries, started, settings.value.homeRows]);
  const watchedItems = useMemo(() => Object.entries(watched.value).sort((a, b) => b[1] - a[1]).map(([k]) => idx.get(k)).filter((x): x is Movie => x?.kind === 'movie').slice(0, 24), [watched.value, idx]);
  void episodeTracks.value;
  const newEps = favVod.filter((x): x is Series => x.kind === 'series' && !!newEpisodeOf(x));
  const rows = homeRows(settings.value.homeRows).filter(r => r.on);

  // A plain function (not a component), so rows aren't re-created on every render and focus stays put.
  const renderRow = (id: string) => {
    if (id.startsWith('sport:')) return <SportsRow leagueId={id.slice(6)} />;
    switch (id) {
      case 'continue': return continueItems.length ? (
        <Shelf title={ROW_LABELS.continue}>
          {continueItems.map(([key, r]) => (
            <button key={key} class="wide-card" onClick={() => {
              const it = idx.get(r.seriesKey ?? key);
              if (it?.kind === 'movie') P.play(moviePlayable(it));
              else if (it?.kind === 'series') {
                const ep = Object.values(it.seasons ?? {}).flat().find(e => e.key === r.episodeKey);
                if (ep) P.play(episodePlayable(it, ep)); else openItem(it);
              }
            }}>
              <div class="art"><Img src={r.image} alt={r.title} /><div class="progress"><i style={{ width: `${(r.position / r.duration) * 100}%` }} /></div></div>
              <div class="t clip">{r.title}</div>
              <div class="s">{minutesLabel((r.duration - r.position) / 60)} left</div>
            </button>
          ))}
        </Shelf>
      ) : null;
      case 'newEpisodes': return newEps.length ? <Shelf title={ROW_LABELS.newEpisodes}>{newEps.map(x => <PosterCard key={x.key} item={x} sub="New episode" />)}</Shelf> : null;
      case 'favChannels': return favChannels.length ? <Shelf title={ROW_LABELS.favChannels}>{favChannels.map(ch => <ChannelCard key={ch.key} channel={ch} list={favChannels} />)}</Shelf> : null;
      case 'recentChannels': return recent.length ? <Shelf title={ROW_LABELS.recentChannels}>{recent.map(ch => <ChannelCard key={ch.key} channel={ch} list={recent} />)}</Shelf> : null;
      case 'favVod': return favVod.length ? <Shelf title={ROW_LABELS.favVod}>{favVod.map(x => <PosterCard key={x.key} item={x} />)}</Shelf> : null;
      case 'newMovies': return newMovies.length ? <Shelf title={ROW_LABELS.newMovies}>{newMovies.map(x => <PosterCard key={x.key} item={x} />)}</Shelf> : null;
      case 'newSeries': return newSeries.length ? <Shelf title={ROW_LABELS.newSeries}>{newSeries.map(x => <PosterCard key={x.key} item={x} />)}</Shelf> : null;
      case 'unwatchedMovies': return unwatchedMovies.length ? <Shelf title={ROW_LABELS.unwatchedMovies}>{unwatchedMovies.map(x => <PosterCard key={x.key} item={x} />)}</Shelf> : null;
      case 'unwatchedSeries': return unwatchedSeries.length ? <Shelf title={ROW_LABELS.unwatchedSeries}>{unwatchedSeries.map(x => <PosterCard key={x.key} item={x} />)}</Shelf> : null;
      case 'watched': return watchedItems.length ? <Shelf title={ROW_LABELS.watched}>{watchedItems.map(x => <PosterCard key={x.key} item={x} />)}</Shelf> : null;
      case 'liveChannels': return !recent.length && !favChannels.length && c.live.length > 0 ? <Shelf title={ROW_LABELS.liveChannels}>{c.live.slice(0, 20).map(ch => <ChannelCard key={ch.key} channel={ch} />)}</Shelf> : null;
    }
    return null;
  };

  if (!loaded.value) return <LoadingPlaylists />;
  const nothing = !c.live.length && !c.movies.length && !c.series.length;

  return (
    <div class="screen opaque">
      {spot ? <Spotlight item={spot} /> : <div style={{ height: '2rem' }} />}
      {nothing && (
        <div class="empty">
          <h2>Your playlists did not return anything</h2>
          {errors.value.map(e => <p key={e} class="error-text">{e}</p>)}
          <button class="btn primary" onClick={() => goRoot({ name: 'settings', section: 'playlists' })}>Check playlists</button>
        </div>
      )}
      {rows.map(r => <Fragment key={r.id}>{renderRow(r.id)}</Fragment>)}
      <div style={{ height: '2rem' }} />
    </div>
  );
}

/** First load: say what is happening, and offer a way out if it stalls. */
function LoadingPlaylists() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const since = loadingSince.value;
  const slow = !since || now - since > 45000;
  const secs = since ? Math.round((now - since) / 1000) : 0;
  return (
    <div class="screen">
      <div class="empty">
        {since ? <span class="spinner big" /> : null}
        <h2>{since ? 'Loading your playlists' : 'Your playlists have not loaded'}</h2>
        <p class="tnum">{loading.value || ' '}{since && secs > 5 ? `  (${secs} s)` : ''}</p>
        {slow && (
          <>
            {since && <p class="muted" style={{ maxWidth: '34rem' }}>Large playlists can take a minute on a TV stick. If nothing changes, try again or check the login details.</p>}
            {errors.value.map(e => <p key={e} class="error-text">{e}</p>)}
            <div class="row" style={{ justifyContent: 'center' }}>
              <button class="btn primary" data-autofocus onClick={() => reload(true)}><Icon name="refresh" />Try again</button>
              <button class="btn quiet" onClick={() => goRoot({ name: 'settings', section: 'playlists' })}>Playlist settings</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Spotlight({ item }: { item: Movie | Series }) {
  const [info, setInfo] = useState<TmdbInfo | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => { tmdbLookup(item.kind, item.name, item.year).then(setInfo).catch(() => {}); }, [item.key]);
  const r = resume.value[item.key];
  const art = info?.backdrop;
  const plot = item.plot || info?.plot;
  return (
    <section class="hero">
      <div class={`hero-art${art ? '' : ' poster'}`} style={{ backgroundImage: `url("${art || item.poster}")` }} />
      <div class="hero-body">
        <div class="hero-kind">{r ? 'Continue watching' : item.kind === 'movie' ? 'New film' : 'New series'}</div>
        <h1>{info?.title || cleanTitle(item.name).title}</h1>
        <div class="hero-meta">{[info?.year || item.year || '', info?.genres, info?.runtime ? minutesLabel(info.runtime) : ''].filter(Boolean).join('   ')}</div>
        {plot && <p class="clamp3">{plot}</p>}
        <div class="row">
          <button class="btn primary" ref={btn} data-autofocus onClick={() => item.kind === 'movie' ? P.play(moviePlayable(item)) : openItem(item)}>
            <Icon name="play" />{item.kind === 'series' ? 'Open series' : r ? 'Resume' : 'Play'}
          </button>
          <button class="btn quiet" onClick={() => openItem(item)}><Icon name="info" />Details</button>
        </div>
      </div>
    </section>
  );
}

/** A competition as a Home row: live matches, then today's and upcoming ones, then today's results. */
function SportsRow({ leagueId }: { leagueId: string }) {
  const league = LEAGUES.find(l => l.id === leagueId);
  const [fx, setFx] = useState<Fixture[] | null>(null);
  const ix = useMemo(() => indexChannels(catalog.value.live), [catalog.value.live]);
  useEffect(() => {
    if (!league) return;
    let alive = true;
    const get = () => fixturesFor(league).then(f => { if (alive) setFx(f); }).catch(() => { if (alive) setFx([]); });
    get();
    const t = setInterval(get, 60e3);
    return () => { alive = false; clearInterval(t); };
  }, [leagueId]);
  if (!league || !fx) return null;
  const now = Date.now();
  const rank = (f: Fixture) => (f.state === 'in' ? 0 : f.state === 'pre' ? 1 : 2);
  const list = fx.filter(f => f.state === 'in' || (f.state === 'pre' && f.start - now < 3 * 86400e3) || (f.state === 'post' && now - f.start < 12 * 3600e3))
    .sort((a, b) => rank(a) - rank(b) || a.start - b.start).slice(0, 16);
  if (!list.length) return null;
  return (
    <Shelf title={league.name}>
      {list.map(f => {
        const streams = matchStreams(ix, f);
        return (
          <button key={f.id} class="prog-card" onClick={() => (streams[0] ? P.playChannel(streams[0], { channels: streams, alternatives: streams.slice(1) }) : goRoot({ name: 'sports' }))}>
            <span class="when tnum">{f.state === 'in' ? <><span class="dot-live" />{f.detail || 'Live'}</> : f.state === 'post' ? 'Full time' : clock(f.start)}</span>
            <b class="clamp2">{f.home && f.away ? (f.state === 'pre' ? `${f.home.short} v ${f.away.short}` : `${f.home.short} ${f.home.score}–${f.away.score} ${f.away.short}`) : f.title}</b>
            <span class={`fx-streams${streams.length ? ' has' : ''}`}>{streams.length ? `${streams.length} stream${streams.length === 1 ? '' : 's'}` : 'No stream yet'}</span>
          </button>
        );
      })}
    </Shelf>
  );
}
