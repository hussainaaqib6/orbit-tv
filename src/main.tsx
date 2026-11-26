import { render } from 'preact';
import './styles/theme.css';
import './styles/player.css';
import { App } from './app/App';
import { store } from './core/storage';
import { start, sources } from './sources/library';

async function boot() {
  await store.restore();
  render(<App />, document.getElementById('app')!);
  if (sources.value.length) start();
}
boot();
