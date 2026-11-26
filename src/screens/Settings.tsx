// Settings: playlists, player, subtitles, TV guide, general and integrations.
import { useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { sources, settings, updateSettings, updateSource, removeSource, reload, reloadGuide, loading, type Settings as S, type Aspect } from '../sources/library';
import type { Source } from '../sources/types';
import { SourceForm } from './SourceForm';
import { PairingPanel, pairingAvailable } from './PairingPanel';
import { confirmDialog, toast } from '../ui/overlays';
import { Icon } from '../ui/icons';
import { PLATFORM } from '../core/platform';
import { focusEl } from '../nav/focus';
import { defaults } from '../core/platform';

const SECTIONS = [
  { id: 'playlists', label: 'Playlists' }, { id: 'player', label: 'Player' }, { id: 'subtitles', label: 'Subtitles' },
  { id: 'guide', label: 'TV guide' }, { id: 'general', label: 'General' }, { id: 'services', label: 'Artwork and info' }, { id: 'about', label: 'About' },
];

function Toggle({ label, sub, on, onChange }: { label: string; sub?: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button class={`toggle${on ? ' on' : ''}`} role="switch" aria-checked={on} onClick={() => onChange(!on)}>
      <span>{label}{sub && <div class="muted" style={{ fontSize: '0.88rem' }}>{sub}</div>}</span>
      <span class="switch" />
    </button>
  );
}

function Choice<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: { v: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div style={{ marginBottom: '1.1rem' }}>
      <div class="muted" style={{ marginBottom: '0.5rem' }}>{label}</div>
      <div class="choice" data-nav-group>{options.map(o => <button key={String(o.v)} class={`chip${o.v === value ? ' on' : ''}`} onClick={() => onChange(o.v)}>{o.label}</button>)}</div>
    </div>
  );
}

function TextSetting({ label, value, onSave, type = 'text', hint, placeholder }: { label: string; value: string; onSave: (v: string) => void; type?: string; hint?: ComponentChildren; placeholder?: string }) {
  const [v, setV] = useState(value);
  return (
    <label class="field" style={{ maxWidth: '40rem' }}>
      <span>{label}</span>
      <div class="row" style={{ flexWrap: 'nowrap' }}>
        <input class="input" type={type} value={v} placeholder={placeholder} autocomplete="off" spellcheck={false} onInput={e => setV((e.target as HTMLInputElement).value)} />
        <button type="button" class="btn" disabled={v === value} onClick={() => { onSave(v.trim()); toast('Saved'); }}>Save</button>
      </div>
      {hint && <span class="hint">{hint}</span>}
    </label>
  );
}

function Playlists() {
  const [editing, setEditing] = useState<Source | 'new' | null>(null);
  if (editing) {
    return (
      <>
        <h2>{editing === 'new' ? 'Add a playlist' : `Edit ${editing.name}`}</h2>
        <div class="add-layout">
          <SourceForm existing={editing === 'new' ? undefined : editing} onDone={() => setEditing(null)} />
          {editing === 'new' && pairingAvailable && <div class="card"><PairingPanel onAdded={() => setEditing(null)} /></div>}
        </div>
      </>
    );
  }
  const date = (t?: number) => (t ? new Date(t).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) : '');
  return (
    <>
      <h2>Playlists</h2>
      <div class="stack">
        {sources.value.map(s => (
          <div key={s.id} class="source-row" style={{ background: 'var(--deck)' }}>
            <div>
              <b>{s.name}</b>{!s.enabled && <span class="muted"> (off)</span>}
              <div class="muted" style={{ fontSize: '0.9rem' }}>
                {s.type === 'xtream' ? 'Xtream Codes' : s.type === 'stalker' ? 'MAC portal' : s.fromFile ? 'M3U file' : 'M3U link'}
                {s.counts ? `   ${s.counts.live} channels, ${s.counts.movies} films, ${s.counts.series} series` : ''}
                {s.expires ? `   Expires ${date(s.expires)}` : ''}
              </div>
              {s.error && <div class="error-text" style={{ fontSize: '0.9rem' }}>{s.error}</div>}
            </div>
            <div class="row" style={{ gap: '0.4rem' }}>
              <button class="btn icon" aria-label={`Edit ${s.name}`} onClick={() => setEditing(s)}><Icon name="edit" /></button>
              <button class="btn" onClick={() => { updateSource(s.id, { enabled: !s.enabled }); reload(); }}>{s.enabled ? 'Turn off' : 'Turn on'}</button>
              <button class="btn icon danger" aria-label={`Remove ${s.name}`} onClick={async () => { if (await confirmDialog(`Remove ${s.name}?`, 'Its channels, films and series will disappear from Orbit.', 'Remove')) removeSource(s.id); }}><Icon name="trash" /></button>
            </div>
          </div>
        ))}
      </div>
      <div class="row" style={{ marginTop: '1.2rem' }}>
        <button class="btn primary" onClick={() => setEditing('new')}><Icon name="plus" />Add a playlist</button>
        <button class="btn" disabled={!!loading.value} onClick={() => reload()}><Icon name="refresh" />Refresh now</button>
      </div>
      <h3>Refresh automatically</h3>
      <Choice label="Reload playlists when Orbit opens if they are older than" value={settings.value.refreshHours} onChange={v => updateSettings({ refreshHours: v })}
        options={[{ v: 6, label: '6 hours' }, { v: 12, label: '12 hours' }, { v: 24, label: '1 day' }, { v: 72, label: '3 days' }]} />
    </>
  );
}

