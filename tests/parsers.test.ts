import { describe, expect, it } from 'vitest';
import { parseM3U } from '../src/sources/m3u';
import { parseXMLTV, emptyGuide, guideIdFor, nowNext, xmltvDate, indexAt } from '../src/sources/epg';
import { catchupUrl, canCatchup, xtStamp } from '../src/sources/catchup';
import { cleanChannelName, cleanTitle, matchKey } from '../src/core/names';
import type { Channel, Source } from '../src/sources/types';

const M3U = `#EXTM3U x-tvg-url="http://epg.example/guide.xml.gz,http://other/epg.xml"
#EXTINF:-1 tvg-id="bbc1.uk" tvg-logo="http://l/bbc1.png" group-title="UK" catchup="default" catchup-days="7" catchup-source="http://cu/{utc}-{duration}.ts",UK: BBC One FHD
http://host/live/u/p/1.ts
#EXTINF:-1 group-title="Films",The Matrix (1999)
http://host/movie/u/p/2.mkv
#EXTINF:-1 group-title="Shows",Some Show S01E02 Pilot Two
http://host/series/u/p/3.mp4
#EXTINF:-1 group-title="Shows",Some Show S01E01
http://host/series/u/p/4.mp4
`;

describe('M3U', () => {
  const c = parseM3U(M3U, 'src1');
  it('splits live, films and series', () => {
    expect(c.live).toHaveLength(1);
    expect(c.movies).toHaveLength(1);
    expect(c.series).toHaveLength(1);
  });
  it('reads attributes and the guide links', () => {
    expect(c.epgUrls).toEqual(['http://epg.example/guide.xml.gz', 'http://other/epg.xml']);
    const ch = c.live[0];
    expect(ch).toMatchObject({ name: 'UK: BBC One FHD', epgId: 'bbc1.uk', logo: 'http://l/bbc1.png', group: 'UK' });
    expect(ch.catchup).toEqual({ type: 'default', source: 'http://cu/{utc}-{duration}.ts', days: 7 });
  });
  it('groups episodes into seasons in order', () => {
    const s = c.series[0];
    expect(s.name).toBe('Some Show');
    expect(s.seasons![1].map(e => e.episode)).toEqual([1, 2]);
    expect(s.seasons![1][1].title).toBe('Pilot Two');
  });
  it('reads the year from film names', () => {
    expect(c.movies[0].year).toBe(1999);
  });
});

describe('names', () => {
  it('cleans channel names', () => {
    expect(cleanChannelName('UK: BBC One FHD')).toEqual({ name: 'BBC One', prefix: 'UK', quality: 'FHD' });
    expect(cleanChannelName('Sky Sports Main Event')).toEqual({ name: 'Sky Sports Main Event', prefix: '', quality: '' });
  });
  it('cleans film titles', () => {
    expect(cleanTitle('EN - The Matrix (1999) [4K]')).toEqual({ title: 'The Matrix', year: 1999 });
    expect(cleanTitle('Dune: Part Two (2024)')).toEqual({ title: 'Dune: Part Two', year: 2024 });
    expect(cleanChannelName('Dave: Funny')).toMatchObject({ name: 'Dave: Funny', prefix: '' });
  });
  it('builds matching keys', () => {
    expect(matchKey('UK: BBC One HD')).toBe(matchKey('BBC ONE'));
  });
});

const XML = `<?xml version="1.0"?><tv>
<channel id="bbc1.uk"><display-name>BBC One</display-name></channel>
<channel id="dup1"><display-name>News</display-name></channel>
<channel id="dup2"><display-name>News</display-name></channel>
<programme start="20261125190000 +0000" stop="20261125200000 +0000" channel="bbc1.uk"><title>Six &amp; Seven</title><desc>About &lt;it&gt;</desc></programme>
<programme start="20261125200000 +0000" stop="20261125210000 +0000" channel="bbc1.uk"><title><![CDATA[Later]]></title></programme>
<programme start="20261125200000 +0100" stop="20261125210000 +0100" channel="dup1"><title>N</title></programme>
</tv>`;

