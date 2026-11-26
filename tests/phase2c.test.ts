import { describe, expect, it } from 'vitest';
import { homeRows, DEFAULT_ROWS } from '../src/screens/homeRows';
import { setMemoryGuide, searchProgrammes } from '../src/sources/guideStore';
import { emptyGuide } from '../src/sources/epg';

describe('home rows', () => {
  it('keeps the viewer order, adds rows they have not placed, and Watched starts off', () => {
    const r = homeRows([{ id: 'newMovies', on: true }, { id: 'sport:epl', on: true }]);
    expect(r[0].id).toBe('newMovies');
    expect(r[1].id).toBe('sport:epl');
    expect(r.length).toBe(DEFAULT_ROWS.length + 1);
    expect(DEFAULT_ROWS.find(x => x.id === 'watched')!.on).toBe(false);
  });
  it('drops rows that no longer exist', () => {
    expect(homeRows([{ id: 'gone', on: true }]).some(r => r.id === 'gone')).toBe(false);
  });
});

describe('programme search', () => {
  it('finds upcoming programmes by title or episode title', async () => {
    const g = emptyGuide();
    const t = Date.now();
    g.programmes.set('a', [
      { start: t - 7200e3, stop: t - 3600e3, title: 'Match of the Day', desc: '' },
      { start: t + 3600e3, stop: t + 7200e3, title: 'Match of the Day', desc: '' },
      { start: t + 7200e3, stop: t + 9000e3, title: 'News', desc: '', sub: 'Matchday special' },
    ]);
    setMemoryGuide(g);
    const r = await searchProgrammes('match');
    expect(r.map(([, p]) => p.start)).toEqual([t + 3600e3, t + 7200e3]);
  });
});
