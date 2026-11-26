// Everything Orbit knows about: sources, the merged catalogue, the guide, and what the viewer did.
// State is held in Preact signals so every screen updates itself when it changes.
import { signal, computed, batch } from '@preact/signals';
import { store } from '../core/storage';
import { cache } from '../core/idb';
import { getText, friendlyError } from '../core/http';
import { uid } from '../core/format';
import { loadXtream } from './xtream';
import { parseM3U, looksLikeM3U } from './m3u';
import { loadStalker, loadStalkerGuide } from './stalker';
import { emptyGuide, guideIdFor, nowNext, parseXMLTV, wantedFor, type Guide } from './epg';
import type { Catalog, Channel, Item, Movie, Programme, Series, Source } from './types';

/* ------------------------------ settings ------------------------------ */

export type Aspect = 'fit' | 'fill' | 'stretch' | '16:9' | '4:3';
export interface Settings {
  /** Android: 'native' = ExoPlayer (recommended), 'web' = the WebView's own player. */
  engine: 'native' | 'web';
  liveFormat: 'auto' | 'ts' | 'm3u8';
  skipStep: number;
  controlsTimeout: number;
  aspectLive: Aspect;
  aspectVod: Aspect;
  epgOffset: number;
  extraEpg: string[];
  epgMap: Record<string, string>;
  refreshHours: number;
  tmdbKey: string;
  osKey: string;
  osUser: string;
  osPass: string;
  subLang: string;
  subSize: number; // percent
  subBackground: boolean;
  askBeforeExit: boolean;
  showNumbers: boolean;
  autoplayNext: boolean;
}

const DEFAULT_SETTINGS: Settings = {
  engine: 'native', liveFormat: 'auto', skipStep: 10, controlsTimeout: 5,
  aspectLive: 'fit', aspectVod: 'fit', epgOffset: 0, extraEpg: [], epgMap: {}, refreshHours: 12,
  tmdbKey: '', osKey: '', osUser: '', osPass: '', subLang: (typeof navigator !== 'undefined' ? navigator.language : 'en').slice(0, 2) || 'en',
  subSize: 100, subBackground: true, askBeforeExit: true, showNumbers: true, autoplayNext: true,
};

export const settings = signal<Settings>({ ...DEFAULT_SETTINGS, ...store.get<Partial<Settings>>('settings', {}) });
export function updateSettings(patch: Partial<Settings>) {
  settings.value = { ...settings.value, ...patch };
  store.set('settings', settings.value);
}

/* ------------------------------ viewer data ------------------------------ */

export const sources = signal<Source[]>(store.get<Source[]>('sources', []));
export const favourites = signal<string[]>(store.get<string[]>('favourites', []));
/** Recently played channel keys, newest first. */
export const recentChannels = signal<string[]>(store.get<string[]>('recentChannels', []));
export interface ResumePoint { position: number; duration: number; at: number; title: string; image?: string; seriesKey?: string; episodeKey?: string }
/** Films and episodes in progress, keyed by item/episode key. */
export const resume = signal<Record<string, ResumePoint>>(store.get('resume', {}));
/** Finished films/episodes. */
export const watched = signal<Record<string, number>>(store.get('watched', {}));

export const isFavourite = (key: string) => favourites.value.includes(key);
export function toggleFavourite(key: string): boolean {
  const on = !isFavourite(key);
  favourites.value = on ? [...favourites.value, key] : favourites.value.filter(k => k !== key);
  store.set('favourites', favourites.value);
  return on;
}

export function noteChannelPlayed(key: string) {
  recentChannels.value = [key, ...recentChannels.value.filter(k => k !== key)].slice(0, 30);
  store.set('recentChannels', recentChannels.value);
}

