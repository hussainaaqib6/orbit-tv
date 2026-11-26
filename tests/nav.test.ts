import { describe, expect, it } from 'vitest';
import { nextInDirection } from '../src/nav/focus';
import { actionForKey } from '../src/nav/keys';
import { find } from '../src/screens/Search';

const rect = (x: number, y: number, w = 100, h = 40) => ({ left: x, top: y, right: x + w, bottom: y + h, width: w, height: h, x, y, toJSON() {} }) as DOMRect;
const el = (name: string) => ({ name }) as unknown as HTMLElement;

describe('spatial navigation', () => {
  const a = el('a'), b = el('b'), c = el('c'), d = el('d');
  const cands = [{ el: a, r: rect(0, 100) }, { el: b, r: rect(300, 0) }, { el: c, r: rect(120, 0) }, { el: d, r: rect(0, 200) }];
  it('prefers the nearest item in line', () => {
    expect(nextInDirection(rect(0, 0), 'right', cands)).toBe(c);
    expect(nextInDirection(rect(0, 0), 'down', cands)).toBe(a);
    expect(nextInDirection(rect(0, 100), 'down', cands)).toBe(d);
  });
  it('returns nothing when there is nothing that way', () => {
    expect(nextInDirection(rect(0, 0), 'up', cands)).toBeNull();
    expect(nextInDirection(rect(0, 0), 'left', cands)).toBeNull();
  });
  it('prefers an overlapping row over a closer diagonal', () => {
    const row = el('row'), diag = el('diag');
    expect(nextInDirection(rect(0, 0), 'right', [{ el: diag, r: rect(110, 60) }, { el: row, r: rect(400, 5) }])).toBe(row);
  });
});

describe('keys', () => {
  it('maps remote keys', () => {
    expect(actionForKey({ key: 'ArrowUp', keyCode: 38 }, false)).toBe('up');
    expect(actionForKey({ key: 'Unidentified', keyCode: 85 }, false)).toBe('playpause');
    expect(actionForKey({ key: 'GoBack', keyCode: 0 }, false)).toBe('back');
    expect(actionForKey({ key: '7', keyCode: 55 }, false)).toBe('digit7');
  });
  it('lets typing through in text fields', () => {
    expect(actionForKey({ key: '7', keyCode: 55 }, true)).toBeNull();
    expect(actionForKey({ key: 'Backspace', keyCode: 8 }, true)).toBeNull();
    expect(actionForKey({ key: 'f', keyCode: 70 }, true)).toBeNull();
    expect(actionForKey({ key: 'Escape', keyCode: 27 }, true)).toBe('back');
    // On-screen keyboard (Fire TV, Android TV): every letter arrives as keyCode 229. It is typing,
    // never the Last channel button (which made the first letter of a search jump channels).
    expect(actionForKey({ key: 'Unidentified', keyCode: 229 }, true)).toBeNull();
    expect(actionForKey({ key: 'Process', keyCode: 229 }, true)).toBeNull();
    expect(actionForKey({ key: 'Unidentified', keyCode: 229 }, false)).toBeNull();
    // Letters whose key codes match old remote codes must stay letters.
    expect(actionForKey({ key: 'u', keyCode: 85 }, true)).toBeNull();
    expect(actionForKey({ key: 'y', keyCode: 89 }, true)).toBeNull();
    expect(actionForKey({ key: 'u', keyCode: 85 }, false)).toBeNull();
  });
});

describe('search', () => {
  const list = [{ name: 'BBC One' }, { name: 'One Piece' }, { name: 'Pokémon' }, { name: 'BBC Two' }];
  it('matches all words, starts-with first, ignoring accents', () => {
    expect(find(list, 'one').map(x => x.name)).toEqual(['One Piece', 'BBC One']);
    expect(find(list, 'bbc two').map(x => x.name)).toEqual(['BBC Two']);
    expect(find(list, 'pokemon').map(x => x.name)).toEqual(['Pokémon']);
  });
});
