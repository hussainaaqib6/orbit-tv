// Adding or editing a playlist: Xtream Codes login, M3U link or file, or MAC portal.
import { withStartup } from '../sources/loadState';
import { useState } from 'preact/hooks';
import { addSource, updateSource, reload, saveM3UFile, sources } from '../sources/library';
import type { Source, SourceType } from '../sources/types';
import { looksLikeM3U } from '../sources/m3u';
import { normaliseMac } from '../sources/stalker';
import { toast } from '../ui/overlays';
import { Icon, type IconName } from '../ui/icons';
import { PLATFORM } from '../core/platform';

export type Kind = 'xtream' | 'm3u' | 'file' | 'stalker';
const KINDS: { id: Kind; label: string }[] = [
  { id: 'xtream', label: 'Xtream Codes' }, { id: 'm3u', label: 'M3U link' }, { id: 'file', label: 'M3U file' }, { id: 'stalker', label: 'MAC portal' },
];

/** Compact (sign-in screen): no labels or hints, an icon in the field and the label as its placeholder. */
function Field({ label, value, onInput, type = 'text', placeholder, hint, icon, compact }: { label: string; value: string; onInput: (v: string) => void; type?: string; placeholder?: string; hint?: string; icon?: IconName; compact?: boolean }) {
  if (compact) {
    return (
      <label class="field si-field" aria-label={label}>
        {icon && <Icon name={icon} />}
        <input class="input" type={type} value={value} placeholder={label} autocomplete="off" autocapitalize="off" spellcheck={false}
          onInput={e => onInput((e.target as HTMLInputElement).value)} />
      </label>
    );
  }
  return (
    <label class="field">
      <span>{label}</span>
      <input class="input" type={type} value={value} placeholder={placeholder} autocomplete="off" autocapitalize="off" spellcheck={false}
        onInput={e => onInput((e.target as HTMLInputElement).value)} />
      {hint && <span class="hint">{hint}</span>}
    </label>
  );
}