export function saveResume(key: string, p: ResumePoint) {
  const next = { ...resume.value };
  const nearEnd = p.duration > 0 && p.position > p.duration - Math.min(120, p.duration * 0.05);
  if (nearEnd) {
    delete next[key];
    watched.value = { ...watched.value, [key]: Date.now() };
    store.set('watched', watched.value);
  } else if (p.position > 20) {
    next[key] = p;
  } else {
    return;
  }
  // Keep the most recent 200.
  const keys = Object.keys(next).sort((a, b) => next[b].at - next[a].at);
  for (const k of keys.slice(200)) delete next[k];
  resume.value = next;
  store.set('resume', next);
}
export function clearResume(key: string) {
  if (!(key in resume.value)) return;
  const next = { ...resume.value };
  delete next[key];
  resume.value = next;
  store.set('resume', next);
}

/* ------------------------------ catalogue ------------------------------ */

const EMPTY: Catalog = { live: [], movies: [], series: [], epgUrls: [] };
export const catalog = signal<Catalog>(EMPTY);
export const guide = signal<Guide>(emptyGuide());
export const loading = signal<string>('');
export const loaded = signal(false);

export const itemIndex = computed(() => {
  const m = new Map<string, Item>();
  const c = catalog.value;
  for (const x of c.live) m.set(x.key, x);
  for (const x of c.movies) m.set(x.key, x);
  for (const x of c.series) m.set(x.key, x);
  return m;
});

/** Guide id per channel key, recomputed when the guide or manual matches change. */
export const guideLinks = computed(() => {
  const g = guide.value, manual = settings.value.epgMap;
  const m = new Map<string, string>();
  for (const c of catalog.value.live) {
    const id = guideIdFor(c, g, manual);
    if (id) m.set(c.key, id);
  }
  return m;
});

export function programmesFor(c: Channel | undefined): Programme[] {
  if (!c) return [];
  const id = guideLinks.value.get(c.key);
  return (id && guide.value.programmes.get(id)) || [];
}
export const nowNextFor = (c: Channel | undefined, t = Date.now()) => nowNext(programmesFor(c), t);

/** Categories in first-seen order with counts. */
export function groupsOf<T extends { group: string }>(items: T[]): { name: string; count: number }[] {
  const m = new Map<string, number>();
  for (const x of items) m.set(x.group, (m.get(x.group) ?? 0) + 1);
  return [...m].map(([name, count]) => ({ name, count }));
}

/* ------------------------------ sources ------------------------------ */

export function saveSources() {
  store.set('sources', sources.value);
}

export function addSource(s: Omit<Source, 'id' | 'enabled'>): Source {
  const src: Source = { ...s, id: uid(), enabled: true };
  sources.value = [...sources.value, src];
  saveSources();
  return src;
}

export function updateSource(id: string, patch: Partial<Source>) {
  sources.value = sources.value.map(s => (s.id === id ? { ...s, ...patch } : s));
  saveSources();
}

export async function removeSource(id: string) {
  sources.value = sources.value.filter(s => s.id !== id);
  saveSources();
  await cache.remove(`m3u:${id}`);
  await reload();
}

export const saveM3UFile = (id: string, text: string) => cache.set(`m3u:${id}`, text);

async function loadSource(src: Source): Promise<Catalog> {
  switch (src.type) {
    case 'xtream': return loadXtream(src, msg => { loading.value = msg; });
    case 'stalker': return loadStalker(src);
    case 'm3u': {
      const text = src.fromFile ? await cache.get<string>(`m3u:${src.id}`) : await getText(src.url ?? '');
      if (text == null) throw new Error('This playlist file is missing. Open it again in Settings.');
      if (!looksLikeM3U(text)) throw new Error('That does not look like an M3U playlist.');
      return parseM3U(text, src.id);
    }
  }
}

/** Gives channels a running number in playlist order, so number keys can jump to them. */
function numberChannels(live: Channel[]) {
  live.forEach((c, i) => { c.number = i + 1; });
}

interface CacheBlob { at: number; catalog: Catalog; guide?: { at: number; entries: [string, Programme[]][]; names: [string, string | null][]; ids: [string, string][]; displayNames: [string, string][] } }

