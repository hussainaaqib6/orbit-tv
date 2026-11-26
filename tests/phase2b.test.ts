import { describe, expect, it } from 'vitest';
import { exportTheme, importTheme, cleanTheme, DEFAULT_THEME, OLD_DEFAULT_THEME, PRESETS, isOldDefault, themeVars } from '../src/core/theme';
import { isAdultGroup, isLocked, isHidden, hashPin, unlocked } from '../src/sources/restrictions';
import { conflicts } from '../src/app/shortcuts';
import { episodeLabel, emptyGuide, parseXMLTV } from '../src/sources/epg';
import { sortItems } from '../src/screens/Vod';

describe('themes', () => {
  it('round-trips through a share code', () => {
    const t = { ...DEFAULT_THEME, name: 'Mine', accent: '#1e7be0', fontScale: 125 };
    expect(importTheme(exportTheme(t))).toEqual({ ...t, menu: 'solid' });
  });
  it('carries appearance only and rejects anything odd', () => {
    const evil = { name: '<b>x</b>', accent: '#123456', background: '#000000', fontScale: 999, menu: 'solid', password: 'secret', backgroundImage: 'javascript:alert(1)' };
    const t = cleanTheme(evil)!;
    expect(t).not.toHaveProperty('password');
    expect(t.backgroundImage).toBeUndefined();
    expect(t.fontScale).toBe(100);
    expect(t.name).not.toContain('<');
    expect(cleanTheme({ accent: 'red', background: '#000000' })).toBeNull();
    expect(importTheme('MTV1-!!!')).toBeNull();
    expect(importTheme('hello')).toBeNull();
  });
  it('derives the colour variables', () => {
    expect(themeVars(DEFAULT_THEME)['--blue']).toBe('#d3122a');
    expect(themeVars(DEFAULT_THEME)['--on-accent']).toBe('#ffffff');
    expect(themeVars(PRESETS.find(p => p.name === 'Galaxy gold')!)['--on-accent']).toBe('#111111');
  });
  it('moves only the untouched old default to the new look', () => {
    expect(isOldDefault(OLD_DEFAULT_THEME)).toBe(true);
    expect(isOldDefault({ ...OLD_DEFAULT_THEME, fontScale: 125 })).toBe(false);
    expect(isOldDefault({ ...OLD_DEFAULT_THEME, backgroundImage: 'https://example.com/a.jpg' })).toBe(false);
    expect(isOldDefault(PRESETS.find(p => p.name === 'Matrix red'))).toBe(false);
    expect(isOldDefault(DEFAULT_THEME)).toBe(false);
    expect(isOldDefault(PRESETS.find(p => p.name === 'Classic blue'))).toBe(true);
    expect(isOldDefault(undefined)).toBe(false);
  });
});

describe('parental controls', () => {
  const s = { hiddenGroups: ['live:UK | News'], lockedGroups: ['movie:Horror'], pinHash: 'x', lockAdult: true };
  it('spots adult categories', () => {
    expect(isAdultGroup('XXX | Adult')).toBe(true);
    expect(isAdultGroup('For Adults 18+')).toBe(true);
    expect(isAdultGroup('UK | Kids')).toBe(false);
  });
  it('locks until unlocked, and only with a PIN', () => {
    unlocked.value = false;
    expect(isLocked(s, 'movie', 'Horror')).toBe(true);
    expect(isLocked(s, 'live', 'Adult XXX')).toBe(true);
    expect(isLocked({ ...s, pinHash: '' }, 'movie', 'Horror')).toBe(false);
    unlocked.value = true;
    expect(isLocked(s, 'movie', 'Horror')).toBe(false);
    unlocked.value = false;
    expect(isHidden(s, 'live', 'UK | News')).toBe(true);
  });
  it('never stores the PIN itself', async () => {
    const h = await hashPin('1234');
    expect(h).not.toContain('1234');
    expect(h).toBe(await hashPin('1234'));
    expect(h).not.toBe(await hashPin('1235'));
  });
});

describe('remote buttons', () => {
  it('flags buttons sharing a job', () => {
    expect(conflicts({ red: 'home', green: 'home', blue: 'live' }).sort()).toEqual(['green', 'red']);
    expect(conflicts({ red: 'none', green: 'none' })).toEqual([]);
  });
});

describe('guide details', () => {
  it('reads episode numbers', () => {
    expect(episodeLabel('1.4.0/1')).toBe('S2 E5');
    expect(episodeLabel('.9.')).toBe('E10');
    expect(episodeLabel('')).toBe('');
  });
  it('keeps artwork, episode, category and rating from XMLTV', () => {
    const now = Date.UTC(2026, 10, 26, 12);
    const xml = `<tv><channel id="a"><display-name>A</display-name></channel>
      <programme start="20261126120000 +0000" stop="20261126130000 +0000" channel="a"><title>Show</title><sub-title>Pilot</sub-title>
      <desc>D</desc><category>Drama</category><episode-num system="xmltv_ns">0.0.</episode-num><icon src="http://i/x.jpg" /><rating><value>15</value></rating></programme></tv>`;
    const g = emptyGuide();
    parseXMLTV(xml, g, { now });
    expect(g.programmes.get('a')![0]).toMatchObject({ sub: 'Pilot', ep: 'S1 E1', cat: 'Drama', img: 'http://i/x.jpg', rating: '15' });
  });
});

describe('sorting', () => {
  const it2 = (name: string, added: number, src = 's1') => ({ name, added, rating: 0, year: 0, sourceId: src, key: name });
  const items = [it2('EN - Zulu', 1), it2('Alpha 10', 3, 's2'), it2('Alpha 2', 2)];
  it('sorts A–Z ignoring language prefixes and numbering naturally', () => {
    expect(sortItems(items, 'az', new Map(), []).map(x => x.name)).toEqual(['Alpha 2', 'Alpha 10', 'EN - Zulu']);
    expect(sortItems(items, 'za', new Map(), []).map(x => x.name)[0]).toBe('EN - Zulu');
  });
  it('keeps playlists apart with Playlist, then A–Z', () => {
    expect(sortItems(items, 'playlist-az', new Map(), ['s1', 's2']).map(x => x.name)).toEqual(['Alpha 2', 'EN - Zulu', 'Alpha 10']);
  });
  it('orders by recently watched', () => {
    expect(sortItems(items, 'watched', new Map([['Alpha 10', 5]]), [])[0].name).toBe('Alpha 10');
  });
});