const ASPECTS: { v: Aspect; label: string }[] = [{ v: 'fit', label: 'Fit' }, { v: 'fill', label: 'Fill' }, { v: 'stretch', label: 'Stretch' }, { v: '16:9', label: '16:9' }, { v: '4:3', label: '4:3' }];

function Player() {
  const s = settings.value;
  const set = (p: Partial<S>) => updateSettings(p);
  return (
    <>
      <h2>Player</h2>
      {PLATFORM === 'android' && (
        <Choice label="Player engine" value={s.engine} onChange={v => set({ engine: v })} options={[{ v: 'native', label: 'ExoPlayer (recommended)' }, { v: 'web', label: 'Web player' }]} />
      )}
      <Choice label="Live stream format (Xtream)" value={s.liveFormat} onChange={v => set({ liveFormat: v })}
        options={[{ v: 'auto', label: 'Automatic' }, { v: 'ts', label: 'MPEG-TS' }, { v: 'm3u8', label: 'HLS' }]} />
      <Choice label="Skip step (Left/Right in films)" value={s.skipStep} onChange={v => set({ skipStep: v })}
        options={[5, 10, 15, 30].map(v => ({ v, label: `${v} s` }))} />
      <Choice label="Hide the controls after" value={s.controlsTimeout} onChange={v => set({ controlsTimeout: v })}
        options={[3, 5, 8, 12].map(v => ({ v, label: `${v} s` }))} />
      <Choice label="Picture for channels" value={s.aspectLive} onChange={v => set({ aspectLive: v })} options={ASPECTS} />
      <Choice label="Picture for films and episodes" value={s.aspectVod} onChange={v => set({ aspectVod: v })} options={ASPECTS} />
      <div class="stack">
        <Toggle label="Play the next episode automatically" on={s.autoplayNext} onChange={v => set({ autoplayNext: v })} />
      </div>
    </>
  );
}

function Subtitles() {
  const s = settings.value;
  return (
    <>
      <h2>Subtitles</h2>
      <Choice label="Size" value={s.subSize} onChange={v => updateSettings({ subSize: v })} options={[80, 100, 125, 150].map(v => ({ v, label: `${v}%` }))} />
      <div class="stack" style={{ marginBottom: '1.4rem' }}>
        <Toggle label="Turn on a film's own subtitles" sub="When a film or episode has subtitles in your language, show them straight away" on={s.autoSubtitles} onChange={v => updateSettings({ autoSubtitles: v })} />
        <Toggle label="Dark box behind subtitles" on={s.subBackground} onChange={v => updateSettings({ subBackground: v })} />
      </div>
      <TextSetting label="Preferred language (two letters)" value={s.subLang} onSave={v => updateSettings({ subLang: v.slice(0, 2).toLowerCase() || 'en' })} placeholder="en" />
      <h3>OpenSubtitles</h3>
      <TextSetting label="API key" value={s.osKey} onSave={v => updateSettings({ osKey: v })} type="password"
        hint={defaults.osKey ? 'This build already includes a key; add your own to use your own quota.' : 'Free from opensubtitles.com → Consumers. Orbit matches subtitles to the exact file first, so they line up.'} />
      <TextSetting label="Username (optional, for more downloads a day)" value={s.osUser} onSave={v => updateSettings({ osUser: v })} />
      <TextSetting label="Password" value={s.osPass} onSave={v => updateSettings({ osPass: v })} type="password" />
    </>
  );
}

