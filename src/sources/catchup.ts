// Catch-up (archive) URLs for Xtream servers and the M3U `catchup` attribute styles.
import type { Channel, Programme, Source } from './types';
import { xtBase } from './xtream';
import { pad2 } from '../core/format';

export const canCatchup = (c: Channel | undefined, p: Programme | null | undefined, now = Date.now()) =>
  !!(c?.catchup && p && p.start < now && p.start >= now - c.catchup.days * 86400e3);

/** "2026-11-25:19-30" in the server's time zone (Xtream timeshift format). */
export function xtStamp(t: number, tz?: string): string {
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
      timeZone: tz || undefined, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(t)).map(x => [x.type, x.value]));
    return `${parts.year}-${parts.month}-${parts.day}:${parts.hour}-${parts.minute}`;
  } catch {
    return tz ? xtStamp(t) : '';
  }
}

const join = (u: string, q: string) => u + (u.includes('?') ? '&' : '?') + q.replace(/^[?&]/, '');

export function catchupUrl(c: Channel, p: Programme, src: Source | undefined, ext: 'ts' | 'm3u8', now = Date.now()): string | null {
  const cu = c.catchup;
  if (!cu) return null;
  const startS = Math.floor(p.start / 1000), endS = Math.floor(p.stop / 1000), nowS = Math.floor(now / 1000);
  const durMin = Math.max(1, Math.ceil((Math.min(p.stop, now) - p.start) / 60000));

  if (cu.type === 'xc' || cu.type === 'xtream') {
    let base: string, u: string, pw: string, id: string;
    if (src?.type === 'xtream' && c.xtId != null) {
      base = xtBase(src.server ?? ''); u = encodeURIComponent(src.user ?? ''); pw = encodeURIComponent(src.pass ?? ''); id = String(c.xtId);
    } else {
      const m = /^(https?:\/\/[^/]+)\/(?:live\/)?([^/]+)\/([^/]+)\/(\d+)/.exec(c.url);
      if (!m) return null;
      [, base, u, pw, id] = m;
    }
    const minutes = Math.ceil((p.stop - p.start) / 60000);
    return `${base}/timeshift/${u}/${pw}/${minutes}/${xtStamp(p.start, src?.timezone)}/${id}.${ext}`;
  }

  const d = new Date(p.start);
  const vals: Record<string, string | number> = {
    utc: startS, start: startS, lutc: nowS, now: nowS, timestamp: nowS, end: endS, utcend: endS, stop: endS,
    duration: durMin * 60, offset: nowS - startS,
    Y: d.getUTCFullYear(), m: pad2(d.getUTCMonth() + 1), d: pad2(d.getUTCDate()), H: pad2(d.getUTCHours()), M: pad2(d.getUTCMinutes()), S: pad2(d.getUTCSeconds()),
  };
  const fill = (t: string) => t.replace(/\$?\{(utc|start|lutc|now|timestamp|end|utcend|stop|duration|offset|Y|m|d|H|M|S)(?::[^}]*)?\}/g, (_, k: string) => String(vals[k]));

  switch (cu.type) {
    case 'append':
      if (!cu.source) return join(c.url, `utc=${startS}&lutc=${nowS}`);
      return /^[?&]/.test(cu.source) ? join(c.url, fill(cu.source)) : c.url + fill(cu.source);
    case 'default':
      return cu.source ? fill(cu.source) : join(c.url, `utc=${startS}&lutc=${nowS}`);
    case 'shift':
    case 'timeshift':
      return join(c.url, `utc=${startS}&lutc=${nowS}`);
    case 'flussonic': case 'fs': case 'flussonic-hls': case 'flussonic-ts':
      if (/\/(index|video|mono)\.m3u8/.test(c.url)) return c.url.replace(/\/(index|video|mono)\.m3u8/, `/$1-${startS}-${durMin * 60}.m3u8`);
      return c.url.replace(/\/mpegts(\?|$)/, `/timeshift_abs-${startS}.ts$1`);
    default:
      return null;
  }
}
