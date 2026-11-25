'use strict';
{
/* ============================ basics ============================ */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/* ---------- platform: Electron / browser / Android & Fire TV / iOS ---------- */
const CAP = window.Capacitor;
const NATIVE = !!(CAP && CAP.isNativePlatform && CAP.isNativePlatform());
const PLATFORM = NATIVE ? CAP.getPlatform() : 'web'; // 'android' | 'ios' | 'web'
const plug = n => { try { return CAP.registerPlugin(n); } catch { return null; } };
const P = NATIVE ? { http: plug('CapacitorHttp'), app: plug('App'), device: plug('Device'), prefs: plug('Preferences'), orient: plug('ScreenOrientation'), status: plug('StatusBar'), awake: plug('KeepAwake'), video: plug('VideoPlayer') } : {};
const UA = 'VLC/3.0.21 LibVLC/3.0.21';
const IS_PHONE = Math.min(screen.width, screen.height) < 600 && navigator.maxTouchPoints > 0;
// Small settings are mirrored to native storage on phones, because iOS may clear web storage when space runs low.
const mirrored = k => !k.startsWith('file.') && !k.startsWith('cache.');
const store = {
  get(k, d) { try { const v = localStorage.getItem('orbit.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) {
    let ok = true;
    try { localStorage.setItem('orbit.' + k, JSON.stringify(v)); } catch { ok = false; }
    if (NATIVE && P.prefs && mirrored(k)) P.prefs.set({ key: 'orbit.' + k, value: JSON.stringify(v) }).catch(() => {});
    if (typeof noteChange === 'function') noteChange(k);
    return ok;
  },
  del(k) { try { localStorage.removeItem('orbit.' + k); } catch {} if (NATIVE && P.prefs) P.prefs.remove({ key: 'orbit.' + k }).catch(() => {}); },
  async restore() {
    if (!NATIVE || !P.prefs) return;
    try {
      const { keys } = await P.prefs.keys();
      for (const key of keys || []) {
        if (!key.startsWith('orbit.') || localStorage.getItem(key) != null) continue;
        const r = await P.prefs.get({ key }); if (r && r.value != null) localStorage.setItem(key, r.value);
      }
    } catch {}
  },
};
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const hhmm = t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const day = t => new Date(t).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
const norm = s => String(s || '').toLowerCase()
  .replace(/^\s*[a-z]{2,4}\s*[:|]\s*/, '')          // "UK: ", "US | "
  .replace(/\[[^\]]*\]|\([^)]*\)/g, '')              // [HD] (backup)
  .replace(/\b(hd|fhd|uhd|4k|sd|hevc|h265|raw|50fps|60fps)\b/g, '')
  .replace(/[^a-z0-9+]/g, '');
const initials = s => String(s || '').replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || 'TV';
function img(src, alt, cls) {
  const i = esc(initials(alt));
  return src
    ? `<img class="${cls}" src="${esc(src)}" alt="" loading="lazy" data-i="${i}">`
    : `<span class="${cls} ph">${i}</span>`;
}
// Swap broken images for initials (delegated, so it covers every render)
document.addEventListener('error', e => {
  const t = e.target;
  if (t.tagName === 'IMG' && t.dataset.i != null) {
    const s = document.createElement('span'); s.className = t.className + ' ph'; s.textContent = t.dataset.i; t.replaceWith(s);
  }
}, true);
function toast(msg, bad) {
  const t = document.createElement('div'); t.className = 'toast' + (bad ? ' bad' : ''); t.textContent = msg;
  $('#toasts').append(t); setTimeout(() => t.remove(), bad ? 8000 : 3500);
}
function setStatus(msg) { const s = $('#status'); s.hidden = !msg; s.innerHTML = msg ? `<span class="spin"></span>${esc(msg)}` : ''; }
const num = v => { const n = parseFloat(v); return isFinite(n) && n > 0 ? n : 0; };

/* ============================ state ============================ */
const S = {
  sources: [], favs: new Set(), recent: [], pos: {}, cfg: {}, reminders: [],
  all: { live: [], movies: [], series: [] },          // everything the sources returned
  live: [], movies: [], series: [], index: new Map(), // what the current profile may see
  epg: new Map(), epgNames: new Map(), epgIdsLower: new Map(), epgChannels: new Map(),
  view: 'home', loading: false, loaded: false, lastLoad: 0,
};
/* ---------- profiles ---------- */
const AVATAR_COLOURS = ['#4d8dff', '#ff5d73', '#2fbf71', '#ffb020', '#a970ff', '#18b6c9', '#ff7ab8', '#8a94b8'];
const PROF = { list: [], active: null, unlocked: false };
function loadProfiles() {
  PROF.list = store.get('profiles', null) || [{ id: 'main', name: 'Me', color: AVATAR_COLOURS[0], kids: false }];
  const a = store.get('activeProfile', 'main');
  PROF.active = PROF.list.find(p => p.id === a) || PROF.list[0];
}
const saveProfiles = () => store.set('profiles', PROF.list);
const pkey = k => `${k}.${PROF.active.id}`;
function loadState() {
  loadProfiles();
  const legacy = PROF.active.id === 'main';
  S.sources = store.get('sources', []);
  S.favs = new Set(store.get(pkey('favs'), legacy ? store.get('favs', []) : []));
  S.recent = store.get(pkey('recent'), legacy ? store.get('recent', []) : []);
  S.pos = store.get(pkey('pos'), legacy ? store.get('pos', {}) : {});
  S.reminders = store.get(pkey('reminders'), []);
  S.cfg = Object.assign({ epgOffset: 0, extraEpg: [], multi: [null, null, null, null], mvLayout: 4, player: 'auto', layout: 'auto',
    pin: '', locked: [], autoLock: true, refreshHours: 12, epgMap: {}, askProfile: true }, store.get('cfg', {}));
}
loadState();
const fileText = new Map(); // M3U files that were too large to remember
const saveSources = () => store.set('sources', S.sources.map(({ count, err, ...s }) => ({ ...s, count, err })));
const saveFavs = () => store.set(pkey('favs'), [...S.favs]);
const saveRecent = () => store.set(pkey('recent'), S.recent);
const savePosAll = () => store.set(pkey('pos'), S.pos);
const saveReminders = () => store.set(pkey('reminders'), S.reminders);
const saveCfg = () => store.set('cfg', S.cfg);

/* ============================ network ============================ */
const host = u => { try { return new URL(u).host; } catch { return u; } };
function toBytes(d) {
  if (d instanceof ArrayBuffer) return new Uint8Array(d);
  if (typeof d === 'string') {
    try { const bin = atob(d.replace(/\s/g, '')); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
    catch { return new TextEncoder().encode(d); }
  }
  return new TextEncoder().encode(JSON.stringify(d));
}
// Headers a browser will not let a page set. Electron's main process renames X-Orbit-* back to the real header.
const FORBIDDEN = { 'cookie': 'X-Orbit-Cookie', 'user-agent': 'X-Orbit-UA', 'referer': 'X-Orbit-Referer' };
/**
 * request(url, { method, headers, body, type: 'json' | 'text' | 'bytes' })
 * On phones and Fire TV this goes through the native HTTP stack (no CORS limits, any header).
 */
async function request(url, o = {}) {
  const method = o.method || 'GET', type = o.type || 'json';
  const headers = Object.assign({ Accept: type === 'json' ? 'application/json' : '*/*' }, o.headers || {});
  let body = o.body;
  if (body && typeof body === 'object' && !(body instanceof FormData) && !(body instanceof URLSearchParams)) { body = JSON.stringify(body); headers['Content-Type'] = headers['Content-Type'] || 'application/json'; }
  if (body instanceof URLSearchParams) { body = body.toString(); headers['Content-Type'] = 'application/x-www-form-urlencoded'; }
  if (NATIVE && P.http) {
    if (!headers['User-Agent']) headers['User-Agent'] = UA;
    const r = await P.http.request({ url, method, headers, data: body, responseType: type === 'bytes' ? 'blob' : 'text', connectTimeout: 20000, readTimeout: 180000 });
    if (r.status >= 400) { const e = new Error(`HTTP ${r.status} from ${host(url)}`); e.status = r.status; e.body = r.data; throw e; }
    if (type === 'bytes') return toBytes(r.data);
    const txt = typeof r.data === 'string' ? r.data : JSON.stringify(r.data);
    if (type === 'text') return txt;
    if (typeof r.data === 'object' && r.data !== null) return r.data;
    try { return txt ? JSON.parse(txt) : null; } catch { throw new Error(`Unexpected reply from ${host(url)}`); }
  }
  const h = {};
  for (const [k, v] of Object.entries(headers)) h[FORBIDDEN[k.toLowerCase()] || k] = v;
  const r = await fetch(url, { method, headers: h, body: method === 'GET' ? undefined : body, cache: 'no-store' });
  if (!r.ok) { const e = new Error(`HTTP ${r.status} from ${host(url)}`); e.status = r.status; try { e.body = await r.text(); } catch {} throw e; }
  if (type === 'bytes') return new Uint8Array(await r.arrayBuffer());
  const txt = await r.text();
  if (type === 'text') return txt;
  try { return txt ? JSON.parse(txt) : null; } catch { throw new Error(`Unexpected reply from ${host(url)}`); }
}
async function getBytes(url) {
  if (NATIVE && P.http) {
    const r = await P.http.request({ url, method: 'GET', headers: { 'User-Agent': UA, Accept: '*/*' }, responseType: 'blob', connectTimeout: 20000, readTimeout: 180000 });
    if (r.status >= 400) throw new Error(`HTTP ${r.status} from ${host(url)}`);
    return toBytes(r.data);
  }
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`HTTP ${r.status} from ${host(url)}`);
  return new Uint8Array(await r.arrayBuffer());
}
async function getText(url) {
  const b = await getBytes(url);
  if (b[0] === 0x1f && b[1] === 0x8b) {
    if (!window.DecompressionStream) throw new Error('This device cannot unpack .gz guides. Use an uncompressed .xml link.');
    return await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  }
  return new TextDecoder().decode(b);
}
async function getJSON(url) {
  const t = await getText(url);
  try { return JSON.parse(t); } catch { throw new Error(`Unexpected reply from ${host(url)}`); }
}

/* ============================ M3U ============================ */
function parseM3U(text, src) {
  const out = { live: [], movies: [], series: [], epg: '' };
  const lines = text.split(/\r?\n/);
  const head = lines.find(l => l.startsWith('#EXTM3U')) || '';
  const em = head.match(/(?:x-tvg-url|url-tvg)="([^"]+)"/i);
  if (em) out.epg = em[1].split(',')[0].trim();
  const hc = {}; head.replace(/([\w-]+)="([^"]*)"/g, (_, k, v) => { hc[k.toLowerCase()] = v; });
  const seriesMap = new Map();
  let cur = null, grp = '', n = 0;
  for (const raw of lines) {
    const l = raw.trim();
    if (!l) continue;
    if (l.startsWith('#EXTINF')) {
      const a = {};
      l.replace(/([\w-]+)="([^"]*)"/g, (_, k, v) => { a[k.toLowerCase()] = v; });
      const stripped = l.replace(/([\w-]+)="([^"]*)"/g, '');
      const name = stripped.slice(stripped.indexOf(',') + 1).trim() || a['tvg-name'] || 'Untitled';
      const ct = a['catchup'] || a['catchup-type'] || hc['catchup'] || '';
      const cs = a['catchup-source'] || hc['catchup-source'] || '';
      const cd = +(a['catchup-days'] || a['tvg-rec'] || a['timeshift'] || hc['catchup-days'] || 0);
      cur = { name, logo: a['tvg-logo'] || '', group: a['group-title'] || '', epgId: a['tvg-id'] || '', catchup: ct || cd ? { type: (ct || 'default').toLowerCase(), source: cs, days: cd || 7 } : null };
    } else if (l.startsWith('#EXTGRP:')) {
      grp = l.slice(8).trim();
    } else if (!l.startsWith('#') && cur) {
      const url = l, g = cur.group || grp || 'Uncategorised';
      const path = url.split('?')[0].toLowerCase();
      const isFile = /\.(mp4|mkv|avi|mov|m4v|webm)$/.test(path);
      n++;
      if (/\/series\//.test(path) || (isFile && /S\d{1,2}\s*E\d{1,3}/i.test(cur.name))) {
        const m = /^(.*?)[\s._-]*S(\d{1,2})[\s._-]*E(\d{1,3})(.*)$/i.exec(cur.name);
        const title = (m ? m[1] : cur.name).replace(/[\s._-]+$/, '') || cur.name;
        const sk = norm(title) + '|' + g;
        let s = seriesMap.get(sk);
        if (!s) {
          s = { kind: 'series', key: `s:${src.id}:${seriesMap.size}`, name: title, poster: cur.logo, group: g, seasons: {} };
          seriesMap.set(sk, s);
        }
        const season = m ? +m[2] : 1, ep = m ? +m[3] : Object.values(s.seasons).flat().length + 1;
        (s.seasons[season] ||= []).push({ num: ep, title: m && m[4].replace(/^[\s._-]+/, '') || `Episode ${ep}`, url });
      } else if (/\/movie\//.test(path) || isFile) {
        out.movies.push({ kind: 'movie', key: `m:${src.id}:${n}`, name: cur.name, poster: cur.logo, group: g, url });
      } else {
        out.live.push({ kind: 'live', key: `l:${src.id}:${n}`, mkey: `${src.id}:${norm(cur.name)}`, name: cur.name, logo: cur.logo, group: g, url, epgId: cur.epgId, catchup: cur.catchup });
      }
      cur = null;
    }
  }
  for (const s of seriesMap.values()) {
    for (const k in s.seasons) s.seasons[k].sort((a, b) => a.num - b.num);
    out.series.push(s);
  }
  return out;
}
async function loadM3U(src) {
  let text;
  if (src.url) text = await getText(src.url);
  else text = fileText.get(src.id) ?? store.get('file.' + src.id, null);
  if (text == null) throw new Error('This file playlist was too large to remember. Open the file again in Settings.');
  if (!/#EXTINF/i.test(text)) throw new Error('That does not look like an M3U playlist.');
  return parseM3U(text, src);
}

/* ============================ Xtream Codes ============================ */
function xtBase(src) {
  let s = src.server.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
  return s.replace(/\/(player_api\.php|get\.php).*$/i, '');
}
const xtQ = src => `username=${encodeURIComponent(src.user)}&password=${encodeURIComponent(src.pass)}`;
async function loadXtream(src) {
  const base = xtBase(src), q = xtQ(src);
  const u = encodeURIComponent(src.user), p = encodeURIComponent(src.pass);
  const api = a => getJSON(`${base}/player_api.php?${q}${a ? '&action=' + a : ''}`);
  const info = await api('');
  if (!info || !info.user_info || +info.user_info.auth === 0) throw new Error('Login failed — check server, username and password.');
  if (info.user_info.status && info.user_info.status !== 'Active') throw new Error(`Account status: ${info.user_info.status}`);
  src.expires = info.user_info.exp_date ? +info.user_info.exp_date * 1000 : 0;
  src.tz = (info.server_info && info.server_info.timezone) || '';
  const formats = info.user_info.allowed_output_formats || [];
  const ext = formats.includes('m3u8') || !formats.length ? 'm3u8' : 'ts';
  const safe = pr => pr.then(x => Array.isArray(x) ? x : []).catch(() => []);
  const [lc, ls, vc, vs, sc, ss] = await Promise.all(['get_live_categories', 'get_live_streams', 'get_vod_categories', 'get_vod_streams', 'get_series_categories', 'get_series'].map(a => safe(api(a))));
  const cat = list => Object.fromEntries(list.map(c => [String(c.category_id), c.category_name]));
  const L = cat(lc), V = cat(vc), SC = cat(sc);
  return {
    epg: `${base}/xmltv.php?${q}`,
    live: ls.map(s => ({ kind: 'live', key: `l:${src.id}:${s.stream_id}`, name: s.name || '', logo: s.stream_icon || '', group: L[s.category_id] || 'Uncategorised', url: `${base}/live/${u}/${p}/${s.stream_id}.${ext}`, epgId: s.epg_channel_id || '', xt: { src: src.id, id: s.stream_id }, mkey: `${src.id}:${s.stream_id}`, catchup: +s.tv_archive ? { type: 'xc', days: +s.tv_archive_duration || 3 } : null })),
    movies: vs.map(s => ({ kind: 'movie', key: `m:${src.id}:${s.stream_id}`, name: s.name || '', poster: s.stream_icon || '', group: V[s.category_id] || 'Uncategorised', rating: num(s.rating), added: +s.added || 0, url: `${base}/movie/${u}/${p}/${s.stream_id}.${s.container_extension || 'mp4'}`, xt: { src: src.id, id: s.stream_id } })),
    series: ss.map(s => ({ kind: 'series', key: `s:${src.id}:${s.series_id}`, name: s.name || '', poster: s.cover || '', group: SC[s.category_id] || 'Uncategorised', rating: num(s.rating), added: +s.last_modified || 0, plot: s.plot || '', year: s.releaseDate || s.release_date || '', xt: { src: src.id, id: s.series_id } })),
  };
}
async function xtSeriesInfo(s) {
  const src = S.sources.find(x => x.id === s.xt.src); if (!src) return;
  const base = xtBase(src), u = encodeURIComponent(src.user), p = encodeURIComponent(src.pass);
  const r = await getJSON(`${base}/player_api.php?${xtQ(src)}&action=get_series_info&series_id=${s.xt.id}`);
  s.seasons = {};
  for (const [season, eps] of Object.entries(r.episodes || {})) {
    s.seasons[season] = (eps || []).map(e => ({ num: +e.episode_num || 0, title: e.title || `Episode ${e.episode_num}`, url: `${base}/series/${u}/${p}/${e.id}.${e.container_extension || 'mp4'}`, plot: e.info?.plot || '', dur: e.info?.duration || '' })).sort((a, b) => a.num - b.num);
  }
  if (r.info) { s.plot = r.info.plot || s.plot; s.year = r.info.releaseDate || s.year; s.genre = r.info.genre || ''; s.cast = r.info.cast || ''; }
}
async function xtMovieInfo(m) {
  const src = S.sources.find(x => x.id === m.xt.src); if (!src) return;
  const r = await getJSON(`${xtBase(src)}/player_api.php?${xtQ(src)}&action=get_vod_info&vod_id=${m.xt.id}`);
  const i = r.info || {};
  Object.assign(m, { plot: i.plot || i.description || '', year: i.releasedate || i.release_date || '', genre: i.genre || '', dur: i.duration || '', cast: i.cast || '', director: i.director || '', infoLoaded: true });
}

/* ============================ catch-up ============================ */
function tzStamp(t, tz) {
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz || undefined, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(t)).map(x => [x.type, x.value]));
    return `${parts.year}-${parts.month}-${parts.day}:${parts.hour}-${parts.minute}`;
  } catch { return tzStamp(t, ''); }
}
const canCatchup = (ch, p) => !!(ch && ch.catchup && p && p.start < Date.now() && p.start >= Date.now() - (ch.catchup.days || 3) * 86400e3);
function catchupUrl(ch, p) {
  const c = ch.catchup; if (!c) return null;
  const startS = Math.floor(p.start / 1000), endS = Math.floor(p.stop / 1000), nowS = Math.floor(Date.now() / 1000);
  const dur = Math.max(1, Math.ceil((Math.min(p.stop, Date.now()) - p.start) / 60000));
  if (c.type === 'xc' || c.type === 'xtream') {
    const src = ch.xt && S.sources.find(x => x.id === ch.xt.src);
    let base, u, pw, id;
    if (src && src.type === 'xtream') { base = xtBase(src); u = encodeURIComponent(src.user); pw = encodeURIComponent(src.pass); id = ch.xt.id; }
    else { const m = /^(https?:\/\/[^/]+)\/(?:live\/)?([^/]+)\/([^/]+)\/(\d+)/.exec(ch.url); if (!m) return null; [, base, u, pw, id] = m; }
    const ext = PLATFORM === 'ios' || /\.m3u8/i.test(ch.url) ? 'm3u8' : 'ts';
    return `${base}/timeshift/${u}/${pw}/${Math.ceil((p.stop - p.start) / 60000)}/${tzStamp(p.start, src && src.tz)}/${id}.${ext}`;
  }
  const d = new Date(p.start), pad = n => String(n).padStart(2, '0');
  const parts = { Y: d.getUTCFullYear(), m: pad(d.getUTCMonth() + 1), d: pad(d.getUTCDate()), H: pad(d.getUTCHours()), M: pad(d.getUTCMinutes()), S: pad(d.getUTCSeconds()) };
  const vals = { utc: startS, start: startS, lutc: nowS, now: nowS, timestamp: nowS, end: endS, utcend: endS, stop: endS, duration: dur * 60, offset: nowS - startS, ...parts };
  const fill = t => String(t).replace(/\$?\{(utc|start|lutc|now|timestamp|end|utcend|stop|duration|offset|Y|m|d|H|M|S)(?::[^}]*)?\}/g, (_, k) => vals[k]);
  const join = (u, q) => u + (u.includes('?') ? '&' : '?') + q.replace(/^[?&]/, '');
  if (c.type === 'append') return c.source ? (c.source.startsWith('?') || c.source.startsWith('&') ? join(ch.url, fill(c.source)) : ch.url + fill(c.source)) : join(ch.url, `utc=${startS}&lutc=${nowS}`);
  if (c.type === 'default') return c.source ? fill(c.source) : join(ch.url, `utc=${startS}&lutc=${nowS}`);
  if (c.type === 'shift' || c.type === 'timeshift') return join(ch.url, `utc=${startS}&lutc=${nowS}`);
  if (c.type === 'flussonic' || c.type === 'fs' || c.type === 'flussonic-hls' || c.type === 'flussonic-ts') {
    if (/\/(index|video|mono)\.m3u8/.test(ch.url)) return ch.url.replace(/\/(index|video|mono)\.m3u8/, `/$1-${startS}-${dur * 60}.m3u8`);
    return ch.url.replace(/\/mpegts(\?|$)/, `/timeshift_abs-${startS}.ts$1`);
  }
  return null;
}
function catchupItem(ch, p) {
  const url = catchupUrl(ch, p); if (!url) return null;
  return { kind: 'catchup', key: `cu:${ch.key}:${p.start}`, recentKey: ch.key, favKey: ch.key, name: p.title, sub: `${ch.name} · ${day(p.start)} ${hhmm(p.start)}`, group: ch.group, logo: ch.logo, url };
}

/* ============================ MAC portals (Stalker / Ministra) ============================ */
const MAG_UA = 'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3';
const STK = new Map();
function stkBase(src) {
  let b = String(src.portal || '').trim();
  if (!/^https?:\/\//i.test(b)) b = 'http://' + b;
  return b.replace(/\/+$/, '').replace(/\/(stalker_portal\/)?(server\/load\.php|portal\.php)$/i, '').replace(/\/c$/i, '').replace(/\/stalker_portal$/i, '');
}
const normMac = m => String(m || '').trim().toUpperCase().replace(/[^0-9A-F]/g, '').replace(/(..)(?!$)/g, '$1:');
async function stkLogin(src) {
  const base = stkBase(src), mac = normMac(src.mac);
  const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return 'Europe/London'; } })();
  const headers = { 'User-Agent': MAG_UA, 'X-User-Agent': 'Model: MAG250; Link: WiFi', Cookie: `mac=${encodeURIComponent(mac)}; stb_lang=en; timezone=${encodeURIComponent(tz)}`, Referer: base + '/c/' };
  let lastErr = null;
  for (const path of ['/portal.php', '/stalker_portal/server/load.php', '/server/load.php']) {
    try {
      const r = await request(`${base}${path}?type=stb&action=handshake&token=&prehash=0&JsHttpRequest=1-xml`, { headers });
      const token = r && r.js && r.js.token;
      if (!token) continue;
      const st = { ep: base + path, base, headers: { ...headers, Authorization: 'Bearer ' + token } };
      const prof = await request(`${st.ep}?type=stb&action=get_profile&hd=1&stb_type=MAG250&JsHttpRequest=1-xml`, { headers: st.headers }).catch(() => null);
      if (prof && prof.js && (prof.js.blocked === '1' || prof.js.status === 2)) throw new Error('This MAC address is blocked by the portal.');
      STK.set(src.id, st);
      return st;
    } catch (e) { lastErr = e; if (/blocked/.test(e.message)) throw e; }
  }
  throw new Error('The portal did not accept this MAC address' + (lastErr ? ` (${friendly(lastErr)})` : '.'));
}
async function stkCall(src, query, retry = true) {
  const st = STK.get(src.id) || await stkLogin(src);
  try {
    const r = await request(`${st.ep}?${query}&JsHttpRequest=1-xml`, { headers: st.headers });
    if ((!r || r.js === undefined) && retry) throw new Error('session expired');
    return r && r.js;
  } catch (e) { if (retry) { STK.delete(src.id); return stkCall(src, query, false); } throw e; }
}
async function stkLink(src, type, cmd) {
  const r = await stkCall(src, `type=${type}&action=create_link&cmd=${encodeURIComponent(cmd)}&series=&forced_storage=0&disable_ad=0&download=0`);
  const u = String((r && r.cmd) || cmd || '').replace(/^(ffmpeg|ffrt\d?|auto)\s+/i, '').trim();
  if (!/^https?:\/\//i.test(u)) throw new Error('The portal did not return a playable link.');
  return u;
}
async function loadStalker(src) {
  const st = await stkLogin(src);
  const abs = u => !u ? '' : /^https?:/i.test(u) ? u : st.base + (u.startsWith('/') ? '' : '/') + u;
  const genres = await stkCall(src, 'type=itv&action=get_genres').catch(() => []);
  const G = Object.fromEntries((genres || []).map(g => [String(g.id), g.title]));
  const chans = await stkCall(src, 'type=itv&action=get_all_channels');
  const live = ((chans && chans.data) || []).map(c => ({
    kind: 'live', key: `l:${src.id}:${c.id}`, mkey: `${src.id}:${c.id}`, name: c.name || '', logo: abs(c.logo), group: G[String(c.tv_genre_id)] || 'Uncategorised',
    url: '', epgId: `stk:${src.id}:${c.id}`, xmltvId: c.xmltv_id || '', stk: { src: src.id, id: c.id }, resolve: () => stkLink(src, 'itv', c.cmd),
  }));
  const movies = [];
  try {
    const cats = (await stkCall(src, 'type=vod&action=get_categories')) || [];
    const pages = Math.max(1, Math.min(+src.vodPages || 4, 50));
    for (const cat of cats.filter(c => c.id !== '*').slice(0, 60)) {
      for (let pg = 1; pg <= pages; pg++) {
        const r = await stkCall(src, `type=vod&action=get_ordered_list&category=${encodeURIComponent(cat.id)}&p=${pg}&sortby=added`);
        for (const v of (r && r.data) || []) {
          if (+v.is_series) continue;
          movies.push({ kind: 'movie', key: `m:${src.id}:${v.id}`, name: v.name || '', poster: abs(v.screenshot_uri), group: cat.title || 'Films', rating: num(v.rating_imdb || v.rating_kinopoisk), year: v.year || '', plot: v.description || '', genre: v.genres_str || '', added: Date.parse(v.added) || 0, url: '', infoLoaded: true, resolve: () => stkLink(src, 'vod', v.cmd) });
        }
        if (pg >= Math.ceil((+(r && r.total_items) || 0) / (+(r && r.max_page_items) || 14))) break;
      }
    }
  } catch {}
  return { live, movies, series: [] };
}
async function loadStalkerEpg(src) {
  const r = await stkCall(src, 'type=itv&action=get_epg_info&period=168');
  let n = 0;
  for (const [chId, list] of Object.entries((r && r.data) || {})) {
    const arr = (list || []).map(x => ({ start: +x.start_timestamp * 1000, stop: +x.stop_timestamp * 1000, title: x.name || 'Untitled', desc: x.descr || '' })).filter(x => x.stop > x.start);
    if (arr.length) { S.epg.set(`stk:${src.id}:${chId}`, arr.sort((a, b) => a.start - b.start)); n += arr.length; }
  }
  return n;
}
// Every playable item can provide its URL lazily (portals hand out short-lived links).
async function resolveUrl(item) {
  let u = item.url;
  if (item.resolve) u = await item.resolve();
  return streamUrl({ ...item, url: u });
}

/* ============================ EPG (XMLTV) ============================ */
const xmlDec = s => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, (m, e) =>
  ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e.toLowerCase()] ?? (e[1] === 'x' || e[1] === 'X' ? String.fromCodePoint(parseInt(e.slice(2), 16)) : String.fromCodePoint(+e.slice(1))))).trim();
