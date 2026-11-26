// First run: the sign-in screen. One centred card that always fits a TV screen: the logo on top, then
// the sign-in form (login type, server, username, password, Sign In) beside "OR" and the QR code for
// typing the details on a phone instead (Android TV, where typing with a remote is slow). Optional
// fields (name, extra guide link) sit behind More options.
import { useEffect, useRef } from 'preact/hooks';
import { Wordmark } from '../ui/brand';
import { SourceForm } from './SourceForm';
import { PairingPanel, pairingAvailable } from './PairingPanel';
import { focusFirst } from '../nav/focus';

export function Welcome() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { requestAnimationFrame(() => focusFirst(ref.current!)); }, []);
  return (
    <div class="screen si-screen" ref={ref}>
      <div class={`si-card${pairingAvailable ? ' two' : ''}`}>
        <Wordmark class="si-logo" />
        <div class="si-cols">
          <section class="si-form">
            <h2>Sign in</h2>
            <p class="si-sub">Enter the details your TV provider sent you.</p>
            <SourceForm kind="xtream" compact />
          </section>
          {pairingAvailable && (
            <>
              <div class="si-or"><span>OR</span></div>
              <section class="si-phone">
                <h2>Use your phone</h2>
                <PairingPanel />
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
