// Home: the hub, laid out like GalaxyXC's home (docs/GALAXYXC_REFERENCE.md): time and date top left,
// logo top centre, small icon buttons top right; four big square tiles across the middle (Live TV,
// TV Guide, VOD, Series); a footer with an accent line along its top, buttons at both ends and the
// account expiry in the middle. Tiles are outlined squares with an icon and an upper-case name.
// Every screen opens from here, and Back from any screen comes back here. Deliberately light: no
// artwork to fetch and no rows to build, so it appears instantly.
import { useEffect, useRef, useState } from 'preact/hooks';
import { onAction } from '../nav/keys';
import { focusEl } from '../nav/focus';
import { catalog, favourites, errors, loaded, loading, loadingSince, reload, sources } from '../sources/library';
import { Icon, type IconName } from '../ui/icons';
import { Wordmark } from '../ui/brand';
import { goRoot, type Route } from '../nav/router';
import { clock } from '../core/format';

const count = (n: number, one: string, many: string) => (n ? `${n.toLocaleString()} ${n === 1 ? one : many}` : '');

function Tile({ icon, label, sub, onClick, big, auto }: { icon: IconName; label: string; sub?: string; onClick: () => void; big?: boolean; auto?: boolean }) {
  return (
    <button class={`gx-tile${big ? ' big' : ''}`} data-autofocus={auto || undefined} onClick={onClick} aria-label={label}>
      <span class="gx-icon"><Icon name={icon} /></span>
      <span class="gx-label">{label}</span>
      {sub !== undefined && <span class="gx-sub tnum">{sub || ' '}</span>}
    </button>
  );
}

export function Home() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(t); }, []);
  // Up/Down always move between the three rows (top buttons, big tiles, footer), never diagonally
  // across them, and land on the tile you last had in that row (like GalaxyXC).
  const root = useRef<HTMLDivElement>(null);
  const lastIn = useRef<Record<string, HTMLElement | null>>({});
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const rows = ['.gx-tools', '.gx-big', '.gx-foot'];
    const onIn = (e: FocusEvent) => {
      const t = e.target as HTMLElement;
      for (const r of rows) if (t.closest(r)) lastIn.current[r] = t;
    };
    el.addEventListener('focusin', onIn);
    const off = onAction(el, a => {
      if (a !== 'up' && a !== 'down') return;
      const cur = document.activeElement as HTMLElement | null;
      const i = rows.findIndex(r => cur?.closest(r));
      if (i < 0) return;
      for (let j = i + (a === 'down' ? 1 : -1); j >= 0 && j < rows.length; j += a === 'down' ? 1 : -1) {
        const row = el.querySelector<HTMLElement>(rows[j]);
        const target = (lastIn.current[rows[j]]?.isConnected && lastIn.current[rows[j]]) || row?.querySelector<HTMLElement>('button');
        if (target) { focusEl(target); return true; }
      }
      return true;
    });
    return () => { el.removeEventListener('focusin', onIn); off(); };
  }, [loaded.value]);

  if (!loaded.value) return <LoadingPlaylists />;
  const c = catalog.value;
  const nothing = !c.live.length && !c.movies.length && !c.series.length;
  const src = sources.value.find(s => s.enabled && s.expires) ?? sources.value.find(s => s.enabled);
  const expires = src?.expires;
  const date = new Date(now).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const go = (to: Route) => () => goRoot(to);

  return (
    <div class="screen dash" ref={root}>
      <header class="gx-top">
        <div class="gx-clock"><b class="tnum">{clock(now)}</b><span>{date}</span></div>
        <Wordmark class="gx-logo" />
        <div class="gx-tools" data-nav-group>
          <IconBtn icon="search" label="Search" onClick={go({ name: 'search' })} />
          <IconBtn icon="refresh" label="Update contents" onClick={() => reload(true)} />
        </div>
      </header>

      {nothing ? (
        <div class="empty">
          <h2>Your playlists did not return anything</h2>
          {errors.value.map(e => <p key={e} class="error-text">{e}</p>)}
          <button class="btn primary" data-autofocus onClick={() => goRoot({ name: 'settings', section: 'playlists' })}>Check playlists</button>
        </div>
      ) : (
        <div class="gx-big" data-nav-group>
          <Tile big icon="live" label="Live TV" sub={count(c.live.length, 'channel', 'channels')} onClick={go({ name: 'live' })} auto />
          <Tile big icon="guide" label="TV Guide" sub="What's on" onClick={go({ name: 'guide' })} />
          <Tile big icon="movies" label="VOD" sub={count(c.movies.length, 'film', 'films')} onClick={go({ name: 'movies' })} />
          <Tile big icon="series" label="Series" sub={count(c.series.length, 'series', 'series')} onClick={go({ name: 'series' })} />
        </div>
      )}

      <footer class="gx-foot" data-nav-group>
        <div class="gx-foot-side">
          <Tile icon="account" label="Account" onClick={go({ name: 'settings', section: 'playlists' })} />
          <Tile icon="history" label="Catch Up" onClick={go({ name: 'guide' })} />
          <Tile icon="sports" label="Sports" onClick={go({ name: 'sports' })} />
        </div>
        <div class="gx-expire tnum">
          {expires ? <b>Expiration: {new Date(expires).toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' })}</b> : null}
          {src ? <span>Logged in as: {src.user || src.name}</span> : null}
        </div>
        <div class="gx-foot-side">
          {favourites.value.length > 0 && <Tile icon="heart" label="Favourites" onClick={go({ name: 'favourites' })} />}
          <Tile icon="settings" label="Settings" onClick={go({ name: 'settings' })} />
        </div>
      </footer>
    </div>
  );
}

function IconBtn({ icon, label, onClick }: { icon: IconName; label: string; onClick: () => void }) {
  return <button class="gx-iconbtn" onClick={onClick} aria-label={label} title={label}><Icon name={icon} /></button>;
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