const attr = (a, k) => (a.match(new RegExp('\\b' + k + '="([^"]*)"')) || [])[1] || '';
function xdate(s) {
  const m = /^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)?\s*([+-]\d{4})?/.exec(s);
  if (!m) return NaN;
  let t = Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  if (m[7]) { const sg = m[7][0] === '-' ? -1 : 1; t -= sg * ((+m[7].slice(1, 3)) * 60 + (+m[7].slice(3))) * 60000; }
  return t;
}
function wantedEpg() {
  const ids = new Set(), names = new Set();
  for (const c of S.all.live) { if (c.epgId) { ids.add(c.epgId.toLowerCase()); names.add(norm(c.epgId)); } if (c.xmltvId) ids.add(c.xmltvId.toLowerCase()); names.add(norm(c.name)); }
  for (const v of Object.values(S.cfg.epgMap || {})) ids.add(String(v).toLowerCase());
  return { ids, names };
}
function parseXMLTV(text, wanted) {
  const off = (+S.cfg.epgOffset || 0) * 3600e3, now = Date.now();
  const min = now - 7 * 86400e3, max = now + 7 * 86400e3;
  const keep = new Set();
  const chRe = /<channel\s+id="([^"]*)"[^>]*>([\s\S]*?)<\/channel>/g;
  let m, count = 0;
  while ((m = chRe.exec(text))) {
    const id = xmlDec(m[1]);
    S.epgIdsLower.set(id.toLowerCase(), id);
    if (!wanted || wanted.ids.has(id.toLowerCase())) keep.add(id);
    const dn = /<display-name[^>]*>([\s\S]*?)<\/display-name>/g; let d, first = true;
    while ((d = dn.exec(m[2]))) {
      const name = xmlDec(d[1]);
      if (first) { S.epgChannels.set(id, name); first = false; }
      const k = norm(name); if (!k) continue;
      if (wanted && wanted.names.has(k)) keep.add(id);
      const prev = S.epgNames.get(k);
      S.epgNames.set(k, prev === undefined || prev === id ? id : null); // null = ambiguous, never guess
    }
  }
  const pRe = /<programme\s+([^>]*)>([\s\S]*?)<\/programme>/g;
  while ((m = pRe.exec(text))) {
    const a = m[1];
    const start = xdate(attr(a, 'start')) + off, stop = xdate(attr(a, 'stop')) + off;
    if (!(stop > min && start < max)) continue;
    const ch = xmlDec(attr(a, 'channel'));
    if (wanted && !keep.has(ch) && !wanted.ids.has(ch.toLowerCase())) continue;
    const t = /<title[^>]*>([\s\S]*?)<\/title>/.exec(m[2]);
    const ds = /<desc[^>]*>([\s\S]*?)<\/desc>/.exec(m[2]);
    let arr = S.epg.get(ch); if (!arr) S.epg.set(ch, arr = []);
    arr.push({ start, stop, title: xmlDec(t ? t[1] : '') || 'Untitled', desc: xmlDec(ds ? ds[1] : '') });
    S.epgIdsLower.set(ch.toLowerCase(), ch);
    count++;
  }
  for (const arr of S.epg.values()) arr.sort((a, b) => a.start - b.start);
  return count;
}
function linkEpg() {
  for (const c of S.all.live) {
    let k = null;
    const manual = c.mkey && S.cfg.epgMap[c.mkey];
    if (manual) { c.epgKey = S.epg.has(manual) ? manual : null; c.epgManual = true; continue; }
    c.epgManual = false;
    if (c.epgId) k = S.epg.has(c.epgId) ? c.epgId : S.epgIdsLower.get(c.epgId.toLowerCase()) || null;
    if (!k && c.xmltvId) k = S.epgIdsLower.get(c.xmltvId.toLowerCase()) || null;
    if (!k) k = S.epgNames.get(norm(c.name)) || (c.epgId && S.epgNames.get(norm(c.epgId))) || null;
    c.epgKey = k && S.epg.has(k) ? k : null;
  }
}
const progs = c => (c && c.epgKey && S.epg.get(c.epgKey)) || [];
function nowNext(c) {
  const p = progs(c), t = Date.now();
  const i = p.findIndex(x => x.stop > t);
  if (i < 0) return [null, null, p, -1];
  return p[i].start <= t ? [p[i], p[i + 1] || null, p, i] : [null, p[i], p, i];
}
const pct = p => p ? Math.max(0, Math.min(100, (Date.now() - p.start) / (p.stop - p.start) * 100)) : 0;

/* ============================ loading ============================ */
async function loadAll() {
  if (S.loading) return;
  S.loading = true;
  const live = [], movies = [], series = [];
  const epgUrls = new Set((S.cfg.extraEpg || []).filter(Boolean));
  if (S.view === 'home') render();
  for (const src of S.sources) {
    if (src.off) continue;
    try {
      setStatus(`Loading ${src.name}…`);
      const r = await (LOADERS[src.type] || loadM3U)(src);
      live.push(...r.live); movies.push(...r.movies); series.push(...r.series);
      src.count = { live: r.live.length, movies: r.movies.length, series: r.series.length };
      src.err = '';
      src.loadedAt = Date.now();
      const e = src.epg || r.epg; if (e) epgUrls.add(e);
    } catch (err) {
      src.err = friendly(err);
      toast(`${src.name}: ${src.err}`, true);
    }
  }
  S.all = { live, movies, series };
  applyFilters();
  saveSources();
  S.loading = false; S.loaded = true; S.lastLoad = Date.now();
  S.epgUrls = [...epgUrls];
  setStatus('');
  stopViewPlayers(); render();
  await loadEpg();
}
async function loadEpg() {
  S.epg = new Map(); S.epgNames = new Map(); S.epgIdsLower = new Map(); S.epgChannels = new Map();
  const wanted = wantedEpg();
  for (const src of S.sources.filter(x => x.type === 'stalker' && !x.off && !x.err)) {
    try { setStatus('Loading programme guide…'); await loadStalkerEpg(src); } catch (err) { toast(`Guide (${src.name}): ${friendly(err)}`, true); }
  }
  for (const u of S.epgUrls || []) {
    try { setStatus('Loading programme guide…'); parseXMLTV(await getText(u), wanted); }
    catch (err) { toast(`Guide: ${friendly(err)}`, true); }
  }
  linkEpg(); setStatus('');
  scheduleReminderNotifications();
  softRefresh();
}
const LOADERS = { xtream: loadXtream, m3u: loadM3U, stalker: loadStalker };

/* ---------- what the current profile may see ---------- */
const ADULT = /(adult|xxx|18\s*\+|porn|erotic|for\s+adults)/i;
const KIDS = /(kid|child|cartoon|junior|family|disney|nick|cbeebies|cbbc|boomerang|baby|anim|toon|pbs)/i;
function isLocked(it) {
  const g = it.group || '';
  if ((S.cfg.locked || []).includes(g)) return true;
  if ((S.cfg.notLocked || []).includes(g)) return false;
  return !!S.cfg.autoLock && (ADULT.test(g) || ADULT.test(it.name || ''));
}
function kidsOk(it) {
  const allow = PROF.active.allow;
  return allow && allow.length ? allow.includes(it.group) : KIDS.test(it.group || '');
}
function visible(it) {
  if (PROF.active.kids) return kidsOk(it) && !isLocked(it);
  return !isLocked(it) || PROF.unlocked;
}
function applyFilters() {
  S.live = S.all.live.filter(visible); S.movies = S.all.movies.filter(visible); S.series = S.all.series.filter(visible);
  S.index = new Map([...S.live, ...S.movies, ...S.series].map(x => [x.key, x]));
  const lockedGroups = list => PROF.active.kids || PROF.unlocked ? [] : [...new Set(list.filter(isLocked).map(x => x.group))];
  S.lockedGroups = { live: lockedGroups(S.all.live), movies: lockedGroups(S.all.movies), series: lockedGroups(S.all.series) };
}
function friendly(err) {
  const m = String(err && err.message || err);
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Could not reach the server (offline, wrong address, or the provider blocked the request).';
  return m;
}
// Refresh guide text without interrupting anything that is playing
function softRefresh() {
  if (S.view === 'live') { renderChannelList(); renderPreviewMeta(); }
  else if (S.view === 'multi') {}
  else render();
  if (!$('#player').hidden) opInfo();
}

/* ============================ player ============================ */
// Rewrite stream URLs for the platform. iPhone/iPad cannot play raw MPEG-TS in a web view,
// but almost every Xtream-style server offers the same channel as HLS.
function streamUrl(item) {
  let u = item.url;
  if (PLATFORM === 'ios' && item.kind === 'live') {
    const path = u.split('?')[0];
    if (/\/live\/[^/]+\/[^/]+\/\d+\.ts$/i.test(path)) u = u.replace(/\.ts(\?|$)/i, '.m3u8$1');
    else if (/^https?:\/\/[^/]+\/(?!live\/)([^/]+)\/([^/]+)\/(\d+)$/i.test(path)) u = u.replace(/^(https?:\/\/[^/]+)\/([^/]+)\/([^/]+)\/(\d+)$/i, '$1/live/$2/$3/$4.m3u8');
  }
  return u;
}
class Player {
  constructor(video, onMsg, onFail) {
    this.v = video; this.onMsg = onMsg || (() => {}); this.onFail = onFail || null; this.h = null; this.m = null; this.tries = 0; this.url = ''; this.nativeTried = false;
    video.addEventListener('error', () => { if (!this.h && !this.m && video.getAttribute('src')) this.fail('This stream format cannot be played in the built-in player.'); });
    video.addEventListener('playing', () => this.onMsg(''));
    video.addEventListener('waiting', () => this.onMsg('Buffering…'));
  }
  fail(text) {
    // On Android, try the web view's own HLS support once before giving up (it ignores CORS).
    if (this.h && PLATFORM === 'android' && !this.nativeTried && /\.m3u8/i.test(this.url)) {
      this.nativeTried = true; const u = this.url; this.h.destroy(); this.h = null; this.v.src = u; this.v.play().catch(() => {}); return;
    }
    this.onMsg(text, true);
    if (this.onFail) this.onFail(this.url, text);
  }
  load(url) {
    this.stop(); this.tries = 0; this.url = url; this.nativeTried = false;
    const v = this.v, path = url.split('?')[0].toLowerCase();
    this.onMsg('Connecting…');
    const isHls = /\.m3u8$/.test(path);
    if (isHls && PLATFORM === 'ios') {
      v.src = url; // Apple's own HLS player: no CORS limits, HEVC/AC3 support, AirPlay and PiP
    } else if (isHls && window.Hls && Hls.isSupported()) {
      const h = this.h = new Hls({ enableWorker: true, backBufferLength: 60, maxBufferLength: 30 });
      h.on(Hls.Events.ERROR, (_, d) => {
        if (!d.fatal) return;
        if (/^manifest/i.test(d.details)) {
          const code = d.response && d.response.code;
          return this.fail(code ? `Channel unavailable (server returned ${code}).` : 'Channel unavailable — the server did not answer.');
        }
        if (d.type === Hls.ErrorTypes.NETWORK_ERROR && this.tries++ < 3) setTimeout(() => this.h === h && h.startLoad(), 1500);
        else if (d.type === Hls.ErrorTypes.MEDIA_ERROR && this.tries++ < 3) h.recoverMediaError();
        else this.fail(`Stream unavailable (${d.details}).`);
      });
      h.loadSource(url); h.attachMedia(v);
    } else if (/\.(mp4|mkv|webm|mov|m4v|avi|mp3|aac)$/.test(path) || isHls) {
      v.src = url;
    } else if (window.mpegts && mpegts.getFeatureList().mseLivePlayback) {
      const m = this.m = mpegts.createPlayer({ type: 'mpegts', isLive: true, url }, { enableWorker: true, liveBufferLatencyChasing: true, lazyLoad: false });
      m.attachMediaElement(v); m.load();
      m.on(mpegts.Events.ERROR, (type, detail) => this.fail(`Stream unavailable (${detail || type}).`));
    } else v.src = url;
    const p = v.play(); if (p) p.catch(() => {});
  }
  stop() {
    if (this.h) { this.h.destroy(); this.h = null; }
    if (this.m) { try { this.m.pause(); this.m.unload(); this.m.detachMediaElement(); this.m.destroy(); } catch {} this.m = null; }
    this.v.pause(); this.v.removeAttribute('src'); this.v.load();
  }
  destroy() { this.stop(); }
}
const msgFor = el => (t, bad) => { el.hidden = !t; el.textContent = t || ''; el.classList.toggle('err', !!bad); };
const canSystemPlayer = () => !!(NATIVE && P.video);

/* ---------- system (native) player: ExoPlayer on Android/Fire TV, AVPlayer on iOS ---------- */
const NP = { item: null, list: [], i: 0 };
async function playSystem(item, list) {
  if (!canSystemPlayer() || !item) return false;
  NP.item = item; NP.list = list && list.length ? list : [item]; NP.i = Math.max(0, NP.list.indexOf(item));
  scrobbleStart(item);
  addRecent(item.recentKey || item.key);
  try {
    await P.video.initPlayer({
      mode: 'fullscreen', playerId: 'fullscreen', componentTag: 'div', url: await resolveUrl(item),
      title: item.name, smallTitle: item.sub || item.group || '', artwork: item.poster || item.logo || '',
      accentColor: '#4D8DFF', exitOnEnd: true, showControls: true, displayMode: 'landscape', chromecast: true, pipEnabled: true,
      headers: { 'User-Agent': UA },
    });
    const p = item.kind !== 'live' && S.pos[item.key];
    if (p) setTimeout(() => P.video.setCurrentTime({ playerId: 'fullscreen', seektime: p }).catch(() => {}), 1200);
    return true;
  } catch (e) { toast(`System player: ${e && e.message || e}`, true); return false; }
}
if (canSystemPlayer()) {
  P.video.addListener('jeepCapVideoPlayerExit', d => { const it = NP.item; if (it) { savePosFor(it, d && d.currentTime, null); const rt = (it.tmdb || (S.index.get(it.key) || {}).tmdb || {}).runtime; scrobbleStop(it, rt && d ? d.currentTime / (rt * 60) * 100 : 0); } NP.item = null; afterPlayer(); });
  P.video.addListener('jeepCapVideoPlayerEnded', () => {
    const it = NP.item; if (!it) return;
    delete S.pos[it.key]; savePosAll();
    if (it.kind === 'episode' && NP.i < NP.list.length - 1) setTimeout(() => playSystem(NP.list[NP.i + 1], NP.list), 400);
  });
}

/* ---------- full-screen overlay player ---------- */
const OP = { el: $('#player'), v: $('#opv'), list: [], i: 0, item: null, idleT: 0, saveT: 0 };
OP.player = new Player(OP.v, msgFor($('#opmsg')), () => {
  // Built-in player failed: hand over to the system player when allowed
  if (playerModeFor(OP.item) === 'auto' && canSystemPlayer() && OP.item) {
    const it = OP.item, list = OP.list; toast('Switching to the system player');
    closePlayer(true); playSystem(it, list);
  } else if (canSystemPlayer()) $('#opmsg').insertAdjacentHTML('beforeend', '<br><button class="btn pri" style="margin-top:14px;pointer-events:auto" data-sysplay>Try the system player</button>');
});
const isVod = it => !!it && ['movie', 'episode', 'download', 'recording', 'catchup'].includes(it.kind);
// Live TV follows the "Video player" setting; films and episodes follow "Films and episodes" (built-in by default, so subtitles work).
function playerModeFor(it) { return isVod(it) && (S.cfg.playerVod || 'builtin') === 'builtin' ? 'auto' : S.cfg.player; }
function openPlayer(item, list) {
  if (!item) return;
  if (playerModeFor(item) === 'system' && canSystemPlayer()) return void playSystem(item, list);
  if (pvPlayer) pvPlayer.stop();
  mvPlayers.forEach(p => p && p.stop());
  OP.list = list && list.length ? list : [item];
  OP.i = Math.max(0, OP.list.indexOf(item));
  OP.el.hidden = false;
  document.body.classList.add('watching');
  if (NATIVE) {
    if (IS_PHONE && P.orient) P.orient.lock({ orientation: 'landscape' }).catch(() => {});
    if (P.status) P.status.hide().catch(() => {});
  }
  playOverlay(item);
  OP.el.focus();
  wake();
}
function playOverlay(item) {
  if (OP.item && OP.item !== item) scrobbleStop(OP.item, OP.v.duration ? OP.v.currentTime / OP.v.duration * 100 : 0);
  stopLiveCaptions(); $$('track', OP.v).forEach(t => t.remove());
  OP.item = item;
  scrobbleStart(item);
  resolveUrl(item).then(u => { if (OP.item === item) OP.player.load(u); }).catch(e => { if (OP.item === item) msgFor($('#opmsg'))(friendly(e), true); });
  addRecent(item.recentKey || item.key);
  const live = item.kind === 'live';
  $('#optitle').textContent = item.name;
  $('#opsub').textContent = live ? item.group : (item.sub || item.group || '');
  $('#opfav').classList.toggle('on', S.favs.has(item.favKey || item.key));
  $('#opprev').hidden = $('#opnext').hidden = !(live && OP.list.length > 1);
  OP.v.controls = !document.body.classList.contains('tv');
  $('#opbar').hidden = !(document.body.classList.contains('tv') && !live);
  opInfo();
}
function opInfo() {
  const it = OP.item, box = $('#opinfo');
  if (!it || it.kind !== 'live') { box.innerHTML = ''; return; }
  const [n, nx] = nowNext(it);
  const tv = document.body.classList.contains('tv'), touch = document.body.classList.contains('touch');
  box.innerHTML = `<div class="row" style="gap:14px;flex-wrap:nowrap">${img(it.logo, it.name, 'logo" style="width:56px;height:56px;flex:none')}<div>
    <div class="when"><span class="livedot"></span>${n ? `${hhmm(n.start)} – ${hhmm(n.stop)}` : 'Live'}${OP.list.length > 1 ? ` · channel ${OP.i + 1} of ${OP.list.length}` : ''}</div>
    <b style="font-size:18px">${esc(n ? n.title : it.name)}</b></div></div>
    ${n ? `<span class="bar" style="margin:12px 0 8px"><i style="width:${pct(n).toFixed(1)}%"></i></span>` : ''}
    ${nx ? `<small class="dim">Next ${hhmm(nx.start)} · ${esc(nx.title)}</small>` : ''}
    ${!touch ? `<small class="dim" style="display:block;margin-top:6px">${tv ? `${OP.list.length > 1 ? '▲ ▼ change channel · ' : ''}OK for options · Back to close` : `${OP.list.length > 1 ? '↑ ↓ change channel · ' : ''}F favourite · C subtitles · Esc close`}</small>` : ''}`;
}
function closePlayer(quiet) {
  savePos();
  if (OP.item) scrobbleStop(OP.item, OP.v.duration ? OP.v.currentTime / OP.v.duration * 100 : 0);
  stopLiveCaptions();
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  OP.player.stop(); OP.el.hidden = true; OP.item = null;
  document.body.classList.remove('watching');
  if (NATIVE) {
    if (IS_PHONE && P.orient) P.orient.lock({ orientation: 'portrait' }).catch(() => {});
    if (P.status) P.status.show().catch(() => {});
  }
  if (quiet !== true) afterPlayer();
}
function afterPlayer() {
  if (S.view === 'favs' || S.view === 'home') render();
  if (S.view === 'live' && LV.cur && pvPlayer) previewPlay(S.index.get(LV.cur));
  if (S.view === 'multi') render();
}
function zap(d) {
  if (OP.list.length < 2) return;
  OP.i = (OP.i + d + OP.list.length) % OP.list.length;
  playOverlay(OP.list[OP.i]); wake();
}
function savePosFor(it, t, dur) {
  if (!it || it.kind === 'live' || !isFinite(t)) return;
  if (t > 30 && (!dur || !isFinite(dur) || t < dur - 90)) S.pos[it.key] = Math.floor(t);
  else if (dur && isFinite(dur)) delete S.pos[it.key];
  const keys = Object.keys(S.pos); if (keys.length > 300) delete S.pos[keys[0]];
  savePosAll();
}
function savePos() { const it = OP.item, v = OP.v; if (it && v.duration && isFinite(v.duration)) savePosFor(it, v.currentTime, v.duration); }
const mmss = t => { t = Math.max(0, Math.floor(t || 0)); const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = t % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0'); };
OP.v.addEventListener('loadedmetadata', () => {
  const it = OP.item; if (!it || it.kind === 'live') return;
  const p = S.pos[it.key]; if (p && p < OP.v.duration - 60) { OP.v.currentTime = p; toast(`Resumed at ${Math.floor(p / 60)} min`); }
});
OP.v.addEventListener('timeupdate', () => {
  if (Date.now() - OP.saveT > 5000) { OP.saveT = Date.now(); savePos(); }
  if (!$('#opbar').hidden) { const v = OP.v; $('#opcur').textContent = mmss(v.currentTime); $('#opdur').textContent = isFinite(v.duration) ? mmss(v.duration) : '–'; $('#opprog').style.width = (v.duration ? v.currentTime / v.duration * 100 : 0) + '%'; }
});
OP.v.addEventListener('ended', () => {
  const it = OP.item; if (!it) return;
  delete S.pos[it.key]; savePosAll();
  if (it.kind === 'episode' && OP.i < OP.list.length - 1) { toast('Playing next episode'); zap(1); }
});
function wake() { OP.el.classList.remove('idle'); clearTimeout(OP.idleT); OP.idleT = setTimeout(() => OP.el.classList.add('idle'), 3500); }
OP.el.addEventListener('mousemove', wake);
OP.el.addEventListener('touchstart', e => { if (e.target === OP.v || e.target === OP.el) { if (OP.el.classList.contains('idle')) wake(); } else wake(); }, { passive: true });
$('#opclose').onclick = () => closePlayer();
$('#opprev').onclick = () => zap(-1);
$('#opcc').onclick = () => subtitlesMenu();
function playerMenu() {
  const it = OP.item; if (!it) return;
  const fk = it.favKey || it.key;
  modal(`<h2>${esc(it.name)}</h2><div class="morelist">
    <button class="btn ghost" id="pm_subs">Subtitles${osOn() && isVod(it) ? ' and OpenSubtitles' : ''}</button>
    ${it.kind === 'live' && OP.list.length > 1 ? '<button class="btn ghost" data-close id="pm_next">Next channel</button>' : ''}
    <button class="btn ghost" id="pm_fav">${S.favs.has(fk) ? 'Remove from favourites' : 'Add to favourites'}</button>
    ${canSystemPlayer() ? '<button class="btn ghost" id="pm_sys">Play in system player</button>' : ''}
    ${canCast() ? '<button class="btn ghost" id="pm_cast">Cast to a TV</button>' : ''}
    <button class="btn ghost" id="pm_close">Stop watching</button></div>`, 'narrow sheet');
  const on = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };
  on('#pm_subs', () => { closeModal(); subtitlesMenu(); });
  on('#pm_next', () => zap(1));
  on('#pm_fav', () => { closeModal(); $('#opfav').click(); });
  on('#pm_sys', () => { closeModal(); const l = OP.list; closePlayer(true); playSystem(it, l); });
  on('#pm_cast', () => { closeModal(); castMenu(); });
  on('#pm_close', () => { closeModal(); closePlayer(); });
}
$('#opnext').onclick = () => zap(1);
$('#opfs').onclick = () => document.fullscreenElement ? document.exitFullscreen() : OP.el.requestFullscreen().catch(() => { if (OP.v.webkitEnterFullscreen) OP.v.webkitEnterFullscreen(); });
$('#opfav').onclick = () => { const it = OP.item; if (it) { toggleFav(it.favKey || it.key); $('#opfav').classList.toggle('on', S.favs.has(it.favKey || it.key)); } };
function opKey(e) {
  wake();
  const live = OP.item && OP.item.kind === 'live', v = OP.v;
  const k = e.key;
  if (k === 'Escape' || k === 'Backspace' || k === 'GoBack') { if (!document.fullscreenElement) { e.preventDefault(); closePlayer(); } return; }
  const tv = document.body.classList.contains('tv');
  if (k === 'ContextMenu' || k === 'Menu' || k === 'Settings' || (tv && !live && (k === 'ArrowUp' || k === 'ArrowDown')) || (tv && live && k === 'Enter')) { e.preventDefault(); return playerMenu(); }
  if ((k === 'ArrowUp' || k === 'PageUp' || k === 'ChannelUp') && live) { e.preventDefault(); zap(-1); }
  else if ((k === 'ArrowDown' || k === 'PageDown' || k === 'ChannelDown') && live) { e.preventDefault(); zap(1); }
  else if ((k === 'ArrowRight' || k === 'MediaFastForward') && !live) { e.preventDefault(); v.currentTime += k === 'ArrowRight' ? 10 : 30; }
  else if ((k === 'ArrowLeft' || k === 'MediaRewind') && !live) { e.preventDefault(); v.currentTime -= k === 'ArrowLeft' ? 10 : 30; }
  else if (k === ' ' || k === 'Enter' || k === 'MediaPlayPause' || k === 'MediaPlay' || k === 'MediaPause') { if (document.activeElement && document.activeElement.tagName === 'BUTTON' && k === 'Enter') return; e.preventDefault(); v.paused ? v.play() : v.pause(); }
  else if (k === 'f' || k === 'F') $('#opfav').click();
  else if (k === 'm' || k === 'M') v.muted = !v.muted;
  else if (k === 'c' || k === 'C') subtitlesMenu();
  else if (k === 'n' || k === 'N') zap(1);
  else if (k === 'p' || k === 'P') zap(-1);
}

