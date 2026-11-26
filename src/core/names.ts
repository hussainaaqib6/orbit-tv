// Cleaning up the names IPTV providers use, so channels and films look tidy and match the guide.

/** A matching key: lower case, no provider prefix, no quality tags, no punctuation. */
export function matchKey(s: string): string {
  return String(s || '').toLowerCase()
    .replace(/^\s*[a-z]{2,4}\s*[:|]\s*/, '')
    .replace(/\[[^\]]*\]|\([^)]*\)/g, '')
    .replace(/\b(hd|fhd|uhd|4k|sd|hevc|h\.?265|raw|50fps|60fps|backup)\b/g, '')
    .replace(/[^a-z0-9+]/g, '');
}

const QUALITY = /\b(4K|UHD|FHD|HD|SD|HEVC|H\.?265|50FPS|60FPS)\b/i;

export interface CleanName { name: string; prefix: string; quality: string }

/** "UK: BBC One FHD" -> { name: "BBC One", prefix: "UK", quality: "FHD" } */
export function cleanChannelName(raw: string): CleanName {
  let s = String(raw || '').trim();
  let prefix = '';
  // Provider prefixes are upper-case codes ("UK:", "EN |", "4K:"), never ordinary words ("Dave: …").
  const pm = /^\s*([A-Z0-9]{2,4})\s*[:|]\s*/.exec(s);
  if (pm) { prefix = pm[1].toUpperCase(); s = s.slice(pm[0].length); }
  const qm = QUALITY.exec(s);
  const quality = qm ? qm[1].toUpperCase().replace('H.265', 'HEVC').replace('H265', 'HEVC') : '';
  if (qm) s = (s.slice(0, qm.index) + s.slice(qm.index + qm[0].length));
  s = s.replace(/\s{2,}/g, ' ').replace(/[\s|:-]+$/, '').trim();
  return { name: s || String(raw).trim(), prefix, quality };
}

/** "EN - The Matrix (1999) [4K]" -> { title: "The Matrix", year: 1999 } */
export function cleanTitle(raw: string): { title: string; year: number } {
  let s = String(raw || '');
  s = s.replace(/^\s*[A-Z]{2,3}\s*[-:|]\s+/, '');
  const ym = /[([]?\b(19\d\d|20\d\d)\b[)\]]?/.exec(s);
  const year = ym ? +ym[1] : 0;
  if (ym) s = s.slice(0, ym.index) + s.slice(ym.index + ym[0].length);
  s = s.replace(/\[[^\]]*\]|\([^)]*\)/g, '').replace(QUALITY, '').replace(/[\s._-]+$/, '').replace(/\s{2,}/g, ' ').trim();
  return { title: s || String(raw).trim(), year };
}

/** Two-letter initials for logo placeholders. */
export const initials = (s: string) =>
  String(s || '').replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || 'TV';
