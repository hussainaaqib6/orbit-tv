// The app shell: side menu, the current screen, the player, and the overlays on top.
import { useEffect } from 'preact/hooks';
import { route, pop } from '../nav/router';
import { setBaseBack, setShortcutHandler, handleNativeKey, installKeyHandling } from '../nav/focus';
import { lastChannel } from '../player/controller';
import { goRoot } from '../nav/router';
import { Rail, focusRail, focusScreen } from './Rail';
import { Sheets, Dialog, Toasts, confirmDialog } from '../ui/overlays';
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

function Screen() {
  const r = route.value;
  switch (r.name) {
    case 'home': return <Home />;
    case 'live': return <Live key="live" initialGroup={r.group} />;
    case 'sports': return <Sports />;
    case 'guide': return <Guide />;
    case 'movies': return <Vod key="movies" kind="movies" />;
    case 'series': return <Vod key="series" kind="series" />;
    case 'search': return <Search />;
    case 'favourites': return <Favourites />;
    case 'settings': return <Settings section={r.section} />;
    case 'movie': return <MovieDetail key={r.key} itemKey={r.key} />;
    case 'show': return <ShowDetail key={r.key} itemKey={r.key} />;
  }
}

export function App() {
  useEffect(() => {
    installKeyHandling();
    // Back with nothing open: leave a detail screen, then go to the menu, then offer to leave the app.
    setBaseBack(() => {
      if (pop()) return;
      if (!document.activeElement?.closest('.rail')) focusRail();
      else exitApp();
    });
    // Remote shortcuts that work from any screen.
    setShortcutHandler(a => {
      if (booting.value) return;
      if (a === 'last' || a === 'yellow') lastChannel();
      else if (a === 'guide') goRoot({ name: 'guide' });
      else if (a === 'search') goRoot({ name: 'search' });
    });
    if (PLATFORM === 'android') {
      const h = OrbitPlayer.addListener('key', e => handleNativeKey(e.key, e.action, e.repeat));
      return () => { h.then(x => x.remove()); };
    }
  }, []);

  const noSources = !sources.value.length;

  // Put focus into each new screen (unless the player is full screen), and after the first load.
  useEffect(() => {
    if (mode.value === 'full') return;
    const area = document.querySelector('.screen-area');
    if (!area?.contains(document.activeElement) || document.activeElement === document.body) focusScreen();
  }, [route.value, noSources, loaded.value, booting.value]);
  return (
    <>
      <div class="shell" inert={mode.value === 'full' || (booting.value && !noSources) || undefined}>
        {!noSources && <Rail />}
        <main class="screen-area">
          {noSources ? <Welcome /> : <Screen />}
        </main>
      </div>
      {booting.value && !noSources && <Startup />}
      <PlayerOverlay />
      <Sheets />
      <Dialog />
      <Toasts />
      {loading.value && !booting.value && <div class="status-pill"><span class="spinner" />{loading.value}</div>}
    </>
  );
}