/* ============================ shared bits ============================ */
let pvPlayer = null, mvPlayers = [];
function stopViewPlayers() {
  if (pvPlayer) { pvPlayer.destroy(); pvPlayer = null; }
  mvPlayers.forEach(p => p && p.destroy()); mvPlayers = [];
}
function addRecent(k) { S.recent = [k, ...S.recent.filter(x => x !== k)].slice(0, 40); saveRecent(); }
function toggleFav(k) {
  if (S.favs.has(k)) { S.favs.delete(k); toast('Removed from favourites'); } else { S.favs.add(k); toast('Added to favourites'); }
  saveFavs();
  const fc = $('.grp[data-grp="★"] small'); if (fc) fc.textContent = S.live.filter(c => S.favs.has(c.key)).length;
  $$(`[data-fav="${CSS.escape(k)}"]`).forEach(el => el.classList.toggle('on', S.favs.has(k)));
}
function groupsOf(list) {
  const m = new Map(); for (const x of list) m.set(x.group, (m.get(x.group) || 0) + 1);
  return [...m];
}
const match = (x, q) => !q || x.name.toLowerCase().includes(q);
function chCard(c) {
  const [n] = nowNext(c);
  return `<button class="ch-card" data-play="${esc(c.key)}">${img(c.logo, c.name, 'logo')}<span class="t">${esc(c.name)}</span>
    <span class="s">${n ? esc(n.title) : esc(c.group)}</span>${n ? `<span class="bar"><i style="width:${pct(n).toFixed(1)}%"></i></span>` : ''}</button>`;
}
function posterCard(m) {
  const r = num(m.rating);
  const resume = S.pos[m.key] ? ' · resume' : '';
  return `<button class="poster" data-open="${esc(m.key)}">${img(m.poster, m.name, 'pimg')}<span class="t">${esc(m.name)}</span>
    <span class="rt">${r ? '★ ' + r.toFixed(1) : esc(m.group)}${resume}</span></button>`;
}
const cardFor = x => x.kind === 'live' ? chCard(x) : posterCard(x);
const railSec = (title, items) => items.length ? `<section class="sec"><h2>${esc(title)}</h2><div class="rowscroll">${items.map(cardFor).join('')}</div></section>` : '';
function welcome() {
  return `<div class="empty"><h1>Bring your own TV</h1>
    <p>Orbit plays the channels, films and series from your provider. Add an Xtream Codes login or an M3U playlist link to get started — nothing is included with the app.</p>
    <div class="row"><button class="btn pri" data-add="xtream">Add Xtream login</button><button class="btn" data-add="m3u">Add M3U link</button><button class="btn" data-addsrc>More options</button></div></div>`;
}
const loadingHTML = () => `<div class="empty"><h1>Loading your playlists</h1><p><span class="spin"></span>Big playlists can take a moment.</p></div>`;
function needData() {
  if (!S.sources.length) { view.innerHTML = welcome(); return true; }
  if (!S.loaded) { view.innerHTML = loadingHTML(); return true; }
  return false;
}
function setBg(root = view) { $$('[data-bg]', root).forEach(el => { el.style.backgroundImage = `url(${JSON.stringify(el.dataset.bg)})`; }); }

/* ============================ views ============================ */
const view = $('#view');
const views = { home, live, guide, movies: () => gridView('movies'), series: () => gridView('series'), favs, multi, search, settings, library: () => library(), sports: () => sports() };
async function go(v) {
  if (!views[v]) v = 'home';
  if (v === 'settings' && PROF.active.kids && S.view !== 'settings' && S.cfg.pin && !(await askPin('Enter the parental PIN to open Settings'))) return;
  stopViewPlayers();
  S.view = v;
  $$('.nav').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  if (location.hash !== '#' + v) history.replaceState(null, '', '#' + v);
  view.scrollTop = 0;
  render();
}
function render() { views[S.view](); setBg(); }

/* ---------- home ---------- */
function home() {
  if (needData()) return;
  const favL = S.live.filter(c => S.favs.has(c.key));
  const rec = S.recent.map(k => S.index.get(k)).filter(Boolean);
  const newest = [...S.movies].sort((a, b) => (b.added || 0) - (a.added || 0));
  const withPoster = newest.filter(m => m.poster).slice(0, 30);
  const feat = withPoster.length ? withPoster[Math.floor(Math.random() * withPoster.length)] : null;
  const spot = feat || favL[0] || S.live[0];
  let h = '';
  if (spot) {
    const isLive = spot.kind === 'live', [n] = isLive ? nowNext(spot) : [];
    h += `<section class="hero"><div class="hero-bg" data-bg="${esc(spot.poster || spot.logo || '')}"></div><div class="hero-in">
      ${isLive ? img(spot.logo, spot.name, 'logo') : img(spot.poster, spot.name, 'pimg')}
      <div><span class="kicker">${isLive ? '<span class="livedot"></span>On now' : 'Featured film'}</span><h1>${esc(spot.name)}</h1>
      <p>${isLive ? esc(n ? `${n.title} · until ${hhmm(n.stop)}` : spot.group) : esc([spot.group, num(spot.rating) ? '★ ' + num(spot.rating).toFixed(1) : ''].filter(Boolean).join(' · '))}</p>
      <div class="row"><button class="btn pri" data-play="${esc(spot.key)}">${isLive ? 'Watch live' : 'Play'}</button>${isLive ? '' : `<button class="btn ghost" data-open="${esc(spot.key)}">Details</button>`}</div></div></div></section>`;
  }
  h += railSec('Continue watching', rec.slice(0, 20));
  h += railSec('Favourite channels', favL.slice(0, 30));
  if (!favL.length && S.live.length) h += railSec('Live channels', S.live.slice(0, 20));
  h += railSec('Recently added films', newest.slice(0, 24));
  h += railSec('Series', [...S.series].sort((a, b) => (b.added || 0) - (a.added || 0)).slice(0, 24));
  if (!S.live.length && !S.movies.length && !S.series.length) h += `<div class="empty"><h1>Nothing loaded</h1><p>Your playlists returned no items. Check them in Settings.</p><button class="btn pri" data-go="settings">Open settings</button></div>`;
  view.innerHTML = h + '<div style="height:32px"></div>';
}

/* ---------- live ---------- */
const LV = { group: 'All', q: '', limit: 300, cur: null };
function liveList() {
  const q = LV.q.toLowerCase();
  return S.live.filter(c => (LV.group === 'All' || (LV.group === '★' ? S.favs.has(c.key) : c.group === LV.group)) && match(c, q));
}
function live() {
  if (needData()) return;
  const gs = groupsOf(S.live);
  const opts = [['All', S.live.length], ['★', S.live.filter(c => S.favs.has(c.key)).length], ...gs];
  const label = g => g === '★' ? 'Favourites' : g;
  view.innerHTML = `<div class="live">
    <nav class="groups" aria-label="Channel groups">${opts.map(([g, n]) => `<button class="grp ${g === LV.group ? 'on' : ''}" data-grp="${esc(g)}"><span>${esc(label(g))}</span><small>${n}</small></button>`).join('')}
      ${(S.lockedGroups.live || []).map(g => `<button class="grp locked" data-unlock><span>${LOCK}${esc(g)}</span></button>`).join('')}</nav>
    <section class="chcol"><div class="chhead"><select class="grpsel" id="grpsel" aria-label="Group">${opts.map(([g]) => `<option value="${esc(g)}" ${g === LV.group ? 'selected' : ''}>${esc(label(g))}</option>`).join('')}${S.lockedGroups.live.length ? `<option value="__unlock">Locked categories (${S.lockedGroups.live.length})…</option>` : ''}</select>
      <input type="search" id="chq" placeholder="Filter channels" value="${esc(LV.q)}" aria-label="Filter channels"></div><div class="chlist" id="chlist"></div></section>
    <section class="pv"><div class="vwrap"><video id="pv" playsinline></video><div class="vmsg" id="pvmsg">Choose a channel to preview it here.<br>Press Enter again for full screen.</div></div><div class="pvmeta" id="pvmeta"></div></section></div>`;
  pvPlayer = new Player($('#pv'), msgFor($('#pvmsg')), () => { if (canSystemPlayer()) $('#pvmsg').insertAdjacentHTML('beforeend', '<br><button class="btn pri" style="margin-top:12px;pointer-events:auto" data-pvsys>Play in system player</button>'); });
  $('#pv').addEventListener('dblclick', () => LV.cur && openPlayer(S.index.get(LV.cur), liveList()));
  $('#chq').addEventListener('input', e => { LV.q = e.target.value; LV.limit = 300; renderChannelList(); });
  $('#grpsel').addEventListener('change', e => e.target.value === '__unlock' ? (e.target.value = LV.group, unlockFlow()) : setGroup(e.target.value));
  renderChannelList();
  if (LV.cur && S.index.get(LV.cur)) previewPlay(S.index.get(LV.cur)); else renderPreviewMeta();
}
function setGroup(g) {
  LV.group = g; LV.limit = 300;
  $$('.grp').forEach(b => b.classList.toggle('on', b.dataset.grp === g));
  renderChannelList(); $('#chlist').scrollTop = 0;
}
function renderChannelList() {
  const box = $('#chlist'); if (!box) return;
  const list = liveList();
  box.innerHTML = list.slice(0, LV.limit).map((c, i) => {
    const [n] = nowNext(c);
    return `<button class="chrow ${c.key === LV.cur ? 'on' : ''}" data-ch="${esc(c.key)}"><span class="num">${i + 1}</span>${img(c.logo, c.name, 'logo')}
      <span><b>${esc(c.name)}</b><small>${n ? `${esc(n.title)} · ${hhmm(n.start)}–${hhmm(n.stop)}` : esc(c.group)}</small></span>
      <span class="star ${S.favs.has(c.key) ? 'on' : ''}" data-fav="${esc(c.key)}" title="Favourite (F)">★</span></button>`;
  }).join('') + (list.length > LV.limit ? `<button class="btn ghost" style="margin:10px" data-morech>Show ${Math.min(300, list.length - LV.limit)} more of ${list.length - LV.limit}</button>` : '')
    + (list.length ? '' : `<p class="dim" style="padding:16px">${LV.group === '★' ? 'No favourite channels yet. Press F on a channel to add it.' : 'No channels match.'}</p>`);
}
function previewPlay(c) {
  if (!c || !pvPlayer) return;
  LV.cur = c.key;
  $$('.chrow').forEach(r => r.classList.toggle('on', r.dataset.ch === c.key));
  const pv = pvPlayer; resolveUrl(c).then(u => { if (pvPlayer === pv && LV.cur === c.key) pv.load(u); }).catch(e => msgFor($('#pvmsg'))(friendly(e), true));
  addRecent(c.key);
  renderPreviewMeta();
}
function renderPreviewMeta() {
  const box = $('#pvmeta'); if (!box) return;
  const c = LV.cur && S.index.get(LV.cur);
  if (!c) { box.innerHTML = `<p class="dim">${document.body.classList.contains('tv') ? 'Press OK on a channel to watch it.' : document.body.classList.contains('touch') ? 'Tap a channel to preview it, tap again for full screen.' : 'Tip: use the arrow keys to move through channels, Enter to watch, F to favourite.'}</p>`; return; }
  const [n, , p, i] = nowNext(c);
  const up = i >= 0 ? p.slice(n ? i + 1 : i, (n ? i + 1 : i) + 6) : [];
  const ni = n ? p.indexOf(n) : -1;
  const past = c.catchup ? p.filter(x => x.stop <= Date.now() && canCatchup(c, x)).slice(-6).reverse() : [];
  const row = (x, extra) => `<div><span>${day(x.start) === day(Date.now()) ? '' : day(x.start) + ' '}${hhmm(x.start)}</span><b style="font-weight:500">${esc(x.title)}</b>${extra || ''}</div>`;
  box.innerHTML = `<div class="row" style="justify-content:space-between"><div><span class="kicker">${esc(c.group)}${c.catchup ? ` · catch-up ${c.catchup.days} days` : ''}</span><h2>${esc(c.name)}</h2></div>
    <div class="row"><button class="btn ${S.favs.has(c.key) ? 'pri' : 'ghost'}" data-fav="${esc(c.key)}" data-favbtn>★ Favourite</button>${n && canCatchup(c, n) ? `<button class="btn ghost" data-cu="${esc(c.key)}" data-pi="${ni}">↺ Start over</button>` : ''}${recordButton(c, n)}<button class="btn pri" data-play="${esc(c.key)}">Full screen</button></div></div>
    ${n ? `<div class="now"><div class="when"><span class="livedot"></span>Now · ${hhmm(n.start)} – ${hhmm(n.stop)}</div><b>${esc(n.title)}</b><span class="bar"><i style="width:${pct(n).toFixed(1)}%"></i></span>${n.desc ? `<p>${esc(n.desc)}</p>` : ''}</div>`
      : `<div class="now"><b>No programme information</b><p>${c.epgId ? 'The guide has no listings for this channel right now.' : 'This channel has no guide ID.'} You can match it to a guide channel yourself.</p></div>`}
    ${up.length ? `<div class="upn"><h2 style="margin-top:20px">Coming up</h2>${up.map(x => row(x, `<button class="mini ${hasReminder(c, x) ? 'on' : ''}" data-remind="${esc(c.key)}" data-pi="${p.indexOf(x)}" aria-label="Remind me">${BELL}</button>`)).join('')}</div>` : ''}
    ${past.length ? `<div class="upn"><h2 style="margin-top:20px">Catch up</h2>${past.map(x => row(x, `<button class="mini" data-cu="${esc(c.key)}" data-pi="${p.indexOf(x)}" aria-label="Play">▶</button>`)).join('')}</div>` : ''}
    <p style="margin-top:18px"><button class="linkbtn" data-match="${esc(c.key)}">${c.epgManual ? 'Change guide match' : c.epgKey ? 'Wrong guide? Match it yourself' : 'Match to a guide channel'}</button></p>`;
}

/* ---------- guide ---------- */
const GV = { group: 'All', t0: null, limit: 150 };
const guideNowT0 = () => Math.floor(Date.now() / 18e5) * 18e5 - 18e5;
const midnight = (off = 0) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + off); return d.getTime(); };
const PXMIN = 4; // px per minute
function guide() {
  if (needData()) return;
  const all = S.live.filter(c => c.epgKey);
  const gs = groupsOf(all);
  const chans = all.filter(c => GV.group === 'All' || (GV.group === '★' ? S.favs.has(c.key) : c.group === GV.group));
  const GCH = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--gch')) || 210;
  const now = Date.now(), t0 = GV.t0 ?? guideNowT0(), span = 6 * 36e5, W = span / 6e4 * PXMIN;
  const dayOff = Math.round((midnight(0) - (() => { const d = new Date(t0); d.setHours(0, 0, 0, 0); return d.getTime(); })()) / -864e5);
  const days = []; for (let o = -7; o <= 7; o++) days.push(o);
  const dayName = o => o === 0 ? 'Today' : o === -1 ? 'Yesterday' : o === 1 ? 'Tomorrow' : day(midnight(o));
  const px = t => (t - t0) / 6e4 * PXMIN;
  let h = `<div class="pagehead"><h1>Guide</h1><div class="tools">
    <select id="gg" aria-label="Group"><option value="All">All channels (${all.length})</option><option value="★" ${GV.group === '★' ? 'selected' : ''}>Favourites</option>${gs.map(([g, n]) => `<option value="${esc(g)}" ${g === GV.group ? 'selected' : ''}>${esc(g)} (${n})</option>`).join('')}</select>
    <select id="gday" aria-label="Day">${days.map(o => `<option value="${o}" ${o === dayOff ? 'selected' : ''}>${dayName(o)}</option>`).join('')}</select>
    <button class="btn ghost" data-gshift="-1">← Earlier</button><button class="btn ghost" data-gshift="0">Now</button><button class="btn ghost" data-gshift="1">Later →</button></div></div>`;
  if (!all.length) {
    view.innerHTML = h + `<div class="empty" style="margin-top:6vh"><h1>No guide data yet</h1><p>${S.live.length ? 'Guides load from your provider automatically for Xtream logins, from an M3U\'s x-tvg-url, or from an XMLTV link you add in Settings.' : 'Add a playlist with live channels first.'}</p><button class="btn pri" data-go="settings">Open settings</button></div>`;
    return;
  }
  const slots = []; for (let t = t0; t < t0 + span; t += 18e5) slots.push(t);
  h += `<div class="gwrap" id="gwrap"><div class="ggrid" style="width:${GCH + W}px">
    <div class="gtimes"><span class="corner"></span>${slots.map(t => `<span>${dayOff ? day(t) + ' ' : ''}${hhmm(t)}</span>`).join('')}</div>`;
  for (const c of chans.slice(0, GV.limit)) {
    const ps = progs(c).filter(p => p.stop > t0 && p.start < t0 + span);
    h += `<div class="gr"><button class="gch" data-play="${esc(c.key)}" data-ctx="guide">${img(c.logo, c.name, 'logo')}<span>${esc(c.name)}</span></button><div class="gline" style="width:${W}px">
      ${ps.map((p, j) => { const l = Math.max(0, px(p.start)), r = Math.min(W, px(p.stop)); const on = p.start <= now && p.stop > now;
        const cu = p.stop <= now && canCatchup(c, p), rem = p.start > now && hasReminder(c, p), rec = isRecordingScheduled(c, p);
        return `<button class="gp ${on ? 'on' : ''} ${p.stop <= now ? (cu ? 'past cu' : 'past') : ''}" style="left:${l + 2}px;width:${Math.max(6, r - l - 4)}px" data-prog="${esc(c.key)}" data-pi="${progs(c).indexOf(p)}">${rec ? '<i class="recdot"></i>' : ''}${rem ? BELL : ''}${cu ? '<span class="cutag">↺</span>' : ''}${esc(p.title)}<small>${hhmm(p.start)} – ${hhmm(p.stop)}</small></button>`; }).join('')}
      ${ps.length ? '' : '<span class="dim" style="position:absolute;left:12px;top:22px;font-size:13px">No listings</span>'}</div></div>`;
  }
  h += `${now > t0 && now < t0 + span ? `<div class="gnow" style="left:${GCH + px(now)}px"></div>` : ''}</div></div>`;
  if (chans.length > GV.limit) h += `<div class="more"><button class="btn ghost" data-gmore>Show more channels (${chans.length - GV.limit} left)</button></div>`;
  view.innerHTML = h;
  $('#gg').onchange = e => { GV.group = e.target.value; GV.limit = 150; render(); };
  $('#gday').onchange = e => { const o = +e.target.value; GV.t0 = o === 0 ? null : midnight(o) + 17 * 36e5; render(); };
  const gw = $('#gwrap'); if (GV.t0 == null && gw) gw.scrollLeft = Math.max(0, px(now) - 180);
}
function progDetail(key, pi) {
  const c = S.index.get(key), p = progs(c)[pi]; if (!p) return;
  const now = Date.now(), on = p.start <= now && p.stop > now, future = p.start > now, cu = canCatchup(c, p);
  const btns = [];
  if (!on && cu) btns.push(`<button class="btn pri" data-cu="${esc(c.key)}" data-pi="${pi}" data-close>▶ Watch (catch-up)</button>`);
  btns.push(`<button class="btn ${on || !cu ? 'pri' : 'ghost'}" data-play="${esc(c.key)}" data-ctx="guide" data-close>${on ? 'Watch now' : 'Watch channel live'}</button>`);
  if (on && cu) btns.push(`<button class="btn ghost" data-cu="${esc(c.key)}" data-pi="${pi}" data-close>↺ Start over</button>`);
  if (future) btns.push(`<button class="btn ghost" data-remind="${esc(c.key)}" data-pi="${pi}" data-close>${hasReminder(c, p) ? 'Cancel reminder' : 'Remind me'}</button>`);
  btns.push(recordButton(c, p, true));
  modal(`<span class="kicker">${esc(c.name)} · ${day(p.start)} ${hhmm(p.start)} – ${hhmm(p.stop)}${cu && !future ? ' · available on catch-up' : ''}</span><h1 style="padding-right:40px">${esc(p.title)}</h1>
    ${p.desc ? `<p class="plot" style="margin-top:14px">${esc(p.desc)}</p>` : '<p class="dim">No description.</p>'}
    <div class="row" style="margin-top:18px">${btns.join('')}</div>`, 'narrow');
}

