// Subtitle files (SRT / WebVTT) parsed into cues, so Orbit can draw them itself over any player
// engine, shift them in time, and correct frame-rate mismatches.

export interface Cue { start: number; end: number; text: string }

const TIME = /(?:(\d+):)?(\d{1,2}):(\d{1,2})[,.](\d{1,3})/;

function toSeconds(s: string): number {
  const m = TIME.exec(s);
  if (!m) return NaN;
  return (+(m[1] || 0)) * 3600 + +m[2] * 60 + +m[3] + +m[4].padEnd(3, '0') / 1000;
}

/** Strips tags the renderer does not support, keeping line breaks. Italic/bold are kept as <i>/<b>. */
function cleanText(t: string): string {
  return t
    .replace(/\{\\[^}]*\}/g, '')            // SSA override codes {\an8}
    .replace(/<(?!\/?(i|b|u)>)[^>]+>/gi, '') // any tag but i/b/u
    .trim();
}

/** Parses SRT or WebVTT text. Cues are returned sorted by start time. */
export function parseSubtitles(input: string): Cue[] {
  const text = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const cues: Cue[] = [];
  for (const block of text.split(/\n{2,}/)) {
    const lines = block.split('\n');
    const ti = lines.findIndex(l => l.includes('-->'));
    if (ti < 0) continue;
    const [a, b] = lines[ti].split('-->');
    const start = toSeconds(a), end = toSeconds(b);
    if (!isFinite(start) || !isFinite(end)) continue;
    const body = cleanText(lines.slice(ti + 1).join('\n'));
    if (body) cues.push({ start, end: Math.max(end, start + 0.2), text: body });
  }
  return cues.sort((x, y) => x.start - y.start);
}

/**
 * Cue text at `time`. `delay` shifts subtitles later (positive) or earlier (negative), in seconds.
 * `rate` corrects subtitles made for a different frame rate (for example 25/23.976).
 */
export function cueAt(cues: Cue[], time: number, delay = 0, rate = 1): string {
  const t = (time - delay) * rate;
  let lo = 0, hi = cues.length - 1, idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].start <= t) { idx = mid; lo = mid + 1; } else hi = mid - 1;
  }
  const out: string[] = [];
  // Overlapping cues: look back a few.
  for (let i = idx; i >= 0 && i > idx - 4; i--) if (cues[i].end > t) out.unshift(cues[i].text);
  return out.join('\n');
}

/** Frame-rate corrections offered in the subtitle menu. */
export const RATE_PRESETS: { label: string; rate: number }[] = [
  { label: 'None', rate: 1 },
  { label: '23.976 → 25 fps', rate: 25 / 23.976 },
  { label: '25 → 23.976 fps', rate: 23.976 / 25 },
  { label: '24 → 25 fps', rate: 25 / 24 },
  { label: '25 → 24 fps', rate: 24 / 25 },
];

/** Escapes text for HTML, keeping <i>, <b>, <u> and line breaks. */
export function cueHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/&lt;(\/?)(i|b|u)&gt;/gi, '<$1$2>')
    .replace(/\n/g, '<br>');
}
