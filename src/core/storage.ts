// Small settings live in localStorage. On phones they are mirrored to native Preferences,
// because iOS may clear web storage when the device runs low on space.
// Large data (playlists, guides) goes to IndexedDB through idb.ts.
import { Preferences } from '@capacitor/preferences';
import { NATIVE } from './platform';

const PREFIX = 'orbit2.';

export const store = {
  get<T>(key: string, fallback: T): T {
    try {
      const v = localStorage.getItem(PREFIX + key);
      return v == null ? fallback : (JSON.parse(v) as T);
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown): void {
    const json = JSON.stringify(value);
    try { localStorage.setItem(PREFIX + key, json); } catch { /* storage full: native mirror still has it */ }
    if (NATIVE) Preferences.set({ key: PREFIX + key, value: json }).catch(() => {});
  },
  remove(key: string): void {
    try { localStorage.removeItem(PREFIX + key); } catch {}
    if (NATIVE) Preferences.remove({ key: PREFIX + key }).catch(() => {});
  },
  /** Copy anything the native mirror has that web storage lost. Call once at start-up. */
  async restore(): Promise<void> {
    if (!NATIVE) return;
    try {
      const { keys } = await Preferences.keys();
      for (const key of keys) {
        if (!key.startsWith(PREFIX) || localStorage.getItem(key) != null) continue;
        const { value } = await Preferences.get({ key });
        if (value != null) localStorage.setItem(key, value);
      }
    } catch {}
  },
};