/* ---------- movies & series ---------- */
const GS = { movies: { group: 'All', q: '', sort: 'default', limit: 120 }, series: { group: 'All', q: '', sort: 'default', limit: 120 } };
function gridView(kind) {
  if (needData()) return;
  const st = GS[kind], list = S[kind];
  const gs = groupsOf(list);
  view.innerHTML = `<div class="pagehead"><h1>${kind === 'movies' ? 'Movies' : 'Series'}</h1><div class="tools">
    <input type="search" id="gq" placeholder="Search ${kind === 'movies' ? 'films' : 'series'}" value="${esc(st.q)}" aria-label="Search">
    <select id="gcat" aria-label="Category"><option value="All">All categories (${list.length})</option>${gs.map(([g, n]) => `<option value="${esc(g)}" ${g === st.group ? 'selected' : ''}>${esc(g)} (${n})</option>`).join('')}${(S.lockedGroups[kind] || []).length ? `<option value="__unlock">Locked categories (${S.lockedGroups[kind].length})…</option>` : ''}</select>
    <select id="gsort" aria-label="Sort">${[['default', 'Provider order'], ['new', 'Recently added'], ['rating', 'Top rated'], ['az', 'A–Z']].map(([v, l]) => `<option value="${v}" ${v === st.sort ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
    <div class="grid" id="grid"></div><div class="more" id="gmore"></div>`;
  const draw = () => {
    const q = st.q.toLowerCase();
    let l = list.filter(x => (st.group === 'All' || x.group === st.group) && match(x, q));
    if (st.sort === 'az') l = [...l].sort((a, b) => a.name.localeCompare(b.name));
    if (st.sort === 'new') l = [...l].sort((a, b) => (b.added || 0) - (a.added || 0));
    if (st.sort === 'rating') l = [...l].sort((a, b) => num(b.rating) - num(a.rating));
    $('#grid').innerHTML = l.slice(0, st.limit).map(posterCard).join('') || `<p class="dim">${list.length ? 'Nothing matches.' : `Your playlists have no ${kind}.`}</p>`;
    $('#gmore').innerHTML = l.length > st.limit ? `<button class="btn ghost" id="gmorebtn">Show more (${l.length - st.limit} left)</button>` : '';
    const mb = $('#gmorebtn'); if (mb) mb.onclick = () => { st.limit += 120; draw(); };
  };
  let deb;
  $('#gq').oninput = e => { clearTimeout(deb); deb = setTimeout(() => { st.q = e.target.value; st.limit = 120; draw(); }, 150); };
  $('#gcat').onchange = e => { if (e.target.value === '__unlock') { e.target.value = st.group; return unlockFlow(); } st.group = e.target.value; st.limit = 120; draw(); };
  $('#gsort').onchange = e => { st.sort = e.target.value; draw(); };
  draw();
}
async function openDetail(key) {
  const x = S.index.get(key); if (!x) return;
  if (x.kind === 'live') return openPlayer(x, [x]);
  const metaLine = () => [x.year, x.genre, x.dur, num(x.rating) ? '★ ' + num(x.rating).toFixed(1) : '', x.group].filter(Boolean).map(esc).join(' · ');
  const head = () => `<div class="det">${img(x.poster, x.name, 'pimg')}<div><h1>${esc(x.name)}</h1><div class="meta">${metaLine()}</div>
    ${x.plot ? `<p class="plot">${esc(x.plot)}</p>` : ''}${x.cast ? `<p class="hint" style="margin-bottom:16px">Cast: ${esc(x.cast)}</p>` : ''}<div class="row" id="detbtns"></div></div></div><div id="eps"></div>`;
  modal(head());
  $('#modal .mbox').dataset.key = x.key;
  decorateDetail(x);
  const favBtn = `<button class="btn ${S.favs.has(x.key) ? 'pri' : 'ghost'}" data-fav="${esc(x.key)}" data-favbtn>★ Favourite</button>`;
  if (x.kind === 'movie') {
    const p = S.pos[x.key];
    const dl = downloadOf(x.key);
    $('#detbtns').innerHTML = `<button class="btn pri" data-playnow="${esc(x.key)}" data-close>${p ? `Resume from ${Math.floor(p / 60)} min` : 'Play'}</button>${favBtn}${canDownload() ? (dl ? (dl.status === 'done' ? `<button class="btn ghost" data-dlplaykey="${esc(x.key)}" data-close>Play downloaded copy</button>` : '<button class="btn ghost" disabled>Downloading…</button>') : `<button class="btn ghost" data-dlkey="${esc(x.key)}">⤓ Download</button>`) : ''}${castButton()}`;
    $('#detbtns button').focus();
    if (x.xt && !x.infoLoaded) {
      try { await xtMovieInfo(x); } catch { x.infoLoaded = true; return; }
      if (!$('#modal').hidden && $('#detbtns')) { const ret = modalReturn; openDetail(key); modalReturn = ret; }
    }
    return;
  }
  // series
  $('#detbtns').innerHTML = favBtn;
  const eps = $('#eps');
  if (!x.seasons) {
    eps.innerHTML = '<p class="dim"><span class="spin"></span>Loading episodes…</p>';
    try { if (x.loadEpisodes) x.seasons = await x.loadEpisodes(); else await xtSeriesInfo(x); } catch (e) { eps.innerHTML = `<p class="dim">Could not load episodes: ${esc(friendly(e))}</p>`; return; }
    if (!$('#eps')) return;
    $('.mbox .meta').innerHTML = metaLine();
    if (x.plot) { const pl = $('.mbox .plot'); if (pl) pl.textContent = x.plot; else $('.mbox .meta').insertAdjacentHTML('afterend', `<p class="plot">${esc(x.plot)}</p>`); }
  }
  const seasons = Object.keys(x.seasons || {}).sort((a, b) => a - b);
  if (!seasons.length) { eps.innerHTML = '<p class="dim">No episodes available.</p>'; return; }
  let cur = x.lastSeason && x.seasons[x.lastSeason] ? x.lastSeason : seasons[0];
  const drawEps = () => {
    eps.innerHTML = `<div class="tabs">${seasons.map(s => `<button class="tab ${s == cur ? 'on' : ''}" data-season="${esc(s)}">Season ${esc(s)}</button>`).join('')}</div>
      <div class="eps">${x.seasons[cur].map((e, i) => { const k = epKey(x, cur, i); return `<button class="ep" data-ep="${i}"><span class="n">${e.num || i + 1}</span><span><b>${esc(e.title)}</b>${e.plot ? `<small>${esc(e.plot.slice(0, 140))}${e.plot.length > 140 ? '…' : ''}</small>` : ''}</span><small>${S.pos[k] ? 'Resume' : esc(e.dur || '')}${canDownload() ? ` <span class="mini dlbtn" role="button" data-epdl="${i}" aria-label="Download">${downloadOf(k) ? '✓' : '⤓'}</span>` : ''}</small></button>`; }).join('')}</div>`;
    $$('[data-season]', eps).forEach(b => b.onclick = () => { cur = b.dataset.season; drawEps(); });
    $$('[data-epdl]', eps).forEach(b => b.onclick = e => { e.stopPropagation(); const it = episodeItems(x, cur)[+b.dataset.epdl]; startDownload({ ...it, poster: x.poster }).then(() => { b.textContent = '✓'; }); });
    $$('[data-ep]', eps).forEach(b => b.onclick = () => { x.lastSeason = cur; const list = episodeItems(x, cur); closeModal(); openPlayer(list[+b.dataset.ep], list); });
  };
  drawEps();
}
const epKey = (s, season, i) => `e:${s.key}:${season}:${i}`;
const episodeItems = (s, season) => s.seasons[season].map((e, i) => ({ kind: 'episode', key: epKey(s, season, i), recentKey: s.key, favKey: s.key, seriesKey: s.key, seriesName: s.name, season: +season, num: e.num || i + 1, name: `${s.name} · S${season} E${e.num || i + 1}`, sub: e.title, url: e.url, poster: s.poster }));

/* ---------- favourites ---------- */
function favs() {
  if (needData()) return;
  const f = [...S.favs].map(k => S.index.get(k)).filter(Boolean);
  const L = f.filter(x => x.kind === 'live'), M = f.filter(x => x.kind === 'movie'), SE = f.filter(x => x.kind === 'series');
  if (!f.length) { view.innerHTML = `<div class="empty"><h1>No favourites yet</h1><p>Press F on a channel, or the ★ button on a film or series, and it will appear here.</p><button class="btn pri" data-go="live">Browse live TV</button></div>`; return; }
  view.innerHTML = `<div class="pagehead"><h1>Favourites</h1></div>`
    + (L.length ? `<section class="sec"><h2>Channels</h2></section><div class="grid chgrid">${L.map(chCard).join('')}</div>` : '')
    + (M.length ? `<section class="sec"><h2>Films</h2></section><div class="grid">${M.map(posterCard).join('')}</div>` : '')
    + (SE.length ? `<section class="sec"><h2>Series</h2></section><div class="grid">${SE.map(posterCard).join('')}</div>` : '');
}

/* ---------- search ---------- */
let SQ = '';
function search() {
  view.innerHTML = `<div class="pagehead"><h1>Search</h1></div><div style="padding:0 36px 12px"><input type="search" id="sq" placeholder="Channels, films, series…" value="${esc(SQ)}" style="width:min(640px,100%);font-size:18px;min-height:52px" aria-label="Search everything"></div><div id="sres"></div>`;
  const draw = () => {
    const q = SQ.trim().toLowerCase(), box = $('#sres');
    if (q.length < 2) { box.innerHTML = `<p class="dim" style="padding:0 36px">Type at least two letters.${S.sources.length ? '' : ' You have no playlists yet.'}</p>`; return; }
    const L = S.live.filter(x => match(x, q)), M = S.movies.filter(x => match(x, q)), SE = S.series.filter(x => match(x, q));
    const sec = (t, a, f, cls = '') => a.length ? `<section class="sec"><h2>${t} <span class="dim" style="font-weight:400">${a.length}</span></h2></section><div class="grid ${cls}">${a.slice(0, 48).map(f).join('')}</div>` : '';
    box.innerHTML = sec('Channels', L, chCard, 'chgrid') + sec('Films', M, posterCard) + sec('Series', SE, posterCard) || `<p class="dim" style="padding:0 36px">Nothing found for “${esc(SQ)}”.</p>`;
  };
  let deb; $('#sq').oninput = e => { clearTimeout(deb); deb = setTimeout(() => { SQ = e.target.value; draw(); }, 150); };
  draw(); $('#sq').focus();
}

/* ---------- multiview ---------- */
let MVaudio = 0;
function multi() {
  if (needData()) return;
  const n = S.cfg.mvLayout === 2 ? 2 : 4, slots = S.cfg.multi;
  view.innerHTML = `<div class="pagehead"><h1>Multiview</h1><p class="dim" style="margin:0">Click a tile to hear it · double-click to watch full screen</p><div class="tools">
    <button class="btn ${n === 2 ? 'pri' : 'ghost'}" data-mvl="2">2 screens</button><button class="btn ${n === 4 ? 'pri' : 'ghost'}" data-mvl="4">4 screens</button></div></div>
    <div class="mv mv${n}">${Array.from({ length: n }, (_, i) => { const c = slots[i] && S.index.get(slots[i]);
      return `<div class="tile ${i === MVaudio && c ? 'aud' : ''}" data-tile="${i}">${c ? `<video muted playsinline></video><div class="vmsg"></div><div class="tcap"><b>${esc(c.name)}</b><button data-mvpick="${i}">Change</button><button data-mvx="${i}" aria-label="Remove">✕</button></div>` : `<button class="tadd" data-mvpick="${i}">+ Add a channel</button>`}</div>`; }).join('')}</div>`;
  mvPlayers = [];
  $$('.tile').forEach(t => {
    const i = +t.dataset.tile, c = slots[i] && S.index.get(slots[i]), v = $('video', t);
    if (!c || !v) return;
    const p = new Player(v, msgFor($('.vmsg', t))); mvPlayers[i] = p; resolveUrl(c).then(u => p.load(u)).catch(e => msgFor($('.vmsg', t))(friendly(e), true)); v.muted = i !== MVaudio;
    t.addEventListener('click', e => { if (e.target.closest('button')) return; MVaudio = i; $$('.tile').forEach((x, j) => { x.classList.toggle('aud', j === i); const vv = $('video', x); if (vv) vv.muted = j !== i; }); });
    t.addEventListener('dblclick', () => openPlayer(c, slots.slice(0, n).map(k => k && S.index.get(k)).filter(Boolean)));
  });
}
function pickChannel(slot) {
  modal(`<h2>Choose a channel</h2><input type="search" id="pkq" placeholder="Search channels" style="width:100%" aria-label="Search channels"><div class="picklist" id="pkl"></div>`, 'narrow');
  const draw = () => {
    const q = $('#pkq').value.toLowerCase();
    const favFirst = [...S.live].sort((a, b) => S.favs.has(b.key) - S.favs.has(a.key));
    $('#pkl').innerHTML = favFirst.filter(c => match(c, q)).slice(0, 200).map(c => `<button class="chrow" style="grid-template-columns:44px 1fr" data-pick="${esc(c.key)}" data-slot="${slot}">${img(c.logo, c.name, 'logo')}<span><b>${esc(c.name)}</b><small>${esc(c.group)}</small></span></button>`).join('') || '<p class="dim">No channels match.</p>';
  };
  $('#pkq').oninput = draw; draw(); $('#pkq').focus();
}

/* ---------- settings ---------- */
const SRC_TYPES = {
  xtream: { label: 'Xtream Codes login', short: 'Xtream Codes', fields: [['server', 'Server address', 'url', 'http://example.com:8080'], ['user', 'Username'], ['pass', 'Password', 'password']], epgHint: "optional — your provider's guide is used automatically" },
  m3u: { label: 'M3U playlist link', short: 'M3U link', fields: [['url', 'Playlist link', 'url', 'http://…/playlist.m3u']], epgHint: 'optional — used if the playlist does not name one' },
  stalker: { label: 'MAC portal (Stalker / Ministra)', short: 'MAC portal', fields: [['portal', 'Portal address', 'url', 'http://example.com:8080/c/'], ['mac', 'MAC address', 'text', '00:1A:79:XX:XX:XX'], ['vodPages', 'Film pages to load per category (14 films a page)', 'number', '4']], epgHint: "optional — the portal's own guide is used automatically" },
};
function sourceChooser() {
  modal(`<h2>Add a source</h2><div class="morelist">${Object.entries(SRC_TYPES).map(([k, t]) => `<button class="btn ghost" data-add="${k}">${esc(t.label)}</button>`).join('')}
    <label class="btn ghost" tabindex="0">M3U file from this device<input type="file" id="m3ufile2" accept=".m3u,.m3u8,.txt" hidden></label></div>`, 'narrow sheet');
  $('#m3ufile2').onchange = e => addM3UFile(e.target.files[0]);
}
async function addM3UFile(file) {
  if (!file) return;
  const text = await file.text();
  if (!/#EXTINF/i.test(text)) { toast('That file is not an M3U playlist.', true); return; }
  const src = { id: uid(), type: 'm3u', name: file.name.replace(/\.(m3u8?|txt)$/i, ''), file: true };
  fileText.set(src.id, text);
  if (!store.set('file.' + src.id, text)) toast('This file is large, so it will not be remembered after you close the app.', true);
  S.sources.push(src); saveSources(); closeModal(); toast(`Added ${src.name}`); loadAll().then(() => S.view === 'settings' && render());
}
function sourceForm(type, src) {
  const s = src || { type }, T = SRC_TYPES[type]; if (!T) return;
  if (T.custom) return T.custom(s, !!src);
  modal(`<h2>${src ? 'Edit' : 'Add'} ${esc(T.label)}</h2>
    <form class="form" id="srcform">
      <label>Name<input type="text" id="f_name" value="${esc(s.name || '')}" placeholder="My ${esc(T.short)}" required></label>
      ${s.file ? '<p class="hint">This playlist came from a file. To replace it, remove it and open the new file.</p>' : T.fields.map(([k, l, ty = 'text', ph = '']) =>
        `<label>${esc(l)}<input type="${ty === 'url' ? 'text' : ty}" ${ty === 'url' ? 'inputmode="url"' : ''} spellcheck="false" autocomplete="off" id="f_${k}" value="${esc(s[k] ?? (ty === 'number' ? ph : ''))}" placeholder="${esc(ph)}" ${ty === 'number' ? 'min="1" max="50"' : 'required'}></label>`).join('')}
      ${T.noEpg ? '' : `<label>Guide (XMLTV) link — ${esc(T.epgHint)}<input type="text" inputmode="url" spellcheck="false" id="f_epg" value="${esc(s.epg || '')}" placeholder="http://…/epg.xml.gz"></label>`}
      <div class="row"><button class="btn pri" type="submit">${src ? 'Save' : 'Add and load'}</button><button class="btn ghost" type="button" data-close>Cancel</button></div></form>`, 'narrow');
  $('#srcform').onsubmit = e => {
    e.preventDefault();
    const fix = u => u && !/^https?:\/\//i.test(u) ? 'http://' + u : u;
    const next = { ...s, id: s.id || uid(), type, name: $('#f_name').value.trim() || T.short };
    const ep = $('#f_epg'); if (ep) next.epg = fix(ep.value.trim()) || '';
    if (!s.file) for (const [k, , ty] of T.fields) { const v = ty === 'password' ? $('#f_' + k).value : $('#f_' + k).value.trim(); next[k] = ty === 'url' ? fix(v) : ty === 'number' ? (+v || '') : v; }
    if (type === 'stalker') next.mac = normMac(next.mac);
    STK.delete(next.id);
    saveSource(next, !src);
  };
}
function saveSource(next, isNew) {
  const i = S.sources.findIndex(x => x.id === next.id);
  if (i >= 0) S.sources[i] = next; else S.sources.push(next);
  saveSources(); closeModal(); toast(`Loading ${next.name}…`);
  loadAll().then(() => { if (S.view === 'settings') render(); else if (isNew) go('home'); });
}
const SETTINGS_EXTRA = []; // later modules add sections: { order, html(), bind() }
function settings() {
  const exp = s => s.expires ? ` · expires ${new Date(s.expires).toLocaleDateString()}` : '';
  const allGroups = [...new Set(S.all.live.concat(S.all.movies, S.all.series).map(i => i.group))].sort((a, b) => a.localeCompare(b));
  const rems = S.reminders.filter(r => r.stop > Date.now());
  const sections = [
    { order: 10, html: () => `<section><h2>Profiles</h2>
      ${PROF.list.map(pr => `<div class="src">${avatar(pr, 40)}<div><b>${esc(pr.name)}${pr.id === PROF.active.id ? ' <span class="pill">Watching now</span>' : ''}</b><small>${pr.kids ? 'Kids profile' : 'Standard profile'}${pr.pin ? ' · PIN protected' : ''}</small></div>
        ${pr.id !== PROF.active.id ? `<button class="btn ghost" data-prof="${esc(pr.id)}">Switch</button>` : ''}<button class="btn ghost" data-profedit="${esc(pr.id)}">Edit</button>${PROF.list.length > 1 ? `<button class="btn ghost" data-profdel="${esc(pr.id)}">Delete</button>` : ''}</div>`).join('')}
      <div class="row" style="margin-top:12px"><button class="btn" data-profedit="">Add profile</button>
      <label class="check"><input type="checkbox" id="askprof" ${S.cfg.askProfile ? 'checked' : ''}> Ask who's watching when the app opens</label></div>
      <p class="hint" style="margin-top:10px">Each profile has its own favourites, history, resume points and reminders.</p></section>` },
    { order: 20, html: () => `<section><h2>Playlists and servers</h2>
      ${S.sources.map(s => `<div class="src"><div><b>${esc(s.name)}</b>
        <small>${esc((SRC_TYPES[s.type] || SRC_TYPES.m3u).short)}${s.file ? ' (file)' : ''}${s.count ? ` · ${s.count.live} channels · ${s.count.movies} films · ${s.count.series} series` : ''}${exp(s)}${s.off ? ' · turned off' : ''}</small>
        ${s.err ? `<small class="err">${esc(s.err)}</small>` : ''}</div>
        <button class="btn ghost" data-srctoggle="${esc(s.id)}">${s.off ? 'Turn on' : 'Turn off'}</button><button class="btn ghost" data-srcedit="${esc(s.id)}">Edit</button><button class="btn ghost" data-srcdel="${esc(s.id)}">Remove</button></div>`).join('') || '<p class="dim">No playlists yet.</p>'}
      <div class="row" style="margin-top:14px"><button class="btn pri" data-addsrc>Add playlist or server</button>
        ${S.sources.length ? '<button class="btn ghost" id="reload">Reload everything</button>' : ''}
        <label>Refresh automatically <select id="refreshh">${[[0, 'Never'], [6, 'Every 6 hours'], [12, 'Every 12 hours'], [24, 'Every 24 hours']].map(([v, l]) => `<option value="${v}" ${+S.cfg.refreshHours === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
      <p class="hint" style="margin-top:12px">Logins are stored only on this device${S.cfg.sync && S.cfg.sync.on ? ' and your Orbit Server' : ''}. Orbit does not supply any channels.${S.lastLoad ? ` Last loaded ${hhmm(S.lastLoad)}.` : ''}</p></section>` },
    { order: 30, html: () => `<section><h2>Programme guide</h2>
      <form class="form" id="epgform"><label>Extra XMLTV guide links (one per line, .xml or .xml.gz)<textarea id="epgx" spellcheck="false">${esc((S.cfg.extraEpg || []).join('\n'))}</textarea></label>
      <label>Time correction<select id="epgoff">${[-3, -2, -1, 0, 1, 2, 3].map(h => `<option value="${h}" ${+S.cfg.epgOffset === h ? 'selected' : ''}>${h > 0 ? '+' : ''}${h} hours</option>`).join('')}</select></label>
      <div class="row"><button class="btn pri" type="submit">Save and reload guide</button></div>
      <p class="hint">${S.epg.size ? `${S.epg.size} guide channels loaded · ${S.all.live.filter(c => c.epgKey).length} of ${S.all.live.length} channels matched · ${Object.keys(S.cfg.epgMap).length} matched by you.` : 'No guide loaded.'} The guide covers 7 days back and 7 days ahead. Channels are matched by guide ID, then by name; ambiguous names are left unmatched rather than guessed. Fix a channel from its page in Live TV.</p></form></section>` },
    { order: 40, html: () => `<section><h2>Parental controls</h2>
      <div class="row"><button class="btn" data-pin>${S.cfg.pin ? 'Change PIN' : 'Create a PIN'}</button>
        <label class="check"><input type="checkbox" id="autolock" ${S.cfg.autoLock ? 'checked' : ''}> Lock adult categories automatically</label>
        ${PROF.unlocked ? '<button class="btn ghost" id="relock">Hide locked categories again</button>' : ''}</div>
      <details class="lockbox"><summary>Choose locked categories (${allGroups.filter(g => isLocked({ group: g })).length} locked)</summary>
        <p class="hint">Locked categories are hidden until someone enters the PIN. Kids profiles never see them.</p>
        <div class="checklist">${allGroups.map(g => `<label class="check"><input type="checkbox" data-lockg="${esc(g)}" ${isLocked({ group: g }) ? 'checked' : ''}> ${esc(g)}</label>`).join('') || '<p class="dim">Load a playlist first.</p>'}</div></details></section>` },
    { order: 50, html: () => rems.length ? `<section><h2>Reminders</h2>${rems.map(r => `<div class="src"><div><b>${esc(r.title)}</b><small>${day(r.start)} ${hhmm(r.start)} · ${esc(r.chName)}</small></div><button class="btn ghost" data-remdel="${esc(r.id)}">Cancel</button></div>`).join('')}</section>` : '' },
    ...SETTINGS_EXTRA,
    { order: 90, html: () => `<section><h2>This device</h2><div class="form">
      <label>Layout<select id="cfglayout">${[['auto', 'Automatic'], ['tv', 'TV (remote control)'], ['touch', 'Phone / tablet'], ['desktop', 'Computer']].map(([v, l]) => `<option value="${v}" ${S.cfg.layout === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      ${canSystemPlayer() ? `<label>Video player<select id="cfgplayer">${[['auto', 'Automatic — built-in, switch to system player if a stream fails'], ['builtin', 'Built-in player only'], ['system', 'Always use the system player (best for Fire TV Stick)']].map(([v, l]) => `<option value="${v}" ${S.cfg.player === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label>Films and episodes<select id="cfgplayervod">${[['builtin', 'Built-in player — subtitles and OpenSubtitles available'], ['same', 'Same as live TV']].map(([v, l]) => `<option value="${v}" ${(S.cfg.playerVod || 'builtin') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <p class="hint">The system player (${PLATFORM === 'ios' ? 'Apple AVPlayer' : 'ExoPlayer'}) plays more formats, including AC3 audio, and supports Chromecast and picture-in-picture. The built-in player keeps channel zapping, subtitles and the on-screen guide.</p>` : ''}</div></section>` },
    { order: 95, html: () => `<section><h2>Keyboard and remote</h2><p class="dim" style="margin:0">Arrow keys move around · Enter selects · F favourites · / searches · in the player: ↑ ↓ change channel, ← → skip 10 s, Space pauses, M mutes, Esc goes back.</p></section>` },
  ].sort((a, b) => a.order - b.order);
  view.innerHTML = `<div class="page set"><h1>Settings</h1>${sections.map(x => x.html()).join('')}</div>`;
  const on = (sel, ev, fn) => { const el = $(sel); if (el) el[ev] = fn; };
  on('#askprof', 'onchange', e => { S.cfg.askProfile = e.target.checked; saveCfg(); });
  on('#refreshh', 'onchange', e => { S.cfg.refreshHours = +e.target.value; saveCfg(); });
  on('#cfglayout', 'onchange', e => { S.cfg.layout = e.target.value; saveCfg(); applyLayout(); });
  on('#cfgplayer', 'onchange', e => { S.cfg.player = e.target.value; saveCfg(); });
  on('#cfgplayervod', 'onchange', e => { S.cfg.playerVod = e.target.value; saveCfg(); });
  on('#reload', 'onclick', () => loadAll().then(() => S.view === 'settings' && render()));
  on('#relock', 'onclick', () => { PROF.unlocked = false; applyFilters(); render(); });
  on('#epgform', 'onsubmit', e => { e.preventDefault(); S.cfg.extraEpg = $('#epgx').value.split(/\s+/).filter(Boolean); S.cfg.epgOffset = +$('#epgoff').value; saveCfg(); S.epgUrls = [...new Set([...(S.epgUrls || []), ...S.cfg.extraEpg])]; loadAll().then(() => S.view === 'settings' && render()); });
  on('#autolock', 'onchange', async e => {
    const want = e.target.checked;
    if (!want && !(await askPin('Enter PIN to turn off automatic locking'))) { e.target.checked = true; return; }
    S.cfg.autoLock = want; saveCfg(); applyFilters(); render();
  });
  $$('[data-lockg]').forEach(cb => cb.onchange = async () => {
    const g = cb.dataset.lockg, want = cb.checked;
    if (!(await askPin(want ? 'Enter PIN to lock this category' : 'Enter PIN to unlock this category'))) { cb.checked = !want; return; }
    S.cfg.locked = (S.cfg.locked || []).filter(x => x !== g); S.cfg.notLocked = (S.cfg.notLocked || []).filter(x => x !== g);
    (want ? S.cfg.locked : S.cfg.notLocked).push(g);
    saveCfg(); applyFilters();
  });
  $$('[data-remdel]').forEach(b => b.onclick = () => { const r = S.reminders.find(x => x.id === b.dataset.remdel); if (r) { S.reminders = S.reminders.filter(x => x !== r); saveReminders(); const ln = LN(); if (ln) ln.cancel({ notifications: [{ id: notifId(r.id) }] }).catch(() => {}); render(); } });
  SETTINGS_EXTRA.forEach(x => x.bind && x.bind());
}

/* ============================ parental controls ============================ */
const LOCK = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
const BELL = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>';
// PIN pad that works with touch, keyboard and a TV remote. Resolves to the PIN typed, or null.
function pinPad(title, hint) {
  return new Promise(res => {
    let val = '';
    modal(`<h2>${esc(title)}</h2>${hint ? `<p class="hint" style="margin:-4px 0 12px">${esc(hint)}</p>` : ''}
      <div class="pindots" id="pindots"></div>
      <div class="pinpad">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 'Clear', 0, 'OK'].map(k => `<button class="btn ${k === 'OK' ? 'pri' : 'ghost'}" data-k="${k}">${k}</button>`).join('')}</div>`, 'narrow pinbox');
    const box = $('#modal');
    const draw = () => { $('#pindots').innerHTML = [0, 1, 2, 3].map(i => `<i class="${i < val.length ? 'on' : ''}"></i>`).join(''); };
    const done = v => { box.removeEventListener('click', onClick); document.removeEventListener('keydown', onKey, true); closeModal(); res(v); };
    const press = k => { if (k === 'OK') return val.length >= 4 && done(val); if (k === 'Clear') val = ''; else if (val.length < 8) val += k; draw(); if (val.length === 4 && !hint) setTimeout(() => done(val), 120); };
    const onClick = e => { const b = e.target.closest('[data-k]'); if (b) { e.stopPropagation(); press(b.dataset.k); } else if (e.target.closest('[data-close]') || e.target.id === 'modal') done(null); };
    const onKey = e => { if (/^[0-9]$/.test(e.key)) { e.preventDefault(); e.stopPropagation(); press(e.key); } else if (e.key === 'Backspace') { e.preventDefault(); e.stopPropagation(); val = val.slice(0, -1); draw(); } else if (e.key === 'Escape') { e.stopPropagation(); done(null); } };
    box.addEventListener('click', onClick); document.addEventListener('keydown', onKey, true);
    draw(); setTimeout(() => { const f = $('.pinpad [data-k="1"]'); if (f) f.focus(); }, 30);
  });
}
async function askPin(title, expected) {
  expected = expected || S.cfg.pin;
  if (!expected) return createPin();
  for (let i = 0; i < 3; i++) {
    const v = await pinPad(i ? 'Wrong PIN — try again' : title);
    if (v == null) return false;
    if (v === expected) return true;
  }
  toast('Too many wrong attempts', true); return false;
}
async function createPin() {
  const a = await pinPad('Create a parental PIN', 'Choose 4 digits, then press OK. You will need it to open locked categories and change parental settings.');
  if (!a) return false;
  const b = await pinPad('Type the PIN again', 'Enter the same 4 digits and press OK.');
  if (a !== b) { toast('The PINs did not match', true); return false; }
  S.cfg.pin = a; saveCfg(); toast('Parental PIN saved'); return true;
}
async function unlockFlow() {
  if (PROF.active.kids) return toast('Locked categories are not available in a kids profile.', true);
  if (await askPin('Enter PIN to show locked categories')) { PROF.unlocked = true; applyFilters(); render(); toast('Locked categories shown until you switch profile or close the app'); }
}
async function pinSettings() {
  if (S.cfg.pin && !(await askPin('Enter your current PIN'))) return;
  const ok = await createPin(); if (ok && S.view === 'settings') render();
}

/* ============================ profiles ============================ */
const avatar = (pr, size = 44) => `<span class="avatar" style="--av:${esc(pr.color)};width:${size}px;height:${size}px;font-size:${Math.round(size * .42)}px">${esc(initials(pr.name).slice(0, 1))}</span>`;
function profilePicker(first) {
  modal(`<h1 style="text-align:center;margin:6px 0 22px">Who's watching?</h1><div class="profgrid">
    ${PROF.list.map(pr => `<button class="profbtn ${pr.id === PROF.active.id ? 'on' : ''}" data-prof="${esc(pr.id)}" data-close>${avatar(pr, 84)}<b>${esc(pr.name)}</b><small>${pr.kids ? 'Kids' : pr.pin ? 'PIN' : ''}</small></button>`).join('')}
    <button class="profbtn" data-profedit="" data-close><span class="avatar add" style="width:84px;height:84px">+</span><b>Add profile</b><small></small></button></div>
    ${first ? '' : '<p class="hint" style="text-align:center;margin-top:18px">Manage profiles in Settings.</p>'}`, 'profiles');
}
async function switchProfile(id) {
  const pr = PROF.list.find(p => p.id === id); if (!pr) return;
  if (pr.id === PROF.active.id && S.loaded) return;
  if (pr.pin && !(await askPin(`PIN for ${pr.name}`, pr.pin))) return;
  if (!pr.kids && PROF.active.kids && S.cfg.pin && !(await askPin('Enter the parental PIN to leave the kids profile'))) return;
  store.set('activeProfile', pr.id);
  stopViewPlayers();
  loadState(); PROF.unlocked = false;
  applyFilters(); renderRail();
  go('home'); toast(`Switched to ${pr.name}`);
}
async function profileForm(id) {
  const pr = PROF.list.find(p => p.id === id) || null;
  if ((PROF.active.kids || (pr && pr.kids === false && pr.id !== PROF.active.id)) && S.cfg.pin && !(await askPin('Enter the parental PIN'))) return;
  const x = pr || { id: uid(), name: '', color: AVATAR_COLOURS[PROF.list.length % AVATAR_COLOURS.length], kids: false };
  const groups = [...new Set(S.all.live.concat(S.all.movies, S.all.series).map(i => i.group))].sort((a, b) => a.localeCompare(b));
  modal(`<h2>${pr ? 'Edit profile' : 'New profile'}</h2><form class="form" id="profform">
    <label>Name<input type="text" id="pf_name" value="${esc(x.name)}" required maxlength="20"></label>
    <div><span class="lbl">Colour</span><div class="swatches">${AVATAR_COLOURS.map(c => `<label class="sw"><input type="radio" name="pf_col" value="${c}" ${c === x.color ? 'checked' : ''}><i style="background:${c}"></i></label>`).join('')}</div></div>
    <label class="check"><input type="checkbox" id="pf_kids" ${x.kids ? 'checked' : ''}> Kids profile — shows only children's categories</label>
    <div id="pf_allowbox" ${x.kids ? '' : 'hidden'}><span class="lbl">Categories this profile can see ${groups.length ? '' : '(load a playlist first)'}</span>
      <p class="hint">Leave all unticked to pick children's categories automatically (names containing kids, cartoon, family, Disney and similar).</p>
      <div class="checklist">${groups.map(g => `<label class="check"><input type="checkbox" name="pf_allow" value="${esc(g)}" ${(x.allow || []).includes(g) ? 'checked' : ''}> ${esc(g)}</label>`).join('')}</div></div>
    <label class="check"><input type="checkbox" id="pf_pinon" ${x.pin ? 'checked' : ''}> Ask for a PIN to open this profile</label>
    <div class="row"><button class="btn pri" type="submit">Save</button><button class="btn ghost" type="button" data-close>Cancel</button></div></form>`, 'narrow');
  $('#pf_kids').onchange = e => { $('#pf_allowbox').hidden = !e.target.checked; };
  $('#profform').onsubmit = async e => {
    e.preventDefault();
    x.name = $('#pf_name').value.trim() || 'Profile';
    x.color = ($('input[name=pf_col]:checked') || {}).value || x.color;
    x.kids = $('#pf_kids').checked;
    x.allow = x.kids ? $$('input[name=pf_allow]:checked').map(i => i.value) : [];
    const wantPin = $('#pf_pinon').checked;
    closeModal();
    if (wantPin && !x.pin) { const a = await pinPad(`PIN for ${x.name}`, 'Choose 4 digits and press OK.'); if (a) x.pin = a; }
    if (!wantPin) delete x.pin;
    if (!pr) PROF.list.push(x);
    saveProfiles();
    if (x.id === PROF.active.id) { PROF.active = x; applyFilters(); renderRail(); }
    toast(`Saved ${x.name}`);
    if (S.view === 'settings') render();
  };
}
async function deleteProfile(id, btn) {
  if (PROF.list.length < 2) return toast('You need at least one profile.', true);
  if (!btn.dataset.armed) { btn.dataset.armed = '1'; btn.textContent = 'Confirm delete'; btn.classList.add('pri'); return; }
  if (S.cfg.pin && !(await askPin('Enter the parental PIN'))) return;
  PROF.list = PROF.list.filter(p => p.id !== id); saveProfiles();
  ['favs', 'recent', 'pos', 'reminders'].forEach(k => store.del(`${k}.${id}`));
  if (PROF.active.id === id) { store.set('activeProfile', PROF.list[0].id); loadState(); applyFilters(); renderRail(); }
  render();
}
function renderRail() {
  let b = $('#profbtn');
  if (!b) { b = document.createElement('button'); b.id = 'profbtn'; b.className = 'nav profnav'; b.dataset.profiles = ''; $('.rail .grow').after(b); }
  b.innerHTML = `${avatar(PROF.active, 30)}<span>${esc(PROF.active.name)}</span>`;
  b.setAttribute('aria-label', `Profile: ${PROF.active.name}`);
  document.body.classList.toggle('kidsmode', !!PROF.active.kids);
}

/* ============================ reminders ============================ */
const remKey = (c, p) => `${c.mkey || c.key}|${p.start}`;
const hasReminder = (c, p) => !!(c && p && S.reminders.some(r => r.id === remKey(c, p)));
const LN = () => NATIVE ? (P.notify || (P.notify = plug('LocalNotifications'))) : null;
const notifId = id => { let h = 0; for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) | 0; return Math.abs(h) % 2000000000; };
async function toggleReminder(c, p) {
  if (!c || !p) return;
  const id = remKey(c, p);
  if (hasReminder(c, p)) {
    S.reminders = S.reminders.filter(r => r.id !== id); saveReminders(); toast('Reminder cancelled');
    const ln = LN(); if (ln) ln.cancel({ notifications: [{ id: notifId(id) }] }).catch(() => {});
    return;
  }
  S.reminders.push({ id, ch: c.key, mkey: c.mkey || c.key, chName: c.name, title: p.title, start: p.start, stop: p.stop });
  S.reminders = S.reminders.filter(r => r.stop > Date.now()).sort((a, b) => a.start - b.start);
  saveReminders();
  toast(`Reminder set for ${hhmm(p.start)}`);
  scheduleReminderNotifications();
}
async function scheduleReminderNotifications() {
  const ln = LN(); if (!ln) return;
  try {
    const perm = await ln.checkPermissions();
    if (perm.display !== 'granted') { const r = await ln.requestPermissions(); if (r.display !== 'granted') return; }
    const future = S.reminders.filter(r => r.start > Date.now() + 30000);
    if (!future.length) return;
    await ln.schedule({ notifications: future.map(r => ({ id: notifId(r.id), title: `${r.title}`, body: `Starting at ${hhmm(r.start)} on ${r.chName}`, schedule: { at: new Date(r.start - 60000), allowWhileIdle: true }, extra: { ch: r.ch, mkey: r.mkey } })) });
  } catch {}
}
function checkReminders() {
  const now = Date.now();
  const due = S.reminders.filter(r => !r.fired && r.start - now <= 60000 && r.stop > now);
  if (!due.length) return;
  due.forEach(r => { r.fired = true; });
  S.reminders = S.reminders.filter(r => r.stop > now); saveReminders();
  const r = due[0], c = S.index.get(r.ch) || S.live.find(x => x.mkey === r.mkey);
  if (!OP.el.hidden && OP.item && c && OP.item.key === c.key) return;
  modal(`<span class="kicker">${BELL} Reminder</span><h1 style="padding-right:40px">${esc(r.title)}</h1><p class="plot">${r.start > now ? 'Starts' : 'Started'} at ${hhmm(r.start)} on ${esc(r.chName)}.</p>
    <div class="row">${c ? `<button class="btn pri" data-play="${esc(c.key)}" data-close>Watch now</button>` : ''}<button class="btn ghost" data-close>Dismiss</button></div>`, 'narrow');
}

/* ============================ manual guide matching ============================ */
function matchGuide(key) {
  const c = S.index.get(key); if (!c) return;
  if (!S.epgChannels.size) return toast('No XMLTV guide is loaded, so there is nothing to match against. Add a guide link in Settings.', true);
  const all = [...S.epgChannels].map(([id, name]) => ({ id, name, n: norm(name) }));
  modal(`<h2>Guide for ${esc(c.name)}</h2><p class="hint">Pick the guide channel that matches. Your choice is kept when playlists reload.</p>
    <input type="search" id="emq" placeholder="Search guide channels" value="${esc(c.name.replace(/^\s*[A-Z]{2,4}\s*[:|]\s*/, ''))}" style="width:100%;margin-top:10px" aria-label="Search guide channels">
    <div class="picklist" id="eml"></div>${c.epgManual ? `<button class="btn ghost" style="margin-top:12px" data-epgpick="" data-chkey="${esc(c.key)}">Remove my match</button>` : ''}`, 'narrow');
  const draw = () => {
    const q = norm($('#emq').value), ql = $('#emq').value.toLowerCase().trim();
    const list = (q ? all.filter(x => x.n.includes(q) || x.id.toLowerCase().includes(ql)) : all).slice(0, 150);
    $('#eml').innerHTML = list.map(x => `<button class="chrow" style="grid-template-columns:1fr auto" data-epgpick="${esc(x.id)}" data-chkey="${esc(c.key)}"><span><b>${esc(x.name)}</b><small>${esc(x.id)}</small></span><small>${(S.epg.get(x.id) || []).length ? 'has listings' : ''}</small></button>`).join('') || '<p class="dim">No guide channels match.</p>';
  };
  $('#emq').oninput = draw; draw();
}
async function setGuideMatch(chKey, epgId) {
  const c = S.index.get(chKey); if (!c) return;
  const k = c.mkey || c.key;
  if (epgId) S.cfg.epgMap[k] = epgId; else delete S.cfg.epgMap[k];
  saveCfg(); closeModal();
  if (epgId && !S.epg.has(epgId)) { toast('Updating guide…'); await loadEpg(); } else { linkEpg(); softRefresh(); }
  toast(epgId ? `Matched to ${S.epgChannels.get(epgId) || epgId}` : 'Match removed');
}

/* ============================ recording hooks (filled in by the recording module) ============================ */
let recordButton = () => '';
let isRecordingScheduled = () => false;
let recordAction = () => {};
let castButton = () => '';

/* ============================ Orbit Server, recordings and downloads ============================ */
const DESK = window.orbitDesktop || null;               // desktop shell (Electron) API, if present
const OSV = { ok: false, info: null, recs: [], err: '', checked: 0 };
const JOBS = { list: [] };                               // desktop local recordings + downloads
const MDL = { list: store.get('downloads', []) };        // phone / Fire TV downloads
const saveMdl = () => store.set('downloads', MDL.list.map(({ live, ...d }) => d));
const srvCfg = () => S.cfg.server || {};
const srvOn = () => !!(srvCfg().url && srvCfg().token);
const srvBase = () => { let u = String(srvCfg().url || '').trim().replace(/\/+$/, ''); if (u && !/^https?:\/\//i.test(u)) u = 'http://' + u; return u; };
const srv = (p, o = {}) => request(srvBase() + p, { ...o, headers: { Authorization: 'Bearer ' + srvCfg().token, ...(o.headers || {}) } });
async function srvRefresh() {
  if (!srvOn()) { OSV.ok = false; OSV.recs = []; return false; }
  try {
    const h = await srv('/api/health');
    if (!h || !h.ok) throw new Error('That address is not an Orbit Server.');
    if (!h.authed) throw new Error('The server rejected the token.');
    OSV.info = h; OSV.recs = await srv('/api/recordings'); OSV.ok = true; OSV.err = '';
  } catch (e) { OSV.ok = false; OSV.err = friendly(e); }
  OSV.checked = Date.now();
  return OSV.ok;
}
async function jobsRefresh() { if (DESK) { try { JOBS.list = await DESK.jobs.list(); } catch {} } }
if (DESK) DESK.on('job', j => { const i = JOBS.list.findIndex(x => x.id === j.id); if (i >= 0) JOBS.list[i] = j; else JOBS.list.push(j); if (S.view === 'library') drawLibrary(); });
if (DESK) DESK.on('removed', ({ id }) => { JOBS.list = JOBS.list.filter(x => x.id !== id); if (S.view === 'library') drawLibrary(); });
const P_FS = () => NATIVE ? (P.fs || (P.fs = plug('Filesystem'))) : null;
const P_FT = () => NATIVE ? (P.ft || (P.ft = plug('FileTransfer'))) : null;
const recTarget = () => (S.cfg.recTarget === 'local' && DESK) ? 'local' : srvOn() ? 'server' : DESK ? 'local' : null;
const canRecord = () => !!recTarget();
const canDownload = () => !!(DESK || (NATIVE && P_FT()));
function allRecordings() {
  const out = [];
  for (const r of OSV.recs) out.push({ ...r, where: 'server' });
  for (const j of JOBS.list) if (j.kind === 'record') out.push({ ...j, where: 'local' });
  return out.filter(r => !r.profile || r.profile === PROF.active.id || !PROF.active.kids);
}
isRecordingScheduled = (c, p) => !!(c && p && allRecordings().some(r => r.channelKey === c.key && Math.abs(r.start - p.start) < 60000 && r.status !== 'failed'));
recordButton = (c, p, big) => {
  if (!canRecord() || !c) return '';
  if (p && p.stop <= Date.now()) return '';
  const pi = p ? progs(c).indexOf(p) : -1;
  const on = p && isRecordingScheduled(c, p);
  const label = on ? (p.start <= Date.now() ? 'Stop recording' : 'Cancel recording') : p ? (p.start > Date.now() ? '● Record' : '● Record now') : '● Record 1 hour';
  return `<button class="btn ghost ${on ? 'recon' : ''}" data-rec data-ch="${esc(c.key)}" data-pi="${pi}" ${big ? 'data-close' : ''}>${label}</button>`;
};
recordAction = async btn => {
  const c = S.index.get(btn.dataset.ch); if (!c) return;
  const p = +btn.dataset.pi >= 0 ? progs(c)[+btn.dataset.pi] : null;
  if (btn.dataset.close !== undefined) closeModal();
  const existing = p && allRecordings().find(r => r.channelKey === c.key && Math.abs(r.start - p.start) < 60000 && r.status !== 'failed');
  try {
    if (existing) {
      if (existing.where === 'server') await srv(`/api/recordings/${existing.id}${existing.status === 'recording' ? '/stop' : ''}`, { method: existing.status === 'recording' ? 'POST' : 'DELETE' });
      else if (existing.status === 'recording') await DESK.jobs.stop(existing.id); else await DESK.jobs.remove(existing.id);
      toast(existing.status === 'recording' ? 'Recording stopped' : 'Recording cancelled');
    } else await scheduleRecording(c, p);
  } catch (e) { toast(`Recording: ${friendly(e)}`, true); }
  await Promise.all([srvRefresh(), jobsRefresh()]);
  if (S.view === 'live') renderPreviewMeta(); else if (S.view === 'guide' || S.view === 'library') render();
};
async function scheduleRecording(c, p) {
  const now = Date.now();
  const start = p ? p.start : now, stop = p ? p.stop : now + 3600e3;
  const url = await resolveUrl({ ...c, kind: 'record' });
  const body = { title: p ? p.title : `${c.name} ${day(now)} ${hhmm(now)}`, channel: c.name, channelKey: c.key, logo: c.logo || '', desc: p ? p.desc : '', url, start, stop, profile: PROF.active.id };
  if (c.resolve && start > now + 10 * 60e3) toast('Note: this portal gives short-lived links, so a recording far in the future may fail.', true);
  if (recTarget() === 'server') await srv('/api/recordings', { method: 'POST', body });
  else await DESK.jobs.add({ kind: 'record', ...body, poster: c.logo || '' });
  toast(start > now + 60e3 ? `Recording set for ${day(start)} ${hhmm(start)}` : 'Recording started');
}
async function recordingItem(r) {
  const url = r.where === 'server' ? `${srvBase()}/media/${r.id}.${r.ext || 'ts'}?token=${encodeURIComponent(srvCfg().token)}` : await DESK.jobs.fileUrl(r.id);
  return { kind: 'recording', key: 'rec:' + r.id, name: r.title, sub: `${r.channel} · ${day(r.start)} ${hhmm(r.start)}`, logo: r.logo, url };
}

/* ---------- downloads (films and episodes) ---------- */
function downloadOf(key) {
  const j = JOBS.list.find(x => x.kind === 'download' && x.itemKey === key && x.status !== 'failed');
  if (j) return { ...j, where: 'local' };
  const m = MDL.list.find(x => x.itemKey === key && x.status !== 'failed');
  return m ? { ...m, where: 'mobile' } : null;
}
async function startDownload(item) {
  if (!canDownload()) return toast('Downloads work in the desktop, Android and iPhone apps.', true);
  if (downloadOf(item.key)) return toast('Already downloaded or downloading.');
  let url;
  try { url = await resolveUrl(item); } catch (e) { return toast(friendly(e), true); }
  if (DESK) {
    await DESK.jobs.add({ kind: 'download', title: item.name, url, itemKey: item.key, poster: item.poster || '', profile: PROF.active.id });
    await jobsRefresh(); toast(`Downloading ${item.name}`); return;
  }
  if (/\.m3u8(\?|$)/i.test(url)) return toast('This title streams in pieces (HLS) and cannot be saved on this device. Use the desktop app or Orbit Server.', true);
  const ext = (url.split('?')[0].match(/\.(mp4|mkv|m4v|mov|avi|webm|ts)$/i) || [, 'mp4'])[1];
  const id = uid(), rel = `downloads/${id}.${ext}`;
  const d = { id, itemKey: item.key, title: item.name, poster: item.poster || '', path: rel, status: 'downloading', progress: 0, total: 0, createdAt: Date.now(), kind: item.kind, sub: item.sub || '' };
  MDL.list.push(d); saveMdl(); toast(`Downloading ${item.name}`);
  try {
    const fsP = P_FS(), ft = P_FT();
    await fsP.mkdir({ path: 'downloads', directory: 'DATA', recursive: true }).catch(() => {});
    const { uri } = await fsP.getUri({ path: rel, directory: 'DATA' });
    d.uri = uri;
    await ft.downloadFile({ url, path: uri, progress: true, headers: { 'User-Agent': UA } });
    d.status = 'done';
  } catch (e) { d.status = 'failed'; d.error = friendly(e); toast(`Download failed: ${d.error}`, true); }
  saveMdl(); if (S.view === 'library') drawLibrary();
}
if (NATIVE) { const ft = P_FT(); if (ft) ft.addListener('progress', e => { const d = MDL.list.find(x => x.uri === e.url || (e.url && x.status === 'downloading')); if (d) { d.progress = e.bytes; d.total = e.contentLength; if (S.view === 'library') drawLibrary(); } }).catch(() => {}); }
async function downloadItem(d) {
  if (d.where === 'local') return { kind: 'download', key: d.itemKey, recentKey: d.itemKey, name: d.title, sub: 'Downloaded', url: await DESK.jobs.fileUrl(d.id) };
  return { kind: 'download', key: d.itemKey, recentKey: d.itemKey, name: d.title, sub: d.sub || 'Downloaded', url: CAP.convertFileSrc(d.uri) };
}
async function removeDownload(d) {
  if (d.where === 'local') await DESK.jobs.remove(d.id, true);
  else { try { await P_FS().deleteFile({ path: d.path, directory: 'DATA' }); } catch {} MDL.list = MDL.list.filter(x => x.id !== d.id); saveMdl(); }
  await jobsRefresh();
}

/* ---------- library view ---------- */
const fmtSize = b => !b ? '' : b > 1e9 ? (b / 1e9).toFixed(1) + ' GB' : Math.max(1, Math.round(b / 1e6)) + ' MB';
const LIB = { tab: 'recordings' };
function library() {
  view.innerHTML = `<div class="pagehead"><h1>Library</h1><div class="tools">
    <div class="tabs" style="margin:0"><button class="tab ${LIB.tab === 'recordings' ? 'on' : ''}" data-libtab="recordings">Recordings</button><button class="tab ${LIB.tab === 'downloads' ? 'on' : ''}" data-libtab="downloads">Downloads</button></div>
    ${DESK ? '<button class="btn ghost" id="libfolder">Open folder</button>' : ''}</div></div><div id="lib" class="page" style="padding-top:0"></div>`;
  $$('[data-libtab]').forEach(b => b.onclick = () => { LIB.tab = b.dataset.libtab; library(); });
  const f = $('#libfolder'); if (f) f.onclick = () => DESK.jobs.reveal('');
  drawLibrary();
  Promise.all([srvRefresh(), jobsRefresh()]).then(() => S.view === 'library' && drawLibrary());
}
function libRow(x, actions, meta) {
  return `<div class="src librow">${x.logo || x.poster ? img(x.logo || x.poster, x.title, 'logo') : `<span class="logo ph">${esc(initials(x.title))}</span>`}
    <div><b>${esc(x.title)}</b><small>${meta}</small>${x.error ? `<small class="err">${esc(x.error)}</small>` : ''}</div>${actions}</div>`;
}
function drawLibrary() {
  const box = $('#lib'); if (!box) return;
  if (LIB.tab === 'recordings') {
    if (!canRecord()) { box.innerHTML = `<div class="empty" style="margin-top:4vh"><h1>Record live TV</h1><p>${DESK ? '' : 'On phones and Fire TV, recordings are made by Orbit Server, a small program that runs on an always-on computer or NAS at home. '}Set it up in Settings, then press Record on any programme in the guide.</p><button class="btn pri" data-go="settings">Open settings</button></div>`; return; }
    const all = allRecordings().sort((a, b) => b.start - a.start);
    const groups = [['Recording now', all.filter(r => r.status === 'recording')], ['Scheduled', all.filter(r => r.status === 'scheduled').reverse()], ['Recorded', all.filter(r => r.status === 'done')], ['Failed', all.filter(r => r.status === 'failed')]];
    const where = r => r.where === 'server' ? 'Orbit Server' : 'This computer';
    box.innerHTML = (srvOn() && !OSV.ok && OSV.checked ? `<p class="err" style="margin-bottom:14px">Orbit Server: ${esc(OSV.err)}</p>` : '') + (groups.map(([t, list]) => list.length ? `<h2 style="margin-top:22px">${t}</h2>` + list.map(r => libRow(r,
      `${r.status === 'done' || (r.status === 'recording' && r.where === 'local') ? `<button class="btn pri" data-recplay="${esc(r.id)}">Play</button>` : ''}${r.status === 'recording' ? `<button class="btn ghost" data-recstop="${esc(r.id)}">Stop</button>` : ''}${r.where === 'local' && r.status === 'done' ? `<button class="btn ghost" data-recreveal="${esc(r.id)}">Show file</button>` : ''}<button class="btn ghost" data-recdel="${esc(r.id)}">${r.status === 'scheduled' ? 'Cancel' : 'Delete'}</button>`,
      `${esc(r.channel)} · ${day(r.start)} ${hhmm(r.start)}–${hhmm(r.stop)} · ${where(r)}${r.size ? ' · ' + fmtSize(r.size) : ''}${r.status === 'recording' ? ' · <span class="livedot"></span>recording' : ''}`)).join('') : '').join('') || `<p class="dim" style="margin-top:20px">No recordings yet. Open a programme in the guide and press Record.</p>`);
  } else {
    const list = [...JOBS.list.filter(j => j.kind === 'download').map(j => ({ ...j, where: 'local' })), ...MDL.list.map(d => ({ ...d, where: 'mobile' }))].sort((a, b) => b.createdAt - a.createdAt);
    if (!canDownload()) { box.innerHTML = '<p class="dim">Downloads work in the desktop, Android and iPhone apps.</p>'; return; }
    box.innerHTML = list.map(d => libRow(d,
      `${d.status === 'done' ? `<button class="btn pri" data-dlplay="${esc(d.id)}">Play</button>` : ''}${d.where === 'local' && d.status === 'done' ? `<button class="btn ghost" data-recreveal="${esc(d.id)}">Show file</button>` : ''}<button class="btn ghost" data-dldel="${esc(d.id)}">${d.status === 'downloading' || d.status === 'queued' ? 'Cancel' : 'Delete'}</button>`,
      `${d.status === 'done' ? 'Ready to watch offline' : d.status === 'failed' ? 'Failed' : d.status === 'queued' ? 'Waiting' : `Downloading ${d.total ? Math.round((d.progress || d.size || 0) / d.total * 100) + '%' : fmtSize(d.progress || d.size)}`}${d.size || d.total ? ' · ' + fmtSize(d.size || d.total) : ''}`)).join('')
      || `<p class="dim" style="margin-top:20px">No downloads yet. Open a film or an episode and press Download to watch it offline.</p>`;
  }
  const findRec = id => allRecordings().find(r => r.id === id);
  const findDl = id => [...JOBS.list.map(j => ({ ...j, where: 'local' })), ...MDL.list.map(d => ({ ...d, where: 'mobile' }))].find(d => d.id === id);
  $$('[data-recplay]', box).forEach(b => b.onclick = async () => { const it = await recordingItem(findRec(b.dataset.recplay)); openPlayer(it, [it]); });
  $$('[data-recstop]', box).forEach(b => b.onclick = async () => { const r = findRec(b.dataset.recstop); if (r.where === 'server') await srv(`/api/recordings/${r.id}/stop`, { method: 'POST' }); else await DESK.jobs.stop(r.id); setTimeout(library, 800); });
  $$('[data-recdel]', box).forEach(b => b.onclick = async () => {
    if (!b.dataset.armed) { b.dataset.armed = 1; b.textContent = 'Confirm'; b.classList.add('pri'); return; }
    const r = findRec(b.dataset.recdel); if (r.where === 'server') await srv(`/api/recordings/${r.id}`, { method: 'DELETE' }); else await DESK.jobs.remove(r.id, true);
    library();
  });
  $$('[data-recreveal]', box).forEach(b => b.onclick = () => DESK.jobs.reveal(b.dataset.recreveal));
  $$('[data-dlplay]', box).forEach(b => b.onclick = async () => { const it = await downloadItem(findDl(b.dataset.dlplay)); openPlayer(it, [it]); });
  $$('[data-dldel]', box).forEach(b => b.onclick = async () => {
    if (!b.dataset.armed) { b.dataset.armed = 1; b.textContent = 'Confirm'; b.classList.add('pri'); return; }
    await removeDownload(findDl(b.dataset.dldel)); drawLibrary();
  });
}
SETTINGS_EXTRA.push({ order: 60, html: () => `<section><h2>Orbit Server and recordings</h2>
  <p class="hint" style="margin:0 0 12px">Orbit Server runs on an always-on computer or NAS at home (Docker image included). It records programmes for every device, including phones and Fire TV, and keeps your devices in sync.</p>
  <form class="form" id="srvform"><label>Server address<input type="text" inputmode="url" spellcheck="false" id="srv_url" value="${esc(srvCfg().url || '')}" placeholder="http://192.168.1.20:8090"></label>
  <label>Token<input type="password" id="srv_token" value="${esc(srvCfg().token || '')}" autocomplete="off" placeholder="The ORBIT_TOKEN you set on the server"></label>
  <div class="row"><button class="btn pri" type="submit">Save and test</button>${srvOn() ? '<button class="btn ghost" type="button" id="srv_forget">Disconnect</button>' : ''}</div>
  <p class="hint" id="srv_status">${srvOn() ? (OSV.ok ? `Connected to Orbit Server ${esc(OSV.info.version)} · ${OSV.recs.length} recordings` : OSV.err ? `Not connected: ${esc(OSV.err)}` : 'Not checked yet') : 'Not set up.'}</p></form>
  ${DESK ? `<div class="form" style="margin-top:16px"><label>Record on<select id="rectarget"><option value="server" ${recTarget() === 'server' ? 'selected' : ''} ${srvOn() ? '' : 'disabled'}>Orbit Server</option><option value="local" ${recTarget() === 'local' ? 'selected' : ''}>This computer (while the app is open)</option></select></label>
    <div class="row"><span class="dim" id="dlfolder">Saving to …</span><button class="btn ghost" type="button" id="dlchoose">Change folder</button></div></div>` : ''}</section>`,
  bind: () => {
    $('#srvform').onsubmit = async e => {
      e.preventDefault();
      S.cfg.server = { ...srvCfg(), url: $('#srv_url').value.trim(), token: $('#srv_token').value.trim() }; saveCfg();
      $('#srv_status').textContent = 'Testing…';
      const ok = await srvRefresh();
      $('#srv_status').textContent = ok ? `Connected to Orbit Server ${OSV.info.version} · ${OSV.recs.length} recordings` : `Not connected: ${OSV.err}`;
      if (ok) { toast('Orbit Server connected'); if (typeof syncNow === 'function') syncNow(); }
    };
    const fg = $('#srv_forget'); if (fg) fg.onclick = () => { S.cfg.server = {}; saveCfg(); OSV.ok = false; render(); };
    const rt = $('#rectarget'); if (rt) rt.onchange = e => { S.cfg.recTarget = e.target.value; saveCfg(); };
    if (DESK) { DESK.jobs.folder().then(f => { const el = $('#dlfolder'); if (el) el.textContent = 'Saving to ' + f; }); $('#dlchoose').onclick = async () => { const f = await DESK.jobs.chooseFolder(); $('#dlfolder').textContent = 'Saving to ' + f; }; }
  } });

/* ============================ external services ============================ */
// Endpoints can be overridden (window.__orbitApi) for testing against local mocks.
const API = Object.assign({
  tmdb: 'https://api.themoviedb.org/3', tmdbImg: 'https://image.tmdb.org/t/p', trakt: 'https://api.trakt.tv', simkl: 'https://api.simkl.com',
  os: 'https://api.opensubtitles.com/api/v1', gemini: 'https://generativelanguage.googleapis.com/v1beta', plextv: 'https://plex.tv',
  sportsdb: 'https://www.thesportsdb.com/api/v1/json',
}, window.__orbitApi || {});
const INT = () => (S.cfg.int || (S.cfg.int = {}));
const deviceId = () => { let d = store.get('deviceId', ''); if (!d) { d = 'orbit-' + uid() + uid(); store.set('deviceId', d); } return d; };
// "UK: The Long Harbour (2021) [4K]" -> { title: 'The Long Harbour', year: 2021 }
function cleanTitle(name) {
  let t = String(name || '').replace(/^\s*(\|[^|]*\||[A-Z]{2,3}\s*[-:|]\s+)/, '').replace(/\[[^\]]*\]/g, '').replace(/\b(4k|uhd|fhd|hd|sd|hevc|x26[45]|multi|vostfr|subbed|dubbed)\b/gi, '');
  const ym = /[\s(\-–]*((?:19|20)\d{2})\)?\s*$/.exec(t);
  const year = ym ? +ym[1] : 0;
  if (ym) t = t.slice(0, ym.index);
  return { title: t.replace(/[\s\-–:|]+$/, '').replace(/\s+/g, ' ').trim(), year };
}

/* ---------- media servers: Jellyfin and Emby ---------- */
function mbAuthHeader(src) {
  const v = `MediaBrowser Client="Orbit TV", Device="${PLATFORM === 'web' ? 'Desktop' : PLATFORM}", DeviceId="${deviceId()}", Version="1.0.0"${src.token ? `, Token="${src.token}"` : ''}`;
  return { 'X-Emby-Authorization': v, Authorization: v, ...(src.token ? { 'X-Emby-Token': src.token, 'X-MediaBrowser-Token': src.token } : {}) };
}
const mbBase = src => { let b = String(src.server || '').trim().replace(/\/+$/, ''); if (!/^https?:\/\//i.test(b)) b = 'http://' + b; return b; };
async function mbLogin(src) {
  const r = await request(`${mbBase(src)}/Users/AuthenticateByName`, { method: 'POST', headers: mbAuthHeader({}), body: { Username: src.user, Pw: src.pass || '' } });
  if (!r || !r.AccessToken) throw new Error('Login failed — check the address, username and password.');
  src.token = r.AccessToken; src.userId = r.User && r.User.Id; saveSources();
}
async function mbGet(src, path) {
  if (!src.token) await mbLogin(src);
  try { return await request(mbBase(src) + path, { headers: mbAuthHeader(src) }); }
  catch (e) { if (e.status === 401) { src.token = ''; await mbLogin(src); return request(mbBase(src) + path, { headers: mbAuthHeader(src) }); } throw e; }
}
function mbStream(src, it) {
  const direct = /^(mp4|m4v|mov|webm)$/i.test(it.Container || '') || src.directPlay;
  return direct ? `${mbBase(src)}/Videos/${it.Id}/stream?static=true&api_key=${src.token}`
    : `${mbBase(src)}/Videos/${it.Id}/master.m3u8?api_key=${src.token}&MediaSourceId=${it.Id}&DeviceId=${deviceId()}&VideoCodec=h264&AudioCodec=aac,mp3&TranscodingMaxAudioChannels=2&SegmentContainer=ts&BreakOnNonKeyFrames=true`;
}
const mbImg = (src, id, tag) => tag ? `${mbBase(src)}/Items/${id}/Images/Primary?maxHeight=450&quality=85&tag=${tag}` : '';
async function loadMediaBrowser(src) {
  const views = await mbGet(src, `/Users/${src.userId || 'me'}/Views`).catch(async () => { await mbLogin(src); return mbGet(src, `/Users/${src.userId}/Views`); });
  const movies = [], series = [];
  const fields = 'Overview,Genres,ProductionYear,CommunityRating,DateCreated,Container,RunTimeTicks,People';
  for (const v of (views && views.Items) || []) {
    if (!['movies', 'tvshows', 'homevideos', 'musicvideos', null, undefined].includes(v.CollectionType)) continue;
    const types = v.CollectionType === 'tvshows' ? 'Series' : 'Movie';
    const r = await mbGet(src, `/Users/${src.userId}/Items?ParentId=${v.Id}&IncludeItemTypes=${types}&Recursive=true&Fields=${fields}&SortBy=DateCreated&SortOrder=Descending&Limit=20000`);
    for (const it of (r && r.Items) || []) {
      const base = { name: it.Name || '', poster: mbImg(src, it.Id, it.ImageTags && it.ImageTags.Primary), group: v.Name, rating: num(it.CommunityRating), year: it.ProductionYear || '',
        plot: it.Overview || '', genre: (it.Genres || []).slice(0, 3).join(', '), added: Date.parse(it.DateCreated) || 0, infoLoaded: true,
        cast: (it.People || []).filter(p => p.Type === 'Actor').slice(0, 6).map(p => p.Name).join(', '), ms: { src: src.id, id: it.Id } };
      if (it.Type === 'Series') series.push({ ...base, kind: 'series', key: `s:${src.id}:${it.Id}`, loadEpisodes: () => mbEpisodes(src, it.Id) });
      else movies.push({ ...base, kind: 'movie', key: `m:${src.id}:${it.Id}`, url: mbStream(src, it), dur: it.RunTimeTicks ? Math.round(it.RunTimeTicks / 6e8) + ' min' : '' });
    }
  }
  return { live: [], movies, series };
}
async function mbEpisodes(src, seriesId) {
  const r = await mbGet(src, `/Shows/${seriesId}/Episodes?UserId=${src.userId}&Fields=Overview,Container,RunTimeTicks`);
  const seasons = {};
  for (const e of (r && r.Items) || []) {
    const sn = e.ParentIndexNumber ?? 1;
    (seasons[sn] ||= []).push({ num: e.IndexNumber || 0, title: e.Name || '', plot: e.Overview || '', url: mbStream(src, e), dur: e.RunTimeTicks ? Math.round(e.RunTimeTicks / 6e8) + ' min' : '' });
  }
  for (const k in seasons) seasons[k].sort((a, b) => a.num - b.num);
  return seasons;
}

/* ---------- media servers: Plex ---------- */
const plexHeaders = token => ({ Accept: 'application/json', 'X-Plex-Product': 'Orbit TV', 'X-Plex-Version': '1.0.0', 'X-Plex-Client-Identifier': deviceId(), 'X-Plex-Platform': 'Chrome', 'X-Plex-Device-Name': 'Orbit TV', ...(token ? { 'X-Plex-Token': token } : {}) });
const plexBase = src => { let b = String(src.server || '').trim().replace(/\/+$/, ''); if (b && !/^https?:\/\//i.test(b)) b = 'http://' + b; return b; };
const plexGet = (src, path) => request(plexBase(src) + path, { headers: plexHeaders(src.token) });
const plexImg = (src, thumb) => thumb ? `${plexBase(src)}/photo/:/transcode?width=300&height=450&minSize=1&upscale=1&url=${encodeURIComponent(thumb)}&X-Plex-Token=${src.token}` : '';
function plexStream(src, m) {
  const part = m.Media && m.Media[0] && m.Media[0].Part && m.Media[0].Part[0];
  const direct = part && /^(mp4|m4v|mov|webm)$/i.test(part.container || m.Media[0].container || '');
  if (direct || (part && src.directPlay)) return `${plexBase(src)}${part.key}?X-Plex-Token=${src.token}`;
  return `${plexBase(src)}/video/:/transcode/universal/start.m3u8?path=${encodeURIComponent('/library/metadata/' + m.ratingKey)}&protocol=hls&directPlay=0&directStream=1&directStreamAudio=0&mediaIndex=0&partIndex=0&fastSeek=1&videoResolution=1920x1080&maxVideoBitrate=12000&session=${uid()}&X-Plex-Token=${src.token}&X-Plex-Client-Identifier=${deviceId()}&X-Plex-Product=Orbit%20TV&X-Plex-Platform=Chrome`;
}
async function loadPlex(src) {
  if (!src.token || !src.server) throw new Error('Sign in to Plex again from Settings.');
  const secs = await plexGet(src, '/library/sections');
  const movies = [], series = [];
  for (const d of ((secs && secs.MediaContainer && secs.MediaContainer.Directory) || []).filter(x => x.type === 'movie' || x.type === 'show')) {
    const r = await plexGet(src, `/library/sections/${d.key}/all`);
    for (const m of (r && r.MediaContainer && r.MediaContainer.Metadata) || []) {
      const base = { name: m.title || '', poster: plexImg(src, m.thumb), group: d.title, rating: num(m.audienceRating || m.rating), year: m.year || '', plot: m.summary || '',
        genre: (m.Genre || []).slice(0, 3).map(g => g.tag).join(', '), added: (m.addedAt || 0) * 1000, infoLoaded: true, px: { src: src.id, id: m.ratingKey } };
      if (d.type === 'show') series.push({ ...base, kind: 'series', key: `s:${src.id}:${m.ratingKey}`, loadEpisodes: () => plexEpisodes(src, m.ratingKey) });
      else movies.push({ ...base, kind: 'movie', key: `m:${src.id}:${m.ratingKey}`, url: plexStream(src, m), dur: m.duration ? Math.round(m.duration / 60000) + ' min' : '' });
    }
  }
  return { live: [], movies, series };
}
async function plexEpisodes(src, key) {
  const r = await plexGet(src, `/library/metadata/${key}/allLeaves`);
  const seasons = {};
  for (const e of (r && r.MediaContainer && r.MediaContainer.Metadata) || []) (seasons[e.parentIndex ?? 1] ||= []).push({ num: e.index || 0, title: e.title || '', plot: e.summary || '', url: plexStream(src, e), dur: e.duration ? Math.round(e.duration / 60000) + ' min' : '' });
  for (const k in seasons) seasons[k].sort((a, b) => a.num - b.num);
  return seasons;
}
// Sign in with a code at plex.tv/link — works on TVs too, no typing a password into Orbit.
async function plexSignIn(src) {
  const pin = await request(`${API.plextv}/api/v2/pins`, { method: 'POST', headers: plexHeaders() });
  modal(`<h2>Sign in to Plex</h2><p class="plot">On your phone or computer, go to <b>plex.tv/link</b> and enter this code:</p>
    <div class="bigcode">${esc(pin.code)}</div><p class="hint"><span class="spin"></span>Waiting for you to sign in…</p>`, 'narrow');
  const until = Date.now() + 10 * 60e3;
  while (Date.now() < until && !$('#modal').hidden) {
    await new Promise(r => setTimeout(r, 2500));
    const st = await request(`${API.plextv}/api/v2/pins/${pin.id}`, { headers: plexHeaders() }).catch(() => null);
    if (st && st.authToken) {
      src.token = st.authToken;
      const res = await request(`${API.plextv}/api/v2/resources?includeHttps=1&includeRelay=1`, { headers: plexHeaders(src.token) });
      const servers = (res || []).filter(r => (r.provides || '').includes('server'));
      if (!servers.length) throw new Error('No Plex Media Server was found on this account.');
      const srvr = servers[0];
      src.name = src.name || srvr.name;
      const conns = (srvr.connections || []).sort((a, b) => (b.local === true) - (a.local === true));
      for (const c of conns) {
        try { await request(`${c.uri}/identity`, { headers: plexHeaders(srvr.accessToken || src.token) }); src.server = c.uri; src.token = srvr.accessToken || src.token; break; } catch {}
      }
      if (!src.server) throw new Error(`Found "${srvr.name}" but could not reach it from this device.`);
      closeModal(); return true;
    }
  }
  closeModal(); return false;
}
SRC_TYPES.jellyfin = { label: 'Jellyfin server', short: 'Jellyfin', fields: [['server', 'Server address', 'url', 'http://192.168.1.20:8096'], ['user', 'Username'], ['pass', 'Password', 'password']], noEpg: true };
SRC_TYPES.emby = { label: 'Emby server', short: 'Emby', fields: [['server', 'Server address', 'url', 'http://192.168.1.20:8096'], ['user', 'Username'], ['pass', 'Password', 'password']], noEpg: true };
SRC_TYPES.plex = { label: 'Plex Media Server', short: 'Plex', noEpg: true, custom: (s, editing) => {
  modal(`<h2>${editing ? 'Edit' : 'Add'} Plex</h2><form class="form" id="plexform">
    <label>Name<input type="text" id="px_name" value="${esc(s.name || '')}" placeholder="My Plex"></label>
    <button class="btn pri" type="button" id="px_link">Sign in with plex.tv/link</button>
    <details><summary class="linkbtn">Or enter a server address and token</summary>
      <label>Server address<input type="text" inputmode="url" id="px_server" value="${esc(s.server || '')}" placeholder="http://192.168.1.20:32400"></label>
      <label>X-Plex-Token<input type="password" id="px_token" value="${esc(s.token || '')}" autocomplete="off"></label>
      <button class="btn" type="submit">Save</button></details>
    <label class="check"><input type="checkbox" id="px_direct" ${s.directPlay ? 'checked' : ''}> Always play the original file (no conversion on the server)</label></form>`, 'narrow');
  const collect = () => ({ ...s, id: s.id || uid(), type: 'plex', name: $('#px_name').value.trim() || s.name || 'Plex', directPlay: $('#px_direct').checked });
  $('#px_link').onclick = async () => { const n = collect(); try { if (await plexSignIn(n)) saveSource(n, !editing); } catch (e) { closeModal(); toast(`Plex: ${friendly(e)}`, true); } };
  $('#plexform').onsubmit = e => { e.preventDefault(); const n = collect(); n.server = $('#px_server').value.trim(); n.token = $('#px_token').value.trim(); if (!n.server || !n.token) return toast('Enter both the address and the token.', true); saveSource(n, !editing); };
} };
LOADERS.plex = loadPlex; LOADERS.jellyfin = loadMediaBrowser; LOADERS.emby = loadMediaBrowser;

/* ---------- TMDB: artwork, plot, cast and trailers ---------- */
const tmdbCache = store.get('cache.tmdb', {});
const tmdbOn = () => !!INT().tmdbKey;
async function tmdbGet(path, params = {}) {
  const k = INT().tmdbKey, bearer = k.length > 40;
  const q = new URLSearchParams({ ...params, ...(bearer ? {} : { api_key: k }), language: navigator.language || 'en-GB' });
  return request(`${API.tmdb}${path}?${q}`, { headers: bearer ? { Authorization: 'Bearer ' + k } : {} });
}
async function tmdbFor(x) {
  if (!tmdbOn()) return null;
  const type = x.kind === 'series' ? 'tv' : 'movie';
  const ck = `${type}:${x.name}`;
  if (tmdbCache[ck] !== undefined) return tmdbCache[ck];
  const { title, year } = cleanTitle(x.name);
  const y = year || +x.year || 0;
  let r = await tmdbGet(`/search/${type}`, { query: title, ...(y ? (type === 'tv' ? { first_air_date_year: y } : { year: y }) : {}) });
  if ((!r || !r.results || !r.results.length) && y) r = await tmdbGet(`/search/${type}`, { query: title });
  const hit = r && r.results && r.results[0];
  if (!hit) { tmdbCache[ck] = null; return null; }
  const d = await tmdbGet(`/${type}/${hit.id}`, { append_to_response: 'credits,videos' });
  const trailer = ((d.videos && d.videos.results) || []).find(v => v.site === 'YouTube' && /trailer/i.test(v.type));
  const out = { id: hit.id, type, title: d.title || d.name, year: +String(d.release_date || d.first_air_date || '').slice(0, 4) || 0, plot: d.overview || '',
    poster: d.poster_path ? `${API.tmdbImg}/w342${d.poster_path}` : '', backdrop: d.backdrop_path ? `${API.tmdbImg}/w1280${d.backdrop_path}` : '',
    genres: (d.genres || []).map(g => g.name).slice(0, 3).join(', '), runtime: d.runtime || (d.episode_run_time && d.episode_run_time[0]) || 0,
    cast: ((d.credits && d.credits.cast) || []).slice(0, 6).map(c => c.name).join(', '), rating: d.vote_average || 0, trailer: trailer ? `https://www.youtube.com/watch?v=${trailer.key}` : '' };
  tmdbCache[ck] = out;
  const keys = Object.keys(tmdbCache); if (keys.length > 800) delete tmdbCache[keys[0]];
  store.set('cache.tmdb', tmdbCache);
  return out;
}
async function decorateDetail(x) {
  if (!tmdbOn() || (x.kind !== 'movie' && x.kind !== 'series')) return;
  let t; try { t = await tmdbFor(x); } catch { return; }
  const box = $('#modal .mbox'); if (!t || !box || box.dataset.key !== x.key) return;
  x.tmdb = t;
  if (t.backdrop) { box.classList.add('hasbd'); box.style.setProperty('--bd', `url(${JSON.stringify(t.backdrop)})`); }
  if (!x.plot && t.plot) { x.plot = t.plot; const m = $('.mbox .meta'); if (m) m.insertAdjacentHTML('afterend', `<p class="plot">${esc(t.plot)}</p>`); }
  if (!x.poster && t.poster) { const pi = $('.mbox .det .pimg'); if (pi) pi.outerHTML = img(t.poster, x.name, 'pimg'); }
  const meta = $('.mbox .meta');
  if (meta) meta.textContent = [x.year || t.year, x.genre || t.genres, x.dur || (t.runtime ? t.runtime + ' min' : ''), (num(x.rating) || t.rating) ? '★ ' + (num(x.rating) || t.rating).toFixed(1) : '', x.group].filter(Boolean).join(' · ');
  if (!x.cast && t.cast) { const btns = $('#detbtns'); if (btns) btns.insertAdjacentHTML('beforebegin', `<p class="hint" style="margin-bottom:16px">Cast: ${esc(t.cast)}</p>`); }
  if (t.trailer) { const btns = $('#detbtns'); if (btns && !$('#trailer')) btns.insertAdjacentHTML('beforeend', `<a class="btn ghost" id="trailer" href="${esc(t.trailer)}" target="_blank" rel="noopener">▶ Trailer</a>`); }
}

/* ---------- Trakt and SIMKL: scrobbling and watched history ---------- */
const traktOn = () => !!(INT().trakt && INT().trakt.token);
const simklOn = () => !!(INT().simkl && INT().simkl.token);
const traktHeaders = () => ({ 'trakt-api-version': '2', 'trakt-api-key': INT().trakt.clientId, Authorization: 'Bearer ' + INT().trakt.token });
async function traktConnect() {
  const t = INT().trakt || {};
  t.clientId = ($('#tr_id') || {}).value?.trim() || t.clientId; t.clientSecret = ($('#tr_secret') || {}).value?.trim() || t.clientSecret;
  if (!t.clientId || !t.clientSecret) return toast('Enter your Trakt app Client ID and Secret first.', true);
  INT().trakt = t; saveCfg();
  const dc = await request(`${API.trakt}/oauth/device/code`, { method: 'POST', body: { client_id: t.clientId } });
  modal(`<h2>Connect Trakt</h2><p class="plot">Go to <b>${esc(dc.verification_url)}</b> and enter:</p><div class="bigcode">${esc(dc.user_code)}</div><p class="hint"><span class="spin"></span>Waiting for you to approve Orbit TV…</p>`, 'narrow');
  const until = Date.now() + (dc.expires_in || 600) * 1000;
  while (Date.now() < until && !$('#modal').hidden) {
    await new Promise(r => setTimeout(r, (dc.interval || 5) * 1000));
    try {
      const tok = await request(`${API.trakt}/oauth/device/token`, { method: 'POST', body: { code: dc.device_code, client_id: t.clientId, client_secret: t.clientSecret } });
      if (tok && tok.access_token) { Object.assign(t, { token: tok.access_token, refresh: tok.refresh_token, expires: Date.now() + tok.expires_in * 1000 }); saveCfg(); closeModal(); toast('Trakt connected'); return render(); }
    } catch (e) { if (e.status && e.status !== 400 && e.status !== 429) { closeModal(); return toast(`Trakt: ${friendly(e)}`, true); } }
  }
  closeModal();
}
async function traktRefresh() {
  const t = INT().trakt; if (!t || !t.refresh || !t.expires || t.expires - Date.now() > 7 * 864e5) return;
  try { const tok = await request(`${API.trakt}/oauth/token`, { method: 'POST', body: { refresh_token: t.refresh, client_id: t.clientId, client_secret: t.clientSecret, redirect_uri: 'urn:ietf:wg:oauth:2.0:oob', grant_type: 'refresh_token' } });
    Object.assign(t, { token: tok.access_token, refresh: tok.refresh_token, expires: Date.now() + tok.expires_in * 1000 }); saveCfg(); } catch {}
}
async function simklConnect() {
  const sm = INT().simkl || {};
  sm.clientId = ($('#sk_id') || {}).value?.trim() || sm.clientId;
  if (!sm.clientId) return toast('Enter your SIMKL Client ID first.', true);
  INT().simkl = sm; saveCfg();
  const pin = await request(`${API.simkl}/oauth/pin?client_id=${encodeURIComponent(sm.clientId)}&redirect=urn:ietf:wg:oauth:2.0:oob`);
  modal(`<h2>Connect SIMKL</h2><p class="plot">Go to <b>${esc(pin.verification_url || 'simkl.com/pin')}</b> and enter:</p><div class="bigcode">${esc(pin.user_code)}</div><p class="hint"><span class="spin"></span>Waiting for you to approve Orbit TV…</p>`, 'narrow');
  const until = Date.now() + (pin.expires_in || 900) * 1000;
  while (Date.now() < until && !$('#modal').hidden) {
    await new Promise(r => setTimeout(r, (pin.interval || 5) * 1000));
    const r = await request(`${API.simkl}/oauth/pin/${encodeURIComponent(pin.user_code)}?client_id=${encodeURIComponent(sm.clientId)}`).catch(() => null);
    if (r && r.access_token) { sm.token = r.access_token; saveCfg(); closeModal(); toast('SIMKL connected'); return render(); }
  }
  closeModal();
}
// What a playing item is, in the shape Trakt and SIMKL expect.
async function mediaIds(item) {
  if (item.kind === 'movie' || (item.kind === 'download' && !item.season)) {
    const x = S.index.get(item.key) || item; const { title, year } = cleanTitle(x.name);
    const t = x.tmdb || (tmdbOn() ? await tmdbFor(x).catch(() => null) : null);
    return { type: 'movie', movie: { title: t ? t.title : title, year: (t && t.year) || year || +x.year || undefined, ids: t ? { tmdb: t.id } : {} } };
  }
  if (item.kind === 'episode' && item.season != null) {
    const sx = S.index.get(item.seriesKey) || { name: item.seriesName, kind: 'series' }; const { title, year } = cleanTitle(sx.name);
    const t = sx.tmdb || (tmdbOn() ? await tmdbFor(sx).catch(() => null) : null);
    return { type: 'episode', show: { title: t ? t.title : title, year: (t && t.year) || year || +sx.year || undefined, ids: t ? { tmdb: t.id } : {} }, episode: { season: +item.season, number: +item.num } };
  }
  return null;
}
const SCR = { item: null, ids: null };
async function scrobbleStart(item) {
  SCR.item = item; SCR.ids = null;
  if (!(traktOn() || simklOn()) || !item || !['movie', 'episode', 'download'].includes(item.kind)) return;
  try { SCR.ids = await mediaIds(item); } catch { return; }
  if (!SCR.ids || !traktOn()) return;
  await traktRefresh();
  const body = SCR.ids.type === 'movie' ? { movie: SCR.ids.movie, progress: 0.1 } : { show: SCR.ids.show, episode: SCR.ids.episode, progress: 0.1 };
  request(`${API.trakt}/scrobble/start`, { method: 'POST', headers: traktHeaders(), body }).catch(() => {});
}
async function scrobbleStop(item, progress) {
  if (!item || SCR.item !== item || !SCR.ids) return;
  const ids = SCR.ids; SCR.item = null; SCR.ids = null;
  const pctDone = Math.max(0, Math.min(100, progress || 0));
  if (traktOn()) {
    const body = ids.type === 'movie' ? { movie: ids.movie, progress: pctDone } : { show: ids.show, episode: ids.episode, progress: pctDone };
    request(`${API.trakt}/scrobble/${pctDone >= 80 ? 'stop' : 'pause'}`, { method: 'POST', headers: traktHeaders(), body }).catch(() => {});
  }
  if (simklOn() && pctDone >= 80) {
    const h = { 'simkl-api-key': INT().simkl.clientId, Authorization: 'Bearer ' + INT().simkl.token };
    const now = new Date().toISOString();
    const body = ids.type === 'movie' ? { movies: [{ ...ids.movie, watched_at: now }] } : { shows: [{ ...ids.show, seasons: [{ number: ids.episode.season, episodes: [{ number: ids.episode.number, watched_at: now }] }] }] };
    request(`${API.simkl}/sync/history`, { method: 'POST', headers: h, body }).catch(() => {});
  }
}

/* ---------- subtitles: files, OpenSubtitles, and Gemini live captions ---------- */
function srtToVtt(srt) {
  return 'WEBVTT\n\n' + String(srt).replace(/\r/g, '').replace(/^\uFEFF/, '').replace(/(\d\d:\d\d:\d\d),(\d\d\d)/g, '$1.$2').replace(/^\d+\n(?=\d\d:)/gm, '').trim() + '\n';
}
function addSubtitleTrack(text, label, lang) {
  const vtt = /^WEBVTT/.test(text.trim()) ? text : srtToVtt(text);
  const url = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }));
  $$('track', OP.v).forEach(t => t.remove());
  const tr = document.createElement('track');
  Object.assign(tr, { kind: 'subtitles', label: label || 'Subtitles', srclang: lang || 'en', src: url, default: true });
  OP.v.append(tr);
  setTimeout(() => { for (const t of OP.v.textTracks) t.mode = t.label === tr.label ? 'showing' : 'disabled'; }, 50);
  toast(`Subtitles: ${label}`);
}
const osOn = () => !!INT().osKey;
const osHeaders = () => ({ 'Api-Key': INT().osKey, 'X-User-Agent': 'OrbitTV v1.0.0', ...(INT().osToken ? { Authorization: 'Bearer ' + INT().osToken } : {}) });
async function osLogin() {
  const i = INT(); if (!i.osUser || !i.osPass || i.osToken) return;
  try { const r = await request(`${API.os}/login`, { method: 'POST', headers: osHeaders(), body: { username: i.osUser, password: i.osPass } }); if (r && r.token) { i.osToken = r.token; saveCfg(); } } catch {}
}
async function subtitlesMenu() {
  const it = OP.item; if (!it) return;
  const lang = INT().subLang || (navigator.language || 'en').slice(0, 2);
  const capOk = !!(INT().geminiKey && (OP.v.captureStream || OP.v.mozCaptureStream));
  modal(`<h2>Subtitles</h2>
    <div class="morelist">
      <label class="btn ghost" tabindex="0">Load a subtitle file (.srt or .vtt)<input type="file" id="subfile" accept=".srt,.vtt,text/vtt" hidden></label>
      ${[...OP.v.textTracks].length ? '<button class="btn ghost" id="suboff">Turn subtitles off</button>' : ''}
      ${INT().geminiKey ? `<button class="btn ghost" id="livecap" ${capOk ? '' : 'disabled'}>${LC.on ? 'Stop live captions' : `Live captions with Gemini (${esc(INT().capLang || 'original language')})`}</button>${capOk ? '' : '<p class="hint">Live captions need the built-in player on this device.</p>'}` : ''}
    </div>
    ${osOn() && it.kind !== 'live' ? `<h2 style="margin-top:20px">OpenSubtitles</h2><div class="row"><input type="search" id="osq" value="${esc(cleanTitle((S.index.get(it.seriesKey) || it).name.split(' · ')[0]).title)}" style="flex:1" aria-label="Search subtitles"><select id="oslang">${['en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'pl', 'ar', 'tr', 'ro', 'sv'].map(l => `<option ${l === lang ? 'selected' : ''}>${l}</option>`).join('')}</select><button class="btn" id="osgo">Search</button></div><div class="picklist" id="osres"></div>` : !osOn() ? '<p class="hint" style="margin-top:14px">Add an OpenSubtitles API key in Settings to search for subtitles.</p>' : ''}`, 'narrow');
  $('#subfile').onchange = async e => { const f = e.target.files[0]; if (f) { addSubtitleTrack(await f.text(), f.name.replace(/\.\w+$/, ''), lang); closeModal(); } };
  const off = $('#suboff'); if (off) off.onclick = () => { for (const t of OP.v.textTracks) t.mode = 'disabled'; closeModal(); };
  const lcb = $('#livecap'); if (lcb) lcb.onclick = () => { closeModal(); LC.on ? stopLiveCaptions() : startLiveCaptions(); };
  const go = $('#osgo'); if (go) { go.onclick = () => osSearch(it); osSearch(it); }
}
async function osSearch(it) {
  const box = $('#osres'); if (!box) return;
  box.innerHTML = '<p class="dim"><span class="spin"></span>Searching…</p>';
  const lang = $('#oslang').value; INT().subLang = lang; saveCfg();
  try {
    const q = { query: $('#osq').value.trim(), languages: lang };
    const ids = await mediaIds(it).catch(() => null);
    if (it.kind === 'episode') Object.assign(q, { type: 'episode', season_number: it.season, episode_number: it.num });
    if (ids && ((ids.movie && ids.movie.ids.tmdb) || (ids.show && ids.show.ids.tmdb))) { if (ids.movie) q.tmdb_id = ids.movie.ids.tmdb; else q.parent_tmdb_id = ids.show.ids.tmdb; }
    const r = await request(`${API.os}/subtitles?${new URLSearchParams(q)}`, { headers: osHeaders() });
    const list = (r && r.data) || [];
    box.innerHTML = list.slice(0, 30).map(s => { const a = s.attributes || {}, f = (a.files || [])[0] || {}; return `<button class="chrow" style="grid-template-columns:1fr auto" data-osfile="${esc(f.file_id)}"><span><b>${esc(a.release || f.file_name || 'Subtitle')}</b><small>${esc(a.language || '')} · ${esc(a.download_count || 0)} downloads${a.hearing_impaired ? ' · SDH' : ''}</small></span></button>`; }).join('') || '<p class="dim">No subtitles found. Try a shorter title.</p>';
    $$('[data-osfile]', box).forEach(b => b.onclick = async () => {
      try {
        await osLogin();
        const d = await request(`${API.os}/download`, { method: 'POST', headers: osHeaders(), body: { file_id: +b.dataset.osfile } });
        const text = await request(d.link, { type: 'text' });
        addSubtitleTrack(text, `OpenSubtitles (${lang})`, lang); closeModal();
      } catch (e) { toast(`OpenSubtitles: ${e.status === 406 ? 'daily download limit reached — add your OpenSubtitles login in Settings for more' : friendly(e)}`, true); }
    });
  } catch (e) { box.innerHTML = `<p class="err">${esc(friendly(e))}</p>`; }
}
// Gemini live captions: records the audio the player is outputting in short chunks and asks Gemini to transcribe (and translate) each one.
const LC = { on: false, rec: null, timer: 0, gen: 0 };
function startLiveCaptions() {
  const v = OP.v;
  let stream;
  try { stream = (v.captureStream || v.mozCaptureStream).call(v); } catch (e) { return toast('This stream cannot be captioned on this device.', true); }
  const audio = stream.getAudioTracks();
  if (!audio.length) return toast('No audio to caption yet — try again once the video is playing.', true);
  const ms = new MediaStream(audio);
  const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m));
  if (!mime) return toast('This device cannot record audio for captions.', true);
  LC.on = true; const gen = ++LC.gen;
  $('#lcap').hidden = false; $('#lcap').textContent = 'Live captions starting…';
  const chunk = () => {
    if (!LC.on || gen !== LC.gen) return;
    const rec = LC.rec = new MediaRecorder(ms, { mimeType: mime });
    const parts = [];
    rec.ondataavailable = e => e.data.size && parts.push(e.data);
    rec.onstop = () => { if (parts.length) transcribe(new Blob(parts, { type: mime.split(';')[0] }), gen); };
    rec.start();
    LC.timer = setTimeout(() => { if (rec.state === 'recording') rec.stop(); chunk(); }, 6000);
  };
  chunk();
}
function stopLiveCaptions() {
  LC.on = false; LC.gen++; clearTimeout(LC.timer);
  try { if (LC.rec && LC.rec.state === 'recording') LC.rec.stop(); } catch {}
  const el = $('#lcap'); if (el) { el.hidden = true; el.textContent = ''; }
}
async function transcribe(blob, gen) {
  const i = INT();
  const b64 = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(',')[1]); fr.readAsDataURL(blob); });
  const lang = i.capLang && i.capLang !== 'original' ? i.capLang : '';
  const prompt = `Transcribe the speech in this audio clip from a TV programme${lang ? ` and translate it into ${lang}` : ''}. Reply with only the subtitle text, at most two short lines, with no timestamps, labels or commentary. If there is no speech, reply with nothing.`;
  try {
    const r = await request(`${API.gemini}/models/${encodeURIComponent(i.geminiModel || 'gemini-2.5-flash')}:generateContent?key=${encodeURIComponent(i.geminiKey)}`, { method: 'POST',
      body: { contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: blob.type || 'audio/webm', data: b64 } }] }], generationConfig: { temperature: 0, maxOutputTokens: 120 } } });
    const text = ((r && r.candidates && r.candidates[0] && r.candidates[0].content && r.candidates[0].content.parts) || []).map(p => p.text || '').join(' ').trim();
    if (gen !== LC.gen) return;
    const el = $('#lcap'); if (el) el.textContent = text;
  } catch (e) {
    if (gen !== LC.gen) return;
    const el = $('#lcap'); if (el) el.textContent = `Captions unavailable: ${e.status === 400 || e.status === 403 ? 'check your Gemini API key and model' : friendly(e)}`;
  }
}

