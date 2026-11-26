// Film and series pages: artwork, plot, play/resume, and for series the seasons and episodes.
import { useEffect, useState } from 'preact/hooks';
import { itemIndex, resume, watched, isFavourite, toggleFavourite, sourceById, favourites } from '../sources/library';
import type { Episode, Movie, Series } from '../sources/types';
import { loadXtreamMovieInfo, loadXtreamSeriesInfo } from '../sources/xtream';
import { tmdbLookup, type TmdbInfo } from '../services/tmdb';
import { Img } from '../ui/Img';
import { Icon } from '../ui/icons';
import { toast } from '../ui/overlays';
import * as P from '../player/controller';
import { moviePlayable, episodePlayable, episodeList } from '../player/playables';
import { minutesLabel } from '../core/format';
import { cleanTitle } from '../core/names';
import { friendlyError } from '../core/http';
import { PLATFORM } from '../core/platform';

interface Extra { plot?: string; backdrop?: string; genre?: string; cast?: string; runtimeMin?: number }

function Backdrop({ art, poster }: { art?: string; poster?: string }) {
  const src = art || poster;
  if (!src) return null;
  return <div class={`detail-art${art ? '' : ' poster'}`} style={{ backgroundImage: `url("${src}")` }} />;
}

function Facts({ year, extra, tmdb, rating, group }: { year?: number; extra: Extra; tmdb: TmdbInfo | null; rating: number; group: string }) {
  const r = rating || tmdb?.rating || 0;
  const runtime = extra.runtimeMin || tmdb?.runtime || 0;
  return (
    <div class="facts">
      {(year || tmdb?.year) ? <span>{year || tmdb?.year}</span> : null}
      {(extra.genre || tmdb?.genres) && <span>{extra.genre || tmdb?.genres}</span>}
      {runtime > 0 && <span>{minutesLabel(runtime)}</span>}
      {r > 0 && <span class="star">★ {r.toFixed(1)}</span>}
      <span>{group}</span>
    </div>
  );
}

function FavButton({ itemKey }: { itemKey: string }) {
  void favourites.value; // re-render on change
  const on = isFavourite(itemKey);
  return <button class="btn quiet" onClick={() => toast(toggleFavourite(itemKey) ? 'Added to favourites' : 'Removed from favourites')}><Icon name="star" />{on ? 'Favourite' : 'Add to favourites'}</button>;
}

