// Colour themes. A theme is appearance only (colours, font size, style), never account data, so it
// can be shared as a short code safely.
export interface Theme {
  name: string;
  /** Selection and highlight colour. */
  accent: string;
  /** Page background. */
  background: string;
  /** Text size, percent. */
  fontScale: number;
  /** Side menu: solid or see-through. */
  menu: 'solid' | 'glass';
  /** Optional background picture (https URL). */
  backgroundImage?: string;
}

/** Flat blue: bright, simple and quick to draw on a TV stick. */
export const DEFAULT_THEME: Theme = { name: 'Classic blue', accent: '#1d9bf0', background: '#2b2a9c', fontScale: 100, menu: 'solid' };
/** The look before the Home redesign. Installs still on it move to the new default once. */
export const OLD_DEFAULT_THEME: Theme = { name: 'Matrix', accent: '#d3122a', background: '#0b0709', fontScale: 100, menu: 'solid' };

export const PRESETS: Theme[] = [
  DEFAULT_THEME,
  { name: 'Matrix red', accent: '#d3122a', background: '#0b0709', fontScale: 100, menu: 'solid' },
  { name: 'Ocean', accent: '#1e7be0', background: '#060b14', fontScale: 100, menu: 'solid' },
  { name: 'Emerald', accent: '#12a36b', background: '#05100c', fontScale: 100, menu: 'solid' },
  { name: 'Gold', accent: '#c98a12', background: '#0e0b05', fontScale: 100, menu: 'solid' },
  { name: 'Violet', accent: '#7b4ce0', background: '#0b0814', fontScale: 100, menu: 'solid' },
  { name: 'Graphite', accent: '#8a94a6', background: '#0b0c0e', fontScale: 100, menu: 'solid' },
  { name: 'Large text', accent: '#1d9bf0', background: '#2b2a9c', fontScale: 125, menu: 'solid' },
];

const HEX = /^#[0-9a-f]{6}$/i;
const rgb = (h: string) => { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
const hex = (r: number, g: number, b: number) => `#${[r, g, b].map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;
/** Mixes a colour towards white (k > 0) or black (k < 0). */
export function shade(h: string, k: number): string {
  const [r, g, b] = rgb(h);
  const t = k > 0 ? 255 : 0, a = Math.abs(k);
  return hex(r + (t - r) * a, g + (t - g) * a, b + (t - b) * a);
}

/** The CSS variables a theme sets. */
export function themeVars(t: Theme): Record<string, string> {
  const a = t.accent, bg = t.background;
  return {
    '--blue': a, '--violet': shade(a, 0.15), '--cyan': shade(a, 0.3),
    '--grad': `linear-gradient(180deg, ${shade(a, 0.1)}, ${shade(a, -0.22)})`,
    '--ring': `0 0 0 0.16rem ${shade(a, 0.35)}`, '--glow': `0 0 0 0.16rem ${shade(a, 0.35)}`,
    '--accent-soft': shade(a, -0.72), '--accent-line': `${shade(a, 0.2)}66`, '--accent-glow': `${shade(a, -0.55)}88`,
    '--rail-glass': `${shade(bg, 0.04)}b3`,
    '--bg': bg, '--bg-2': shade(bg, 0.04), '--bg-3': shade(bg, 0.08), '--bg-4': shade(bg, 0.14), '--bg-lit': shade(bg, 0.16),
    // Secondary text tinted by the background, so it stays readable on light and dark themes alike.
    '--muted': shade(bg, 0.72), '--faint': shade(bg, 0.48),
  };
}

export function applyTheme(t: Theme) {
  const root = document.documentElement;
  for (const [k, v] of Object.entries(themeVars(t))) root.style.setProperty(k, v);
  root.style.fontSize = t.fontScale === 100 ? '' : `calc(clamp(13px, min(1.05vw, 1.9vh), 22px) * ${t.fontScale / 100})`;
  root.dataset.menu = t.menu;
  root.style.setProperty('--bg-image', t.backgroundImage ? `url("${t.backgroundImage.replace(/["\\\\]/g, '')}")` : 'none');
}

/** Only the fields a theme may contain, checked, so an imported code can't carry anything else. */
export function cleanTheme(x: unknown): Theme | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  if (typeof o.accent !== 'string' || !HEX.test(o.accent) || typeof o.background !== 'string' || !HEX.test(o.background)) return null;
  const img = typeof o.backgroundImage === 'string' && /^https:\/\/[^\s"'()<>]{4,400}$/.test(o.backgroundImage) ? o.backgroundImage : undefined;
  return {
    name: typeof o.name === 'string' ? o.name.replace(/[<>]/g, '').slice(0, 30) || 'Imported' : 'Imported',
    accent: o.accent.toLowerCase(), background: o.background.toLowerCase(),
    fontScale: [90, 100, 110, 125, 150].includes(o.fontScale as number) ? (o.fontScale as number) : 100,
    menu: o.menu === 'glass' ? 'glass' : 'solid',
    ...(img ? { backgroundImage: img } : {}),
  };
}

/** "MTV1-…": a theme as a short code to share. */
export function exportTheme(t: Theme): string {
  const c = cleanTheme(t)!;
  const json = JSON.stringify(c);
  return `MTV1-${btoa(unescape(encodeURIComponent(json))).replace(/=+$/, '')}`;
}
export function importTheme(code: string): Theme | null {
  const m = /^MTV1-([A-Za-z0-9+/]+)$/.exec(code.trim());
  if (!m) return null;
  try { return cleanTheme(JSON.parse(decodeURIComponent(escape(atob(m[1]))))); } catch { return null; }
}

/** True for a saved theme that is just the old default (not one the viewer chose or edited). */
export function isOldDefault(t: Partial<Theme> | undefined): boolean {
  return !!t && t.name === OLD_DEFAULT_THEME.name && t.accent === OLD_DEFAULT_THEME.accent && t.background === OLD_DEFAULT_THEME.background
    && (t.fontScale ?? 100) === 100 && !t.backgroundImage;
}
