// Everything the viewer starred, by kind.
import { favourites, itemIndex } from '../sources/library';
import type { Channel, Movie, Series } from '../sources/types';
import { ChannelCard, PosterCard } from '../ui/cards';

export function Favourites() {
  const idx = itemIndex.value;
  const items = favourites.value.map(k => idx.get(k)).filter(Boolean);
  const live = items.filter((x): x is Channel => x!.kind === 'live');
  const movies = items.filter((x): x is Movie => x!.kind === 'movie');
  const series = items.filter((x): x is Series => x!.kind === 'series');
  return (
    <div class="screen opaque">
      <div class="page" style={{ paddingBottom: 0 }}><div class="page-head"><h1>Favourites</h1></div></div>
      {!items.length && <div class="empty"><h2>No favourites yet</h2><p>Hold OK on a channel, film or series and choose Add to favourites.</p></div>}
      {live.length > 0 && <section class="shelf"><h2>Channels</h2><div class="shelf-row" data-nav-group>{live.map(x => <ChannelCard key={x.key} channel={x} list={live} />)}</div></section>}
      {movies.length > 0 && <section class="shelf"><h2>Films</h2><div class="shelf-row" data-nav-group>{movies.map(x => <PosterCard key={x.key} item={x} />)}</div></section>}
      {series.length > 0 && <section class="shelf"><h2>Series</h2><div class="shelf-row" data-nav-group>{series.map(x => <PosterCard key={x.key} item={x} />)}</div></section>}
    </div>
  );
}
