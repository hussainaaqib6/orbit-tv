import { describe, expect, it } from 'vitest';
import { versionKey, qualityRank } from '../src/sources/alternatives';
import { parseConnections } from '../src/services/connections';
import { searchSettings } from '../src/screens/Settings';
import { parseScoreboard, indexChannels, matchStreams } from '../src/services/sports';
import type { Channel } from '../src/sources/types';

describe('channel versions', () => {
  it('groups HD/FHD/backup and prefixed names together', () => {
    const k = versionKey('Sky Sports Main Event');
    expect(versionKey('UK: Sky Sports Main Event FHD')).toBe(k);
    expect(versionKey('UK | SKY SPORTS MAIN EVENT HD (Backup)')).toBe(k);
    expect(versionKey('Sky Sports Main Event 4K HEVC')).toBe(k);
  });
  it('never treats +1, radio or highlights channels as versions', () => {
    expect(versionKey('ITV1 +1')).toBe('');
    expect(versionKey('BBC Radio 5 Live')).toBe('');
    expect(versionKey('Premier League Highlights')).toBe('');
  });
  it('ranks quality from the name', () => {
    expect(qualityRank('X 4K')).toBeGreaterThan(qualityRank('X FHD'));
    expect(qualityRank('X FHD')).toBeGreaterThan(qualityRank('X HD'));
    expect(qualityRank('X HD')).toBeGreaterThan(qualityRank('X SD'));
  });
});

describe('provider connections', () => {
  it('reads what the provider reports, and nothing it does not', () => {
    expect(parseConnections({ user_info: { active_cons: '1', max_connections: '2' } })).toEqual({ active: 1, max: 2 });
    expect(parseConnections({ user_info: {} })).toEqual({ active: null, max: null });
    expect(parseConnections(null)).toEqual({ active: null, max: null });
  });
});

describe('settings search', () => {
  it('finds settings by other words people use', () => {
    expect(searchSettings('buffer')[0].id).toBe('recoveryDelay');
    expect(searchSettings('epg').map(r => r.section)).toContain('guide');
    expect(searchSettings('mini player')[0].id).toBe('miniPlayer');
    expect(searchSettings('subtitles').length).toBeGreaterThan(2);
    expect(searchSettings('xyzzy')).toEqual([]);
  });
});

describe('sports cards and matching', () => {
  const ev = (state: string, name: string) => ({ events: [{ id: '1', date: '2026-11-29T15:00Z', name: 'A at B', status: { type: { state, name } },
    competitions: [{ competitors: [
      { homeAway: 'home', score: '1', team: { displayName: 'Arsenal', shortDisplayName: 'Arsenal', color: 'ef0107', alternateColor: 'ffffff' } },
      { homeAway: 'away', score: '0', team: { displayName: 'Chelsea', shortDisplayName: 'Chelsea', color: '034694' } },
    ] }] }] });
  it('reads team colours and match status', () => {
    const [f] = parseScoreboard('epl', ev('in', 'STATUS_HALFTIME'));
    expect(f.home?.color).toBe('#ef0107');
    expect(f.status).toBe('halftime');
    expect(parseScoreboard('epl', ev('pre', 'STATUS_POSTPONED'))[0].status).toBe('postponed');
    expect(parseScoreboard('epl', ev('post', 'STATUS_FULL_TIME'))[0].status).toBe('finished');
  });
  it('skips +1, radio and highlights channels when matching', () => {
    const ch = (name: string): Channel => ({ kind: 'live', key: name, sourceId: 's', number: 0, name, group: 'EPL', logo: '', url: '', epgId: '', catchup: null });
    const ix = indexChannels([ch('EPL 01: Arsenal v Chelsea'), ch('EPL 01: Arsenal v Chelsea +1'), ch('Radio: Arsenal v Chelsea'), ch('Arsenal v Chelsea Highlights')]);
    const [f] = parseScoreboard('epl', ev('pre', 'STATUS_SCHEDULED'));
    expect(matchStreams(ix, f).map(c => c.name)).toEqual(['EPL 01: Arsenal v Chelsea']);
  });
});
