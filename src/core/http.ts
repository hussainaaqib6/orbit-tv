// HTTP for playlists, guides and APIs.
// IPTV servers almost never send CORS headers, so on phones/TVs requests go through the native
// HTTP stack, and on desktop through Electron's main process. Plain fetch is the browser fallback.
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { OrbitPlayer } from './native';
import { NATIVE, PLATFORM, PLAYER_UA } from './platform';

export class HttpError extends Error {
  constructor(message: string, public status: number, public body = '') { super(message); }
}

type ResponseType = 'json' | 'text' | 'bytes';
export interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  /** Android: report download progress under this id (see loadState). */
  progressId?: string;
}

export const hostOf = (u: string) => { try { return new URL(u).host; } catch { return u; } };

function encodeBody(body: unknown, headers: Record<string, string>): string | undefined {
  if (body == null) return undefined;
  if (typeof body === 'string') return body;
  if (body instanceof URLSearchParams) { headers['Content-Type'] ??= 'application/x-www-form-urlencoded'; return body.toString(); }
  headers['Content-Type'] ??= 'application/json';
  return JSON.stringify(body);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/\s/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

interface RawResponse { status: number; data: string | Uint8Array; headers: Record<string, string> }

const lowerKeys = (h: Record<string, string> | undefined) =>
  Object.fromEntries(Object.entries(h ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)]));

async function raw(url: string, o: RequestOptions, type: 'text' | 'bytes'): Promise<RawResponse> {
  const method = o.method ?? 'GET';
  const headers: Record<string, string> = { Accept: '*/*', ...o.headers };
  const body = encodeBody(o.body, headers);

  if (NATIVE) {
    headers['User-Agent'] ??= PLAYER_UA;
    const r = await CapacitorHttp.request({
      url, method, headers, data: body,
      responseType: type === 'bytes' ? 'blob' : 'text',
      connectTimeout: o.timeoutMs ?? 20000, readTimeout: 180000,
    });
    let data: string | Uint8Array;
    if (type === 'bytes') data = typeof r.data === 'string' ? base64ToBytes(r.data) : new TextEncoder().encode(JSON.stringify(r.data));
    else data = typeof r.data === 'string' ? r.data : JSON.stringify(r.data); // small replies only (Android GETs use nativeGet)
    return { status: r.status, data, headers: lowerKeys(r.headers) };
  }
  if (PLATFORM === 'electron' && window.orbitDesktop) {
    const r = await window.orbitDesktop.request({ url, method, headers, body, type });
    return { ...r, headers: lowerKeys(r.headers) };
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), o.timeoutMs ?? 60000);
  try {
    const r = await fetch(url, { method, headers, body: method === 'GET' ? undefined : body, cache: 'no-store', signal: ctrl.signal });
    const h: Record<string, string> = {};
    r.headers.forEach((v, k) => { h[k.toLowerCase()] = v; });
    return { status: r.status, data: type === 'bytes' ? new Uint8Array(await r.arrayBuffer()) : await r.text(), headers: h };
  } finally {
    clearTimeout(t);
  }
}

function check(url: string, r: RawResponse) {
  if (r.status >= 400 || r.status === 0) {
    const body = typeof r.data === 'string' ? r.data.slice(0, 500) : '';
    throw new HttpError(`HTTP ${r.status} from ${hostOf(url)}`, r.status, body);
  }
}

/** Response headers only (lower-case keys). */
export async function head(url: string): Promise<Record<string, string>> {
  const r = await raw(url, { method: 'HEAD', headers: { 'User-Agent': PLAYER_UA }, timeoutMs: 15000 }, 'text');
  check(url, r);
  return r.headers;
}

/** A byte range of a remote file, and the file's total size (from Content-Range). */
export async function getRange(url: string, start: number, length: number): Promise<{ bytes: Uint8Array; total: number }> {
  const r = await raw(url, { headers: { Range: `bytes=${start}-${start + length - 1}`, 'User-Agent': PLAYER_UA } }, 'bytes');
  check(url, r);
  const m = /\/(\d+)\s*$/.exec(r.headers['content-range'] ?? '');
  const bytes = r.data as Uint8Array;
  const total = m ? +m[1] : r.status === 200 ? bytes.length : 0;
  // A server that ignores Range sends the whole file; keep only what was asked for.
  return { bytes: r.status === 200 ? bytes.subarray(start, start + length) : bytes, total };
}

export async function getBytes(url: string, o: RequestOptions = {}): Promise<Uint8Array> {
  if (useNativeGet(o)) return new Uint8Array(await (await nativeGet(url, o)).arrayBuffer());
  const r = await raw(url, o, 'bytes');
  check(url, r);
  return r.data as Uint8Array;
}

/** Text, transparently un-gzipping .gz guides. */
export async function getText(url: string, o: RequestOptions = {}): Promise<string> {
  const b = await getBytes(url, o);
  if (b[0] === 0x1f && b[1] === 0x8b) {
    if (typeof DecompressionStream === 'undefined') throw new Error('This device cannot unpack .gz guides. Use an uncompressed .xml link.');
    const stream = new Blob([b as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).text();
  }
  return new TextDecoder().decode(b);
}

let downloadN = 0;

/**
 * Android: GET into a cache file natively, then let the WebView read it. This avoids Capacitor's HTTP
 * layer, which parses JSON natively and copies the whole result across the bridge (very slow for big
 * Xtream lists on a Fire TV Stick).
 */
async function nativeGet(url: string, o: RequestOptions): Promise<Response> {
  const r = await OrbitPlayer.download({ url, name: `dl${downloadN++ % 8}`, headers: o.headers, timeoutMs: o.timeoutMs ?? 120000, progressId: o.progressId });
  if (r.status >= 400 || r.status === 0) {
    let body = '';
    try { body = (await (await fetch(Capacitor.convertFileSrc(r.path))).text()).slice(0, 500); } catch {}
    throw new HttpError(`HTTP ${r.status} from ${hostOf(url)}`, r.status, body);
  }
  return fetch(Capacitor.convertFileSrc(r.path), { cache: 'no-store' });
}
const useNativeGet = (o: RequestOptions) => PLATFORM === 'android' && (o.method ?? 'GET') === 'GET' && !o.body;

export async function request<T = unknown>(url: string, o: RequestOptions = {}, type: ResponseType = 'json'): Promise<T> {
  const headers = { Accept: type === 'json' ? 'application/json' : '*/*', ...o.headers };
  if (type === 'bytes') return getBytes(url, { ...o, headers }) as Promise<T>;
  if (useNativeGet(o)) {
    const res = await nativeGet(url, { ...o, headers });
    const text = await res.text();
    if (type === 'text') return text as T;
    try { return (text ? JSON.parse(text) : null) as T; } catch { throw new Error(`Unexpected reply from ${hostOf(url)}`); }
  }
  const r = await raw(url, { ...o, headers }, 'text');
  check(url, r);
  const text = r.data as string;
  if (type === 'text') return text as T;
  try {
    return (text ? JSON.parse(text) : null) as T;
  } catch {
    throw new Error(`Unexpected reply from ${hostOf(url)}`);
  }
}

export function friendlyError(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err);
  if (/Failed to fetch|NetworkError|Load failed|aborted|timed? ?out|UnknownHost|ECONN|ENOTFOUND/i.test(m)) {
    return 'Could not reach the server. Check the address and your connection.';
  }
  return m;
}
