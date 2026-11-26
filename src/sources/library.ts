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
import { emptyGuide, guideIdFor, nowNext, parseXMLTV, wantedFor } from './epg';
import { guide, programmesById, setMemoryGuide, useNativeGuide, memoryEntries, NATIVE_GUIDE } from './guideStore';
import { OrbitPlayer } from '../core/native';
import { setPart, resetParts, type Part } from './loadState';
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
  /** Turn on a film's own subtitles when they are in the viewer's language. */
  autoSubtitles: boolean;
  askBeforeExit: boolean;
  showNumbers: boolean;
  autoplayNext: boolean;
  /** Live TV: play channels in a small preview box (off: OK goes straight to full screen). */
  miniPlayer: boolean;
  /** Live TV: the preview follows the highlighted channel after a short pause. */
  previewFollows: boolean;
  /** Live TV: the preview plays without sound. */
  previewMuted: boolean;
  /** Player: show when a film or episode will finish, beside the clock. */
  showFinishTime: boolean;
  /** Seconds a live stream may stall before it is reconnected (0 = never). */
  recoveryDelay: number;
  /** When a channel keeps failing, switch to another version of it (HD/FHD/backup, other playlists). */
  autoFailover: boolean;
  /** Side menu: show a Last channel shortcut. */
  lastChannelButton: boolean;
  /** 'playlist': numbers follow the playlist. 'favourites': favourites are 1, 2, 3… then the rest. */
  numbering: 'playlist' | 'favourites';
  /** Live Sports: fixture card style. */
  matchCards: 'classic' | 'big';
  /** Live Sports: only fixtures that have a stream in the playlist. */
  sportsMyChannels: boolean;
}

const DEFAULT_SETTINGS: Settings = {
  engine: 'native', liveFormat: 'auto', skipStep: 10, controlsTimeout: 5,
  aspectLive: 'fit', aspectVod: 'fit', epgOffset: 0, extraEpg: [], epgMap: {}, refreshHours: 12,
  tmdbKey: '', osKey: '', osUser: '', osPass: '', subLang: (typeof navigator !== 'undefined' ? navigator.language : 'en').slice(0, 2) || 'en',
  subSize: 100, subBackground: true, autoSubtitles: true, askBeforeExit: true, showNumbers: true, autoplayNext: true,
  miniPlayer: true, previewFollows: false, previewMuted: false, showFinishTime: true, recoveryDelay: 10, autoFailover: true,
  lastChannelButton: true, numbering: 'playlist', matchCards: 'classic', sportsMyChannels: false,
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
export { guide, guideTick } from './guideStore';
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
  return id ? programmesById(id) : [];
}
export const nowNextFor = (c: Channel | undefined, t = Date.now()) => nowNext(programmesFor(c), t);

/**
 * The number shown for each channel and used by the number keys. Playlist order normally; with
 * numbering from favourites, favourites are 1, 2, 3… in favourites order and the rest follow.
 */
export const channelNumbers = computed(() => {
  const live = catalog.value.live;
  const m = new Map<string, number>();
  let n = 0;
  if (settings.value.numbering === 'favourites') {
    const idx = itemIndex.value;
    for (const k of favourites.value) if (idx.get(k)?.kind === 'live' && !m.has(k)) m.set(k, ++n);
  }
  for (const c of live) if (!m.has(c.key)) m.set(c.key, n ? ++n : c.number);
  return m;
});
export const numberOf = (c: Channel) => channelNumbers.value.get(c.key) ?? c.number;
/** The channel with this number, if any. */
export function channelByNumber(n: number): Channel | undefined {
  const nums = channelNumbers.value;
  return catalog.value.live.find(c => nums.get(c.key) === n);
}

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
      const text = src.fromFile ? await cache.get<string>(`m3u:${src.id}`) : await getText(src.url ?? '', { progressId: 'live' });
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

interface CacheBlob {
  at: number;
  catalog: Catalog;
  /** Android keeps the guide in its own database and only notes when it was made here. */
  guide?: { at: number; native?: boolean; entries?: [string, Programme[]][]; names?: [string, string | null][]; ids?: [string, string][]; displayNames?: [string, string][] };
}

const GUIDE_BACK = 2 * 86400e3, GUIDE_AHEAD = 4 * 86400e3;

function markCatalogParts(c: Catalog, note: string) {
  setPart('live', { status: 'done', count: c.live.length, note });
  setPart('movies', { status: 'done', count: c.movies.length, note });
  setPart('series', { status: 'done', count: c.series.length, note });
}

/**
 * Shows the cached catalogue straight away when it is fresh, otherwise loads everything. Resolves
 * when the channels, films, series and guide are all ready (or have failed), so the start-up screen
 * can step aside.
 */
