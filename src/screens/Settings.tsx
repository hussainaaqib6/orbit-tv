// Settings: playlists, player, subtitles, TV guide, general and integrations.
import { useEffect, useState } from 'preact/hooks';
import { connectionsLabel, refreshConnections } from '../services/connections';
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
import { APP_NAME } from '../core/brand';

const SECTIONS = [
  { id: 'playlists', label: 'Playlists' }, { id: 'appearance', label: 'Appearance' }, { id: 'player', label: 'Player' },
  { id: 'subtitles', label: 'Subtitles' }, { id: 'guide', label: 'TV guide' }, { id: 'sports', label: 'Sports' },
  { id: 'general', label: 'General' }, { id: 'services', label: 'Artwork and info' }, { id: 'about', label: 'About' },
];

/**
 * Every setting, for settings search: where it lives and the other words people use for it.
 * `id` matches the data-setting attribute on the control, so a result can jump straight to it.
 */
export const SETTINGS_INDEX: { id: string; label: string; section: string; words: string }[] = [
  { id: 'playlists', label: 'Playlists', section: 'playlists', words: 'add playlist xtream m3u mac portal stalker provider login edit remove delete refresh connections' },
  { id: 'refreshHours', label: 'Refresh playlists automatically', section: 'playlists', words: 'update reload interval hours day epg' },
  { id: 'miniPlayer', label: 'Mini player (preview box in Live TV)', section: 'appearance', words: 'preview small player tv channels picture in picture pip' },
  { id: 'previewFollows', label: 'Preview follows the highlighted channel', section: 'appearance', words: 'mini player auto preview scroll' },
  { id: 'previewMuted', label: 'Preview without sound', section: 'appearance', words: 'mini player mute audio silent' },
  { id: 'showFinishTime', label: 'Show finish time', section: 'appearance', words: 'ends end time clock player film episode' },
  { id: 'lastChannelButton', label: 'Last channel in the side menu', section: 'appearance', words: 'previous channel recall back swap history' },
  { id: 'numbering', label: 'Channel numbering', section: 'appearance', words: 'numbers favourites fixed sequential lcn' },
  { id: 'showNumbers', label: 'Show channel numbers', section: 'appearance', words: 'numbers lcn' },
  { id: 'engine', label: 'Player engine', section: 'player', words: 'exoplayer media3 decoder hardware web player' },
  { id: 'liveFormat', label: 'Live stream format', section: 'player', words: 'mpeg-ts ts hls m3u8 format container' },
  { id: 'recoveryDelay', label: 'Reconnect a stalled stream after', section: 'player', words: 'buffer buffering freeze frozen recovery timeout reconnect' },
  { id: 'autoFailover', label: 'Switch to another version of a failing channel', section: 'player', words: 'failover backup alternative versions linked channels' },
  { id: 'skipStep', label: 'Skip step', section: 'player', words: 'seek forward back rewind jump seconds' },
  { id: 'controlsTimeout', label: 'Hide the controls after', section: 'player', words: 'osd overlay timeout' },
  { id: 'aspectLive', label: 'Picture for channels', section: 'player', words: 'aspect ratio zoom stretch fit fill' },
  { id: 'aspectVod', label: 'Picture for films and episodes', section: 'player', words: 'aspect ratio zoom stretch fit fill' },
  { id: 'autoplayNext', label: 'Play the next episode automatically', section: 'player', words: 'autoplay binge series' },
  { id: 'subSize', label: 'Subtitle size', section: 'subtitles', words: 'captions text font size' },
  { id: 'autoSubtitles', label: "Turn on a film's own subtitles", section: 'subtitles', words: 'captions automatic embedded' },
  { id: 'subBackground', label: 'Dark box behind subtitles', section: 'subtitles', words: 'captions background' },
  { id: 'subLang', label: 'Subtitle language', section: 'subtitles', words: 'captions language english' },
  { id: 'osKey', label: 'OpenSubtitles', section: 'subtitles', words: 'opensubtitles api key account captions download' },
  { id: 'epgOffset', label: 'Guide time correction', section: 'guide', words: 'epg offset timezone time shift wrong time' },
  { id: 'extraEpg', label: 'Extra guide links', section: 'guide', words: 'epg xmltv url source' },
  { id: 'matchCards', label: 'Match cards', section: 'sports', words: 'sports fixtures classic big cards football' },
  { id: 'sportsMyChannels', label: 'My channels only', section: 'sports', words: 'sports fixtures streams available hide' },
  { id: 'askBeforeExit', label: 'Ask before leaving the app', section: 'general', words: 'exit quit close confirm' },
  { id: 'tmdbKey', label: 'TMDB key (artwork and info)', section: 'services', words: 'tmdb artwork posters backdrops plot cast metadata' },
  { id: 'about', label: 'About and remote control', section: 'about', words: 'version help remote buttons keys' },
];

