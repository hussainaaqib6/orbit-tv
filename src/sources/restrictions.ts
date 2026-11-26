// Hidden categories and parental controls.
//
// Hidden: the viewer doesn't want to see a category. It disappears from lists, search, the guide
// and sports, but favourites from it stay (marked with a crossed-out eye).
// Locked: needs the PIN. Locked categories (and, if switched on, adult ones) are removed everywhere,
// favourites included, until the PIN is entered; they lock again when the app closes or on "Lock now".
import { signal } from '@preact/signals';

export type Kind = 'live' | 'movie' | 'series';
export const groupKey = (kind: Kind, group: string) => `${kind}:${group}`;

const ADULT = /\b(adult|adults|xxx|porn|18\s?\+|\+\s?18|for adults|erotic|sexy|playboy|hustler|brazzers)\b/i;
export const isAdultGroup = (group: string) => ADULT.test(group);

export interface RestrictionSettings { hiddenGroups: string[]; lockedGroups: string[]; pinHash: string; lockAdult: boolean }

/** True after the PIN has been entered in this session. */
export const unlocked = signal(false);

export function isLocked(s: RestrictionSettings, kind: Kind, group: string): boolean {
  if (!s.pinHash || unlocked.value) return false;
  return s.lockedGroups.includes(groupKey(kind, group)) || (s.lockAdult && isAdultGroup(group));
}
export const isHidden = (s: RestrictionSettings, kind: Kind, group: string) => s.hiddenGroups.includes(groupKey(kind, group));

/** SHA-256 of the PIN, so the PIN itself is never stored. */
export async function hashPin(pin: string): Promise<string> {
  const data = new TextEncoder().encode(`matrix-tv:${pin}`);
  if (globalThis.crypto?.subtle) {
    const d = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  // No WebCrypto (very old WebViews): a simple FNV hash is still better than the plain PIN.
  let h = 0x811c9dc5;
  for (const b of data) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0; }
  return `fnv${h.toString(16)}`;
}

export const validPin = (pin: string) => /^\d{4}$/.test(pin);