SETTINGS_EXTRA.push({ order: 70, html: () => { const i = INT(); return `<section><h2>Integrations</h2>
  <p class="hint" style="margin:0 0 14px">Each service needs your own free key or app ID from its website. Keys are stored on this device${S.cfg.sync && S.cfg.sync.on ? ' and your Orbit Server' : ''}.</p>
  <div class="form">
    <label>TMDB API key or read access token — artwork, plots, cast and trailers <input type="password" id="i_tmdb" value="${esc(i.tmdbKey || '')}" autocomplete="off" placeholder="themoviedb.org → Settings → API"></label>
    <div class="intbox"><b>Trakt</b> ${traktOn() ? '<span class="pill">Connected</span>' : ''}<p class="hint">Marks what you watch on Trakt. Create an app at trakt.tv/oauth/applications with redirect URI urn:ietf:wg:oauth:2.0:oob.</p>
      ${traktOn() ? '<button class="btn ghost" type="button" id="tr_off">Disconnect</button>' : `<div class="row"><input type="text" id="tr_id" placeholder="Client ID" value="${esc((i.trakt || {}).clientId || '')}" autocomplete="off"><input type="password" id="tr_secret" placeholder="Client secret" value="${esc((i.trakt || {}).clientSecret || '')}" autocomplete="off"><button class="btn" type="button" id="tr_go">Connect</button></div>`}</div>
    <div class="intbox"><b>SIMKL</b> ${simklOn() ? '<span class="pill">Connected</span>' : ''}<p class="hint">Adds films and episodes you finish to your SIMKL history. Create an app at simkl.com/settings/developer.</p>
      ${simklOn() ? '<button class="btn ghost" type="button" id="sk_off">Disconnect</button>' : `<div class="row"><input type="text" id="sk_id" placeholder="Client ID" value="${esc((i.simkl || {}).clientId || '')}" autocomplete="off"><button class="btn" type="button" id="sk_go">Connect</button></div>`}</div>
    <div class="intbox"><b>OpenSubtitles</b><p class="hint">Search subtitles from the player (CC button). API key from opensubtitles.com/consumers; your login is optional and raises the daily download limit.</p>
      <div class="row"><input type="password" id="i_os" placeholder="API key" value="${esc(i.osKey || '')}" autocomplete="off"><input type="text" id="i_osu" placeholder="Username (optional)" value="${esc(i.osUser || '')}" autocomplete="off"><input type="password" id="i_osp" placeholder="Password (optional)" value="${esc(i.osPass || '')}" autocomplete="off"></div></div>
    <div class="intbox"><b>Google Gemini live captions</b><p class="hint">Creates subtitles for any channel as it plays, optionally translated. Uses your Gemini API key from aistudio.google.com; captions appear a few seconds behind the speech.</p>
      <div class="row"><input type="password" id="i_gem" placeholder="Gemini API key" value="${esc(i.geminiKey || '')}" autocomplete="off"><input type="text" id="i_gmodel" placeholder="Model" value="${esc(i.geminiModel || 'gemini-2.5-flash')}"><select id="i_glang">${['original', 'English', 'Spanish', 'French', 'German', 'Italian', 'Portuguese', 'Arabic', 'Turkish', 'Polish', 'Dutch', 'Hindi'].map(l => `<option value="${l}" ${(i.capLang || 'original') === l ? 'selected' : ''}>${l === 'original' ? 'Original language' : 'Translate to ' + l}</option>`).join('')}</select></div></div>
    <div class="row"><button class="btn pri" type="button" id="i_save">Save keys</button></div>
  </div></section>`; },
  bind: () => {
    const i = INT();
    $('#i_save').onclick = () => {
      i.tmdbKey = $('#i_tmdb').value.trim(); i.osKey = $('#i_os').value.trim();
      if (i.osUser !== $('#i_osu').value.trim() || i.osPass !== $('#i_osp').value) delete i.osToken;
      i.osUser = $('#i_osu').value.trim(); i.osPass = $('#i_osp').value;
      i.geminiKey = $('#i_gem').value.trim(); i.geminiModel = $('#i_gmodel').value.trim() || 'gemini-2.5-flash'; i.capLang = $('#i_glang').value;
      const tid = $('#tr_id'); if (tid) i.trakt = { ...(i.trakt || {}), clientId: tid.value.trim(), clientSecret: $('#tr_secret').value.trim() };
      const sid = $('#sk_id'); if (sid) i.simkl = { ...(i.simkl || {}), clientId: sid.value.trim() };
      saveCfg(); toast('Saved');
    };
    const on = (id, fn) => { const el = $(id); if (el) el.onclick = () => fn().catch(e => toast(friendly(e), true)); };
    on('#tr_go', traktConnect); on('#sk_go', simklConnect);
    on('#tr_off', async () => { delete i.trakt.token; saveCfg(); render(); });
    on('#sk_off', async () => { delete i.simkl.token; saveCfg(); render(); });
  } });

