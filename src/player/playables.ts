// Turning channels, films, episodes and guide programmes into things the player can play.
import type { Channel, Episode, Movie, Playable, Programme, Series } from '../sources/types';
import { sourceById, settings } from '../sources/library';
import { xtLiveUrl } from '../sources/xtream';
import { portalLink } from '../sources/stalker';
import { catchupUrl } from '../sources/catchup';
import { PLATFORM } from '../core/platform';
import { clock, dayLabel } from '../core/format';
import { cleanChannelName, cleanTitle } from '../core/names';

/** The live format to ask Xtream servers for. Apple devices cannot play raw MPEG-TS. */
export function liveFormat(): 'ts' | 'm3u8' {
  const f = settings.value.liveFormat;
  if (f !== 'auto') return f;
  return PLATFORM === 'ios' ? 'm3u8' : 'ts';
}

export function channelUrl(c: Channel, fmt = liveFormat()): string {
  const src = sourceById(c.sourceId);
  if (src?.type === 'xtream' && c.xtId != null) return xtLiveUrl(src, c.xtId, fmt);
  return c.url;
}

export function channelPlayable(c: Channel): Playable {
  const src = sourceById(c.sourceId);
  return {
    kind: 'live', key: c.key, title: cleanChannelName(c.name).name, subtitle: c.group, url: channelUrl(c), image: c.logo, channel: c,
    resolve: c.portal && src ? () => portalLink(src, 'itv', c.portal!.cmd) : undefined,
  };
}

export function moviePlayable(m: Movie): Playable {
  const src = sourceById(m.sourceId);
  return {
    kind: 'movie', key: m.key, title: cleanTitle(m.name).title, subtitle: m.year ? String(m.year) : m.group, url: m.url, image: m.poster,
    resolve: m.portal && src ? () => portalLink(src, 'vod', m.portal!.cmd) : undefined,
  };
}

export function episodePlayable(s: Series, e: Episode): Playable {
  return {
    kind: 'episode', key: e.key, title: `${s.name}`, subtitle: `S${e.season} E${e.episode} · ${e.title}`, url: e.url,
    image: e.still || s.poster, series: s, episode: e,
  };
}

export function catchupPlayable(c: Channel, p: Programme): Playable | null {
  const url = catchupUrl(c, p, sourceById(c.sourceId), liveFormat());
  if (!url) return null;
  return {
    kind: 'catchup', key: `cu:${c.key}:${p.start}`, title: p.title, subtitle: `${c.name} · ${dayLabel(p.start)} ${clock(p.start)}`,
    url, image: c.logo, channel: c, programme: p,
  };
}

/** All episodes of a series in watching order. */
export const episodeList = (s: Series): Episode[] =>
  Object.keys(s.seasons ?? {}).map(Number).sort((a, b) => a - b).flatMap(n => s.seasons![n]);
