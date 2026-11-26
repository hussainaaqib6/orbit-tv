// Xtream Codes API (player_api.php).
import { request } from '../core/http';
import { num } from '../core/format';
import { cleanTitle } from '../core/names';
import { setPart } from './loadState';
import type { Catalog, Episode, Movie, Series, Source } from './types';

export function xtBase(server: string): string {
  let s = server.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
  return s.replace(/\/(player_api\.php|get\.php|xmltv\.php).*$/i, '');
}

const creds = (src: Source) => ({ u: encodeURIComponent(src.user ?? ''), p: encodeURIComponent(src.pass ?? '') });
const query = (src: Source) => `username=${encodeURIComponent(src.user ?? '')}&password=${encodeURIComponent(src.pass ?? '')}`;
const api = <T>(src: Source, action: string, extra = '', progressId?: string) =>
  request<T>(`${xtBase(src.server ?? '')}/player_api.php?${query(src)}${action ? '&action=' + action : ''}${extra}`, { progressId });

interface XtInfo {
  user_info?: { auth?: number | string; status?: string; exp_date?: string | null; allowed_output_formats?: string[] };
  server_info?: { timezone?: string };
}
interface XtCategory { category_id: string | number; category_name: string }
interface XtLive { stream_id: number; name?: string; stream_icon?: string; category_id?: string | number; epg_channel_id?: string; tv_archive?: number | string; tv_archive_duration?: number | string }
interface XtVod { stream_id: number; name?: string; stream_icon?: string; category_id?: string | number; rating?: string | number; added?: string | number; container_extension?: string; year?: string | number }
interface XtSeries { series_id: number; name?: string; cover?: string; category_id?: string | number; rating?: string | number; last_modified?: string | number; plot?: string; releaseDate?: string; release_date?: string; year?: string | number }

/** Live URL for a channel. ExoPlayer and mpegts.js play raw MPEG-TS best; Apple devices need HLS. */
export function xtLiveUrl(src: Source, streamId: number, ext: 'ts' | 'm3u8'): string {
  const { u, p } = creds(src);
  return `${xtBase(src.server ?? '')}/live/${u}/${p}/${streamId}.${ext}`;
}

