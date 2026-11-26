import { render } from 'preact';
import './styles/theme.css';
import './styles/player.css';
import './styles/legacy.css';
import { App } from './app/App';
import { store } from './core/storage';
import { start, sources } from './sources/library';
import { withStartup } from './sources/loadState';

/** Older TV WebViews (before Chromium 84) ignore `gap` in flex rows; switch on the margin fallbacks. */
function detectFlexGap() {
  const d = document.createElement('div');
  d.style.cssText = 'display:flex;flex-direction:column;row-gap:1px;position:absolute;visibility:hidden';
  d.append(document.createElement('div'), document.createElement('div'));
  document.body.append(d);
  const ok = d.scrollHeight === 1;
  d.remove();
  if (!ok) document.documentElement.classList.add('no-gap');
}

async function boot() {
  detectFlexGap();
  await store.restore();
  render(<App />, document.getElementById('app')!);
  if (sources.value.length) withStartup(start);
}
boot();
