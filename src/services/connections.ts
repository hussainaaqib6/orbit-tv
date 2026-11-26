// Provider-reported connection use for Xtream Codes playlists ("Connections: 1 / 2").
// The figures come only from the provider's own account info; when it doesn't report them, the
// answer is "unknown" rather than a guess.
import { signal } from '@preact/signals';
import { request } from '../core/http';
import { xtBase } from '../sources/xtream';
import type { Source } from '../sources/types';

export interface Connections { active: number | null; max: number | null; at: number }
export const connections = signal<Record<string, Connections>>({});

const num = (v: unknown) => (v === undefined || v === null || v === '' || !isFinite(+v) ? null : +v);

/** Reads the counts from user_info (active_cons, max_connections). */
export function parseConnections(info: { user_info?: { active_cons?: unknown; max_connections?: unknown } } | null): Omit<Connections, 'at'> {
  return { active: num(info?.user_info?.active_cons), max: num(info?.user_info?.max_connections) };
}

const inflight = new Map<string, Promise<void>>();

/** Asks the provider again (at most every 15 seconds per playlist). */
export function refreshConnections(src: Source): Promise<void> {
  if (src.type !== 'xtream') return Promise.resolve();
  const prev = connections.value[src.id];
  if (prev && Date.now() - prev.at < 15000) return Promise.resolve();
  const running = inflight.get(src.id);
  if (running) return running;
  const q = `username=${encodeURIComponent(src.user ?? '')}&password=${encodeURIComponent(src.pass ?? '')}`;
  const p = request<{ user_info?: Record<string, unknown> }>(`${xtBase(src.server ?? '')}/player_api.php?${q}`, { timeoutMs: 10000 })
    .then(info => { connections.value = { ...connections.value, [src.id]: { ...parseConnections(info), at: Date.now() } }; })
    .catch(() => { connections.value = { ...connections.value, [src.id]: { active: null, max: null, at: Date.now() } }; })
    .finally(() => inflight.delete(src.id));
  inflight.set(src.id, p);
  return p;
}

export function connectionsLabel(src: Source): string {
  if (src.type !== 'xtream') return '';
  const c = connections.value[src.id];
  if (!c) return 'Connections: checking…';
  if (c.active === null || c.max === null) return 'Connections: unknown';
  if (c.max > 0 && c.active >= c.max) return `Connection limit reached (${c.active} / ${c.max})`;
  return `Connections: ${c.active} / ${c.max}`;
}
