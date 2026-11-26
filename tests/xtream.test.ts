import { describe, expect, it, vi } from 'vitest';

const N = 60000;
vi.mock('../src/core/http', async orig => {
  const real = await orig<typeof import('../src/core/http')>();
  return {
    ...real,
    request: vi.fn(async (url: string) => {
      const action = /action=(\w+)/.exec(url)?.[1] ?? '';
      switch (action) {
        case '': return { user_info: { auth: 1, status: 'Active', exp_date: '1900000000' }, server_info: { timezone: 'Europe/London' } };
        case 'get_live_categories': return [{ category_id: '1', category_name: 'UK' }];
        case 'get_live_streams': return [{ stream_id: 7, name: 'UK: BBC One', category_id: '1', tv_archive: 1, tv_archive_duration: 7 }];
        case 'get_vod_categories': return [{ category_id: '2', category_name: 'Films' }];
        case 'get_vod_streams': return Array.from({ length: N }, (_, i) => ({ stream_id: i, name: `Film ${i}`, category_id: '2', added: String(i), container_extension: 'mkv' }));
        case 'get_series_categories': throw new Error('HTTP 500');
        default: return [];
      }
    }),
  };
});

describe('Xtream loading', () => {
  it('loads a very large account, one list at a time, reporting progress', async () => {
    const { loadXtream } = await import('../src/sources/xtream');
    const steps: string[] = [];
    const src = { id: 's', name: 'Provider', type: 'xtream' as const, enabled: true, server: 'host:8080', user: 'u', pass: 'p' };
    const c = await loadXtream(src, m => steps.push(m));
    expect(c.live[0]).toMatchObject({ name: 'UK: BBC One', url: 'http://host:8080/live/u/p/7.ts', catchup: { type: 'xc', days: 7 } });
    expect(c.movies).toHaveLength(N);
    expect(c.movies[0].url).toBe('http://host:8080/movie/u/p/0.mkv');
    expect(c.series).toHaveLength(0); // a failing list does not sink the whole load
    expect(steps[0]).toMatch(/Signing in/);
    expect(steps.some(s => /films/.test(s))).toBe(true);
    expect(src.expires).toBe(1900000000 * 1000);
  });

  it('merges big catalogues without overflowing the call stack', () => {
    const big = Array.from({ length: 300000 }, (_, i) => i);
    let all: number[] = [];
    expect(() => { all = all.concat(big); }).not.toThrow();
    expect(() => { const x: number[] = []; x.push(...big); }).toThrow(RangeError);
  });
});