export function searchSettings(q: string) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return SETTINGS_INDEX
    .map(e => {
      const hay = `${e.label} ${e.words} ${e.section}`.toLowerCase();
      const score = words.reduce((n, w) => n + (e.label.toLowerCase().includes(w) ? 3 : hay.includes(w) ? 1 : hay.split(/\s+/).some(x => x.startsWith(w.slice(0, 4))) ? 0.5 : -10), 0);
      return { e, score };
    })
    .filter(x => x.score > 0).sort((a, b) => b.score - a.score).map(x => x.e).slice(0, 12);
}

function Toggle({ id, label, sub, on, onChange }: { id?: string; label: string; sub?: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button class={`toggle${on ? ' on' : ''}`} data-setting={id} role="switch" aria-checked={on} onClick={() => onChange(!on)}>
      <span>{label}{sub && <div class="muted" style={{ fontSize: '0.88rem' }}>{sub}</div>}</span>
      <span class="switch" />
    </button>
  );
}

function Choice<T extends string | number>({ id, label, value, options, onChange }: { id?: string; label: string; value: T; options: { v: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div style={{ marginBottom: '1.1rem' }} data-setting={id}>
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
  useEffect(() => { sources.value.forEach(s => { if (s.enabled) refreshConnections(s); }); }, []);
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
              {s.type === 'xtream' && s.enabled && <div class="muted tnum" style={{ fontSize: '0.9rem' }}>{connectionsLabel(s)}</div>}
              {s.error && <div class="error-text" style={{ fontSize: '0.9rem' }}>{s.error}</div>}
            </div>
            <div class="row" style={{ gap: '0.4rem' }}>
              <button class="btn icon" aria-label={`Edit ${s.name}`} onClick={() => setEditing(s)}><Icon name="edit" /></button>
              <button class="btn" onClick={() => { updateSource(s.id, { enabled: !s.enabled }); reload(); }}>{s.enabled ? 'Turn off' : 'Turn on'}</button>
              <button class="btn icon danger" aria-label={`Remove ${s.name}`} onClick={async () => { if (await confirmDialog(`Remove ${s.name}?`, 'Its channels, films and series will disappear from the app.', 'Remove')) removeSource(s.id); }}><Icon name="trash" /></button>
            </div>
          </div>
        ))}
      </div>
      <div class="row" style={{ marginTop: '1.2rem' }}>
        <button class="btn primary" onClick={() => setEditing('new')}><Icon name="plus" />Add a playlist</button>
        <button class="btn" disabled={!!loading.value} onClick={() => reload()}><Icon name="refresh" />Refresh now</button>
      </div>
      <h3>Refresh automatically</h3>
      <Choice id="refreshHours" label="Reload playlists when the app opens if they are older than" value={settings.value.refreshHours} onChange={v => updateSettings({ refreshHours: v })}
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
        <Choice id="engine" label="Player engine" value={s.engine} onChange={v => set({ engine: v })} options={[{ v: 'native', label: 'ExoPlayer (recommended)' }, { v: 'web', label: 'Web player' }]} />
      )}
      <Choice id="liveFormat" label="Live stream format (Xtream)" value={s.liveFormat} onChange={v => set({ liveFormat: v })}
        options={[{ v: 'auto', label: 'Automatic' }, { v: 'ts', label: 'MPEG-TS' }, { v: 'm3u8', label: 'HLS' }]} />
      <Choice id="skipStep" label="Skip step (Left/Right in films)" value={s.skipStep} onChange={v => set({ skipStep: v })}
        options={[5, 10, 15, 30].map(v => ({ v, label: `${v} s` }))} />
      <Choice id="controlsTimeout" label="Hide the controls after" value={s.controlsTimeout} onChange={v => set({ controlsTimeout: v })}
        options={[3, 5, 8, 12].map(v => ({ v, label: `${v} s` }))} />
      <Choice id="aspectLive" label="Picture for channels" value={s.aspectLive} onChange={v => set({ aspectLive: v })} options={ASPECTS} />
      <Choice id="aspectVod" label="Picture for films and episodes" value={s.aspectVod} onChange={v => set({ aspectVod: v })} options={ASPECTS} />
      <Choice id="recoveryDelay" label="Reconnect a live stream that stalls for" value={s.recoveryDelay} onChange={v => set({ recoveryDelay: v })}
        options={[{ v: 6, label: '6 s' }, { v: 10, label: '10 s' }, { v: 20, label: '20 s' }, { v: 30, label: '30 s' }, { v: 0, label: 'Never' }]} />
      <div class="stack">
        <Toggle id="autoFailover" label="Switch to another version of a failing channel" sub="HD, FHD or backup versions of the same channel, from your playlists. Only one stream is open at a time." on={s.autoFailover} onChange={v => set({ autoFailover: v })} />
        <Toggle id="autoplayNext" label="Play the next episode automatically" on={s.autoplayNext} onChange={v => set({ autoplayNext: v })} />
      </div>
    </>
  );
}

