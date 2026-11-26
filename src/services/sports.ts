// Live Sports: fixtures from ESPN's public scoreboard feed, matched to channels in the playlist.
//
// A fixture's streams come in two kinds:
//  - match streams: event channels whose name carries both sides ("EPL 03: Arsenal v Chelsea");
//  - channels that usually show the competition (Sky Sports Premier League, TNT Sports…), found by
//    keywords in the channel name or its category.
import { request } from '../core/http';
import type { Channel } from '../sources/types';

export interface League {
  id: string;
  name: string;
  section: 'Football' | 'More sports';
  /** ESPN path: sport/league. */
  path: string;
  /** Words that point to channels or categories carrying this competition. */
  keywords: string[];
}

export const LEAGUES: League[] = [
  { id: 'epl', name: 'Premier League', section: 'Football', path: 'soccer/eng.1', keywords: ['premier league', 'epl', 'sky sports main event', 'sky sports premier', 'tnt sports', 'amazon prime sport', 'prime video sport'] },
  { id: 'ucl', name: 'Champions League', section: 'Football', path: 'soccer/uefa.champions', keywords: ['champions league', 'ucl', 'tnt sports', 'amazon prime sport'] },
  { id: 'laliga', name: 'La Liga', section: 'Football', path: 'soccer/esp.1', keywords: ['laliga', 'la liga', 'premier sports', 'movistar', 'dazn laliga'] },
  { id: 'seriea', name: 'Serie A', section: 'Football', path: 'soccer/ita.1', keywords: ['serie a', 'tnt sports', 'dazn'] },
  { id: 'bundesliga', name: 'Bundesliga', section: 'Football', path: 'soccer/ger.1', keywords: ['bundesliga', 'sky sport bundesliga', 'sky sports football'] },
  { id: 'ligue1', name: 'Ligue 1', section: 'Football', path: 'soccer/fra.1', keywords: ['ligue 1', 'bein sport', 'ligue1'] },
  { id: 'championship', name: 'Championship', section: 'Football', path: 'soccer/eng.2', keywords: ['efl', 'championship', 'sky sports football'] },
  { id: 'europa', name: 'Europa League', section: 'Football', path: 'soccer/uefa.europa', keywords: ['europa league', 'tnt sports'] },
  { id: 'conference', name: 'Conference League', section: 'Football', path: 'soccer/uefa.europa.conf', keywords: ['conference league', 'tnt sports'] },
  { id: 'facup', name: 'FA Cup', section: 'Football', path: 'soccer/eng.fa', keywords: ['fa cup', 'bbc one', 'itv1'] },
  { id: 'eflcup', name: 'Carabao Cup', section: 'Football', path: 'soccer/eng.league_cup', keywords: ['carabao', 'efl cup', 'sky sports football'] },
  { id: 'spfl', name: 'Scottish Premiership', section: 'Football', path: 'soccer/sco.1', keywords: ['spfl', 'scottish premiership', 'sky sports football', 'premier sports'] },
  { id: 'eredivisie', name: 'Eredivisie', section: 'Football', path: 'soccer/ned.1', keywords: ['eredivisie', 'espn nl', 'ziggo'] },
  { id: 'mls', name: 'MLS', section: 'Football', path: 'soccer/usa.1', keywords: ['mls', 'apple tv'] },
  { id: 'ufc', name: 'UFC', section: 'More sports', path: 'mma/ufc', keywords: ['ufc', 'tnt sports', 'ppv'] },
  { id: 'f1', name: 'Formula 1', section: 'More sports', path: 'racing/f1', keywords: ['f1', 'formula 1', 'sky sports f1'] },
  { id: 'nfl', name: 'NFL', section: 'More sports', path: 'football/nfl', keywords: ['nfl', 'sky sports nfl', 'redzone'] },
  { id: 'nba', name: 'NBA', section: 'More sports', path: 'basketball/nba', keywords: ['nba'] },
  { id: 'nhl', name: 'NHL', section: 'More sports', path: 'hockey/nhl', keywords: ['nhl'] },
  { id: 'mlb', name: 'MLB', section: 'More sports', path: 'baseball/mlb', keywords: ['mlb'] },
];

export interface Side { name: string; short: string; logo: string; score: string; aliases: string[] }
export interface Fixture {
  id: string;
  leagueId: string;
  start: number;
  title: string;
  state: 'pre' | 'in' | 'post';
  /** "63'", "Half Time", "FT"… from the feed. */
  detail: string;
  home?: Side;
  away?: Side;
  venue: string;
  /** Who the feed says shows it (mostly US networks). */
  tv: string[];
}

/* ------------------------------ names ------------------------------ */

/** Lower case, no accents, "&" as "and", punctuation as spaces, padded with spaces for word matching. */
export function norm(s: string): string {
  const t = String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
  return ` ${t} `;
}

