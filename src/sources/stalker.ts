// MAC portals (Stalker / Ministra middleware). Links expire quickly, so each one is created on demand.
import { request, friendlyError } from '../core/http';
import { num } from '../core/format';
import type { Catalog, Channel, Movie, Programme, Source } from './types';

const MAG_UA = 'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3';

interface Session { endpoint: string; base: string; headers: Record<string, string> }
const sessions = new Map<string, Session>();

export function portalBase(portal: string): string {
  let b = portal.trim();
  if (!/^https?:\/\//i.test(b)) b = 'http://' + b;
  return b.replace(/\/+$/, '')
    .replace(/\/(stalker_portal\/)?(server\/load\.php|portal\.php)$/i, '')
    .replace(/\/c$/i, '')
    .replace(/\/stalker_portal$/i, '');
}

export const normaliseMac = (m: string) => m.trim().toUpperCase().replace(/[^0-9A-F]/g, '').replace(/(..)(?!$)/g, '$1:');

async function login(src: Source): Promise<Session> {
  const base = portalBase(src.portal ?? '');
  const mac = normaliseMac(src.mac ?? '');
  let tz = 'Europe/London';
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || tz; } catch {}
  const headers: Record<string, string> = {
    'User-Agent': MAG_UA, 'X-User-Agent': 'Model: MAG250; Link: WiFi',
    Cookie: `mac=${encodeURIComponent(mac)}; stb_lang=en; timezone=${encodeURIComponent(tz)}`, Referer: base + '/c/',
  };
  let lastErr: unknown = null;
  for (const path of ['/portal.php', '/stalker_portal/server/load.php', '/server/load.php']) {
    try {
      const r = await request<{ js?: { token?: string } }>(`${base}${path}?type=stb&action=handshake&token=&prehash=0&JsHttpRequest=1-xml`, { headers });
      const token = r?.js?.token;
      if (!token) continue;
      const s: Session = { endpoint: base + path, base, headers: { ...headers, Authorization: 'Bearer ' + token } };
      const prof = await request<{ js?: { blocked?: string; status?: number } }>(`${s.endpoint}?type=stb&action=get_profile&hd=1&stb_type=MAG250&JsHttpRequest=1-xml`, { headers: s.headers }).catch(() => null);
      if (prof?.js && (prof.js.blocked === '1' || prof.js.status === 2)) throw new Error('This MAC address is blocked by the portal.');
      sessions.set(src.id, s);
      return s;
    } catch (e) {
      lastErr = e;
      if (e instanceof Error && /blocked/.test(e.message)) throw e;
    }
  }
  throw new Error('The portal did not accept this MAC address' + (lastErr ? ` (${friendlyError(lastErr)})` : '.'));
}

async function call<T>(src: Source, q: string, retry = true): Promise<T> {
  const s = sessions.get(src.id) ?? await login(src);
  try {
    const r = await request<{ js?: T }>(`${s.endpoint}?${q}&JsHttpRequest=1-xml`, { headers: s.headers });
    if (r?.js === undefined) throw new Error('Portal session expired');
    return r.js;
  } catch (e) {
    if (!retry) throw e;
    sessions.delete(src.id);
    return call<T>(src, q, false);
  }
}

export async function portalLink(src: Source, type: 'itv' | 'vod', cmd: string): Promise<string> {
  const r = await call<{ cmd?: string }>(src, `type=${type}&action=create_link&cmd=${encodeURIComponent(cmd)}&series=&forced_storage=0&disable_ad=0&download=0`);
  const u = String(r?.cmd || cmd || '').replace(/^(ffmpeg|ffrt\d?|auto)\s+/i, '').trim();
  if (!/^https?:\/\//i.test(u)) throw new Error('The portal did not return a playable link.');
  return u;
}

interface PortalChannel { id: string; name?: string; logo?: string; tv_genre_id?: string; cmd: string; xmltv_id?: string }
interface PortalVod { id: string; name?: string; screenshot_uri?: string; rating_imdb?: string; year?: string; description?: string; added?: string; cmd: string; is_series?: string }

export async function loadStalker(src: Source): Promise<Catalog> {
  const s = await login(src);
  const abs = (u?: string) => !u ? '' : /^https?:/i.test(u) ? u : s.base + (u.startsWith('/') ? '' : '/') + u;
  const genres = await call<{ id: string; title: string }[]>(src, 'type=itv&action=get_genres').catch(() => []);
  const G = new Map((genres || []).map(g => [String(g.id), g.title]));
  const chans = await call<{ data?: PortalChannel[] }>(src, 'type=itv&action=get_all_channels');
  const live: Channel[] = (chans?.data ?? []).map(c => ({
    kind: 'live', key: `l:${src.id}:${c.id}`, sourceId: src.id, number: 0, name: c.name || '', logo: abs(c.logo),
    group: G.get(String(c.tv_genre_id)) || 'Uncategorised', url: '', epgId: c.xmltv_id || `portal:${src.id}:${c.id}`,
    catchup: null, portal: { id: c.id, cmd: c.cmd },
  }));

  const movies: Movie[] = [];
  try {
    const cats = (await call<{ id: string; title: string }[]>(src, 'type=vod&action=get_categories')) || [];
    for (const cat of cats.filter(c => c.id !== '*').slice(0, 60)) {
      for (let page = 1; page <= 4; page++) {
        const r = await call<{ data?: PortalVod[]; total_items?: string; max_page_items?: string }>(src, `type=vod&action=get_ordered_list&category=${encodeURIComponent(cat.id)}&p=${page}&sortby=added`);
        for (const v of r?.data ?? []) {
          if (+(v.is_series ?? 0)) continue;
          movies.push({
            kind: 'movie', key: `m:${src.id}:${v.id}`, sourceId: src.id, name: v.name || '', poster: abs(v.screenshot_uri),
            group: cat.title || 'Films', rating: num(v.rating_imdb), year: +(v.year ?? 0) || 0, plot: v.description || '',
            added: Date.parse(v.added ?? '') || 0, url: '', portal: { id: v.id, cmd: v.cmd },
          });
        }
        if (page >= Math.ceil((+(r?.total_items ?? 0)) / (+(r?.max_page_items ?? 14) || 14))) break;
      }
    }
  } catch { /* films are optional */ }
  return { live, movies, series: [], epgUrls: [] };
}

/** The portal's own guide, keyed the same way as Channel.epgId for portal channels. */
export async function loadStalkerGuide(src: Source): Promise<Map<string, Programme[]>> {
  const r = await call<{ data?: Record<string, { start_timestamp: string; stop_timestamp: string; name?: string; descr?: string }[]> }>(src, 'type=itv&action=get_epg_info&period=168');
  const out = new Map<string, Programme[]>();
  for (const [id, list] of Object.entries(r?.data ?? {})) {
    const progs = (list ?? []).map(x => ({ start: +x.start_timestamp * 1000, stop: +x.stop_timestamp * 1000, title: x.name || 'Untitled', desc: x.descr || '' }))
      .filter(x => x.stop > x.start).sort((a, b) => a.start - b.start);
    if (progs.length) out.set(`portal:${src.id}:${id}`, progs);
  }
  return out;
}