function Subtitles() {
  const s = settings.value;
  return (
    <>
      <h2>Subtitles</h2>
      <Choice id="subSize" label="Size" value={s.subSize} onChange={v => updateSettings({ subSize: v })} options={[80, 100, 125, 150].map(v => ({ v, label: `${v}%` }))} />
      <div class="stack" style={{ marginBottom: '1.4rem' }}>
        <Toggle id="autoSubtitles" label="Turn on a film's own subtitles" sub="When a film or episode has subtitles in your language, show them straight away" on={s.autoSubtitles} onChange={v => updateSettings({ autoSubtitles: v })} />
        <Toggle id="subBackground" label="Dark box behind subtitles" on={s.subBackground} onChange={v => updateSettings({ subBackground: v })} />
      </div>
      <div data-setting="subLang" /><TextSetting label="Preferred language (two letters)" value={s.subLang} onSave={v => updateSettings({ subLang: v.slice(0, 2).toLowerCase() || 'en' })} placeholder="en" />
      <h3>OpenSubtitles</h3>
      <div data-setting="osKey" /><TextSetting label="API key" value={s.osKey} onSave={v => updateSettings({ osKey: v })} type="password"
        hint={defaults.osKey ? 'This build already includes a key; add your own to use your own quota.' : 'Free from opensubtitles.com → Consumers. Subtitles are matched to the exact file first, so they line up.'} />
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
      <Choice id="epgOffset" label="Time correction (if programmes are shown at the wrong time)" value={s.epgOffset} onChange={v => { updateSettings({ epgOffset: v }); reloadGuide(); }}
        options={[-3, -2, -1, 0, 1, 2, 3].map(v => ({ v, label: v === 0 ? 'None' : `${v > 0 ? '+' : '−'}${Math.abs(v)} h` }))} />
      <label class="field" style={{ maxWidth: '40rem' }} data-setting="extraEpg">
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
        <Toggle id="askBeforeExit" label="Ask before leaving the app" sub="Back on the main menu asks first" on={s.askBeforeExit} onChange={v => updateSettings({ askBeforeExit: v })} />
      </div>
    </>
  );
}

function Appearance() {
  const s = settings.value;
  const set = (p: Partial<S>) => updateSettings(p);
  return (
    <>
      <h2>Appearance</h2>
      <h3>TV channels: mini player</h3>
      <div class="stack" style={{ marginBottom: '1.4rem' }}>
        <Toggle id="miniPlayer" label="Mini player" sub="Play channels in a preview box beside the list. Off: OK goes straight to full screen." on={s.miniPlayer} onChange={v => set({ miniPlayer: v })} />
        {s.miniPlayer && <Toggle id="previewFollows" label="Preview follows the highlighted channel" sub="Starts a moment after you stop scrolling, so scrolling fast doesn't open streams. OK then goes full screen." on={s.previewFollows} onChange={v => set({ previewFollows: v })} />}
        {s.miniPlayer && <Toggle id="previewMuted" label="Preview without sound" on={s.previewMuted} onChange={v => set({ previewMuted: v })} />}
      </div>
      <h3>Player</h3>
      <div class="stack" style={{ marginBottom: '1.4rem' }}>
        <Toggle id="showFinishTime" label="Show finish time" sub="Beside the clock in films and episodes; follows pauses, skips and speed" on={s.showFinishTime} onChange={v => set({ showFinishTime: v })} />
      </div>
      <h3>Last channel</h3>
      <div class="stack" style={{ marginBottom: '1.4rem' }}>
        <Toggle id="lastChannelButton" label="Last channel in the side menu" sub="The remote's Last or Yellow button works from any screen as well" on={s.lastChannelButton} onChange={v => set({ lastChannelButton: v })} />
      </div>
      <h3>Channel numbers</h3>
      <Choice id="numbering" label="Numbering" value={s.numbering} onChange={v => set({ numbering: v })}
        options={[{ v: 'playlist', label: 'From the playlist' }, { v: 'favourites', label: 'Favourites first (1, 2, 3…)' }]} />
      <div class="stack">
        <Toggle id="showNumbers" label="Show channel numbers" on={s.showNumbers} onChange={v => set({ showNumbers: v })} />
      </div>
    </>
  );
}

function SportsSettings() {
  const s = settings.value;
  return (
    <>
      <h2>Sports</h2>
      <Choice id="matchCards" label="Match cards" value={s.matchCards} onChange={v => updateSettings({ matchCards: v })}
        options={[{ v: 'classic', label: 'Classic' }, { v: 'big', label: 'Big (team colours)' }]} />
      <div class="stack">
        <Toggle id="sportsMyChannels" label="My channels only" sub="Show only fixtures with a stream in your playlists" on={s.sportsMyChannels} onChange={v => updateSettings({ sportsMyChannels: v })} />
      </div>
    </>
  );
}