/** Common short names for clubs, as playlists write them. Keys are norm()'d full names, trimmed. */
const ALIASES: Record<string, string[]> = {
  'manchester united': ['man utd', 'man united', 'man u', 'manchester utd'],
  'manchester city': ['man city', 'manchester c'],
  'tottenham hotspur': ['tottenham', 'spurs'],
  'wolverhampton wanderers': ['wolves', 'wolverhampton'],
  'brighton and hove albion': ['brighton'],
  'newcastle united': ['newcastle', 'newcastle utd'],
  'west ham united': ['west ham'],
  'nottingham forest': ['nottm forest', 'nottingham', 'notts forest', 'nott m forest'],
  'leeds united': ['leeds'],
  'sheffield united': ['sheff utd', 'sheffield utd', 'sheffield u'],
  'sheffield wednesday': ['sheff wed', 'sheffield w'],
  'afc bournemouth': ['bournemouth'],
  'crystal palace': ['palace'],
  'aston villa': ['villa'],
  'leicester city': ['leicester'],
  'ipswich town': ['ipswich'],
  'west bromwich albion': ['west brom', 'wba'],
  'queens park rangers': ['qpr'],
  'atletico madrid': ['atletico', 'atleti', 'atl madrid', 'atletico de madrid'],
  'barcelona': ['barca', 'fc barcelona'],
  'athletic club': ['athletic bilbao', 'bilbao'],
  'real sociedad': ['sociedad'],
  'real betis': ['betis'],
  'bayern munich': ['bayern', 'bayern munchen', 'fc bayern'],
  'borussia dortmund': ['dortmund', 'bvb'],
  'borussia monchengladbach': ['gladbach', 'monchengladbach'],
  'bayer leverkusen': ['leverkusen'],
  'rb leipzig': ['leipzig'],
  'eintracht frankfurt': ['frankfurt'],
  'paris saint germain': ['psg', 'paris sg', 'paris saint-germain'],
  'olympique marseille': ['marseille', 'om'],
  'marseille': ['olympique marseille'],
  'olympique lyonnais': ['lyon'],
  'lyon': ['olympique lyonnais'],
  'as monaco': ['monaco'],
  'internazionale': ['inter', 'inter milan'],
  'inter milan': ['inter', 'internazionale'],
  'ac milan': ['milan'],
  'juventus': ['juve'],
  'as roma': ['roma'],
  'ss lazio': ['lazio'],
  'ssc napoli': ['napoli'],
  'napoli': ['ssc napoli'],
  'psv eindhoven': ['psv'],
  'sporting cp': ['sporting lisbon', 'sporting'],
  'benfica': ['sl benfica'],
};

const SUFFIX = / (fc|afc|cf|sc|ac|fk|sk|bk|cd|ud|sv|ssc|calcio) $/;
const PREFIX = /^ (fc|afc|cf|sc|ac|fk|sk|bk|cd|ud|sv|ssc|real|as) /;

/** Ways a team can be written in a channel name. */
export function teamAliases(names: string[]): string[] {
  const out = new Set<string>();
  for (const raw of names) {
    const n = norm(raw);
    if (n.trim().length < 3) continue;
    out.add(n);
    const bare = n.replace(SUFFIX, ' ').replace(PREFIX, ' ');
    if (bare.trim().length >= 4) out.add(bare);
    for (const a of ALIASES[n.trim()] ?? []) out.add(norm(a));
  }
  return [...out].filter(a => a.trim().length >= 3 || /^ (om|psg|qpr|wba|bvb) $/.test(a));
}

/* ------------------------------ fixtures ------------------------------ */

interface EspnCompetitor { homeAway?: string; score?: string; team?: { displayName?: string; shortDisplayName?: string; name?: string; location?: string; abbreviation?: string; logo?: string }; athlete?: { displayName?: string; shortName?: string } }
interface EspnEvent {
  id: string; date: string; name?: string; shortName?: string;
  status?: { type?: { state?: string; detail?: string; shortDetail?: string } };
  competitions?: { competitors?: EspnCompetitor[]; venue?: { fullName?: string }; broadcasts?: { names?: string[] }[] }[];
}

