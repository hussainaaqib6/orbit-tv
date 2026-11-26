// First run: the sign-in screen, laid out like GalaxyXC's login (docs/GALAXYXC_REFERENCE.md): a
// centred column with the logo, the kind of login, the fields and a full-width Sign In button.
// Chips above the fields pick Xtream Codes, M3U link, file or MAC portal. Where pairing is available
// a second button lets you type the details on a phone instead (scan the QR code).
import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from '../ui/icons';
import { Wordmark } from '../ui/brand';
import { SourceForm } from './SourceForm';
import { PairingPanel, pairingAvailable } from './PairingPanel';
import { onAction } from '../nav/keys';
import { focusFirst } from '../nav/focus';
import { clock } from '../core/format';

export function Welcome() {
  const [phone, setPhone] = useState(false);
  const [now, setNow] = useState(Date.now());
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(t); }, []);
  // Back from the phone panel returns to the sign-in fields.
  useEffect(() => onAction(ref.current!, a => {
    if (a === 'back' && phone) { setPhone(false); return true; }
  }), [phone]);
  useEffect(() => { requestAnimationFrame(() => focusFirst(ref.current!)); }, [phone]);

  return (
    <div class="screen opaque gx-login-screen" ref={ref}>
      <span class="gx-login-clock tnum">{clock(now)}</span>
      <div class="gx-login">
        <Wordmark class="gx-login-logo" />
        {phone ? (
          <>
            <p class="gx-login-kind">SIGN IN WITH YOUR PHONE</p>
            <div class="card"><PairingPanel /></div>
            <button class="btn quiet gx-login-alt" onClick={() => setPhone(false)}><Icon name="left" />Type the details here</button>
          </>
        ) : (
          <>
            <p class="gx-login-kind">XTREAM CODES COMPATIBLE API · M3U · MAC PORTAL</p>
            <SourceForm kind="xtream" />
            {pairingAvailable && <button class="btn quiet gx-login-alt" onClick={() => setPhone(true)}><Icon name="tv" />Sign in with your phone instead</button>}
            <p class="hint gx-login-note">Enter the details your TV provider sent you. The app has no channels of its own.</p>
          </>
        )}
      </div>
    </div>
  );
}
