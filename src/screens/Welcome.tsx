// First run: the sign-in screen, laid out like GalaxyXC's login (docs/GALAXYXC_REFERENCE.md): a
// centred column with the logo, the kind of login, the fields and a full-width Sign In button.
// Chips above the fields pick Xtream Codes, M3U link, file or MAC portal. On Android TV the QR code
// for signing in with a phone sits beside the column, since typing with a remote is slow.
import { useEffect, useRef, useState } from 'preact/hooks';
import { Wordmark } from '../ui/brand';
import { SourceForm } from './SourceForm';
import { PairingPanel, pairingAvailable } from './PairingPanel';
import { focusFirst } from '../nav/focus';
import { clock } from '../core/format';

export function Welcome() {
  const [now, setNow] = useState(Date.now());
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(t); }, []);
  useEffect(() => { requestAnimationFrame(() => focusFirst(ref.current!)); }, []);

  return (
    <div class="screen opaque gx-login-screen" ref={ref}>
      <span class="gx-login-clock tnum">{clock(now)}</span>
      <div class="gx-login">
        <Wordmark class="gx-login-logo" />
        <p class="gx-login-kind">XTREAM CODES COMPATIBLE API · M3U · MAC PORTAL</p>
        <SourceForm kind="xtream" />
        <p class="hint gx-login-note">Enter the details your TV provider sent you. The app has no channels of its own.</p>
      </div>
      {pairingAvailable && (
        <aside class="gx-login-phone card">
          <p class="gx-login-kind" style={{ marginBottom: '0.6rem' }}>OR SIGN IN WITH YOUR PHONE</p>
          <PairingPanel />
        </aside>
      )}
    </div>
  );
}