export async function loadXtream(src: Source, progress: (msg: string) => void = () => {}): Promise<Catalog> {
  progress(`Signing in to ${src.name}…`);
  const info = await api<XtInfo>(src, '');
  const ui = info?.user_info;
  if (!ui || +(ui.auth ?? 0) === 0) throw new Error('Login failed. Check the server address, username and password.');
  if (ui.status && ui.status !== 'Active') throw new Error(`Your account is ${ui.status.toLowerCase()}.`);
  src.expires = ui.exp_date ? +ui.exp_date * 1000 : 0;
  src.timezone = info.server_info?.timezone || '';

  const base = xtBase(src.server ?? '');
  const { u, p } = creds(src);
  // One list at a time: film lists can be tens of megabytes, and a TV stick has little memory to spare.
  const failed: string[] = [];
  const list = <T>(action: string, what: string, part?: string) => api<T[]>(src, action, '', part)
    .then(x => (Array.isArray(x) ? x : []))
    .catch(() => { failed.push(what); return [] as T[]; });
  progress(`Loading channels from ${src.name}…`);
  const lc = await list<XtCategory>('get_live_categories', 'channel categories');
  const ls = await list<XtLive>('get_live_streams', 'channels', 'live');
  setPart('live', { status: 'done', count: ls.length });
  progress(`Loading films from ${src.name}…`);
  const vc = await list<XtCategory>('get_vod_categories', 'film categories');
  const vs = await list<XtVod>('get_vod_streams', 'films', 'movies');
  setPart('movies', { status: 'done', count: vs.length });
  progress(`Loading series from ${src.name}…`);
  const sc = await list<XtCategory>('get_series_categories', 'series categories');
  const ss = await list<XtSeries>('get_series', 'series', 'series');
  setPart('series', { status: 'done', count: ss.length });
  progress(`Sorting ${(ls.length + vs.length + ss.length).toLocaleString()} items…`);
  if (!ls.length && !vs.length && !ss.length && failed.length) throw new Error(`Signed in, but the server did not send the ${failed.join(', ')}.`);
  const names = (cats: XtCategory[]) => new Map(cats.map(c => [String(c.category_id), c.category_name]));
  const L = names(lc), V = names(vc), SC = names(sc);
  // Keep the provider's category order, which is usually deliberate.
  const order = (cats: XtCategory[]) => new Map(cats.map((c, i) => [c.category_name, i]));
  const byCat = <T extends { group: string }>(items: T[], o: Map<string, number>) =>
    items.map((x, i) => ({ x, i })).sort((a, b) => (o.get(a.x.group) ?? 1e9) - (o.get(b.x.group) ?? 1e9) || a.i - b.i).map(y => y.x);

  const live = byCat(ls.map(s => ({
    kind: 'live' as const, key: `l:${src.id}:${s.stream_id}`, sourceId: src.id, number: 0,
    name: s.name || '', logo: s.stream_icon || '', group: L.get(String(s.category_id)) || 'Uncategorised',
    url: `${base}/live/${u}/${p}/${s.stream_id}.ts`, epgId: s.epg_channel_id || '', xtId: s.stream_id,
    catchup: +(s.tv_archive ?? 0) ? { type: 'xc', days: +(s.tv_archive_duration ?? 0) || 3 } : null,
  })), order(lc));

  const movies: Movie[] = byCat(vs.map(s => ({
    kind: 'movie' as const, key: `m:${src.id}:${s.stream_id}`, sourceId: src.id,
    name: s.name || '', poster: s.stream_icon || '', group: V.get(String(s.category_id)) || 'Uncategorised',
    rating: num(s.rating), added: +(s.added ?? 0) || 0, year: +(s.year ?? 0) || cleanTitle(s.name || '').year,
    url: `${base}/movie/${u}/${p}/${s.stream_id}.${s.container_extension || 'mp4'}`, xtId: s.stream_id,
  })), order(vc));

  const series: Series[] = byCat(ss.map(s => ({
    kind: 'series' as const, key: `s:${src.id}:${s.series_id}`, sourceId: src.id,
    name: s.name || '', poster: s.cover || '', group: SC.get(String(s.category_id)) || 'Uncategorised',
    rating: num(s.rating), added: +(s.last_modified ?? 0) || 0, plot: s.plot || '',
    year: +(s.year ?? 0) || +String(s.releaseDate || s.release_date || '').slice(0, 4) || cleanTitle(s.name || '').year,
    xtId: s.series_id,
  })), order(sc));

  return { live, movies, series, epgUrls: [`${base}/xmltv.php?${query(src)}`] };
}

interface XtEpisode { id: string | number; episode_num?: string | number; title?: string; container_extension?: string; info?: { plot?: string; duration_secs?: number; movie_image?: string } }

export async function loadXtreamSeriesInfo(src: Source, s: Series): Promise<{ seasons: Record<number, Episode[]>; plot?: string; backdrop?: string }> {
  const r = await api<{ episodes?: Record<string, XtEpisode[]>; info?: { plot?: string; backdrop_path?: string[] } }>(src, 'get_series_info', `&series_id=${s.xtId}`);
  const base = xtBase(src.server ?? '');
  const { u, p } = creds(src);
  const seasons: Record<number, Episode[]> = {};
  for (const [season, eps] of Object.entries(r?.episodes ?? {})) {
    seasons[+season] = (eps ?? []).map(e => {
      const ep = +(e.episode_num ?? 0) || 0;
      return {
        key: `${s.key}:${season}:${ep}`, season: +season, episode: ep,
        title: e.title || `Episode ${ep}`, plot: e.info?.plot || '', durationSec: e.info?.duration_secs || 0, still: e.info?.movie_image || '',
        url: `${base}/series/${u}/${p}/${e.id}.${e.container_extension || 'mp4'}`,
      };
    }).sort((a, b) => a.episode - b.episode);
  }
  return { seasons, plot: r?.info?.plot, backdrop: r?.info?.backdrop_path?.[0] };
}

export async function loadXtreamMovieInfo(src: Source, m: Movie): Promise<{ plot?: string; backdrop?: string; genre?: string; cast?: string; durationSec?: number }> {
  const r = await api<{ info?: { plot?: string; description?: string; backdrop_path?: string[]; genre?: string; cast?: string; duration_secs?: number } }>(src, 'get_vod_info', `&vod_id=${m.xtId}`);
  const i = r?.info ?? {};
  return { plot: i.plot || i.description, backdrop: i.backdrop_path?.[0], genre: i.genre, cast: i.cast, durationSec: i.duration_secs };
}