function GuideSettings() {
  const s = settings.value;
  const [extra, setExtra] = useState(s.extraEpg.join('\n'));
  return (
    <>
      <h2>TV guide</h2>
      <Choice label="Time correction (if programmes are shown at the wrong time)" value={s.epgOffset} onChange={v => { updateSettings({ epgOffset: v }); reloadGuide(); }}
        options={[-3, -2, -1, 0, 1, 2, 3].map(v => ({ v, label: v === 0 ? 'None' : `${v > 0 ? '+' : '−'}${Math.abs(v)} h` }))} />
      <label class="field" style={{ maxWidth: '40rem' }}>
        <span>Extra guide links (one per line)</span>
        <textarea class="input" value={extra} onInput={e => setExtra((e.target as HTMLTextAreaElement).value)} placeholder="http://example.com/epg.xml.gz" spellcheck={false} />
        <span class="hint">Your provider's guide loads automatically. Add links here only for channels that have no guide.</span>
      </label>
      <div class="row">
        <button class="btn" onClick={() => { updateSettings({ extraEpg: extra.split(/\s+/).filter(Boolean) }); reloadGuide(); toast('Loading the guide…'); }}>Save and reload guide</button>
        <button class="btn quiet" onClick={() => { updateSettings({ epgMap: {} }); toast('Manual guide matches cleared'); }}>Clear manual matches ({Object.keys(s.epgMap).length})</button>
      </div>
    </>
  );
}

function General() {
  const s = settings.value;
  return (
    <>
      <h2>General</h2>
      <div class="stack">
        <Toggle label="Ask before leaving Orbit" sub="Back on the main menu asks first" on={s.askBeforeExit} onChange={v => updateSettings({ askBeforeExit: v })} />
        <Toggle label="Show channel numbers" on={s.showNumbers} onChange={v => updateSettings({ showNumbers: v })} />
      </div>
    </>
  );
}

function Services() {
  return (
    <>
      <h2>Artwork and info</h2>
      <TextSetting label="TMDB API key or read token" value={settings.value.tmdbKey} onSave={v => updateSettings({ tmdbKey: v })} type="password"
        hint="Free from themoviedb.org → Settings → API. Adds backdrops, plots and cast to films and series." />
    </>
  );
}

function About() {
  return (
    <>
      <h2>About Orbit TV</h2>
      <p class="muted" style={{ maxWidth: '40rem', marginBottom: '1rem' }}>Version 2.0. Orbit plays streams from your own provider and comes with no channels or content of its own. Use it only with streams you have the right to watch.</p>
      <h3>Remote control</h3>
      <div class="stack muted" style={{ lineHeight: 1.7 }}>
        <div><b style={{ color: 'var(--ink)' }}>OK</b> opens or plays. <b style={{ color: 'var(--ink)' }}>Hold OK</b> or <b style={{ color: 'var(--ink)' }}>Menu</b> shows options for the highlighted item.</div>
        <div><b style={{ color: 'var(--ink)' }}>Back</b> goes up one level, then to the side menu.</div>
        <div>In the player: <b style={{ color: 'var(--ink)' }}>Up/Down</b> change channel, <b style={{ color: 'var(--ink)' }}>Left</b> opens the channel list, <b style={{ color: 'var(--ink)' }}>Left/Right</b> skip in films, <b style={{ color: 'var(--ink)' }}>Rewind/Fast-forward</b> jump 30 seconds, number keys pick a channel, <b style={{ color: 'var(--ink)' }}>Yellow</b> returns to the last channel.</div>
      </div>
    </>
  );
}

export function Settings({ section }: { section?: string }) {
  const [cur, setCur] = useState(section ?? 'playlists');
  const body: Record<string, () => ComponentChildren> = { playlists: Playlists, player: Player, subtitles: Subtitles, guide: GuideSettings, general: General, services: Services, about: About };
  const Body = body[cur] ?? Playlists;
  return (
    <div class="screen opaque">
      <div class="settings">
        <aside class="cats" data-nav-group="cats" data-nav-scope="left right">
          <div class="cats-head"><h1>Settings</h1></div>
          <div class="cats-list">
            {SECTIONS.map(s => (
              <button key={s.id} class={`cat${cur === s.id ? ' on' : ''}`} onFocus={() => setCur(s.id)} onClick={() => { setCur(s.id); requestAnimationFrame(() => focusEl(document.querySelector<HTMLElement>('.settings-body button, .settings-body input'))); }}>{s.label}</button>
            ))}
          </div>
        </aside>
        <div class="settings-body"><Body /></div>
      </div>
    </div>
  );
}