/* ============================ sports ============================ */
// Built from the programme guide of the user's own channels, so every event shown is on a channel they have.
const SPORTS = [
  ['Football', /\b(football|soccer|premier league|la ?liga|serie a|bundesliga|ligue 1|champions league|europa league|fa cup|efl|mls|uefa|fifa|copa)\b/i],
  ['Basketball', /\b(nba|basketball|euroleague|wnba|ncaab)\b/i],
  ['American football', /\b(nfl|ncaaf|american football|super bowl|college football)\b/i],
  ['Tennis', /\b(tennis|atp|wta|wimbledon|roland garros|us open tennis|australian open)\b/i],
  ['Motorsport', /\b(f1|formula 1|formula one|grand prix|motogp|nascar|indycar|wec|rally|superbike)\b/i],
  ['Golf', /\b(golf|pga|lpga|dp world tour|ryder cup|the masters|open championship)\b/i],
  ['Cricket', /\b(cricket|ipl|test match|odi|t20|the ashes|big bash)\b/i],
  ['Rugby', /\b(rugby|six nations|super rugby|premiership rugby|nrl|super league)\b/i],
  ['Combat', /\b(ufc|boxing|mma|wwe|bellator|fight night|pfl)\b/i],
  ['Ice hockey', /\b(nhl|ice hockey|khl)\b/i],
  ['Baseball', /\b(mlb|baseball)\b/i],
  ['Cycling', /\b(cycling|tour de france|giro|vuelta)\b/i],
  ['Darts and snooker', /\b(darts|snooker|pdc)\b/i],
];
const SPORT_CH = /(sport|football|soccer|espn|bein|dazn|tnt sports|sky sports|eurosport|premier|laliga|nba|nfl|nhl|mlb|f1|racing|golf|tennis|cricket|rugby|boxing|ufc|arena|supersport|movistar deportes|bt sport|setanta|fox sports|dazn)/i;
const MATCHUP = /\s(v|vs\.?|versus|@|-)\s/i;
function sportOf(text) { for (const [name, re] of SPORTS) if (re.test(text)) return name; return ''; }
function sportsEvents() {
  const now = Date.now(), from = now - 4 * 3600e3, to = now + 36 * 3600e3;
  const map = new Map();
  for (const c of S.live) {
    if (!c.epgKey) continue;
    const chSporty = SPORT_CH.test(c.group + ' ' + c.name);
    for (const p of progs(c)) {
      if (p.stop < from || p.start > to) continue;
      const t = p.title;
      const looksLive = /^\s*(live|en directo|en vivo|direct)\b[:\s-]*/i.test(t) || /\(live\)|\s[-–|]\s*live\s*$|^live\s/i.test(t);
      const matchup = MATCHUP.test(t.replace(/^\s*live[:\s-]*/i, ''));
      const sport = sportOf(t + ' ' + (p.desc || '').slice(0, 200)) || (chSporty ? sportOf(c.group + ' ' + c.name) : '');
      if (!(chSporty && (looksLive || matchup)) && !(sport && (looksLive || matchup))) continue;
      if (/\b(highlights|review|preview|magazine|news|classic|replay|best of|countdown|weekly|show)\b/i.test(t) && !looksLive) continue;
      const title = t.replace(/^\s*(live|en directo|en vivo|direct)\b[:\s-]*/i, '').replace(/\(live\)/i, '').trim();
      const k = norm(title) + '|' + Math.round(p.start / 9e5);
      let ev = map.get(k);
      if (!ev) map.set(k, ev = { id: k, title, start: p.start, stop: p.stop, sport: sport || 'Other', desc: p.desc || '', chans: [] });
      if (!ev.chans.some(x => x.c.key === c.key)) ev.chans.push({ c, p });
    }
  }
  return [...map.values()].sort((a, b) => a.start - b.start);
}
const SP = { sport: 'All', favOnly: false, results: null, resultsDay: '' };
async function sportsResults() {
  const d = new Date().toISOString().slice(0, 10);
  if (SP.resultsDay === d && SP.results) return SP.results;
  SP.resultsDay = d; SP.results = [];
  const key = INT().sportsdbKey || '3';
  for (const sp of ['Soccer', 'Basketball', 'Ice Hockey', 'American Football']) {
    try {
      const r = await request(`${API.sportsdb}/${encodeURIComponent(key)}/eventsday.php?d=${d}&s=${encodeURIComponent(sp)}`);
      for (const e of (r && r.events) || []) SP.results.push({ home: e.strHomeTeam || '', away: e.strAwayTeam || '', hs: e.intHomeScore, as: e.intAwayScore, status: e.strStatus || '', progress: e.strProgress || '', league: e.strLeague || '', sport: sp });
    } catch {}
  }
  return SP.results;
}
function scoreFor(ev) {
  if (!SP.results || ev.start > Date.now()) return null; // never show a score on a later airing
  const n = norm(ev.title);
  return SP.results.find(r => r.home && r.away && n.includes(norm(r.home).slice(0, 10)) && n.includes(norm(r.away).slice(0, 10))) || null;
}
function sports() {
  if (needData()) return;
  const all = sportsEvents();
  const now = Date.now();
  const sportsList = ['All', ...new Set(all.map(e => e.sport))];
  if (!sportsList.includes(SP.sport)) SP.sport = 'All';
  const evs = all.filter(e => (SP.sport === 'All' || e.sport === SP.sport) && (!SP.favOnly || e.chans.some(x => S.favs.has(x.c.key))));
  const hide = !!S.cfg.hideScores;
  const live = evs.filter(e => e.start <= now && e.stop > now), today = evs.filter(e => e.start > now && day(e.start) === day(now)), later = evs.filter(e => e.start > now && day(e.start) !== day(now)), done = evs.filter(e => e.stop <= now).reverse();
  const card = e => {
    const sc = scoreFor(e), onNow = e.start <= now && e.stop > now;
    return `<div class="evcard ${onNow ? 'live' : ''}"><div class="evtop"><span class="kicker">${esc(e.sport)}${sc && sc.league ? ' · ' + esc(sc.league) : ''}</span>
      <span class="evtime">${onNow ? '<span class="livedot"></span>Live' : e.stop <= now ? 'Finished' : (day(e.start) === day(now) ? '' : day(e.start) + ' ') + hhmm(e.start)}</span></div>
      <b class="evtitle">${esc(e.title)}</b>
      ${sc && (sc.hs != null && sc.hs !== '') ? `<div class="score ${hide ? 'blur' : ''}" title="${hide ? 'Click to reveal' : ''}">${esc(sc.hs)} – ${esc(sc.as)}<small>${esc(sc.progress ? sc.progress + "'" : sc.status)}</small></div>` : ''}
      ${onNow ? `<span class="bar"><i style="width:${pct(e).toFixed(1)}%"></i></span>` : ''}
      <div class="evchans">${e.chans.slice(0, 6).map(({ c, p }) => e.stop <= now && canCatchup(c, p) ? `<button class="evch" data-cu="${esc(c.key)}" data-pi="${progs(c).indexOf(p)}">${img(c.logo, c.name, 'logo')}<span>↺ ${esc(c.name)}</span></button>`
        : `<button class="evch" ${onNow ? `data-play="${esc(c.key)}"` : `data-prog="${esc(c.key)}" data-pi="${progs(c).indexOf(p)}"`}>${img(c.logo, c.name, 'logo')}<span>${esc(c.name)}</span></button>`).join('')}${e.chans.length > 6 ? `<small class="dim">+${e.chans.length - 6} more</small>` : ''}</div></div>`;
  };
  const sec = (t, list) => list.length ? `<section class="sec"><h2>${t} <span class="dim" style="font-weight:400">${list.length}</span></h2><div class="evgrid">${list.map(card).join('')}</div></section>` : '';
  view.innerHTML = `<div class="pagehead"><h1>Sports</h1><div class="tools">
    <div class="tabs" style="margin:0">${sportsList.map(s => `<button class="tab ${s === SP.sport ? 'on' : ''}" data-sport="${esc(s)}">${esc(s)}</button>`).join('')}</div>
    <label class="check"><input type="checkbox" id="spfav" ${SP.favOnly ? 'checked' : ''}> Favourite channels only</label>
    <label class="check"><input type="checkbox" id="sphide" ${hide ? 'checked' : ''}> Hide scores</label></div></div>
    ${sec('Live now', live)}${sec('Later today', today)}${sec('Tomorrow', later)}${sec('Earlier', done)}
    ${evs.length ? '' : `<div class="empty" style="margin-top:4vh"><h1>No sport found in your guide</h1><p>${S.epg.size ? 'Sports events are found in the programme guide of your own channels. None are on in the next 36 hours, or your sports channels have no guide data.' : 'The programme guide has not loaded yet. Sports events come from your channels\' guide.'}</p></div>`}
    <p class="hint" style="padding:0 36px 36px">Events come from the guide of channels in your own playlists, so Orbit never adds a channel you do not have. Scores from TheSportsDB.</p>`;
  $$('[data-sport]').forEach(b => b.onclick = () => { SP.sport = b.dataset.sport; render(); });
  $('#spfav').onchange = e => { SP.favOnly = e.target.checked; render(); };
  $('#sphide').onchange = e => { S.cfg.hideScores = e.target.checked; saveCfg(); render(); };
  $$('.score.blur').forEach(s => s.onclick = () => s.classList.remove('blur'));
  if (!SP.results) sportsResults().then(() => { if (S.view === 'sports') render(); });
}

