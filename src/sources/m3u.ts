// M3U / M3U8 playlists, including catch-up attributes and series detection.
import type { Catalog, Channel, Episode, Movie, Series } from './types';
import { cleanTitle } from '../core/names';

const ATTR = /([\w-]+)="([^"]*)"/g;

function attrs(line: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of line.matchAll(ATTR)) out[m[1].toLowerCase()] = m[2];
  return out;
}

const FILE_EXT = /\.(mp4|mkv|avi|mov|m4v|webm|wmv|flv)$/;
const EPISODE = /^(.*?)[\s._-]*S(\d{1,2})[\s._-]*E(\d{1,3})(.*)$/i;

export function parseM3U(text: string, sourceId: string): Catalog {
  const lines = text.split(/\r?\n/);
  const header = lines.find(l => l.startsWith('#EXTM3U')) ?? '';
  const head = attrs(header);
  const epgUrls = (head['x-tvg-url'] || head['url-tvg'] || '').split(',').map(s => s.trim()).filter(Boolean);

  const live: Channel[] = [], movies: Movie[] = [];
  const seriesByName = new Map<string, Series>();
  let info: { name: string; logo: string; group: string; epgId: string; catchup: Channel['catchup'] } | null = null;
  let extGroup = '';
  let n = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('#EXTINF')) {
      const a = attrs(line);
      const stripped = line.replace(ATTR, '');
      const name = stripped.slice(stripped.indexOf(',') + 1).trim() || a['tvg-name'] || 'Untitled';
      const type = a['catchup'] || a['catchup-type'] || head['catchup'] || '';
      const days = +(a['catchup-days'] || a['tvg-rec'] || a['timeshift'] || head['catchup-days'] || 0);
      info = {
        name,
        logo: a['tvg-logo'] || '',
        group: a['group-title'] || '',
        epgId: a['tvg-id'] || '',
        catchup: type || days ? { type: (type || 'default').toLowerCase(), source: a['catchup-source'] || head['catchup-source'] || '', days: days || 7 } : null,
      };
      continue;
    }
    if (line.startsWith('#EXTGRP:')) { extGroup = line.slice(8).trim(); continue; }
    if (line.startsWith('#') || !info) continue;

    const url = line;
    const group = info.group || extGroup || 'Uncategorised';
    const path = url.split('?')[0].toLowerCase();
    const isFile = FILE_EXT.test(path);
    n++;

    const ep = EPISODE.exec(info.name);
    if (/\/series\//.test(path) || (isFile && ep)) {
      const title = (ep ? ep[1] : info.name).replace(/[\s._-]+$/, '') || info.name;
      const sk = title.toLowerCase() + '|' + group;
      let s = seriesByName.get(sk);
      if (!s) {
        s = { kind: 'series', key: `s:${sourceId}:${seriesByName.size}`, sourceId, name: title, group, poster: info.logo, rating: 0, added: 0, year: cleanTitle(title).year, seasons: {} };
        seriesByName.set(sk, s);
      }
      const seasons = s.seasons!;
      const season = ep ? +ep[2] : 1;
      const list = (seasons[season] ??= []);
      const episode = ep ? +ep[3] : list.length + 1;
      const e: Episode = { key: `${s.key}:${season}:${episode}`, season, episode, title: (ep && ep[4].replace(/^[\s._-]+/, '')) || `Episode ${episode}`, url };
      list.push(e);
    } else if (/\/movie\//.test(path) || isFile) {
      movies.push({ kind: 'movie', key: `m:${sourceId}:${n}`, sourceId, name: info.name, group, poster: info.logo, url, rating: 0, added: 0, year: cleanTitle(info.name).year });
    } else {
      live.push({ kind: 'live', key: `l:${sourceId}:${n}`, sourceId, number: 0, name: info.name, group, logo: info.logo, url, epgId: info.epgId, catchup: info.catchup });
    }
    info = null;
  }

  const series = [...seriesByName.values()];
  for (const s of series) for (const list of Object.values(s.seasons!)) list.sort((a, b) => a.episode - b.episode);
  return { live, movies, series, epgUrls };
}

export const looksLikeM3U = (text: string) => /#EXTINF/i.test(text);
