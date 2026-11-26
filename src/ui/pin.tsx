// A 4-digit PIN pad that works with the remote: arrow to the digits and press OK, or press the
// remote's number keys directly. No on-screen keyboard needed.
import { signal } from '@preact/signals';
import { useEffect, useRef, useState } from 'preact/hooks';
import { pushLayer, focusFirst } from '../nav/focus';
import { onAction } from '../nav/keys';
import { Icon } from './icons';
import { settings, updateSettings } from '../sources/library';
import { hashPin, unlocked } from '../sources/restrictions';

const pad = signal<{ title: string; sub: string; resolve: (pin: string | null) => void } | null>(null);

/** Asks for 4 digits. Resolves with them, or null if cancelled. */
export function askPin(title: string, sub = ''): Promise<string | null> {
  return new Promise(resolve => { pad.value = { title, sub, resolve }; });
}

/** Checks the PIN (if one is set) and unlocks restricted content for this session. */
export async function requirePin(why: string): Promise<boolean> {
  if (!settings.value.pinHash || unlocked.value) return true;
  for (let i = 0; i < 3; i++) {
    const pin = await askPin(i ? 'Wrong PIN. Try again' : 'Enter your PIN', why);
    if (pin === null) return false;
    if (await hashPin(pin) === settings.value.pinHash) { unlocked.value = true; return true; }
  }
  return false;
}

/** Sets a new PIN (asked twice). Returns false if cancelled or the two didn't match. */
export async function setNewPin(): Promise<boolean> {
  const a = await askPin('Choose a 4-digit PIN', 'You will need it to change parental controls');
  if (a === null) return false;
  const b = await askPin('Enter the PIN again');
  if (b === null || a !== b) return false;
  updateSettings({ pinHash: await hashPin(a) });
  unlocked.value = false;
  return true;
}

export function PinPad() {
  const p = pad.value;
  const [digits, setDigits] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!p || !ref.current) return;
    setDigits('');
    const pop = pushLayer(ref.current, () => done(null));
    focusFirst(ref.current);
    const off = onAction(ref.current, a => {
      if (a.startsWith('digit')) { add(a.slice(5)); return true; }
    });
    return () => { off(); pop(); };
  }, [p]);
  if (!p) return null;
  const done = (v: string | null) => { pad.value = null; p.resolve(v); };
  const add = (d: string) => setDigits(x => {
    const next = (x + d).slice(0, 4);
    if (next.length === 4) setTimeout(() => done(next), 120);
    return next;
  });
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'];
  return (
    <div class="dialog-backdrop">
      <div class="dialog pinpad" ref={ref} role="dialog" aria-label={p.title}>
        <h2>{p.title}</h2>
        {p.sub && <p>{p.sub}</p>}
        <div class="pin-dots" aria-label={`${digits.length} of 4 digits`}>{[0, 1, 2, 3].map(i => <i key={i} class={i < digits.length ? 'on' : ''} />)}</div>
        <div class="pin-keys" data-nav-group>
          {keys.map((k, i) => k === '' ? <span key={i} /> : (
            <button key={i} class="pin-key" data-autofocus={k === '1' || undefined} aria-label={k === 'del' ? 'Delete' : k}
              onClick={() => (k === 'del' ? setDigits(x => x.slice(0, -1)) : add(k))}>{k === 'del' ? <Icon name="left" /> : k}</button>
          ))}
        </div>
        <button class="btn quiet" onClick={() => done(null)}>Cancel</button>
      </div>
    </div>
  );
}