/* ============================ Chromecast ============================ */
const CAST = { state: '', device: '' };
const canCast = () => !!(DESK || canSystemPlayer());
castButton = () => '';
function castUrl(u) { return /\/live\/[^/]+\/[^/]+\/\d+\.ts(\?|$)/i.test(u) ? u.replace(/\.ts(\?|$)/i, '.m3u8$1') : u; }
async function castMenu() {
  const it = OP.item; if (!it) return;
  if (!DESK) {
    // Phones and Fire TV: the system player has a Cast button built in.
    const list = OP.list; closePlayer(true); playSystem(it, list); toast('Use the Cast icon in the player'); return;
  }
  modal(`<h2>Cast to a TV</h2><p class="hint">Chromecast and Google TV devices on your network.</p><div class="picklist" id="castl"><p class="dim"><span class="spin"></span>Looking for devices…</p></div>
    <p class="hint" style="margin-top:12px">Chromecast plays the stream directly from your provider, so recordings on this computer and some formats cannot be cast.</p>`, 'narrow');
  const draw = async () => {
    const box = $('#castl'); if (!box) return false;
    const devs = await DESK.cast.devices();
    box.innerHTML = devs.map(d => `<button class="chrow" style="grid-template-columns:1fr" data-castdev="${esc(d.id)}"><span><b>${esc(d.name)}</b><small>${esc(d.model || d.host)}</small></span></button>`).join('') || '<p class="dim"><span class="spin"></span>Looking for devices… Make sure the TV is on the same Wi-Fi.</p>';
    $$('[data-castdev]', box).forEach(b => b.onclick = async () => {
      b.innerHTML = '<span><b>Connecting…</b></span>';
      try {
        const url = castUrl(await resolveUrl(it));
        const live = it.kind === 'live';
        const r = await DESK.cast.play({ deviceId: b.dataset.castdev, url, title: it.name, subtitle: it.sub || it.group || '', image: it.poster || it.logo || '', live, startAt: live ? 0 : OP.v.currentTime || 0 });
        CAST.device = r.device; CAST.item = it; closeModal(); OP.player.stop(); showCastBar();
      } catch (e) { toast(`Cast: ${friendly(e)}`, true); draw(); }
    });
    return true;
  };
  await draw();
  const t = setInterval(async () => { if (!(await draw())) clearInterval(t); }, 2500);
}
function showCastBar() {
  $('#opmsg').hidden = false; $('#opmsg').classList.remove('err');
  $('#opmsg').innerHTML = `<div class="castbar"><b>Casting to ${esc(CAST.device)}</b><small id="caststate">${esc(CAST.state || 'Starting…')}</small>
    <div class="row" style="justify-content:center;margin-top:12px"><button class="btn ghost" data-castctl="pause">Pause</button><button class="btn ghost" data-castctl="play">Play</button><button class="btn pri" data-castctl="stop">Stop casting</button></div></div>`;
  $$('[data-castctl]').forEach(b => b.onclick = async () => {
    await DESK.cast.control(b.dataset.castctl).catch(() => {});
    if (b.dataset.castctl === 'stop') { CAST.device = ''; $('#opmsg').hidden = true; if (OP.item) playOverlay(OP.item); }
  });
}
if (DESK) DESK.on('castStatus', st => { CAST.state = st.state === 'PLAYING' ? 'Playing' : st.state === 'PAUSED' ? 'Paused' : st.state === 'BUFFERING' ? 'Buffering…' : st.state === 'error' ? `Error: ${st.error}` : st.state === 'IDLE' ? 'Stopped' : st.state; const el = $('#caststate'); if (el) el.textContent = CAST.state; });
$('#opcast').hidden = !canCast();
$('#opcast').onclick = () => castMenu();

