// The programme guide as the screens see it.
//
// Android keeps the guide in an on-device database (GuideStore.java): the app holds only an index of
// guide channels plus the programmes of the channels recently on screen, fetched in small batches.
// Elsewhere (desktop, browser), and for portal (Stalker) guides, programmes are held in memory.
import { signal } from '@preact/signals';
import { Capacitor } from '@capacitor/core';
import { OrbitPlayer } from '../core/native';
import { PLATFORM } from '../core/platform';
import type { Guide, GuideIndex } from './epg';
import type { Programme } from './types';

export const NATIVE_GUIDE = PLATFORM === 'android';

export const emptyIndex = (): GuideIndex => ({ names: new Map(), ids: new Map(), displayNames: new Map(), has: new Set() });

/** Which guide channels exist and which have programmes. Screens match channels against this. */
export const guide = signal<GuideIndex>(emptyIndex());
/** Bumps whenever more programmes arrive, so screens showing "no guide yet" redraw. */
export const guideTick = signal(0);

/** Programmes held in memory (desktop/browser guides, portal guides on every platform). */
let mem = new Map<string, Programme[]>();
/** Recently used programmes from the Android database, oldest first. */
const cache = new Map<string, Programme[]>();
const CACHE_MAX = 4000;
const pending = new Set<string>();
const inFlight = new Set<string>();
let timer = 0;
let window_ = { from: 0, to: 0 };
const NONE: Programme[] = [];

/** Programmes for a guide id. On Android this may be empty the first time; it fills in moments later. */
export function programmesById(id: string): Programme[] {
  void guideTick.value; // subscribe the caller to new arrivals
  const m = mem.get(id);
  if (m) return m;
  if (!NATIVE_GUIDE || !guide.value.has.has(id)) return NONE;
  const c = cache.get(id);
  if (c) {
    cache.delete(id);
    cache.set(id, c);
    return c;
  }
  if (!inFlight.has(id)) {
    pending.add(id);
    if (!timer) timer = window.setTimeout(flush, 16);
  }
  return NONE;
}

/**
 * Fetches programmes for these guide ids in one go (the rows about to come on screen), so scrolling
 * finds them ready instead of each new row asking and every row redrawing when the answer arrives.
 */
export function prefetchGuide(ids: string[]) {
  if (!NATIVE_GUIDE) return;
  let added = false;
  for (const id of ids) {
    if (!guide.value.has.has(id) || cache.has(id) || inFlight.has(id) || pending.has(id)) continue;
    pending.add(id);
    added = true;
  }
  if (added && !timer) timer = window.setTimeout(flush, 16);
}

async function flush() {
  timer = 0;
  const ids = [...pending];
  pending.clear();
  if (!ids.length) return;
  ids.forEach(i => inFlight.add(i));
  try {
    const r = await OrbitPlayer.guideQuery({ ids, from: window_.from, to: window_.to });
    const data = JSON.parse(r.json) as Record<string, [number, number, string, string, string?, string?, string?, string?, string?][]>;
    for (const id of ids) {
      const rows = data[id] ?? [];
      cache.set(id, rows.map(([start, stop, title, desc, sub, ep, cat, img, rating]) =>
        ({ start, stop, title, desc, sub: sub || undefined, ep: ep || undefined, cat: cat || undefined, img: img || undefined, rating: rating || undefined })));
    }
    while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
  } catch (e) {
    console.warn('[orbit] guide query failed', e);
    for (const id of ids) cache.set(id, NONE);
  } finally {
    ids.forEach(i => inFlight.delete(i));
    guideTick.value++;
  }
}

/** Replaces the in-memory guide (desktop/browser parse, plus any portal guides). */
export function setMemoryGuide(g: Guide, extra?: Map<string, Programme[]>) {
  mem = g.programmes;
  if (extra) for (const [k, v] of extra) mem.set(k, v);
  const has = new Set<string>(mem.keys());
  if (NATIVE_GUIDE) for (const id of guide.value.has) has.add(id);
  guide.value = { names: g.names, ids: g.ids, displayNames: g.displayNames, has };
  guideTick.value++;
}

/** Android: reads the index written by GuideStore.java and starts using the database. */
export async function useNativeGuide(indexPath: string, extra: Map<string, Programme[]>, from: number, to: number) {
  const res = await fetch(Capacitor.convertFileSrc(indexPath), { cache: 'no-store' });
  const j = await res.json() as { at: number; ids: [string, string][]; names: [string, string | null][]; displayNames: [string, string][]; has: string[] };
  cache.clear();
  window_ = { from, to };
  mem = new Map(extra);
  const has = new Set<string>(j.has);
  for (const k of extra.keys()) has.add(k);
  guide.value = { names: new Map(j.names), ids: new Map(j.ids), displayNames: new Map(j.displayNames), has };
  guideTick.value++;
  return j.at;
}

/** For saving the in-memory guide between launches. */
export function memoryEntries(): [string, Programme[]][] { return [...mem]; }

/** Programmes whose title (or episode title) contains `q`, from now on: [guide id, programme]. */
export async function searchProgrammes(q: string, limit = 60): Promise<[string, Programme][]> {
  const from = Date.now();
  const out: [string, Programme][] = [];
  if (q.trim().length < 2) return out;
  if (NATIVE_GUIDE) {
    try {
      const r = await OrbitPlayer.guideSearch({ q, from, limit });
      for (const [ch, start, stop, title, desc, sub, ep, cat, img, rating] of JSON.parse(r.json) as [string, number, number, string, string, string, string, string, string, string][]) {
        out.push([ch, { start, stop, title, desc, sub: sub || undefined, ep: ep || undefined, cat: cat || undefined, img: img || undefined, rating: rating || undefined }]);
      }
    } catch (e) { console.warn('[orbit] guide search failed', e); }
  }
  const ql = q.toLowerCase();
  for (const [id, list] of mem) {
    for (const p of list) {
      if (p.stop > from && (p.title.toLowerCase().includes(ql) || p.sub?.toLowerCase().includes(ql))) out.push([id, p]);
      if (out.length >= limit) break;
    }
    if (out.length >= limit) break;
  }
  return out.sort((a, b) => a[1].start - b[1].start).slice(0, limit);
}
