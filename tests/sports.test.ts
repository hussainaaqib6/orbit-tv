import { describe, expect, it } from 'vitest';
import { parseScoreboard, indexChannels, matchStreams, leagueChannels, eventChannels, LEAGUES, teamAliases } from '../src/services/sports';
import { guideIdFor, type GuideIndex } from '../src/sources/epg';
import type { Channel } from '../src/sources/types';

const ch = (name: string, group = 'EPL Events'): Channel => ({ kind: 'live', key: name, sourceId: 's', number: 0, name, group, logo: '', url: '', epgId: '', catchup: null });
const team = (displayName: string, shortDisplayName: string, homeAway: string, score = '0') =>
  ({ homeAway, score, team: { displayName, shortDisplayName, name: displayName, logo: 'x.png' } });
const board = {
  events: [
    { id: '1', date: '2026-11-29T15:00Z', name: 'Chelsea at Arsenal', status: { type: { state: 'pre', shortDetail: '3:00 PM' } },
      competitions: [{ competitors: [team('Arsenal', 'Arsenal', 'home'), team('Chelsea', 'Chelsea', 'away')], venue: { fullName: 'Emirates Stadium' } }] },
    { id: '2', date: '2026-11-29T12:30Z', name: 'Spurs at United', status: { type: { state: 'in', shortDetail: "63'" } },
      competitions: [{ competitors: [team('Manchester United', 'Man United', 'home', '2'), team('Tottenham Hotspur', 'Spurs', 'away', '1')] }] },
  ],
};

describe('sports', () => {
  const fx = parseScoreboard('epl', board);
  const ix = indexChannels([
    ch('EPL 01: Arsenal v Chelsea @ 15:00'), ch('EPL 02 | Man Utd vs Tottenham'), ch('Arsenal TV', 'UK | Sports'),
    ch('UK: Sky Sports Premier League FHD', 'UK | Sky Sports'), ch('UK: BBC One', 'UK | Entertainment'),
  ]);

  it('reads the scoreboard, soonest first, with live state and scores', () => {
    expect(fx.map(f => f.id)).toEqual(['epl:2', 'epl:1']);
    expect(fx[0].state).toBe('in');
    expect(fx[0].home?.score).toBe('2');
    expect(fx[1].venue).toBe('Emirates Stadium');
  });

  it('finds event channels naming both sides, including short club names', () => {
    expect(matchStreams(ix, fx[1]).map(c => c.name)).toEqual(['EPL 01: Arsenal v Chelsea @ 15:00']);
    expect(matchStreams(ix, fx[0]).map(c => c.name)).toEqual(['EPL 02 | Man Utd vs Tottenham']);
  });

  it('finds channels that show the competition', () => {
    const epl = LEAGUES.find(l => l.id === 'epl')!;
    expect(leagueChannels(ix, epl).map(c => c.name)).toContain('UK: Sky Sports Premier League FHD');
    expect(leagueChannels(ix, epl).map(c => c.name)).not.toContain('UK: BBC One');
  });

  it('lists single-event channels', () => {
    expect(eventChannels(ix).length).toBe(2);
  });

  it('knows common club nicknames', () => {
    expect(teamAliases(['Brighton & Hove Albion'])).toContain(' brighton ');
    expect(teamAliases(['Wolverhampton Wanderers'])).toContain(' wolves ');
  });
});

describe('guide index', () => {
  it('matches channels against the Android guide index', () => {
    const g: GuideIndex = { ids: new Map([['bbc1.uk', 'BBC1.uk']]), names: new Map([['bbcone', 'BBC1.uk']]), displayNames: new Map(), has: new Set(['BBC1.uk']) };
    expect(guideIdFor({ ...ch('Whatever'), epgId: 'bbc1.uk' }, g, {})).toBe('BBC1.uk');
    expect(guideIdFor(ch('UK: BBC One HD'), g, {})).toBe('BBC1.uk');
    expect(guideIdFor(ch('Nothing'), g, {})).toBeNull();
  });
});