const ymd = (t: number) => { const d = new Date(t); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`; };

function side(c: EspnCompetitor | undefined): Side | undefined {
  if (!c) return undefined;
  const t = c.team, a = c.athlete;
  const name = t?.displayName || a?.displayName || '';
  if (!name) return undefined;
  const names = [name, t?.shortDisplayName, t?.name, t?.location, a?.shortName].filter(Boolean) as string[];
  // Fighters and drivers are usually written by surname.
  if (a?.displayName) names.push(a.displayName.split(' ').slice(-1)[0]);
  return { name, short: t?.shortDisplayName || a?.shortName || name, logo: t?.logo || '', score: c.score ?? '', aliases: teamAliases(names) };
}

export function parseScoreboard(leagueId: string, j: { events?: EspnEvent[] }): Fixture[] {
  return (j.events ?? []).map(e => {
    const comp = e.competitions?.[0];
    const cs = comp?.competitors ?? [];
    const home = side(cs.find(c => c.homeAway === 'home') ?? cs[0]);
    const away = side(cs.find(c => c.homeAway === 'away') ?? cs[1]);
    const st = e.status?.type;
    const state = st?.state === 'in' ? 'in' : st?.state === 'post' ? 'post' : 'pre';
    return {
      id: `${leagueId}:${e.id}`, leagueId, start: Date.parse(e.date), title: e.name || e.shortName || '',
      state, detail: st?.shortDetail || st?.detail || '',
      // Two-sided only when the feed names exactly two (a UFC card or a race has many).
      home: cs.length === 2 ? home : undefined, away: cs.length === 2 ? away : undefined,
      venue: comp?.venue?.fullName || '', tv: (comp?.broadcasts ?? []).flatMap(b => b.names ?? []),
    } as Fixture;
  }).filter(f => isFinite(f.start)).sort((a, b) => a.start - b.start);
}

const cache = new Map<string, { at: number; fixtures: Fixture[] }>();

/** Fixtures from yesterday to a week ahead. Cached for five minutes (one minute while a game is on). */
export async function fixturesFor(league: League): Promise<Fixture[]> {
  const c = cache.get(league.id);
  const live = c?.fixtures.some(f => f.state === 'in');
  if (c && Date.now() - c.at < (live ? 60e3 : 300e3)) return c.fixtures;
  const now = Date.now();
  const url = `https://site.api.espn.com/apis/site/v2/sports/${league.path}/scoreboard?dates=${ymd(now - 86400e3)}-${ymd(now + 7 * 86400e3)}&limit=300`;
  const j = await request<{ events?: EspnEvent[] }>(url, { timeoutMs: 15000 });
  const fixtures = parseScoreboard(league.id, j ?? {});
  cache.set(league.id, { at: Date.now(), fixtures });
  return fixtures;
}

/* ------------------------------ channels ------------------------------ */

export interface ChannelIndex { list: Channel[]; names: string[]; groups: string[] }

export function indexChannels(list: Channel[]): ChannelIndex {
  return { list, names: list.map(c => norm(c.name)), groups: list.map(c => norm(c.group)) };
}

const hasAny = (hay: string, needles: string[]) => needles.some(n => hay.includes(n));

/** Event channels naming both sides, best first. */
export function matchStreams(ix: ChannelIndex, f: Fixture): Channel[] {
  let a: string[], b: string[];
  if (f.home && f.away) { a = f.home.aliases; b = f.away.aliases; }
  else {
    // "UFC 310: Pantoja vs. Asakura": the two names either side of "vs".
    const m = /([^:]+?)\s+(?:vs?\.?|v)\s+(.+)$/i.exec(f.title.replace(/^[^:]*:\s*/, ''));
    if (!m) return [];
    a = teamAliases([m[1].split(' ').slice(-1)[0]]); b = teamAliases([m[2].split(' ').slice(-1)[0]]);
  }
  if (!a.length || !b.length) return [];
  const out: Channel[] = [];
  for (let i = 0; i < ix.list.length; i++) {
    const n = ix.names[i];
    if (hasAny(n, a) && hasAny(n, b)) out.push(ix.list[i]);
  }
  return out.slice(0, 40);
}

/** Channels that usually carry this competition, from their name or category. */
export function leagueChannels(ix: ChannelIndex, league: League): Channel[] {
  const kws = league.keywords.map(norm);
  const named: Channel[] = [], grouped: Channel[] = [];
  for (let i = 0; i < ix.list.length; i++) {
    if (hasAny(ix.names[i], kws)) named.push(ix.list[i]);
    else if (hasAny(ix.groups[i], kws)) grouped.push(ix.list[i]);
    if (named.length >= 60) break;
  }
  return named.concat(grouped).slice(0, 60);
}

const EVENT_NAME = / (v|vs|versus) /;
const EVENT_GROUP = /(event|ppv|pay per view|match|fixture|live sport|epl|laliga|la liga|ucl|champions|football|soccer|ufc|boxing|fight)/;

/** Channels set up for single events ("EPL 01: Arsenal v Chelsea"), whatever the feed knows. */
export function eventChannels(ix: ChannelIndex): Channel[] {
  const out: Channel[] = [];
  for (let i = 0; i < ix.list.length; i++) {
    if (EVENT_NAME.test(ix.names[i]) && EVENT_GROUP.test(ix.groups[i] + ix.names[i])) out.push(ix.list[i]);
    if (out.length >= 500) break;
  }
  return out;
}
