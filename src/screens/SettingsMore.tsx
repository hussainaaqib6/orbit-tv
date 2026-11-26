// Settings: remote buttons, side menu, colours & theme.
import { useState } from 'preact/hooks';
import { renderSVG } from 'uqr';
import { settings, updateSettings } from '../sources/library';
import { BUTTONS, TARGETS, DEFAULT_MAP, conflicts } from '../app/shortcuts';
import { menuEntries } from '../app/Rail';
import { PRESETS, DEFAULT_THEME, exportTheme, importTheme, themeVars, type Theme } from '../core/theme';
import { openSheet, closeAllSheets, SheetItem, toast, confirmDialog } from '../ui/overlays';
import { Icon } from '../ui/icons';
import { Choice } from './Settings';
import { homeRows, ROW_LABELS } from './homeRows';
import { LEAGUES } from '../services/sports';

/* ------------------------------ remote buttons ------------------------------ */

export function RemoteButtons() {
  const map = { ...DEFAULT_MAP, ...settings.value.remoteMap };
  const clash = conflicts(map);
  const pick = (key: string, label: string) => openSheet(`${label} button`, () => (
    <>{TARGETS.map(t => (
      <SheetItem key={t.v} label={t.label} checked={(map[key as keyof typeof map] ?? 'none') === t.v} autofocus={(map[key as keyof typeof map] ?? 'none') === t.v}
        onClick={() => { updateSettings({ remoteMap: { ...settings.value.remoteMap, [key]: t.v } }); closeAllSheets(); }} />
    ))}</>
  ));
  return (
    <>
      <h2>Remote buttons</h2>
      <p class="muted" style={{ maxWidth: '44rem', marginBottom: '1rem' }}>Give a button a job. It works from any screen; in the player, a button you've set does its new job instead of its usual one. Buttons your remote doesn't have can be ignored.</p>
      <div class="stack" data-setting="remote">
        {BUTTONS.map(b => {
          const t = map[b.key] ?? 'none';
          return (
            <button key={b.key} class="toggle" onClick={() => pick(b.key, b.label)}>
              <span>{b.label}<div class="muted" style={{ fontSize: '0.85rem' }}>{b.where}{clash.includes(b.key) ? ' · shares its job with another button' : ''}</div></span>
              <span class="gstate">{TARGETS.find(x => x.v === t)?.label}</span>
            </button>
          );
        })}
      </div>
      <div class="row" style={{ marginTop: '1.2rem' }}>
        <button class="btn" onClick={() => { updateSettings({ remoteMap: {} }); toast('Remote buttons reset'); }}><Icon name="refresh" />Restore the usual buttons</button>
      </div>
    </>
  );
}

/* ------------------------------ side menu ------------------------------ */

export function MenuSettings() {
  const s = settings.value;
  const entries = menuEntries(s.menuOrder);
  const move = (i: number, d: number) => {
    const order = entries.map(e => e.name);
    const j = i + d;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    updateSettings({ menuOrder: order });
  };
  const toggle = (name: string) => updateSettings({ menuHidden: s.menuHidden.includes(name) ? s.menuHidden.filter(x => x !== name) : [...s.menuHidden, name] });
  return (
    <>
      <h2>Side menu</h2>
      <p class="muted" style={{ maxWidth: '44rem', marginBottom: '1rem' }}>Reorder or hide menu items. Home and Settings always stay.</p>
      <div class="stack" data-setting="menu">
        {entries.map((e, i) => {
          const fixed = e.name === 'home';
          const hidden = s.menuHidden.includes(e.name);
          return (
            <div key={e.name} class="menu-edit" data-nav-group>
              <span class="menu-edit-name"><Icon name={e.icon} />{e.label}</span>
              <button class="btn icon" aria-label={`Move ${e.label} up`} disabled={i === 0} onClick={() => move(i, -1)}><Icon name="up" /></button>
              <button class="btn icon" aria-label={`Move ${e.label} down`} disabled={i === entries.length - 1} onClick={() => move(i, 1)}><Icon name="down" /></button>
              <button class={`btn${hidden ? '' : ' primary'}`} disabled={fixed} onClick={() => toggle(e.name)}>{hidden ? 'Hidden' : 'Shown'}</button>
            </div>
          );
        })}
      </div>
      <div class="row" style={{ marginTop: '1.2rem' }}>
        <button class="btn" onClick={() => updateSettings({ menuOrder: [], menuHidden: [] })}><Icon name="refresh" />Restore the usual menu</button>
      </div>
    </>
  );
}

/* ------------------------------ themes ------------------------------ */

