// "Scan with your phone": a QR code that opens a page served by the TV on the home network.
// Whatever the viewer sends from the phone is added as a playlist here.
import { withStartup } from '../sources/loadState';
import { useEffect, useState } from 'preact/hooks';
import { renderSVG } from 'uqr';
import { OrbitPlayer } from '../core/native';
import { PLATFORM } from '../core/platform';
import { addSource, reload, sources } from '../sources/library';
import { normaliseMac } from '../sources/stalker';
import type { Source } from '../sources/types';
import { toast } from '../ui/overlays';
import { PHONE_PAGE } from './phonePage';

export const pairingAvailable = PLATFORM === 'android';

/** Turns the phone form into a playlist, or explains what is missing. */
export function sourceFromPhone(f: Record<string, string>): Omit<Source, 'id' | 'enabled'> | string {
  const name = (f.name || '').trim();
  const host = (u: string) => { try { return new URL(/^https?:/i.test(u) ? u : 'http://' + u).hostname; } catch { return 'My playlist'; } };
  if (f.type === 'm3u') {
    const url = (f.url || '').trim();
    if (!/^https?:\/\//i.test(url)) return 'The playlist link must start with http:// or https://';
    return { type: 'm3u', name: name || host(url), url };
  }
  if (f.type === 'stalker') {
    const portal = (f.portal || '').trim(), mac = normaliseMac(f.mac || '');
    if (!portal || mac.length !== 17) return 'Enter the portal address and a MAC address like 00:1A:79:12:34:56.';
    return { type: 'stalker', name: name || host(portal), portal, mac };
  }
  const server = (f.server || '').trim(), user = (f.user || '').trim(), pass = f.pass || '';
  if (!server || !user || !pass) return 'Enter the server address, username and password.';
  return { type: 'xtream', name: name || host(server), server, user, pass };
}

export function PairingPanel({ onAdded }: { onAdded?: () => void }) {
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState<'starting' | 'waiting' | 'loading' | 'failed'>('starting');
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    const sub = OrbitPlayer.addListener('pairing', async f => {
      const src = sourceFromPhone(f);
      if (typeof src === 'string') { toast(src, true); return; }
      setStatus('loading');
      toast(`Received ${src.name} from your phone`);
      const added = addSource(src);
      await withStartup(() => reload(true));
      const s = sources.value.find(x => x.id === added.id);
      if (s?.error) toast(`${s.name}: ${s.error}`, true);
      if (alive) setStatus('waiting');
      onAdded?.();
    });
    OrbitPlayer.startPairing({ page: PHONE_PAGE })
      .then(r => {
        if (import.meta.env.VITE_TRACE_FOCUS === '1') console.debug(`[orbit] pairing ${r.url}`); // read by the device test
        if (alive) { setUrl(r.url); setStatus('waiting'); }
      })
      .catch(e => { if (alive) { setStatus('failed'); setError(e instanceof Error ? e.message : String(e)); } });
    return () => { alive = false; sub.then(h => h.remove()); OrbitPlayer.stopPairing().catch(() => {}); };
  }, []);

  return (
    <div class="pair">
      <div class="pair-qr" aria-label="QR code">
        {url ? <div dangerouslySetInnerHTML={{ __html: renderSVG(url, { border: 1 }) }} /> : <span class="spinner big" />}
      </div>
      {status === 'failed' ? (
        <p class="error-text">The phone link could not start: {error} Use the sign-in form instead.</p>
      ) : (
        <>
          <p class="pair-how">Scan with your phone's camera. Your phone needs to be on the same Wi-Fi as this TV (not mobile data or a guest network). If the page won't open, turn off any VPN on the phone.</p>
          {url && <p class="pair-url tnum">or open <b>{url.replace(/^http:\/\//, '')}</b></p>}
          <p class="pair-status"><span class={`dot${status === 'loading' ? ' busy' : ''}`} />{status === 'loading' ? 'Loading your playlist…' : 'Waiting for your details…'}</p>
        </>
      )}
    </div>
  );
}
