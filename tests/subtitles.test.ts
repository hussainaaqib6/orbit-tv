import { describe, expect, it } from 'vitest';
import { parseSubtitles, cueAt, cueHtml } from '../src/services/subtitles';
import { osHash, releaseSimilarity } from '../src/services/opensubtitles';

const SRT = `\uFEFF1
00:00:01,000 --> 00:00:02,500
Hello <font color="red">there</font>

2
00:00:03,000 --> 00:00:04,000
{\\an8}<i>Second</i>
line
`;

describe('subtitles', () => {
  const cues = parseSubtitles(SRT);
  it('parses SRT, dropping unsupported tags', () => {
    expect(cues).toEqual([
      { start: 1, end: 2.5, text: 'Hello there' },
      { start: 3, end: 4, text: '<i>Second</i>\nline' },
    ]);
  });
  it('parses WebVTT with short timestamps', () => {
    const v = parseSubtitles('WEBVTT\n\n00:01.000 --> 00:02.000 align:start\nHi\n');
    expect(v).toEqual([{ start: 1, end: 2, text: 'Hi' }]);
  });
  it('shifts with the delay', () => {
    expect(cueAt(cues, 1.2)).toBe('Hello there');
    expect(cueAt(cues, 1.2, 0.5)).toBe('');      // subtitles later: not shown yet
    expect(cueAt(cues, 1.6, 0.5)).toBe('Hello there');
    expect(cueAt(cues, 0.6, -0.5)).toBe('Hello there'); // earlier
  });
  it('corrects frame rate', () => {
    // A cue at 25 s in a 23.976 fps file plays at 25 * 23.976/25 s in a 25 fps video.
    const c = [{ start: 100, end: 101, text: 'x' }];
    expect(cueAt(c, 100 * 23.976 / 25 + 0.1, 0, 25 / 23.976)).toBe('x');
  });
  it('escapes HTML but keeps basic styling', () => {
    expect(cueHtml('<i>a</i> & <script>\nb')).toBe('<i>a</i> &amp; &lt;script&gt;<br>b');
  });
});

describe('OpenSubtitles', () => {
  it('computes the hash like the reference implementation', () => {
    // Size only (all-zero chunks): hash is the size in hex.
    const z = new Uint8Array(65536);
    expect(osHash(z, z, 131072)).toBe('0000000000020000');
    // One little-endian word of 1 in each chunk adds 2.
    const a = new Uint8Array(65536); a[0] = 1;
    expect(osHash(a, a, 131072)).toBe('0000000000020002');
    // Wraps at 64 bits.
    const f = new Uint8Array(65536).fill(0xff, 0, 8);
    expect(osHash(f, z, 1)).toBe('0000000000000000');
  });
  it('ranks release names by shared words', () => {
    expect(releaseSimilarity('The.Matrix.1999.1080p.BluRay.x264', 'The Matrix 1999 1080p BluRay')).toBeGreaterThan(releaseSimilarity('The.Matrix.1999.720p.WEB', 'The Matrix 1999 1080p BluRay'));
  });
});

import { pickSubtitleTrack, trackLanguage } from '../src/services/subtitles';
describe('choosing a film\'s own subtitles', () => {
  it('reads two- and three-letter codes and labels', () => {
    expect(trackLanguage('eng', '')).toBe('en');
    expect(trackLanguage('en-GB', '')).toBe('en');
    expect(trackLanguage('und', 'English SDH')).toBe('en');
    expect(trackLanguage('', 'Track 1')).toBe('');
  });
  it('picks the full track in the viewer\'s language over a forced one', () => {
    const t = [{ id: 'a', language: 'fre', label: 'French' }, { id: 'b', language: 'eng', label: 'English Forced' }, { id: 'c', language: 'eng', label: 'English' }];
    expect(pickSubtitleTrack(t, 'en')?.id).toBe('c');
    expect(pickSubtitleTrack(t, 'de')).toBeNull();
  });
  it('uses a single unlabelled track', () => {
    expect(pickSubtitleTrack([{ id: 'x', language: '', label: 'Subtitles 1' }], 'en')?.id).toBe('x');
  });
});