describe('XMLTV', () => {
  const now = Date.UTC(2026, 10, 25, 19, 30);
  const g = emptyGuide();
  parseXMLTV(XML, g, { now });
  it('parses dates with offsets', () => {
    expect(xmltvDate('20261125200000 +0100')).toBe(Date.UTC(2026, 10, 25, 19, 0));
  });
  it('decodes entities and CDATA', () => {
    const list = g.programmes.get('bbc1.uk')!;
    expect(list.map(p => p.title)).toEqual(['Six & Seven', 'Later']);
    expect(list[0].desc).toBe('About <it>');
  });
  it('finds now and next', () => {
    const { now: n, next } = nowNext(g.programmes.get('bbc1.uk')!, now);
    expect(n?.title).toBe('Six & Seven');
    expect(next?.title).toBe('Later');
    expect(indexAt(g.programmes.get('bbc1.uk')!, Date.UTC(2026, 10, 25, 22))).toBe(-1);
  });
  it('matches by id, by name, and never guesses ambiguous names', () => {
    const ch = (name: string, epgId = ''): Channel => ({ kind: 'live', key: name, sourceId: 's', number: 1, name, group: '', logo: '', url: '', epgId, catchup: null });
    expect(guideIdFor(ch('Whatever', 'BBC1.UK'), g, {})).toBe('bbc1.uk');
    expect(guideIdFor(ch('UK: BBC One HD'), g, {})).toBe('bbc1.uk');
    expect(guideIdFor(ch('News'), g, {})).toBeNull();
    expect(guideIdFor(ch('News'), g, { News: 'dup1' })).toBe('dup1');
  });
  it('applies a time correction', () => {
    const g2 = emptyGuide();
    parseXMLTV(XML, g2, { now, offsetHours: 1 });
    expect(g2.programmes.get('bbc1.uk')![0].start).toBe(Date.UTC(2026, 10, 25, 20));
  });
});

describe('catch-up', () => {
  const p = { start: Date.UTC(2026, 10, 25, 19), stop: Date.UTC(2026, 10, 25, 20), title: 'x', desc: '' };
  const now = Date.UTC(2026, 10, 25, 21);
  it('builds Xtream timeshift links in the server time zone', () => {
    const src: Source = { id: 's', name: 's', type: 'xtream', enabled: true, server: 'http://h:80', user: 'u', pass: 'p w', timezone: 'Europe/London' };
    const ch: Channel = { kind: 'live', key: 'k', sourceId: 's', number: 1, name: 'n', group: '', logo: '', url: '', epgId: '', xtId: 42, catchup: { type: 'xc', days: 3 } };
    expect(catchupUrl(ch, p, src, 'ts', now)).toBe('http://h:80/timeshift/u/p%20w/60/2026-11-25:19-00/42.ts');
    expect(xtStamp(p.start, 'America/New_York')).toBe('2026-11-25:14-00');
  });
  it('fills M3U catch-up templates', () => {
    const ch: Channel = { kind: 'live', key: 'k', sourceId: 's', number: 1, name: 'n', group: '', logo: '', url: 'http://h/1.ts', epgId: '', catchup: { type: 'default', source: 'http://cu/{utc}-{duration}.ts', days: 7 } };
    expect(catchupUrl(ch, p, undefined, 'ts', now)).toBe(`http://cu/${p.start / 1000}-3600.ts`);
    const app: Channel = { ...ch, catchup: { type: 'append', source: '?utc={utc}&lutc={lutc}', days: 7 } };
    expect(catchupUrl(app, p, undefined, 'ts', now)).toBe(`http://h/1.ts?utc=${p.start / 1000}&lutc=${now / 1000}`);
  });
  it('knows when catch-up is available', () => {
    const ch = { catchup: { type: 'xc', days: 1 } } as Channel;
    expect(canCatchup(ch, p, now)).toBe(true);
    expect(canCatchup(ch, p, now + 2 * 86400e3)).toBe(false);
    expect(canCatchup(ch, { ...p, start: now + 1 }, now)).toBe(false);
  });
});