const ACCENTS = ['#d3122a', '#e8590c', '#c98a12', '#12a36b', '#0e9aa7', '#1e7be0', '#4c5fe0', '#7b4ce0', '#c2307a', '#8a94a6'];
const BACKGROUNDS = ['#0b0709', '#000000', '#0b0c0e', '#060b14', '#05100c', '#0e0b05', '#0b0814', '#14080c', '#101418'];

function Swatch({ t }: { t: Theme }) {
  const v = themeVars(t);
  return (
    <span class="swatch" style={{ background: v['--bg'] }} aria-hidden="true">
      <i style={{ background: v['--bg-3'] }} /><i style={{ background: v['--grad'] }} /><i style={{ background: v['--bg-3'] }} />
    </span>
  );
}

export function Themes() {
  const s = settings.value;
  const cur = s.theme;
  const [draft, setDraft] = useState<Theme>(cur);
  const [code, setCode] = useState('');
  const saved = s.themes;
  const apply = (t: Theme) => { updateSettings({ theme: t }); setDraft(t); toast(`Theme: ${t.name}`); };
  const saveAs = (name: string) => {
    const t = { ...draft, name: name.trim().slice(0, 30) || 'My theme' };
    updateSettings({ themes: [...saved.filter(x => x.name !== t.name), t], theme: t });
    toast(`Saved ${t.name}`);
  };
  const share = (t: Theme) => {
    const c = exportTheme(t);
    openSheet(`Share ${t.name}`, () => (
      <div style={{ padding: '0 0.9rem 1rem' }}>
        <p class="muted" style={{ marginBottom: '0.6rem' }}>Type this code into Matrix TV on another device (Colours & theme → Import), or scan it. It holds colours and text size only.</p>
        <div class="theme-code tnum">{c}</div>
        <div class="theme-qr" dangerouslySetInnerHTML={{ __html: renderSVG(c, { border: 1 }) }} />
        <SheetItem label="Done" autofocus onClick={closeAllSheets} />
      </div>
    ));
  };
  const savedMenu = (t: Theme) => openSheet(t.name, () => (
    <>
      <SheetItem icon={<Icon name="check" />} label="Use this theme" autofocus onClick={() => { apply(t); closeAllSheets(); }} />
      <SheetItem icon={<Icon name="edit" />} label="Edit" onClick={() => { setDraft(t); closeAllSheets(); }} />
      <SheetItem icon={<Icon name="plus" />} label="Duplicate" onClick={() => { updateSettings({ themes: [...saved, { ...t, name: `${t.name} copy`.slice(0, 30) }] }); closeAllSheets(); }} />
      <SheetItem icon={<Icon name="edit" />} label="Rename" onClick={() => {
        closeAllSheets();
        const n = window.prompt('New name', t.name);
        if (n && n.trim()) updateSettings({ themes: saved.map(x => (x === t ? { ...x, name: n.trim().slice(0, 30) } : x)), theme: cur.name === t.name ? { ...cur, name: n.trim().slice(0, 30) } : cur });
      }} />
      <SheetItem icon={<Icon name="tv" />} label="Share" onClick={() => { closeAllSheets(); share(t); }} />
      <SheetItem icon={<Icon name="trash" />} label="Delete" onClick={async () => { closeAllSheets(); if (await confirmDialog(`Delete ${t.name}?`, 'The theme is removed from this device.', 'Delete')) updateSettings({ themes: saved.filter(x => x !== t) }); }} />
    </>
  ));
  return (
    <>
      <h2>Colours & theme</h2>
      <h3>Themes</h3>
      <div class="theme-grid" data-nav-group data-setting="themes">
        {[...PRESETS, ...saved].map((t, i) => (
          <button key={`${t.name}${i}`} class={`theme-card${cur.name === t.name && cur.accent === t.accent ? ' on' : ''}`}
            onClick={() => (i < PRESETS.length ? apply(t) : savedMenu(t))}>
            <Swatch t={t} /><span class="clip">{t.name}</span>
          </button>
        ))}
      </div>
      <h3>Make your own</h3>
      <div class="theme-editor">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div class="muted" style={{ marginBottom: '0.5rem' }}>Highlight colour</div>
          <div class="choice" data-nav-group style={{ marginBottom: '1rem' }}>{ACCENTS.map(c => <button key={c} class={`dot${draft.accent === c ? ' on' : ''}`} style={{ background: c }} aria-label={c} onClick={() => setDraft({ ...draft, accent: c })} />)}</div>
          <div class="muted" style={{ marginBottom: '0.5rem' }}>Background</div>
          <div class="choice" data-nav-group style={{ marginBottom: '1rem' }}>{BACKGROUNDS.map(c => <button key={c} class={`dot${draft.background === c ? ' on' : ''}`} style={{ background: c }} aria-label={c} onClick={() => setDraft({ ...draft, background: c })} />)}</div>
          <Choice label="Text size" value={draft.fontScale} onChange={v => setDraft({ ...draft, fontScale: v })} options={[90, 100, 110, 125, 150].map(v => ({ v, label: `${v}%` }))} />
          <Choice label="Side menu" value={draft.menu} onChange={v => setDraft({ ...draft, menu: v })} options={[{ v: 'solid', label: 'Solid' }, { v: 'glass', label: 'See-through' }]} />
        </div>
        <div class="theme-preview" style={themeVars(draft) as never}>
          <div class="tp-rail"><i /><i class="on" /><i /></div>
          <div class="tp-body"><b style={{ fontSize: `${draft.fontScale / 100}rem` }}>Preview</b><span class="tp-row on" /><span class="tp-row" /><span class="tp-row" /></div>
        </div>
      </div>
      <div class="row">
        <button class="btn primary" onClick={() => apply(draft)}>Use these colours</button>
        <button class="btn" onClick={() => { const n = window.prompt('Name this theme', draft.name === cur.name ? 'My theme' : draft.name); if (n !== null) saveAs(n); }}>Save as a theme</button>
        <button class="btn" onClick={() => share(draft)}>Share</button>
        <button class="btn quiet" onClick={() => apply(DEFAULT_THEME)}>Restore the Matrix theme</button>
      </div>
      <h3>Import a theme</h3>
      <div class="row" style={{ flexWrap: 'nowrap', maxWidth: '40rem' }}>
        <input class="input" value={code} placeholder="MTV1-…" spellcheck={false} autocomplete="off" onInput={e => setCode((e.target as HTMLInputElement).value)} />
        <button class="btn" disabled={!code.trim()} onClick={() => {
          const t = importTheme(code);
          if (!t) { toast("That isn't a Matrix TV theme code.", true); return; }
          setDraft(t); setCode(''); toast(`Imported ${t.name}: shown in the preview. Use or save it.`);
        }}>Import</button>
      </div>
    </>
  );
}

