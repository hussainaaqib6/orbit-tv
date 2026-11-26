// XMLTV programme guides, and matching guide channels to playlist channels.
import { matchKey } from '../core/names';
import type { Channel, Programme } from './types';

export interface Guide {
  /** Guide channel id -> programmes, sorted by start. */
  programmes: Map<string, Programme[]>;
  /** matchKey(display name) -> guide id, or null when two guide channels share a name. */
  names: Map<string, string | null>;
  /** lower-case id -> id */
  ids: Map<string, string>;
  /** guide id -> first display name (for manual matching) */
  displayNames: Map<string, string>;
}

export const emptyGuide = (): Guide => ({ programmes: new Map(), names: new Map(), ids: new Map(), displayNames: new Map() });

const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export function xmlDecode(s: string): string {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_, e: string) => {
      const named = ENTITY[e.toLowerCase()];
      if (named) return named;
      return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1));
    })
    .trim();
}

/** "20261125193000 +0100" -> epoch ms */
export function xmltvDate(s: string): number {
  const m = /^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)?\s*([+-]\d{4})?/.exec(s.trim());
  if (!m) return NaN;
  let t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  if (m[7]) {
    const sign = m[7][0] === '-' ? -1 : 1;
    t -= sign * (+m[7].slice(1, 3) * 60 + +m[7].slice(3)) * 60000;
  }
  return t;
}

const attr = (a: string, k: string) => (new RegExp('\\b' + k + '="([^"]*)"').exec(a) || [])[1] || '';

export interface ParseOptions {
  /** Hours to add to every time (for guides with the wrong time zone). */
  offsetHours?: number;
  /** Only keep these guide ids / display-name keys (saves a lot of memory on TV sticks). */
  wanted?: { ids: Set<string>; names: Set<string> };
  now?: number;
}

/** Adds the programmes in `text` to `guide`. Returns the number of programmes kept. */
export function parseXMLTV(text: string, guide: Guide, o: ParseOptions = {}): number {
  const off = (o.offsetHours || 0) * 3600e3;
  const now = o.now ?? Date.now();
  const min = now - 7 * 86400e3, max = now + 7 * 86400e3;
  const keep = new Set<string>();

  for (const m of text.matchAll(/<channel\s+id="([^"]*)"[^>]*>([\s\S]*?)<\/channel>/g)) {
    const id = xmlDecode(m[1]);
    guide.ids.set(id.toLowerCase(), id);
    if (!o.wanted || o.wanted.ids.has(id.toLowerCase())) keep.add(id);
    let first = true;
    for (const d of m[2].matchAll(/<display-name[^>]*>([\s\S]*?)<\/display-name>/g)) {
      const name = xmlDecode(d[1]);
      if (first) { guide.displayNames.set(id, name); first = false; }
      const k = matchKey(name);
      if (!k) continue;
      if (o.wanted?.names.has(k)) keep.add(id);
      const prev = guide.names.get(k);
      guide.names.set(k, prev === undefined || prev === id ? id : null);
    }
  }

  let count = 0;
  const touched = new Set<Programme[]>();
  for (const m of text.matchAll(/<programme\s+([^>]*)>([\s\S]*?)<\/programme>/g)) {
    const a = m[1];
    const start = xmltvDate(attr(a, 'start')) + off, stop = xmltvDate(attr(a, 'stop')) + off;
    if (!(stop > min && start < max)) continue;
    const ch = xmlDecode(attr(a, 'channel'));
    if (o.wanted && !keep.has(ch) && !o.wanted.ids.has(ch.toLowerCase())) continue;
    const title = /<title[^>]*>([\s\S]*?)<\/title>/.exec(m[2]);
    const desc = /<desc[^>]*>([\s\S]*?)<\/desc>/.exec(m[2]);
    let list = guide.programmes.get(ch);
    if (!list) guide.programmes.set(ch, (list = []));
    list.push({ start, stop, title: xmlDecode(title ? title[1] : '') || 'Untitled', desc: xmlDecode(desc ? desc[1] : '') });
    touched.add(list);
    guide.ids.set(ch.toLowerCase(), ch);
    count++;
  }
  for (const list of touched) {
    list.sort((x, y) => x.start - y.start);
    // Several guides can carry the same channel: drop exact duplicates.
    for (let i = list.length - 1; i > 0; i--) if (list[i].start === list[i - 1].start) list.splice(i, 1);
  }
  return count;
}

/** The guide ids and names worth keeping for these channels. */
export function wantedFor(channels: Channel[], manual: Record<string, string>) {
  const ids = new Set<string>(), names = new Set<string>();
  for (const c of channels) {
    if (c.epgId) { ids.add(c.epgId.toLowerCase()); names.add(matchKey(c.epgId)); }
    names.add(matchKey(c.name));
  }
  for (const v of Object.values(manual)) ids.add(v.toLowerCase());
  return { ids, names };
}

/**
 * Which guide id a channel uses: a manual choice first, then its tvg-id, then an unambiguous name match.
 * Ambiguous names are left unmatched rather than guessed.
 */
export function guideIdFor(c: Channel, guide: Guide, manual: Record<string, string>): string | null {
  const chosen = manual[c.key];
  if (chosen) return guide.programmes.has(chosen) ? chosen : null;
  let id: string | null | undefined = null;
  if (c.epgId) id = guide.programmes.has(c.epgId) ? c.epgId : guide.ids.get(c.epgId.toLowerCase());
  if (!id) id = guide.names.get(matchKey(c.name)) ?? (c.epgId ? guide.names.get(matchKey(c.epgId)) : null);
  return id && guide.programmes.has(id) ? id : null;
}

/** Index of the programme on at `t`, or of the next one if nothing is on. -1 if none. */
export function indexAt(list: Programme[], t: number): number {
  let lo = 0, hi = list.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].stop > t) { ans = mid; hi = mid - 1; } else lo = mid + 1;
  }
  return ans;
}

export function nowNext(list: Programme[], t = Date.now()): { now: Programme | null; next: Programme | null } {
  const i = indexAt(list, t);
  if (i < 0) return { now: null, next: null };
  return list[i].start <= t ? { now: list[i], next: list[i + 1] ?? null } : { now: null, next: list[i] };
}

export const progress = (p: Programme | null, t = Date.now()) =>
  p ? Math.max(0, Math.min(1, (t - p.start) / (p.stop - p.start))) : 0;