/** Show the cached catalogue straight away; refresh from the network if it is stale or missing. */
export async function start(): Promise<void> {
  const cached = await cache.get<CacheBlob>('catalog');
  if (cached?.catalog) {
    batch(() => {
      catalog.value = cached.catalog;
      if (cached.guide) {
        guide.value = {
          programmes: new Map(cached.guide.entries), names: new Map(cached.guide.names),
          ids: new Map(cached.guide.ids), displayNames: new Map(cached.guide.displayNames),
        };
      }
      loaded.value = true;
    });
  }
  const stale = !cached || Date.now() - cached.at > settings.value.refreshHours * 3600e3;
  const guideStale = !cached?.guide || Date.now() - cached.guide.at > 6 * 3600e3;
  if (stale) await reload();
  else if (guideStale) await reloadGuide();
}

export const errors = signal<string[]>([]);

/** When the current load started (0 = not loading), so the UI can offer "Try again" if it stalls. */
export const loadingSince = signal(0);

let generation = 0;

/** Reloads every playlist. `force` starts again even if a load is still running (a stalled one is dropped). */
export async function reload(force = false): Promise<void> {
  if (loadingSince.value && !force) return;
  const gen = ++generation;
  loadingSince.value = Date.now();
  try {
    await reloadInner(gen);
  } finally {
    if (gen === generation) { loadingSince.value = 0; loading.value = ''; }
  }
}

async function reloadInner(gen: number): Promise<void> {
  let live: Channel[] = [], movies: Movie[] = [], series: Series[] = [];
  const epgUrls = new Set<string>();
  const errs: string[] = [];
  const list = sources.value.map(s => ({ ...s }));
  for (const src of list) {
    if (!src.enabled) continue;
    loading.value = `Loading ${src.name}…`;
    try {
      const r = await loadSource(src);
      // concat, not push(...list): spreading 50,000+ items as arguments overflows the call stack.
      live = live.concat(r.live); movies = movies.concat(r.movies); series = series.concat(r.series);
      r.epgUrls.forEach(u => epgUrls.add(u));
      if (src.epgUrl) epgUrls.add(src.epgUrl);
      Object.assign(src, { error: '', loadedAt: Date.now(), counts: { live: r.live.length, movies: r.movies.length, series: r.series.length } });
    } catch (e) {
      src.error = friendlyError(e);
      errs.push(`${src.name}: ${src.error}`);
    }
  }
  if (gen !== generation) return; // a newer load took over
  numberChannels(live);
  const next: Catalog = { live, movies, series, epgUrls: [...epgUrls] };
  batch(() => {
    sources.value = list;
    catalog.value = next;
    loaded.value = true;
    errors.value = errs;
    loading.value = '';
  });
  saveSources();
  await cache.set('catalog', { at: Date.now(), catalog: next } satisfies CacheBlob);
  await reloadGuide();
}

export async function reloadGuide(): Promise<void> {
  const c = catalog.value;
  const g = emptyGuide();
  const wanted = wantedFor(c.live, settings.value.epgMap);
  const urls = [...new Set([...c.epgUrls, ...settings.value.extraEpg.filter(Boolean)])];
  const errs: string[] = [];
  for (const src of sources.value.filter(s => s.enabled && s.type === 'stalker' && !s.error)) {
    loading.value = 'Loading the TV guide…';
    try {
      for (const [k, v] of await loadStalkerGuide(src)) g.programmes.set(k, v);
    } catch (e) { errs.push(`Guide (${src.name}): ${friendlyError(e)}`); }
  }
  for (const url of urls) {
    loading.value = 'Loading the TV guide…';
    try {
      parseXMLTV(await getText(url, { timeoutMs: 60000 }), g, { offsetHours: settings.value.epgOffset, wanted });
    } catch (e) { errs.push(`Guide: ${friendlyError(e)}`); }
  }
  batch(() => {
    guide.value = g;
    loading.value = '';
    if (errs.length) errors.value = [...errors.value, ...errs];
  });
  const blob = await cache.get<CacheBlob>('catalog');
  if (blob) {
    blob.guide = { at: Date.now(), entries: [...g.programmes], names: [...g.names], ids: [...g.ids], displayNames: [...g.displayNames] };
    await cache.set('catalog', blob);
  }
}

export const sourceById = (id: string) => sources.value.find(s => s.id === id);