/* ------------------------------ home screen ------------------------------ */

export function HomeSettings() {
  const rows = homeRows(settings.value.homeRows);
  const save = (r: typeof rows) => updateSettings({ homeRows: r });
  const move = (i: number, d: number) => { const r = [...rows]; const j = i + d; if (j < 0 || j >= r.length) return; [r[i], r[j]] = [r[j], r[i]]; save(r); };
  const label = (id: string) => (id.startsWith('sport:') ? `${LEAGUES.find(l => l.id === id.slice(6))?.name ?? id} (sports)` : ROW_LABELS[id] ?? id);
  const addSports = () => openSheet('Add a sports row', () => (
    <>{LEAGUES.filter(l => !rows.some(r => r.id === `sport:${l.id}`)).map((l, i) => (
      <SheetItem key={l.id} label={l.name} sub={l.section} autofocus={i === 0} onClick={() => { save([{ id: `sport:${l.id}`, on: true }, ...rows]); closeAllSheets(); toast(`${l.name} added to Home`); }} />
    ))}</>
  ));
  return (
    <>
      <h2>Home screen</h2>
      <p class="muted" style={{ maxWidth: '44rem', marginBottom: '1rem' }}>Choose the rows on Home and their order. A sports row shows live and upcoming matches with their streams; adding one doesn't turn on any notifications.</p>
      <div class="stack" data-setting="homeRows">
        {rows.map((r, i) => (
          <div key={r.id} class="menu-edit" data-nav-group>
            <span class="menu-edit-name">{label(r.id)}</span>
            <button class="btn icon" aria-label={`Move ${label(r.id)} up`} disabled={i === 0} onClick={() => move(i, -1)}><Icon name="up" /></button>
            <button class="btn icon" aria-label={`Move ${label(r.id)} down`} disabled={i === rows.length - 1} onClick={() => move(i, 1)}><Icon name="down" /></button>
            {r.id.startsWith('sport:')
              ? <button class="btn danger" onClick={() => save(rows.filter(x => x !== r))}>Remove</button>
              : <button class={`btn${r.on ? ' primary' : ''}`} onClick={() => save(rows.map(x => (x === r ? { ...x, on: !x.on } : x)))}>{r.on ? 'Shown' : 'Hidden'}</button>}
          </div>
        ))}
      </div>
      <div class="row" style={{ marginTop: '1.2rem' }}>
        <button class="btn primary" onClick={addSports}><Icon name="plus" />Add a sports row</button>
        <button class="btn" onClick={() => save([])}><Icon name="refresh" />Restore the usual rows</button>
      </div>
    </>
  );
}
