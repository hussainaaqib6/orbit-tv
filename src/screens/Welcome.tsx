// First run. Step one: pick how to add a playlist (or scan the QR code with a phone).
// Step two: type the details with the remote.
import { useEffect, useRef, useState } from 'preact/hooks';
import { OrbitMark, Icon, type IconName } from '../ui/icons';
import { SourceForm, type Kind } from './SourceForm';
import { PairingPanel, pairingAvailable } from './PairingPanel';
import { onAction } from '../nav/keys';
import { focusFirst } from '../nav/focus';
import { PLATFORM } from '../core/platform';
import { clock } from '../core/format';

function Option({ icon, title, sub, onClick, autofocus }: { icon: IconName; title: string; sub: string; onClick: () => void; autofocus?: boolean }) {
  return (
    <button class="option" onClick={onClick} data-autofocus={autofocus || undefined}>
      <span class="option-icon"><Icon name={icon} /></span>
      <span class="option-text"><b>{title}</b><small>{sub}</small></span>
      <Icon name="right" class="option-go" />
    </button>
  );
}

export function Welcome() {
  const [step, setStep] = useState<{ kind: Kind } | null>(null);
  const [now, setNow] = useState(Date.now());
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(t); }, []);
  // Back from "Type it here" returns to the choices.
  useEffect(() => onAction(ref.current!, a => {
    if (a === 'back' && step && !(document.activeElement instanceof HTMLInputElement)) { setStep(null); return true; }
  }), [step]);
  useEffect(() => { requestAnimationFrame(() => focusFirst(ref.current!)); }, [step]);

  return (
    <div class="screen opaque" ref={ref}>
      <div class="welcome-top"><span class="welcome-brand"><OrbitMark /><b>Orbit</b></span><span class="tnum">{clock(now)}</span></div>
      {!step ? (
        <div class="welcome">
          <div class="welcome-main">
            <h1>Add your first playlist</h1>
            <p class="lead">{pairingAvailable ? 'Scan the code with your phone and type your provider details there. Or type them here with the remote.' : 'Enter the details your TV provider sent you.'}</p>
            <div class="options">
              <Option icon="tv" title="Type it here" sub="Xtream Codes, M3U link or MAC portal" onClick={() => setStep({ kind: 'xtream' })} autofocus />
              <Option icon="list" title="M3U playlist link" sub="A link ending in .m3u or get.php" onClick={() => setStep({ kind: 'm3u' })} />
              {PLATFORM !== 'android' && <Option icon="file" title="Open a playlist file" sub="An .m3u file on this device" onClick={() => setStep({ kind: 'file' })} />}
            </div>
          </div>
          {pairingAvailable ? (
            <div class="welcome-side card"><PairingPanel /></div>
          ) : (
            <div class="welcome-side card">
              <h2>What you need</h2>
              <p class="muted">Your provider's server address, username and password (Xtream Codes), or a playlist link. Orbit has no channels of its own.</p>
            </div>
          )}
        </div>
      ) : (
        <div class="welcome">
          <div class="welcome-main">
            <h1>Type it here</h1>
            <p class="lead">Type your provider details.</p>
            <p class="muted">Xtream Codes, M3U link or MAC portal. Back returns to the choices.</p>
          </div>
          <div class="welcome-side card form-card"><SourceForm kind={step.kind} onDone={() => setStep(null)} /></div>
        </div>
      )}
    </div>
  );
}
