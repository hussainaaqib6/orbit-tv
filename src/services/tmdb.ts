// The Movie Database: backdrops, plots, cast and trailers for films and series (needs the viewer's own key).
import { request } from '../core/http';
import { cache } from '../core/idb';
import { cleanTitle } from '../core/names';
import { settings } from '../sources/library';

const API = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p';

export interface TmdbInfo {
  id: number;
  title: string;
  year: number;
  plot: string;
  poster: string;
  backdrop: string;
  genres: string;
  runtime: number;
  cast: string;
  rating: number;
  trailer: string;
}

export const tmdbOn = () => !!settings.value.tmdbKey;

async function get<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
  const key = settings.value.tmdbKey;
  const bearer = key.length > 40; // v4 read token rather than v3 key
  const q = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])), ...(bearer ? {} : { api_key: key }), language: navigator.language || 'en-GB' });
  return request<T>(`${API}${path}?${q}`, { headers: bearer ? { Authorization: 'Bearer ' + key } : {} });
}

const memory = new Map<string, TmdbInfo | null>();

interface SearchHit { id: number }
interface Details {
  title?: string; name?: string; release_date?: string; first_air_date?: string; overview?: string;
  poster_path?: string; backdrop_path?: string; genres?: { name: string }[]; runtime?: number; episode_run_time?: number[];
  credits?: { cast?: { name: string }[] }; vote_average?: number; videos?: { results?: { site: string; type: string; key: string }[] };
}

export async function tmdbLookup(kind: 'movie' | 'series', name: string, year = 0): Promise<TmdbInfo | null> {
  if (!tmdbOn()) return null;
  const type = kind === 'series' ? 'tv' : 'movie';
  const ck = `tmdb:${type}:${name}`;
  if (memory.has(ck)) return memory.get(ck)!;
  const stored = await cache.get<TmdbInfo | null>(ck);
  if (stored !== undefined) { memory.set(ck, stored); return stored; }

  const t = cleanTitle(name);
  const y = t.year || year;
  const yearParam: Record<string, number> = y ? (type === 'tv' ? { first_air_date_year: y } : { year: y }) : {};
  let r = await get<{ results?: SearchHit[] }>(`/search/${type}`, { query: t.title, ...yearParam });
  if (!r?.results?.length && y) r = await get<{ results?: SearchHit[] }>(`/search/${type}`, { query: t.title });
  const hit = r?.results?.[0];
  if (!hit) { memory.set(ck, null); await cache.set(ck, null); return null; }

  const d = await get<Details>(`/${type}/${hit.id}`, { append_to_response: 'credits,videos' });
  const trailer = d.videos?.results?.find(v => v.site === 'YouTube' && /trailer/i.test(v.type));
  const info: TmdbInfo = {
    id: hit.id,
    title: d.title || d.name || t.title,
    year: +String(d.release_date || d.first_air_date || '').slice(0, 4) || 0,
    plot: d.overview || '',
    poster: d.poster_path ? `${IMG}/w342${d.poster_path}` : '',
    backdrop: d.backdrop_path ? `${IMG}/w1280${d.backdrop_path}` : '',
    genres: (d.genres ?? []).map(g => g.name).slice(0, 3).join(', '),
    runtime: d.runtime || d.episode_run_time?.[0] || 0,
    cast: (d.credits?.cast ?? []).slice(0, 6).map(c => c.name).join(', '),
    rating: d.vote_average || 0,
    trailer: trailer ? `https://www.youtube.com/watch?v=${trailer.key}` : '',
  };
  memory.set(ck, info);
  await cache.set(ck, info);
  return info;
}