export function MovieDetail({ itemKey }: { itemKey: string }) {
  const m = itemIndex.value.get(itemKey) as Movie | undefined;
  const [extra, setExtra] = useState<Extra>({});
  const [tmdb, setTmdb] = useState<TmdbInfo | null>(null);
  useEffect(() => {
    if (!m) return;
    const src = sourceById(m.sourceId);
    if (src?.type === 'xtream' && m.xtId != null) {
      loadXtreamMovieInfo(src, m).then(i => setExtra({ plot: i.plot, backdrop: i.backdrop, genre: i.genre, cast: i.cast, runtimeMin: i.durationSec ? Math.round(i.durationSec / 60) : 0 })).catch(() => {});
    }
    tmdbLookup('movie', m.name, m.year).then(setTmdb).catch(() => {});
  }, [itemKey]);
  if (!m) return <div class="screen"><div class="empty"><h2>This film is no longer in your playlist</h2></div></div>;
  const r = resume.value[m.key];
  const plot = extra.plot || m.plot || tmdb?.plot;
  const cast = extra.cast || tmdb?.cast;
  return (
    <div class="screen opaque">
      <div class="detail">
        <Backdrop art={tmdb?.backdrop || extra.backdrop} poster={m.poster} />
        <div class="detail-body">
          <div class="detail-poster"><Img src={m.poster || tmdb?.poster} alt={m.name} /></div>
          <div>
            <h1>{tmdb?.title || cleanTitle(m.name).title}</h1>
            <Facts year={m.year} extra={extra} tmdb={tmdb} rating={m.rating} group={m.group} />
            {plot && <p class="plot">{plot}</p>}
            {cast && <p class="cast">With {cast}</p>}
            <div class="row">
              <button class="btn primary" data-autofocus onClick={() => P.play(moviePlayable(m))}>
                <Icon name="play" />{r ? `Resume from ${minutesLabel(r.position / 60) || 'the start'}` : 'Play'}
              </button>
              {r && <button class="btn quiet" onClick={() => P.play(moviePlayable(m), { fromStart: true })}><Icon name="restart" />From the start</button>}
              <FavButton itemKey={m.key} />
              {tmdb?.trailer && PLATFORM !== 'android' && <a class="btn quiet" href={tmdb.trailer} target="_blank" rel="noopener"><Icon name="tv" />Trailer</a>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ShowDetail({ itemKey }: { itemKey: string }) {
  const s = itemIndex.value.get(itemKey) as Series | undefined;
  const [seasons, setSeasons] = useState<Record<number, Episode[]> | null>(s?.seasons ?? null);
  const [extra, setExtra] = useState<Extra>({});
  const [tmdb, setTmdb] = useState<TmdbInfo | null>(null);
  const [err, setErr] = useState('');
  const [season, setSeason] = useState<number | null>(null);

  useEffect(() => {
    if (!s) return;
    const src = sourceById(s.sourceId);
    if (!s.seasons && src?.type === 'xtream') {
      loadXtreamSeriesInfo(src, s).then(r => {
        s.seasons = r.seasons; // keep for the player's episode list
        setSeasons(r.seasons);
        setExtra({ plot: r.plot, backdrop: r.backdrop });
      }).catch(e => setErr(friendlyError(e)));
    }
    tmdbLookup('series', s.name, s.year).then(setTmdb).catch(() => {});
  }, [itemKey]);

  if (!s) return <div class="screen"><div class="empty"><h2>This series is no longer in your playlist</h2></div></div>;

  const all = seasons ? episodeList({ ...s, seasons }) : [];
  // Where to pick up: the most recent episode in progress, else the first unwatched one.
  const inProgress = Object.values(resume.value).filter(r => r.seriesKey === s.key).sort((a, b) => b.at - a.at)[0];
  const resumeEp = inProgress ? all.find(e => e.key === inProgress.episodeKey) : undefined;
  const nextEp = resumeEp ?? all.find(e => !watched.value[e.key]) ?? all[0];
  const seasonNums = seasons ? Object.keys(seasons).map(Number).sort((a, b) => a - b) : [];
  const shown = season ?? nextEp?.season ?? seasonNums[0];
  const plot = extra.plot || s.plot || tmdb?.plot;
  const playEp = (e: Episode) => P.play(episodePlayable({ ...s, seasons: seasons! }, e));

  return (
    <div class="screen opaque">
      <div class="detail">
        <Backdrop art={tmdb?.backdrop || extra.backdrop} poster={s.poster} />
        <div class="detail-body">
          <div class="detail-poster"><Img src={s.poster || tmdb?.poster} alt={s.name} /></div>
          <div>
            <h1>{tmdb?.title || cleanTitle(s.name).title}</h1>
            <Facts year={s.year} extra={extra} tmdb={tmdb} rating={s.rating} group={s.group} />
            {plot && <p class="plot clamp3">{plot}</p>}
            <div class="row">
              {nextEp ? (
                <button class="btn primary" data-autofocus onClick={() => playEp(nextEp)}>
                  <Icon name="play" />{resumeEp ? 'Continue' : 'Play'} S{nextEp.season} E{nextEp.episode}
                </button>
              ) : !err && <button class="btn primary" disabled><span class="spinner" />Loading episodes</button>}
              <FavButton itemKey={s.key} />
            </div>
            {err && <p class="error-text" style={{ marginTop: '1rem' }}>{err}</p>}

            {seasonNums.length > 0 && (
              <div class="seasons">
                <div class="choice" style={{ marginBottom: '1rem' }} data-nav-group>
                  {seasonNums.map(n => <button key={n} class={`chip${n === shown ? ' on' : ''}`} onClick={() => setSeason(n)} onFocus={() => setSeason(n)}>Season {n}</button>)}
                </div>
                {(seasons![shown] ?? []).map(e => {
                  const r = resume.value[e.key];
                  return (
                    <button key={e.key} class="ep" onClick={() => playEp(e)}>
                      <div class="still">
                        <Img src={e.still || s.poster} alt={e.title} />
                        {r && <div class="progress"><i style={{ width: `${(r.position / r.duration) * 100}%` }} /></div>}
                      </div>
                      <div>
                        <div class="t">{e.episode}. {e.title}{watched.value[e.key] && <span class="watched">Watched</span>}</div>
                        {e.plot && <div class="p clamp2">{e.plot}</div>}
                        {e.durationSec ? <div class="p">{minutesLabel(e.durationSec / 60)}</div> : null}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