function Services() {
  return (
    <>
      <h2>Artwork and info</h2>
      <div data-setting="tmdbKey" /><TextSetting label="TMDB API key or read token" value={settings.value.tmdbKey} onSave={v => updateSettings({ tmdbKey: v })} type="password"
        hint="Free from themoviedb.org → Settings → API. Adds backdrops, plots and cast to films and series." />
    </>
  );
}

function About() {
  return (
    <>
      <h2>About {APP_NAME}</h2>
      <p class="muted" style={{ maxWidth: '40rem', marginBottom: '1rem' }}>Version 2.0. The app plays streams from your own provider and comes with no channels or content of its own. Use it only with streams you have the right to watch.</p>
      <h3>Remote control</h3>
      <div class="stack muted" style={{ lineHeight: 1.7 }}>
        <div><b style={{ color: 'var(--ink)' }}>OK</b> opens or plays. <b style={{ color: 'var(--ink)' }}>Hold OK</b> or <b style={{ color: 'var(--ink)' }}>Menu</b> shows options for the highlighted item.</div>
        <div><b style={{ color: 'var(--ink)' }}>Back</b> goes up one level, then to the side menu.</div>
        <div>In the player: <b style={{ color: 'var(--ink)' }}>Up/Down</b> change channel, <b style={{ color: 'var(--ink)' }}>Left</b> opens the channel list, <b style={{ color: 'var(--ink)' }}>Left/Right</b> skip in films, <b style={{ color: 'var(--ink)' }}>Rewind/Fast-forward</b> jump 30 seconds, number keys pick a channel, <b style={{ color: 'var(--ink)' }}>Yellow</b> returns to the last channel.</div>
      </div>
    </>
  );
}

export function Settings({ section, highlight }: { section?: string; highlight?: string }) {
  const [cur, setCur] = useState(section ?? 'playlists');
  const [q, setQ] = useState('');
  const [flash, setFlash] = useState(highlight ?? '');
  const body: Record<string, () => ComponentChildren> = {
    playlists: Playlists, appearance: Appearance, player: Player, subtitles: Subtitles, guide: GuideSettings, sports: SportsSettings,
    general: General, services: Services, about: About,
  };
  const Body = body[cur] ?? Playlists;
  const results = searchSettings(q);

  // A search result: open its section, then scroll to the setting and light it up.
  useEffect(() => {
    if (!flash) return;
    const t = requestAnimationFrame(() => requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`.settings-body [data-setting="${flash}"]`) ?? document.querySelector<HTMLElement>('.settings-body h2');
      if (!el) return;
      el.scrollIntoView({ block: 'center' });
      el.classList.add('flash');
      const target = el.matches('button, input') ? el : el.querySelector<HTMLElement>('button, input, textarea') ?? el.nextElementSibling?.querySelector<HTMLElement>('input, button');
      if (target) focusEl(target);
      setTimeout(() => el.classList.remove('flash'), 1800);
    }));
    return () => cancelAnimationFrame(t);
  }, [flash, cur]);

  const go = (sec: string, id: string) => { setQ(''); setCur(sec); setFlash(id); };
  return (
    <div class="screen opaque">
      <div class="settings">
        <aside class="cats" data-nav-group="cats" data-nav-scope="left right">
          <div class="cats-head"><h1>Settings</h1></div>
          <div class="settings-search">
            <Icon name="search" />
            <input class="input" value={q} placeholder="Search settings" aria-label="Search settings" spellcheck={false} autocomplete="off"
              onInput={e => setQ((e.target as HTMLInputElement).value)} />
          </div>
          <div class="cats-list">
            {q ? (
              results.length ? results.map(r => (
                <button key={r.id} class="cat result" onClick={() => go(r.section, r.id)}>
                  <span><span class="clip" style={{ display: 'block' }}>{r.label}</span><span class="n" style={{ marginLeft: 0 }}>{SECTIONS.find(x => x.id === r.section)?.label}</span></span>
                </button>
              )) : <p class="hint" style={{ padding: '0.5rem 0.9rem' }}>No setting matches "{q}".</p>
            ) : SECTIONS.map(s => (
              <button key={s.id} class={`cat${cur === s.id ? ' on' : ''}`} onFocus={() => { setCur(s.id); setFlash(''); }} onClick={() => { setCur(s.id); requestAnimationFrame(() => focusEl(document.querySelector<HTMLElement>('.settings-body button, .settings-body input'))); }}>{s.label}</button>
            ))}
          </div>
        </aside>
        <div class="settings-body" key={cur}><Body /></div>
      </div>
    </div>
  );
}