export async function start(): Promise<void> {
  resetParts();
  let cached: CacheBlob | undefined;
  try { cached = await cache.get<CacheBlob>('catalog'); } catch { cached = undefined; }
  if (cached?.catalog) {
    batch(() => { catalog.value = cached!.catalog; loaded.value = true; });
    markCatalogParts(cached.catalog, 'Up to date');
  }
  const fresh = (at: number | undefined) => !!at && Date.now() - at < settings.value.refreshHours * 3600e3;
  if (!cached?.catalog || !fresh(cached.at)) { await reload(); return; }

  let guideOk = false;
  if (cached.guide && fresh(cached.guide.at)) {
    setPart('guide', { status: 'loading' });
    try {
      if (cached.guide.native && NATIVE_GUIDE) {
        const info = await OrbitPlayer.guideInfo();
        if (info.exists) {
          const now = Date.now();
          await useNativeGuide(info.indexPath, new Map(), now - GUIDE_BACK, now + GUIDE_AHEAD);
          guideOk = true;
        }
      } else if (cached.guide.entries) {
        setMemoryGuide({
          programmes: new Map(cached.guide.entries), names: new Map(cached.guide.names), ids: new Map(cached.guide.ids),
          displayNames: new Map(cached.guide.displayNames),
        });
        guideOk = true;
      }
    } catch (e) { console.warn('[orbit] cached guide unusable', e); }
    if (guideOk) setPart('guide', { status: 'done', count: guide.value.has.size, note: 'Up to date' });
  }
  if (!guideOk) await reloadGuide();
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
  resetParts();
  for (const p of ['live', 'movies', 'series'] as Part[]) setPart(p, { status: 'loading' });
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
    if (gen !== generation) return;
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
  const failed = errs.length && !live.length && !movies.length && !series.length;
  if (failed) for (const p of ['live', 'movies', 'series'] as Part[]) setPart(p, { status: 'error', note: errs[0] });
  else markCatalogParts(next, '');
  saveSources();
  try { await cache.set('catalog', { at: Date.now(), catalog: next } satisfies CacheBlob); } catch (e) { console.warn('[orbit] could not cache the catalogue', e); }
  await reloadGuide();
}

let guideGen = 0;

export async function reloadGuide(): Promise<void> {
  const gen = ++guideGen;
  const c = catalog.value;
  const wanted = wantedFor(c.live, settings.value.epgMap);
  const urls = [...new Set([...c.epgUrls, ...settings.value.extraEpg.filter(Boolean)])];
  const errs: string[] = [];
  setPart('guide', { status: 'loading', bytes: 0, total: 0, count: 0, note: '' });
  if (!urls.length && !sources.value.some(s => s.enabled && s.type === 'stalker')) {
    setPart('guide', { status: 'done', note: 'This playlist has no guide' });
    return;
  }
  loading.value = 'Loading the TV guide…';
  const portal = new Map<string, Programme[]>();
  for (const src of sources.value.filter(s => s.enabled && s.type === 'stalker' && !s.error)) {
    try {
      for (const [k, v] of await loadStalkerGuide(src)) portal.set(k, v);
    } catch (e) { errs.push(`Guide (${src.name}): ${friendlyError(e)}`); }
  }
  const now = Date.now();
  let native = false;
  try {
    if (NATIVE_GUIDE && urls.length) {
      const r = await OrbitPlayer.guideBuild({
        urls, ids: [...wanted.ids], names: [...wanted.names], offsetHours: settings.value.epgOffset,
        from: now - GUIDE_BACK, to: now + GUIDE_AHEAD, maxDesc: 400,
      });
      if (gen !== guideGen) return;
      console.info(`[orbit] guide: ${r.programmes} programmes for ${r.channels} channels in ${Math.round((Date.now() - now) / 1000)}s`, r.errors.join('; '));
      r.errors.forEach(e => errs.push(`Guide: ${e}`));
      await useNativeGuide(r.indexPath, portal, now - GUIDE_BACK, now + GUIDE_AHEAD);
      native = true;
    } else {
      const g = emptyGuide();
      for (const url of urls) {
        try {
          parseXMLTV(await getText(url, { timeoutMs: 60000 }), g, { offsetHours: settings.value.epgOffset, wanted, now });
        } catch (e) { errs.push(`Guide: ${friendlyError(e)}`); }
      }
      if (gen !== guideGen) return;
      setMemoryGuide(g, portal);
    }
  } catch (e) {
    console.warn('[orbit] guide failed', e);
    errs.push(`Guide: ${friendlyError(e)}`);
  }
  if (gen !== guideGen) return;
  const matched = guide.value.has.size;
  if (errs.length) console.warn(`[orbit] guide problems: ${errs.join(' | ')}`);
  setPart('guide', matched
    ? { status: 'done', count: matched, note: '' }
    : { status: errs.length ? 'error' : 'done', count: 0, note: errs.length ? 'Could not load the guide' : 'No programmes matched your channels' });
  batch(() => {
    loading.value = '';
    if (errs.length) errors.value = [...errors.value, ...errs];
  });
  // A guide that failed is not saved, so the next start tries again.
  if (!matched && errs.length) return;
  try {
    const blob = await cache.get<CacheBlob>('catalog');
    if (blob) {
      const g = guide.value;
      blob.guide = native
        ? { at: Date.now(), native: true }
        : { at: Date.now(), entries: memoryEntries(), names: [...g.names], ids: [...g.ids], displayNames: [...g.displayNames] };
      await cache.set('catalog', blob);
    }
  } catch (e) { console.warn('[orbit] could not cache the guide', e); }
}

export const sourceById = (id: string) => sources.value.find(s => s.id === id);
