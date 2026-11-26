// The rows on Home, which the viewer can turn on/off, reorder, and add sports rows to.
export interface HomeRow { id: string; on: boolean }

export const ROW_LABELS: Record<string, string> = {
  continue: 'Continue watching', newEpisodes: 'New episodes', favChannels: 'Favourite channels', recentChannels: 'Recently watched channels',
  favVod: 'Your favourites', newMovies: 'Recently added films', newSeries: 'Recently added series', unwatchedMovies: 'Films you haven’t watched',
  unwatchedSeries: 'Series you haven’t started', watched: 'Watched', liveChannels: 'Live TV',
};

/** Watched is off unless switched on (spec 34). */
export const DEFAULT_ROWS: HomeRow[] = [
  { id: 'continue', on: true }, { id: 'newEpisodes', on: true }, { id: 'favChannels', on: true }, { id: 'recentChannels', on: true },
  { id: 'favVod', on: true }, { id: 'newMovies', on: true }, { id: 'newSeries', on: true }, { id: 'unwatchedMovies', on: false },
  { id: 'unwatchedSeries', on: false }, { id: 'watched', on: false }, { id: 'liveChannels', on: true },
];

/** The viewer's rows, with any rows added in a later version appended. */
export function homeRows(saved: HomeRow[]): HomeRow[] {
  const ids = new Set(saved.map(r => r.id));
  return [...saved.filter(r => r.id.startsWith('sport:') || ROW_LABELS[r.id]), ...DEFAULT_ROWS.filter(r => !ids.has(r.id))];
}
