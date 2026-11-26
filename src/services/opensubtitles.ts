// OpenSubtitles.com REST API.
// Subtitles are matched by the video's OpenSubtitles hash first: a hash match was made for that exact
// file, so it lines up. Name matches come after, ranked by how close the release name is.
import { getRange, head, request, HttpError } from '../core/http';
import { defaults } from '../core/platform';
import { settings, updateSettings } from '../sources/library';

const API = 'https://api.opensubtitles.com/api/v1';
let token = '';

export const osKey = () => settings.value.osKey || defaults.osKey || '';
export const osAvailable = () => !!osKey();

const headers = () => ({
  'Api-Key': osKey(),
  'X-User-Agent': 'MatrixTV v2.0.0',
  ...(token ? { Authorization: 'Bearer ' + token } : {}),
});

const CHUNK = 65536;

/** OpenSubtitles hash: file size + the 64-bit little-endian sums of the first and last 64 KB. */
export function osHash(first: Uint8Array, last: Uint8Array, size: number): string {
  const MASK = (BigInt(1) << BigInt(64)) - BigInt(1);
  let h = BigInt(size);
  for (const buf of [first, last]) {
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    for (let i = 0; i + 8 <= buf.byteLength; i += 8) h = (h + view.getBigUint64(i, true)) & MASK;
  }
  return h.toString(16).padStart(16, '0');
}

/** Hash of a remote video, or '' when the server does not allow ranged reads. */
export async function hashRemote(url: string): Promise<string> {
  try {
    const h = await head(url);
    const size = +(h['content-length'] ?? 0);
    if (!size || size < CHUNK * 2 || !/bytes/i.test(h['accept-ranges'] ?? '')) return '';
    const [a, b] = await Promise.all([getRange(url, 0, CHUNK), getRange(url, size - CHUNK, CHUNK)]);
    if (a.bytes.length !== CHUNK || b.bytes.length !== CHUNK) return '';
    return osHash(a.bytes, b.bytes, size);
  } catch {
    return '';
  }
}

async function login() {
  const { osUser, osPass } = settings.value;
  if (token || !osUser || !osPass) return;
  try {
    const r = await request<{ token?: string }>(`${API}/login`, { method: 'POST', headers: headers(), body: { username: osUser, password: osPass } });
    token = r?.token ?? '';
  } catch {}
}

export interface SubtitleResult {
  fileId: number;
  release: string;
  language: string;
  downloads: number;
  hashMatch: boolean;
  hearingImpaired: boolean;
  fps: number;
}

export interface SearchQuery {
  query: string;
  language: string;
  hash?: string;
  tmdbId?: number;
  season?: number;
  episode?: number;
}

interface OsData { attributes: { release?: string; language?: string; download_count?: number; moviehash_match?: boolean; hearing_impaired?: boolean; fps?: number; files?: { file_id: number; file_name?: string }[] } }

/** Similarity of two release names, 0..1, by shared words. */
export function releaseSimilarity(a: string, b: string): number {
  const words = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 1));
  const A = words(a), B = words(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const w of A) if (B.has(w)) n++;
  return n / Math.max(A.size, B.size);
}

export async function searchSubtitles(q: SearchQuery, fileName = ''): Promise<SubtitleResult[]> {
  if (!osAvailable()) throw new Error('Add an OpenSubtitles API key in Settings → Subtitles.');
  updateSettings({ subLang: q.language });
  const params = new URLSearchParams({ languages: q.language });
  if (q.hash) params.set('moviehash', q.hash);
  if (q.tmdbId) params.set(q.season ? 'parent_tmdb_id' : 'tmdb_id', String(q.tmdbId));
  else params.set('query', q.query);
  if (q.season) { params.set('season_number', String(q.season)); params.set('episode_number', String(q.episode ?? 1)); params.set('type', 'episode'); }
  const r = await request<{ data?: OsData[] }>(`${API}/subtitles?${params}`, { headers: headers() });
  const list = (r?.data ?? []).flatMap(d => {
    const a = d.attributes, f = a.files?.[0];
    if (!f) return [];
    return [{ fileId: f.file_id, release: a.release || f.file_name || 'Subtitle', language: a.language || q.language, downloads: a.download_count || 0, hashMatch: !!a.moviehash_match, hearingImpaired: !!a.hearing_impaired, fps: a.fps || 0 }];
  });
  const ref = fileName || q.query;
  return list.sort((x, y) =>
    Number(y.hashMatch) - Number(x.hashMatch) ||
    releaseSimilarity(y.release, ref) - releaseSimilarity(x.release, ref) ||
    Number(x.hearingImpaired) - Number(y.hearingImpaired) ||
    y.downloads - x.downloads);
}

export async function downloadSubtitle(fileId: number): Promise<string> {
  await login();
  try {
    const d = await request<{ link?: string }>(`${API}/download`, { method: 'POST', headers: headers(), body: { file_id: fileId } });
    if (!d?.link) throw new Error('OpenSubtitles did not return a file.');
    return await request<string>(d.link, {}, 'text');
  } catch (e) {
    if (e instanceof HttpError && e.status === 406) throw new Error('Daily OpenSubtitles download limit reached. Add your OpenSubtitles login in Settings for more.');
    if (e instanceof HttpError && e.status === 401) token = '';
    throw e;
  }
}
