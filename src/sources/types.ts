// The shapes every source (Xtream, M3U, MAC portal) is turned into.

export type SourceType = 'xtream' | 'm3u' | 'stalker';

export interface Source {
  id: string;
  name: string;
  type: SourceType;
  enabled: boolean;
  // Xtream Codes
  server?: string;
  user?: string;
  pass?: string;
  // M3U
  url?: string;
  /** M3U pasted or opened from a file (kept in IndexedDB). */
  fromFile?: boolean;
  // MAC portal
  portal?: string;
  mac?: string;
  /** Extra guide link for this source. */
  epgUrl?: string;
  // Filled in when the source loads
  expires?: number;
  timezone?: string;
  error?: string;
  loadedAt?: number;
  counts?: { live: number; movies: number; series: number };
}

export interface Catchup {
  type: string; // 'xc' | 'default' | 'append' | 'shift' | 'flussonic' ...
  source?: string;
  days: number;
}

interface Base {
  /** Unique and stable across reloads. */
  key: string;
  sourceId: string;
  name: string;
  group: string;
}

export interface Channel extends Base {
  kind: 'live';
  /** Position in the full channel list (1-based), used for number entry. */
  number: number;
  logo: string;
  url: string;
  epgId: string;
  catchup: Catchup | null;
  /** Xtream stream id, or MAC portal channel id + cmd (links are created on demand). */
  xtId?: number;
  portal?: { id: string; cmd: string };
}

export interface Movie extends Base {
  kind: 'movie';
  poster: string;
  url: string;
  rating: number;
  added: number;
  year: number;
  plot?: string;
  xtId?: number;
  portal?: { id: string; cmd: string };
}

export interface Episode {
  key: string;
  season: number;
  episode: number;
  title: string;
  url: string;
  plot?: string;
  durationSec?: number;
  still?: string;
}

export interface Series extends Base {
  kind: 'series';
  poster: string;
  rating: number;
  added: number;
  year: number;
  plot?: string;
  xtId?: number;
  /** M3U series have their episodes inline; Xtream series load them on demand. */
  seasons?: Record<number, Episode[]>;
}

export type Item = Channel | Movie | Series;

export interface Catalog {
  live: Channel[];
  movies: Movie[];
  series: Series[];
  /** Guide links the sources advertise. */
  epgUrls: string[];
}

export interface Programme {
  start: number;
  stop: number;
  title: string;
  desc: string;
  /** Episode title (XMLTV sub-title). */
  sub?: string;
  /** "S2 E5" from xmltv_ns, or the guide's own on-screen label. */
  ep?: string;
  /** First XMLTV category, e.g. "Football", "Drama". */
  cat?: string;
  /** Programme artwork URL (XMLTV icon). */
  img?: string;
  /** Age rating as the guide gives it, e.g. "15", "PG". */
  rating?: string;
}

/** A thing the player can play. */
export interface Playable {
  kind: 'live' | 'movie' | 'episode' | 'catchup';
  /** Key used for resume points and history. */
  key: string;
  title: string;
  subtitle?: string;
  url: string;
  /** Builds a fresh URL right before playing (MAC portal links expire). */
  resolve?: () => Promise<string>;
  image?: string;
  /** Channel this belongs to (live and catch-up). */
  channel?: Channel;
  /** For episodes: the series and the position in the episode list. */
  series?: Series;
  episode?: Episode;
  /** For catch-up: the programme being replayed. */
  programme?: Programme;
}