export function SourceForm({ existing, onDone, kind: startKind, compact }: { existing?: Source; onDone?: () => void; kind?: Kind; compact?: boolean }) {
  const [more, setMore] = useState(false);
  const initialKind: Kind = existing ? (existing.type === 'm3u' && existing.fromFile ? 'file' : existing.type) : startKind ?? 'xtream';
  const [kind, setKind] = useState<Kind>(initialKind);
  const [f, setF] = useState({
    name: existing?.name ?? '', server: existing?.server ?? '', user: existing?.user ?? '', pass: existing?.pass ?? '',
    url: existing?.url ?? '', portal: existing?.portal ?? '', mac: existing?.mac ?? '', epgUrl: existing?.epgUrl ?? '',
  });
  const [fileText, setFileText] = useState<{ name: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof typeof f) => (v: string) => setF(x => ({ ...x, [k]: v }));

  const pickFile = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.m3u,.m3u8,audio/x-mpegurl,text/plain';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const text = await file.text();
      if (!looksLikeM3U(text)) { setError('That file is not an M3U playlist.'); return; }
      setFileText({ name: file.name, text });
      setError('');
      if (!f.name) set('name')(file.name.replace(/\.\w+$/, ''));
    };
    input.click();
  };

  const submit = async (e: Event) => {
    e.preventDefault();
    setError('');
    let data: Omit<Source, 'id' | 'enabled'>;
    const type: SourceType = kind === 'file' ? 'm3u' : kind;
    if (kind === 'xtream') {
      if (!f.server.trim() || !f.user.trim() || !f.pass) return setError('Enter the server address, username and password.');
      data = { type, name: f.name.trim() || hostName(f.server), server: f.server.trim(), user: f.user.trim(), pass: f.pass };
    } else if (kind === 'm3u') {
      if (!/^https?:\/\//i.test(f.url.trim())) return setError('Enter the full playlist link, starting with http:// or https://');
      data = { type, name: f.name.trim() || hostName(f.url), url: f.url.trim() };
    } else if (kind === 'file') {
      if (!fileText && !existing?.fromFile) return setError('Choose a playlist file.');
      data = { type, name: f.name.trim() || fileText?.name || 'My playlist', fromFile: true };
    } else {
      const mac = normaliseMac(f.mac);
      if (!f.portal.trim() || mac.length !== 17) return setError('Enter the portal address and a MAC address like 00:1A:79:12:34:56.');
      data = { type, name: f.name.trim() || hostName(f.portal), portal: f.portal.trim(), mac };
    }
    if (f.epgUrl.trim()) data.epgUrl = f.epgUrl.trim();

    setBusy(true);
    let id: string;
    if (existing) { updateSource(existing.id, { ...data, error: '' }); id = existing.id; }
    else id = addSource(data).id;
    if (kind === 'file' && fileText) await saveM3UFile(id, fileText.text);
    await withStartup(() => reload(true));
    setBusy(false);
    const s = sources.value.find(x => x.id === id);
    if (s?.error) { setError(s.error); return; }
    const n = s?.counts;
    toast(n ? `${s!.name}: ${n.live} channels, ${n.movies} films, ${n.series} series` : 'Playlist saved');
    onDone?.();
  };

  return (
    <form class="form" onSubmit={submit}>
      <div class={`choice${compact ? ' si-kinds' : ''}`} style={{ marginBottom: compact ? '1rem' : '1.4rem' }} data-nav-group>
        {KINDS.filter(k => !(compact && k.id === 'file' && PLATFORM === 'android')).map(k => <button type="button" key={k.id} class={`chip${kind === k.id ? ' on' : ''}`} onClick={() => setKind(k.id)} data-autofocus={kind === k.id || undefined}>{k.label}</button>)}
      </div>
      {kind === 'xtream' && (
        <>
          <Field compact={compact} label="Server address" icon="tv" value={f.server} onInput={set('server')} type="url" placeholder="http://example.com:8080" />
          <div class={compact ? '' : 'row'} style={{ alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}><Field compact={compact} label="Username" icon="account" value={f.user} onInput={set('user')} placeholder="Press OK to type" /></div>
            <div style={{ flex: 1 }}><Field compact={compact} label="Password" icon="lock" value={f.pass} onInput={set('pass')} type="password" placeholder="Press OK to type" /></div>
          </div>
        </>
      )}
      {kind === 'm3u' && <Field compact={compact} label="Playlist link" icon="list" value={f.url} onInput={set('url')} type="url" placeholder="http://example.com/get.php?username=…&type=m3u_plus" hint="If your provider gave you an Xtream login too, use that instead: it loads faster and includes catch-up." />}
      {kind === 'file' && (
        <div class="field">
          <span>Playlist file</span>
          <div class="row">
            <button type="button" class="btn" onClick={pickFile}><Icon name="file" />{fileText ? 'Choose another file' : 'Choose a file'}</button>
            <span class="muted">{fileText?.name ?? (existing?.fromFile ? 'Saved file' : '')}</span>
          </div>
        </div>
      )}
      {kind === 'stalker' && (
        <>
          <Field compact={compact} label="Portal address" icon="tv" value={f.portal} onInput={set('portal')} type="url" placeholder="http://portal.example.com/c/" />
          <Field compact={compact} label="MAC address" icon="remote" value={f.mac} onInput={set('mac')} placeholder="00:1A:79:12:34:56" />
        </>
      )}
      {(!compact || more) && (
        <>
          <Field compact={compact} label="Name (optional)" icon="edit" value={f.name} onInput={set('name')} placeholder="My TV" />
          <Field compact={compact} label="Extra guide link (optional)" icon="guide" value={f.epgUrl} onInput={set('epgUrl')} type="url" placeholder="http://example.com/epg.xml.gz" hint="Only needed if your provider's guide is missing." />
        </>
      )}
      {error && <p class="error-text" role="alert" style={{ marginBottom: '1rem' }}>{error}</p>}
      <div class={compact ? 'si-actions' : 'row'}>
        <button type="submit" class="btn primary" disabled={busy}>{busy ? <><span class="spinner" />Signing in…</> : existing ? 'Save changes' : 'Sign In'}</button>
        {onDone && <button type="button" class="btn quiet" onClick={onDone}>Cancel</button>}
        {compact && !more && <button type="button" class="btn quiet si-more" onClick={() => setMore(true)}>More options</button>}
      </div>
    </form>
  );
}

function hostName(u: string): string {
  try { return new URL(/^https?:/i.test(u) ? u : 'http://' + u).hostname.replace(/^www\./, ''); } catch { return 'My playlist'; }
}
