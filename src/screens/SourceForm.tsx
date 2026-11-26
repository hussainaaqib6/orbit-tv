// Adding or editing a playlist: Xtream Codes login, M3U link or file, or MAC portal.
import { useState } from 'preact/hooks';
import { addSource, updateSource, reload, saveM3UFile, sources } from '../sources/library';
import type { Source, SourceType } from '../sources/types';
import { looksLikeM3U } from '../sources/m3u';
import { normaliseMac } from '../sources/stalker';
import { toast } from '../ui/overlays';
import { Icon } from '../ui/icons';

export type Kind = 'xtream' | 'm3u' | 'file' | 'stalker';
const KINDS: { id: Kind; label: string }[] = [
  { id: 'xtream', label: 'Xtream Codes' }, { id: 'm3u', label: 'M3U link' }, { id: 'file', label: 'M3U file' }, { id: 'stalker', label: 'MAC portal' },
];

function Field({ label, value, onInput, type = 'text', placeholder, hint }: { label: string; value: string; onInput: (v: string) => void; type?: string; placeholder?: string; hint?: string }) {
  return (
    <label class="field">
      <span>{label}</span>
      <input class="input" type={type} value={value} placeholder={placeholder} autocomplete="off" autocapitalize="off" spellcheck={false}
        onInput={e => onInput((e.target as HTMLInputElement).value)} />
      {hint && <span class="hint">{hint}</span>}
    </label>
  );
}

export function SourceForm({ existing, onDone, kind: startKind }: { existing?: Source; onDone?: () => void; kind?: Kind }) {
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
    await reload();
    setBusy(false);
    const s = sources.value.find(x => x.id === id);
    if (s?.error) { setError(s.error); return; }
    const n = s?.counts;
    toast(n ? `${s!.name}: ${n.live} channels, ${n.movies} films, ${n.series} series` : 'Playlist saved');
    onDone?.();
  };

  return (
    <form class="form" onSubmit={submit}>
      <div class="choice" style={{ marginBottom: '1.4rem' }} data-nav-group>
        {KINDS.map(k => <button type="button" key={k.id} class={`chip${kind === k.id ? ' on' : ''}`} onClick={() => setKind(k.id)} data-autofocus={kind === k.id || undefined}>{k.label}</button>)}
      </div>
      {kind === 'xtream' && (
        <>
          <Field label="Server address" value={f.server} onInput={set('server')} type="url" placeholder="http://example.com:8080" />
          <div class="row" style={{ alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}><Field label="Username" value={f.user} onInput={set('user')} placeholder="Press OK to type" /></div>
            <div style={{ flex: 1 }}><Field label="Password" value={f.pass} onInput={set('pass')} type="password" placeholder="Press OK to type" /></div>
          </div>
        </>
      )}
      {kind === 'm3u' && <Field label="Playlist link" value={f.url} onInput={set('url')} type="url" placeholder="http://example.com/get.php?username=…&type=m3u_plus" hint="If your provider gave you an Xtream login too, use that instead: it loads faster and includes catch-up." />}
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
          <Field label="Portal address" value={f.portal} onInput={set('portal')} type="url" placeholder="http://portal.example.com/c/" />
          <Field label="MAC address" value={f.mac} onInput={set('mac')} placeholder="00:1A:79:12:34:56" />
        </>
      )}
      <Field label="Name (optional)" value={f.name} onInput={set('name')} placeholder="My TV" />
      <Field label="Extra guide link (optional)" value={f.epgUrl} onInput={set('epgUrl')} type="url" placeholder="http://example.com/epg.xml.gz" hint="Only needed if your provider's guide is missing." />
      {error && <p class="error-text" role="alert" style={{ marginBottom: '1rem' }}>{error}</p>}
      <div class="row">
        <button type="submit" class="btn primary" disabled={busy}>{busy ? <><span class="spinner" />Loading playlist…</> : existing ? 'Save changes' : 'Add playlist'}</button>
        {onDone && <button type="button" class="btn quiet" onClick={onDone}>Cancel</button>}
      </div>
    </form>
  );
}

function hostName(u: string): string {
  try { return new URL(/^https?:/i.test(u) ? u : 'http://' + u).hostname.replace(/^www\./, ''); } catch { return 'My playlist'; }
}
