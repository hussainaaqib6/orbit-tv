import { describe, expect, it } from 'vitest';
import { sourceFromPhone } from '../src/screens/PairingPanel';
import { PHONE_PAGE } from '../src/screens/phonePage';

describe('adding a playlist from a phone', () => {
  it('turns the phone form into an Xtream login', () => {
    expect(sourceFromPhone({ type: 'xtream', server: ' http://tv.example.com:8080 ', user: 'me', pass: 'pw', name: '' }))
      .toEqual({ type: 'xtream', name: 'tv.example.com', server: 'http://tv.example.com:8080', user: 'me', pass: 'pw' });
  });
  it('accepts M3U links and MAC portals', () => {
    expect(sourceFromPhone({ type: 'm3u', url: 'http://h/get.php?a=1', name: 'Mine' })).toEqual({ type: 'm3u', name: 'Mine', url: 'http://h/get.php?a=1' });
    expect(sourceFromPhone({ type: 'stalker', portal: 'http://p/c/', mac: '00-1a-79-12-34-56' })).toMatchObject({ type: 'stalker', mac: '00:1A:79:12:34:56' });
  });
  it('explains what is missing', () => {
    expect(sourceFromPhone({ type: 'xtream', server: 'h', user: '', pass: '' })).toMatch(/username and password/);
    expect(sourceFromPhone({ type: 'm3u', url: 'ftp://x' })).toMatch(/http/);
    expect(sourceFromPhone({ type: 'stalker', portal: 'p', mac: '12' })).toMatch(/MAC/);
  });
  it('serves a page with the form and a sent state', () => {
    expect(PHONE_PAGE).toContain('<!--STATE-->');
    expect(PHONE_PAGE).toContain('name="server"');
    expect(PHONE_PAGE).toContain('method="post"');
  });
});
