// Other versions of the same channel: "UK: Sky Sports Main Event FHD", "Sky Sports Main Event HD",
// "SKY SPORTS MAIN EVENT (Backup)", the same channel from another playlist. Used to switch over when a
// stream keeps failing, and offered in the player's options.
//
// Versions are found by the channel's name with country prefixes, quality tags and "backup"-style
// words removed. Time-shifted (+1), radio and highlights channels are never treated as versions.
import { computed } from '@preact/signals';
import { catalog } from './library';
import { cleanChannelName } from '../core/names';
import type { Channel } from './types';

const NOT_A_VERSION = /(\+\s?\d\b|\btime\s?shift|\bradio\b|\bhighlights?\b|\breplay\b|\bcatch\s?up\b)/i;
const NOISE = /\b(hd|fhd|uhd|sd|4k|8k|hevc|h\.?265|h\.?264|1080p?|720p?|2160p?|hdr|50\s?fps|60\s?fps|backup|bk|alt|alternative|multi|raw|vip|plus\s?hd|\d{1,2}\s?fps)\b/gi;

/** The name all versions of a channel share, or '' when it should not be grouped. */
export function versionKey(name: string): string {
  if (NOT_A_VERSION.test(name)) return '';
  const base = cleanChannelName(name).name
    .replace(/^\s*[A-Z]{2,3}\s*[-|:]\s*/, '')  // "UK - ", "EN | "
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .replace(NOISE, ' ')
    .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');
  return base.length >= 2 ? base : '';
}

/** Rough quality rank from the name, best first, for ordering versions. */
export function qualityRank(name: string): number {
  const n = name.toUpperCase();
  if (/\b(8K)\b/.test(n)) return 5;
  if (/\b(4K|UHD|2160P?)\b/.test(n)) return 4;
  if (/\b(FHD|1080P?)\b/.test(n)) return 3;
  if (/\b(HD|720P?)\b/.test(n)) return 2;
  if (/\bSD\b/.test(n)) return 0;
  return 1;
}

const groups = computed(() => {
  const m = new Map<string, Channel[]>();
  for (const c of catalog.value.live) {
    const k = versionKey(c.name);
    if (!k) continue;
    let l = m.get(k);
    if (!l) m.set(k, (l = []));
    l.push(c);
  }
  return m;
});

/**
 * Other versions of `c`, most likely to work first: same playlist before other playlists (a second
 * playlist means a second provider connection), then by quality, at most 32.
 */
export function versionsOf(c: Channel): Channel[] {
  const k = versionKey(c.name);
  if (!k) return [];
  const list = groups.value.get(k) ?? [];
  return list.filter(x => x.key !== c.key)
    .sort((a, b) => +(b.sourceId === c.sourceId) - +(a.sourceId === c.sourceId) || qualityRank(b.name) - qualityRank(a.name))
    .slice(0, 32);
}