/* ============================ cross-device sync (through Orbit Server) ============================ */
const SHARED_CFG = ['pin', 'locked', 'notLocked', 'autoLock', 'epgMap', 'extraEpg', 'epgOffset', 'refreshHours', 'askProfile', 'int', 'hideScores'];
const syncable = k => k === 'sources' || k === 'profiles' || k === 'cfg' || /^(favs|recent|pos|reminders)\./.test(k);
const SYNC = { meta: store.get('syncMeta', {}), applying: false, pushT: 0, last: store.get('syncLast', 0), busy: false };
const syncOn = () => srvOn() && !!(S.cfg.sync && S.cfg.sync.on);
const syncAccount = () => (S.cfg.sync && S.cfg.sync.account) || 'default';
// Called by store.set for every write: remember when each shared key changed, then push soon.
function noteChange(k) {
  try { if (SYNC.applying || !syncable(k)) return; } catch { return; } // called before sync is set up
  SYNC.meta[k] = Date.now();
  try { localStorage.setItem('orbit.syncMeta', JSON.stringify(SYNC.meta)); } catch {}
  if (syncOn()) { clearTimeout(SYNC.pushT); SYNC.pushT = setTimeout(syncNow, 3000); }
}
function localValue(k) {
  const v = store.get(k, null);
  if (k === 'cfg' && v) { const o = {}; for (const f of SHARED_CFG) if (f in v) o[f] = v[f]; return o; }
  return v;
}
async function syncNow() {
  if (!syncOn() || SYNC.busy) return;
  SYNC.busy = true;
  try {
    const remote = await srv(`/api/sync/${encodeURIComponent(syncAccount())}`);
    let changed = false;
    SYNC.applying = true;
    for (const [k, rec] of Object.entries((remote && remote.data) || {})) {
      if (!syncable(k) || !rec || !(+rec.t > (SYNC.meta[k] || 0))) continue;
      if (k === 'cfg') S.cfg = Object.assign(S.cfg, rec.v || {}), store.set('cfg', S.cfg);
      else store.set(k, rec.v);
      SYNC.meta[k] = +rec.t; changed = true;
    }
    SYNC.applying = false;
    // Push everything newer than what the server has
    const out = {};
    for (const k of Object.keys(localStorage).filter(x => x.startsWith('orbit.')).map(x => x.slice(6))) {
      if (!syncable(k)) continue;
      const t = SYNC.meta[k] || 1;
      const r = remote && remote.data && remote.data[k];
      if (!r || t > +r.t) out[k] = { t, v: localValue(k) };
    }
    if (Object.keys(out).length) await srv(`/api/sync/${encodeURIComponent(syncAccount())}`, { method: 'PUT', body: { data: out } });
    SYNC.last = Date.now(); store.set('syncMeta', SYNC.meta); store.set('syncLast', SYNC.last);
    if (changed) {
      const before = JSON.stringify(S.sources.map(s => [s.id, s.url, s.server, s.user, s.portal, s.off]));
      loadState(); applyFilters(); renderRail();
      if (JSON.stringify(S.sources.map(s => [s.id, s.url, s.server, s.user, s.portal, s.off])) !== before) loadAll();
      else if (OP.el.hidden && !pvPlayer && !mvPlayers.length) render();
      toast('Synced from your other devices');
    }
    const st = $('#syncstatus'); if (st) st.textContent = `Last synced ${hhmm(SYNC.last)}`;
  } catch (e) {
    SYNC.applying = false;
    const st = $('#syncstatus'); if (st) st.textContent = `Sync failed: ${friendly(e)}`;
  } finally { SYNC.busy = false; }
}
SETTINGS_EXTRA.push({ order: 61, html: () => srvOn() ? `<section><h2>Sync between devices</h2>
  <label class="check"><input type="checkbox" id="syncon" ${syncOn() ? 'checked' : ''}> Keep playlists, profiles, favourites, resume points, reminders and settings the same on every device that uses this Orbit Server</label>
  <div class="row" style="margin-top:8px"><label>Account name <input type="text" id="syncacct" value="${esc(syncAccount())}" style="width:180px" autocomplete="off"></label><button class="btn ghost" id="syncgo">Sync now</button></div>
  <p class="hint" id="syncstatus">${SYNC.last ? `Last synced ${day(SYNC.last)} ${hhmm(SYNC.last)}` : 'Not synced yet.'} Use the same account name on each device. Playlists opened from a file are not synced.</p></section>` : '',
  bind: () => {
    const on = $('#syncon'); if (!on) return;
    on.onchange = e => { S.cfg.sync = { ...(S.cfg.sync || {}), on: e.target.checked }; saveCfg(); if (e.target.checked) syncNow(); };
    $('#syncacct').onchange = e => { S.cfg.sync = { ...(S.cfg.sync || {}), account: e.target.value.trim().replace(/[^\w.-]/g, '') || 'default' }; saveCfg(); };
    $('#syncgo').onclick = () => syncNow();
  } });

/* ============================ modal ============================ */
let modalReturn = null;
function modal(html, cls = '') {
  modalReturn = document.activeElement;
  const m = $('#modal');
  m.innerHTML = `<div class="mbox ${cls}" role="dialog" aria-modal="true"><button class="x" data-close aria-label="Close">✕</button>${html}</div>`;
  m.hidden = false;
  setTimeout(() => { const f = m.querySelector('input,.btn,button:not(.x)'); if (f) f.focus(); }, 0);
}
function closeModal() { const m = $('#modal'); m.hidden = true; m.innerHTML = ''; if (modalReturn && document.contains(modalReturn)) modalReturn.focus(); }
$('#modal').addEventListener('mousedown', e => { if (e.target.id === 'modal') closeModal(); });

/* ============================ events ============================ */
document.addEventListener('click', e => {
  const t = e.target.closest('[data-v],[data-play],[data-playnow],[data-open],[data-fav],[data-ch],[data-grp],[data-go],[data-add],[data-close],[data-morech],[data-gshift],[data-gmore],[data-prog],[data-mvpick],[data-mvx],[data-mvl],[data-pick],[data-srcedit],[data-srcdel],[data-srctoggle],[data-more],[data-sysplay],[data-pvsys],[data-unlock],[data-addsrc],[data-cu],[data-remind],[data-match],[data-epgpick],[data-profiles],[data-prof],[data-profedit],[data-profdel],[data-rec],[data-pin],[data-dlkey],[data-dlplaykey]');
  if (!t) return;
  const d = t.dataset;
  if (d.more !== undefined) return moreSheet();
  if (d.unlock !== undefined) return unlockFlow();
  if (d.addsrc !== undefined) return sourceChooser();
  if (d.cu) { const c = S.all.live.find(x => x.key === d.cu), pr = progs(c)[+d.pi]; if (d.close !== undefined) closeModal(); const it = c && pr && catchupItem(c, pr); return it ? openPlayer(it, [it]) : toast('Catch-up is not available for this programme.', true); }
  if (d.remind) { const c = S.index.get(d.remind), pr = progs(c)[+d.pi]; if (d.close !== undefined) closeModal(); toggleReminder(c, pr); if (S.view === 'live') renderPreviewMeta(); else if (S.view === 'guide') render(); return; }
  if (d.match) return matchGuide(d.match);
  if (d.epgpick !== undefined) return setGuideMatch(d.chkey, d.epgpick);
  if (d.profiles !== undefined) return profilePicker();
  if (d.prof) return switchProfile(d.prof);
  if (d.profedit !== undefined) return profileForm(d.profedit);
  if (d.profdel) return deleteProfile(d.profdel, t);
  if (d.rec !== undefined) return recordAction(t);
  if (d.pin !== undefined) return pinSettings();
  if (d.dlkey) { const it = S.index.get(d.dlkey); return void startDownload(it).then(() => { t.textContent = 'Downloading…'; t.disabled = true; }); }
  if (d.dlplaykey) { const dl = downloadOf(d.dlplaykey); closeModal(); return void downloadItem(dl).then(it => openPlayer(it, [it])); }
  if (d.sysplay !== undefined) { const it = OP.item, l = OP.list; closePlayer(true); return void playSystem(it, l); }
  if (d.pvsys !== undefined) { const c = S.index.get(LV.cur); if (pvPlayer) pvPlayer.stop(); return void playSystem(c, liveList()); }
  if (d.fav !== undefined) {
    e.stopPropagation(); toggleFav(d.fav);
    if (d.favbtn !== undefined) { t.classList.toggle('pri', S.favs.has(d.fav)); t.classList.toggle('ghost', !S.favs.has(d.fav)); }
    return;
  }
  if ((d.v || d.go) && d.close !== undefined) closeModal();
  if (d.v) return go(d.v);
  if (d.go) return go(d.go);
  if (d.add) { closeModal(); return sourceForm(d.add); }
  if (d.playnow) { closeModal(); const x = S.index.get(d.playnow); return openPlayer(x, [x]); }
  if (d.play) {
    const x = S.index.get(d.play); if (d.close !== undefined) closeModal();
    if (!x) return;
    if (x.kind === 'series') return openDetail(x.key);
    if (x.kind === 'movie') return openPlayer(x, [x]);
    const ctx = S.view === 'live' ? liveList() : S.view === 'guide' ? S.live.filter(c => c.epgKey && (GV.group === 'All' || (GV.group === '★' ? S.favs.has(c.key) : c.group === GV.group))) : S.view === 'favs' || S.view === 'home' ? (S.favs.has(x.key) ? S.live.filter(c => S.favs.has(c.key)) : S.live.filter(c => c.group === x.group)) : S.live.filter(c => c.group === x.group);
    return openPlayer(x, ctx.includes(x) ? ctx : [x]);
  }
  if (d.close !== undefined) return closeModal();
  if (d.open) return openDetail(d.open);
  if (d.ch && S.cfg.player === 'system' && canSystemPlayer()) { const c = S.index.get(d.ch); LV.cur = d.ch; $$('.chrow').forEach(r => r.classList.toggle('on', r.dataset.ch === d.ch)); renderPreviewMeta(); return void playSystem(c, liveList()); }
  if (d.ch) { const c = S.index.get(d.ch); if (LV.cur === d.ch && pvPlayer && pvPlayer.v.currentSrc) return openPlayer(c, liveList()); return previewPlay(c); }
  if (d.grp) return setGroup(d.grp);
  if (d.morech !== undefined) { LV.limit += 300; return renderChannelList(); }
  if (d.gshift) { GV.t0 = d.gshift === '0' ? null : (GV.t0 ?? guideNowT0()) + +d.gshift * 3 * 36e5; return render(); }
  if (d.gmore !== undefined) { GV.limit += 150; return render(); }
  if (d.prog) return progDetail(d.prog, +d.pi);
  if (d.mvl) { S.cfg.mvLayout = +d.mvl; saveCfg(); stopViewPlayers(); return render(); }
  if (d.mvpick) return pickChannel(+d.mvpick);
  if (d.mvx) { S.cfg.multi[+d.mvx] = null; saveCfg(); stopViewPlayers(); return render(); }
  if (d.pick) { S.cfg.multi[+d.slot] = d.pick; MVaudio = +d.slot; saveCfg(); closeModal(); stopViewPlayers(); return render(); }
  if (d.srcedit) { const s = S.sources.find(x => x.id === d.srcedit); return s && sourceForm(s.type, s); }
  if (d.srctoggle) { const s = S.sources.find(x => x.id === d.srctoggle); if (s) { s.off = !s.off; saveSources(); loadAll().then(() => S.view === 'settings' && render()); render(); } return; }
  if (d.srcdel) {
    if (t.dataset.armed) {
      S.sources = S.sources.filter(x => x.id !== d.srcdel); store.del('file.' + d.srcdel); fileText.delete(d.srcdel);
      saveSources(); toast('Playlist removed'); loadAll().then(() => S.view === 'settings' && render()); return render();
    }
    t.dataset.armed = '1'; t.textContent = 'Confirm remove'; t.classList.add('pri'); setTimeout(() => { if (document.contains(t)) { delete t.dataset.armed; t.textContent = 'Remove'; t.classList.remove('pri'); } }, 4000);
  }
});

// Spatial (D-pad) navigation
function spatial(dir, root = document) {
  const a = document.activeElement;
  const els = $$('button,a[href],input,select,textarea,label[tabindex="0"]', root).filter(e => e.offsetParent !== null && !e.disabled && !e.closest('[hidden]'));
  if (!els.length) return;
  if (!a || a === document.body || a === view || !root.contains(a)) { els[0].focus(); return; }
  const r = a.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const horiz = dir === 'ArrowLeft' || dir === 'ArrowRight';
  let best = null, bd = Infinity;
  for (const e of els) {
    if (e === a) continue;
    const b = e.getBoundingClientRect(); if (!b.width && !b.height) continue;
    const x = b.left + b.width / 2, y = b.top + b.height / 2, dx = x - cx, dy = y - cy;
    const ok = dir === 'ArrowRight' ? b.left >= r.right - 4 : dir === 'ArrowLeft' ? b.right <= r.left + 4 : dir === 'ArrowDown' ? b.top >= r.bottom - 4 : b.bottom <= r.top + 4;
    if (!ok) continue;
    const dist = (horiz ? Math.abs(dx) : Math.abs(dy)) + (horiz ? Math.abs(dy) : Math.abs(dx)) * 3;
    if (dist < bd) { bd = dist; best = e; }
  }
  if (best) { best.focus({ preventScroll: true }); best.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
}
document.addEventListener('keydown', e => {
  if (!OP.el.hidden && $('#modal').hidden) return opKey(e);
  const a = document.activeElement, tag = a && a.tagName;
  const arrow = e.key.startsWith('Arrow');
  const modalOpen = !$('#modal').hidden;
  if (e.key === 'Escape' || e.key === 'GoBack' || (e.key === 'Backspace' && tag !== 'INPUT' && tag !== 'TEXTAREA')) {
    if (tag === 'INPUT' || tag === 'TEXTAREA') { a.blur(); return; }
    e.preventDefault(); if (modalOpen || document.body.classList.contains('tv') || e.key !== 'Escape') back(); return;
  }
  const tvSelect = tag === 'SELECT' && document.body.classList.contains('tv') && arrow;
  const typing = !tvSelect && (tag === 'TEXTAREA' || tag === 'SELECT' || (tag === 'INPUT' && a.type !== 'file'));
  if (typing) {
    if (tag === 'INPUT' && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); spatial(e.key, modalOpen ? $('#modal') : document); }
    return;
  }
  if (e.key === '/' ) { e.preventDefault(); return go('search'); }
  if (arrow) { e.preventDefault(); return spatial(e.key, modalOpen ? $('#modal') : document); }
  if ((e.key === 'f' || e.key === 'F') && a) { const k = a.dataset.ch || a.dataset.play || a.dataset.open; if (k) { toggleFav(k); if (S.view === 'live') renderPreviewMeta(); } }
  if (e.key === 'Enter' && tag === 'LABEL') a.click();
});

// Clock and guide ticker
function tick() {
  $('#clock').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
tick(); setInterval(tick, 15000);
setInterval(() => { if (S.epg.size && document.visibilityState === 'visible') softRefresh(); }, 60000);
window.addEventListener('hashchange', () => { const v = location.hash.slice(1); if (v !== S.view && views[v]) go(v); });

/* ============================ device integration ============================ */
let DEVICE_TV = false;
function applyLayout() {
  const l = S.cfg.layout;
  const tv = l === 'tv' || (l === 'auto' && DEVICE_TV);
  const touch = !tv && (l === 'touch' || (l === 'auto' && navigator.maxTouchPoints > 0 && matchMedia('(pointer: coarse)').matches));
  document.body.classList.toggle('tv', tv);
  document.body.classList.toggle('touch', touch);
  document.body.classList.toggle('desk', !tv && !touch);
}
function moreSheet() {
  const items = [['guide', 'Guide'], ['sports', 'Sports'], ['favs', 'Favourites'], ['library', 'Recordings & downloads'], ['multi', 'Multiview'], ['settings', 'Settings']];
  modal(`<h2>More</h2><div class="morelist">${items.map(([v, l]) => `<button class="btn ghost" data-v="${v}" data-close>${l}</button>`).join('')}
    <button class="btn ghost" data-profiles>${avatar(PROF.active, 26)} Switch profile</button></div>`, 'narrow sheet');
}
// One "back" for the Android/Fire TV back button, Escape and Backspace
function back() {
  if (!$('#modal').hidden) return closeModal();
  if (!OP.el.hidden) return closePlayer();
  if (S.view !== 'home') return go('home');
  if (P.app) P.app.minimizeApp ? P.app.minimizeApp().catch(() => P.app.exitApp()) : P.app.exitApp();
}
// Keep the screen awake while anything is playing
let awake = false;
function updateAwake() {
  if (!NATIVE || !P.awake) return;
  const playing = $$('video').some(v => !v.paused && !v.ended && v.readyState > 2);
  if (playing !== awake) { awake = playing; (playing ? P.awake.keepAwake() : P.awake.allowSleep()).catch(() => {}); }
}
['playing', 'pause', 'ended', 'emptied'].forEach(ev => document.addEventListener(ev, () => setTimeout(updateAwake, 50), true));

async function boot() {
  await store.restore();
  loadState();
  if (NATIVE) {
    try {
      const info = P.device ? await P.device.getInfo() : {};
      // Fire TV models start with "AFT"; other Android TVs have no touch screen.
      DEVICE_TV = PLATFORM === 'android' && (/^AFT/i.test(info.model || '') || /tv|box|shield/i.test(info.model || '') || navigator.maxTouchPoints === 0);
    } catch {}
    if (P.app) {
      P.app.addListener('backButton', back);
      P.app.addListener('pause', () => { if (pvPlayer) pvPlayer.stop(); mvPlayers.forEach(p => p && p.stop()); });
      P.app.addListener('resume', () => { syncNow(); if (S.view === 'live' && LV.cur && pvPlayer) previewPlay(S.index.get(LV.cur)); else if (S.view === 'multi') render(); });
    }
    if (P.status && !DEVICE_TV) { P.status.setStyle({ style: 'DARK' }).catch(() => {}); if (PLATFORM === 'android') P.status.setBackgroundColor({ color: '#05060B' }).catch(() => {}); }
    if (IS_PHONE && P.orient) P.orient.lock({ orientation: 'portrait' }).catch(() => {});
    if (DEVICE_TV && S.cfg.player === 'auto' && !store.get('tvDefaultSet', false)) { S.cfg.player = 'system'; saveCfg(); store.set('tvDefaultSet', true); }
  }
  document.body.classList.add('p-' + PLATFORM);
  applyLayout();
  applyFilters();
  renderRail();
  go(location.hash.slice(1) || 'home');
  if (S.sources.length) loadAll();
  if (PROF.list.length > 1 && S.cfg.askProfile) profilePicker(true);
  setInterval(checkReminders, 20000); setTimeout(checkReminders, 3000);
  srvRefresh().then(() => syncNow()); jobsRefresh(); setInterval(() => { if (srvOn()) srvRefresh(); }, 60000);
  setInterval(() => syncNow(), 120000);
  // Refresh playlists in the background on the chosen schedule, when nothing is playing
  setInterval(() => { const h = +S.cfg.refreshHours; if (h && S.lastLoad && Date.now() - S.lastLoad > h * 3600e3 && OP.el.hidden && !mvPlayers.length && !S.loading) loadAll(); }, 10 * 60e3);
  const ln = LN();
  if (ln) ln.addListener('localNotificationActionPerformed', a => { const x = a && a.notification && a.notification.extra; const c = x && (S.index.get(x.ch) || S.live.find(i => i.mkey === x.mkey)); if (c) openPlayer(c, [c]); }).catch(() => {});
  if (document.body.classList.contains('tv')) setTimeout(() => { const f = $('.nav.on'); if (f) f.focus(); }, 300);
}
boot();
window.__orbit = { S, PROF, parseM3U, parseXMLTV, linkEpg, streamUrl, checkReminders, applyFilters, catchupUrl }; // handy for debugging in DevTools
}
