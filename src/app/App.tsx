// The app shell: the current screen, the player, and the overlays on top. Home is the hub: every
// screen is opened from its tiles, and Back always leads back to it.
import { useEffect } from 'preact/hooks';
import { route, pop, goRoot, stack, takeReturnFocus, type Route } from '../nav/router';
import { setBaseBack, setShortcutHandler, handleNativeKey, installKeyHandling, focusEl } from '../nav/focus';
import { lastChannel } from '../player/controller';
import { runShortcut, DEFAULT_MAP } from './shortcuts';
import { applyTheme } from '../core/theme';
import { focusScreen } from './Rail';
import { Sheets, Dialog, Toasts, confirmDialog } from '../ui/overlays';
import { PinPad } from '../ui/pin';
import { PlayerOverlay } from '../player/PlayerOverlay';
import { mode } from '../player/controller';
import { loading, loaded, sources, settings } from '../sources/library';
import { OrbitPlayer } from '../core/native';
import { PLATFORM } from '../core/platform';
import { APP_NAME } from '../core/brand';
import { Home } from '../screens/Home';
import { Live } from '../screens/Live';
import { Guide } from '../screens/Guide';
import { Vod } from '../screens/Vod';
import { MovieDetail, ShowDetail } from '../screens/Details';
import { Search } from '../screens/Search';
import { Favourites } from '../screens/Favourites';
import { Settings } from '../screens/Settings';
import { Welcome } from '../screens/Welcome';
import { Startup } from '../screens/Startup';
import { Sports } from '../screens/Sports';
import { booting } from '../sources/loadState';

export async function exitApp() {
  if (settings.value.askBeforeExit && !(await confirmDialog(`Leave ${APP_NAME}?`, 'Anything playing will stop.', 'Leave', 'Stay'))) return;
  if (PLATFORM === 'android') OrbitPlayer.exitApp();
  else if (PLATFORM === 'electron') window.orbitDesktop?.quit();
}

function render(r: Route) {
  switch (r.name) {
    case 'home': return <Home />;
    case 'live': return <Live key="live" initialGroup={r.group} />;
    case 'sports': return <Sports />;
    case 'guide': return <Guide />;
    case 'movies': return <Vod key="movies" kind="movies" />;
    case 'series': return <Vod key="series" kind="series" />;
    case 'search': return <Search />;
    case 'favourites': return <Favourites />;
    case 'settings': return <Settings key={r.section ?? ''} section={r.section} highlight={r.highlight} />;
    case 'movie': return <MovieDetail key={r.key} itemKey={r.key} />;
    case 'show': return <ShowDetail key={r.key} itemKey={r.key} />;
  }
}

/**
 * The top-level screen stays mounted (hidden) while a film, series or settings page is open on top
 * of it, so Back returns to it exactly as it was: same category, same scroll, same poster.
 */
function Screens() {
  const s = stack.value;
  const deep = s.length > 1;
  return (
    <>
      <div key="root" class={`slot${deep ? ' kept' : ''}`} inert={deep || undefined}>{render(s[0])}</div>
      {deep && <div key="top" class="slot">{render(s[s.length - 1])}</div>}
    </>
  );
}

export function App() {
  useEffect(() => {
    installKeyHandling();
    // Back with nothing open: leave a detail screen, then go Home, then offer to leave the app.
    setBaseBack(() => {
      if (pop()) return;
      if (route.value.name !== 'home') { goRoot({ name: 'home' }); return; }
      exitApp();
    });
    // Remote shortcuts that work from any screen (Settings → Remote buttons).
    setShortcutHandler(a => {
      if (booting.value) return;
      if (a === 'last') { lastChannel(); return; }
      const t = { ...DEFAULT_MAP, ...settings.value.remoteMap }[a];
      if (t) runShortcut(t, { last: lastChannel, recent: () => goRoot({ name: 'live', group: '\u0001recent' }) });
    });
    if (PLATFORM === 'android') {
      const h = OrbitPlayer.addListener('key', e => handleNativeKey(e.key, e.action, e.repeat));
      return () => { h.then(x => x.remove()); };
    }
  }, []);

  const noSources = !sources.value.length;
  // The viewer's theme (Settings → Colours & theme).
  useEffect(() => { applyTheme(settings.value.theme); }, [settings.value.theme]);

  // Put focus into each new screen (unless the player is full screen), and after the first load.
  // Coming back (Back): onto the element it was opened from.
  useEffect(() => {
    const back = takeReturnFocus();
    if (mode.value === 'full') return;
    if (back instanceof HTMLElement && back.isConnected) { requestAnimationFrame(() => focusEl(back)); return; }
    const area = document.querySelector('.screen-area');
    const a = document.activeElement;
    // Focus left on a screen now hidden underneath (the poster a film was opened from) doesn't count.
    if (!area?.contains(a) || a === document.body || a?.closest('[inert]')) focusScreen();
  }, [route.value, noSources, loaded.value, booting.value]);
  return (
    <>
      <div class="shell" inert={mode.value === 'full' || (booting.value && !noSources) || undefined}>
        <main class="screen-area">
          {noSources ? <Welcome /> : <Screens />}
        </main>
      </div>
      {booting.value && !noSources && <Startup />}
      <PlayerOverlay />
      <Sheets />
      <Dialog />
      <PinPad />
      <Toasts />
      {loading.value && !booting.value && <div class="status-pill"><span class="spinner" />{loading.value}</div>}
    </>
  );
}
