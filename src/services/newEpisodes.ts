// New episodes of favourite series. Each start, the episode count of every favourite Xtream series is
// checked (one request at a time, gently). When a series has more episodes than last time, its newest
// episode is marked new until that episode has been watched to the end.
import { signal } from '@preact/signals';
import { store } from '../core/storage';
import { favourites, itemIndex, watched, sourceById } from '../sources/library';
import { loadXtreamSeriesInfo } from '../sources/xtream';
import type { Series } from '../sources/types';

interface Track { count: number; latestKey: string; newKey?: string; at: number }
export const episodeTracks = signal<Record<string, Track>>(store.get('episodeTracks', {}));

/** The new episode's key if this series has one not yet watched. */
export function newEpisodeOf(s: Series): string | null {
  const t = episodeTracks.value[s.key];
  return t?.newKey && !watched.value[t.newKey] ? t.newKey : null;
}

let running = false;
export async function checkNewEpisodes(max = 25): Promise<void> {
  if (running) return;
  running = true;
  try {
    const idx = itemIndex.value;
    const list = favourites.value.map(k => idx.get(k)).filter((x): x is Series => x?.kind === 'series').slice(0, max);
    for (const s of list) {
      const src = sourceById(s.sourceId);
      if (!src || src.type !== 'xtream') continue;
      try {
        const info = await loadXtreamSeriesInfo(src, s);
        const eps = Object.keys(info.seasons).map(Number).sort((a, b) => a - b).flatMap(n => info.seasons[n]);
        if (!eps.length) continue;
        const latest = eps[eps.length - 1].key;
        const prev = episodeTracks.value[s.key];
        const next: Track = { count: eps.length, latestKey: latest, at: Date.now(), newKey: prev?.newKey };
        if (prev && eps.length > prev.count) next.newKey = latest;
        episodeTracks.value = { ...episodeTracks.value, [s.key]: next };
        store.set('episodeTracks', episodeTracks.value);
      } catch { /* try again next start */ }
      await new Promise(r => setTimeout(r, 1500));
    }
  } finally { running = false; }
}
