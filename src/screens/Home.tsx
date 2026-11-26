// Home: the hub. Four big tiles (Live TV, TV Guide, Movies, Series), a row of small shortcuts under
// them, and the clock. Every screen opens from here, and Back from any screen comes back here.
// Deliberately light: no artwork to fetch and no rows to build, so it appears instantly.
import { useEffect, useState } from 'preact/hooks';
import { catalog, favourites, recentChannels, errors, loaded, loading, loadingSince, reload, settings, sources } from '../sources/library';
import { Icon, type IconName } from '../ui/icons';
import { Wordmark } from '../ui/brand';
import { goRoot, type Route } from '../nav/router';
import { clock } from '../core/format';
import { lastChannel, lastChannelTarget } from '../player/controller';
import { cleanChannelName } from '../core/names';

const count = (n: number, one: string, many: string) => (n ? `${n.toLocaleString()} ${n === 1 ? one : many}` : '');

function Tile({ icon, label, sub, to, auto }: { icon: IconName; label: string; sub: string; to: Route; auto?: boolean }) {
  return (
    <button class={`dash-tile t-${to.name}`} data-autofocus={auto || undefined} onClick={() => goRoot(to)} aria-label={label}>
      <span class="dash-tile-icon"><Icon name={icon} /></span>
      <span class="dash-tile-label">{label}</span>
      <span class="dash-tile-sub tnum">{sub || ' '}</span>
    </button>
  );
}

function Small({ icon, label, onClick }: { icon: IconName; label: string; onClick: () => void }) {
  return (
    <button class="dash-small" onClick={onClick} aria-label={label}>
      <span class="dash-small-icon"><Icon name={icon} /></span>
      <span class="dash-small-label clip">{label}</span>
    </button>
  );
}

export function Home() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(t); }, []);

  if (!loaded.value) return <LoadingPlaylists />;
  const c = catalog.value;
  const nothing = !c.live.length && !c.movies.length && !c.series.length;
  const expires = sources.value.find(s => s.enabled && s.expires)?.expires;
  const last = settings.value.lastChannelButton && recentChannels.value.length > 0 ? lastChannelTarget() : null;
  const date = new Date(now).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div class="screen dash">
      <header class="dash-top">
        <Wordmark class="dash-mark" />
        <div class="dash-clock"><b class="tnum">{clock(now)}</b><span>{date}</span></div>
      </header>

      {nothing ? (
        <div class="empty">
          <h2>Your playlists did not return anything</h2>
          {errors.value.map(e => <p key={e} class="error-text">{e}</p>)}
          <button class="btn primary" data-autofocus onClick={() => goRoot({ name: 'settings', section: 'playlists' })}>Check playlists</button>
        </div>
      ) : (
        <div class="dash-tiles" data-nav-group data-nav-scope="down">
          <Tile icon="live" label="Live TV" sub={count(c.live.length, 'channel', 'channels')} to={{ name: 'live' }} auto />
          <Tile icon="guide" label="TV Guide" sub="What's on" to={{ name: 'guide' }} />
          <Tile icon="movies" label="Movies" sub={count(c.movies.length, 'film', 'films')} to={{ name: 'movies' }} />
          <Tile icon="series" label="Series" sub={count(c.series.length, 'series', 'series')} to={{ name: 'series' }} />
        </div>
      )}

      <div class="dash-row" data-nav-group data-nav-scope="up">
        {favourites.value.length > 0 && <Small icon="heart" label="Favourites" onClick={() => goRoot({ name: 'favourites' })} />}
        {recentChannels.value.length > 0 && <Small icon="history" label="Recently watched" onClick={() => goRoot({ name: 'live', group: '\u0001recent' })} />}
        {last && <Small icon="last" label={cleanChannelName(last.name).name} onClick={() => lastChannel()} />}
        <Small icon="sports" label="Live Sports" onClick={() => goRoot({ name: 'sports' })} />
        <Small icon="search" label="Search" onClick={() => goRoot({ name: 'search' })} />
        <Small icon="refresh" label="Reload playlist" onClick={() => reload(true)} />
        <Small icon="settings" label="Settings" onClick={() => goRoot({ name: 'settings' })} />
      </div>

      {expires ? <footer class="dash-foot tnum">Expires: {new Date(expires).toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' })}</footer> : null}
    </div>
  );
}

/** First load: say what is happening, and offer a way out if it stalls. */
function LoadingPlaylists() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const since = loadingSince.value;
  const slow = !since || now - since > 45000;
  const secs = since ? Math.round((now - since) / 1000) : 0;
  return (
    <div class="screen">
      <div class="empty">
        {since ? <span class="spinner big" /> : null}
        <h2>{since ? 'Loading your playlists' : 'Your playlists have not loaded'}</h2>
        <p class="tnum">{loading.value || ' '}{since && secs > 5 ? `  (${secs} s)` : ''}</p>
        {slow && (
          <>
            {since && <p class="muted" style={{ maxWidth: '34rem' }}>Large playlists can take a minute on a TV stick. If nothing changes, try again or check the login details.</p>}
            {errors.value.map(e => <p key={e} class="error-text">{e}</p>)}
            <div class="row" style={{ justifyContent: 'center' }}>
              <button class="btn primary" data-autofocus onClick={() => reload(true)}><Icon name="refresh" />Try again</button>
              <button class="btn quiet" onClick={() => goRoot({ name: 'settings', section: 'playlists' })}>Playlist settings</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
