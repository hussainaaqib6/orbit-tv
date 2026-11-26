// What the start-up screen shows: how far each part of the playlist has got.
import { signal } from '@preact/signals';
import { OrbitPlayer } from '../core/native';
import { PLATFORM } from '../core/platform';

export type Part = 'live' | 'guide' | 'movies' | 'series';
export const PARTS: Part[] = ['live', 'guide', 'movies', 'series'];

export interface PartState {
  status: 'waiting' | 'loading' | 'done' | 'error';
  /** Bytes arrived so far for the current download, and the size if the server said (0 = unknown). */
  bytes: number;
  total: number;
  /** Items found so far (programmes for the guide). */
  count: number;
  /** Extra line under the count, e.g. "Up to date" or the reason it failed. */
  note: string;
}

const blank = (): PartState => ({ status: 'waiting', bytes: 0, total: 0, count: 0, note: '' });
export const parts = signal<Record<Part, PartState>>({ live: blank(), guide: blank(), movies: blank(), series: blank() });

export function setPart(p: Part, patch: Partial<PartState>) {
  parts.value = { ...parts.value, [p]: { ...parts.value[p], ...patch } };
}
export function resetParts(which: Part[] = PARTS) {
  const next = { ...parts.value };
  for (const p of which) next[p] = blank();
  parts.value = next;
}

/** True while the start-up screen is up. */
export const booting = signal(false);
/** Set when the work behind the start-up screen has finished, so it can step aside. */
export const bootFinished = signal(false);

/** Runs a load behind the start-up screen (the four boxes), then lets the app in. */
export async function withStartup(task: () => Promise<void>): Promise<void> {
  booting.value = true;
  bootFinished.value = false;
  try { await task(); } finally { bootFinished.value = true; }
}

if (PLATFORM === 'android') {
  OrbitPlayer.addListener('progress', e => {
    const p = e.id as Part;
    if (!PARTS.includes(p)) return;
    const cur = parts.value[p];
    if (cur.status !== 'loading') return;
    setPart(p, { bytes: e.bytes, total: e.total > 0 ? e.total : 0, count: p === 'guide' ? e.items : cur.count });
  }).catch(() => {});
}
