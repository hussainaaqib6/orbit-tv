// Home: a spotlight at the top, then rows built from what the viewer actually watches.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { catalog, favourites, recentChannels, resume, itemIndex, errors, loaded, loading, loadingSince, reload } from '../sources/library';
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
import type { ComponentChildren } from 'preact';

function Shelf({ title, children }: { title: string; children: ComponentChildren }) {
  return (
    <section class="shelf">
      <h2>{title}</h2>
      <div class="shelf-row" data-nav-group>{children}</div>
    </section>
  );
}

const newest = <T extends { added: number }>(list: T[], n: number) => [...list].sort((a, b) => b.added - a.added).slice(0, n);

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
      {continueItems.length > 0 && (
        <Shelf title="Continue watching">
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
      )}
      {favChannels.length > 0 && <Shelf title="Favourite channels">{favChannels.map(ch => <ChannelCard key={ch.key} channel={ch} list={favChannels} />)}</Shelf>}
      {recent.length > 0 && <Shelf title="Recently watched channels">{recent.map(ch => <ChannelCard key={ch.key} channel={ch} list={recent} />)}</Shelf>}
      {favVod.length > 0 && <Shelf title="Your favourites">{favVod.map(x => <PosterCard key={x.key} item={x} />)}</Shelf>}
      {newMovies.length > 0 && <Shelf title="New films">{newMovies.map(x => <PosterCard key={x.key} item={x} />)}</Shelf>}
      {newSeries.length > 0 && <Shelf title="New series">{newSeries.map(x => <PosterCard key={x.key} item={x} />)}</Shelf>}
      {!recent.length && !favChannels.length && c.live.length > 0 && (
        <Shelf title="Live TV">{c.live.slice(0, 20).map(ch => <ChannelCard key={ch.key} channel={ch} />)}</Shelf>
      )}
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
