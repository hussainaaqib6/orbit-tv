// Side sheets (hold OK / Menu), confirmation dialogs and toasts.
import { signal } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { pushLayer, focusFirst } from '../nav/focus';

/* ------------------------------ sheets ------------------------------ */

interface SheetSpec { id: number; title: string; sub?: string; render: () => ComponentChildren }
let sheetId = 1;
const sheets = signal<SheetSpec[]>([]);

/** Opens a side sheet. Sheets stack: Back closes the top one. */
export function openSheet(title: string, render: () => ComponentChildren, sub?: string) {
  sheets.value = [...sheets.value, { id: sheetId++, title, render, sub }];
}
/** Replaces the top sheet (for drilling into a sub-menu without stacking). */
export function replaceSheet(title: string, render: () => ComponentChildren, sub?: string) {
  sheets.value = [...sheets.value.slice(0, -1), { id: sheetId++, title, render, sub }];
}
export const closeSheet = () => { sheets.value = sheets.value.slice(0, -1); };
export const closeAllSheets = () => { sheets.value = []; };
export const sheetOpen = () => sheets.value.length > 0;

function Sheet({ spec }: { spec: SheetSpec }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current!;
    const pop = pushLayer(el, closeSheet);
    focusFirst(el);
    return pop;
  }, []);
  return (
    <>
      <div class="sheet-backdrop" onClick={closeSheet} />
      <div class="sheet" ref={ref} role="dialog" aria-label={spec.title}>
        <div class="sheet-head">
          <div style={{ flex: 1 }}>
            <h2>{spec.title}</h2>
            {spec.sub && <div class="sub">{spec.sub}</div>}
          </div>
        </div>
        <div class="sheet-body">{spec.render()}</div>
      </div>
    </>
  );
}

export function Sheets() {
  const list = sheets.value;
  if (!list.length) return null;
  const top = list[list.length - 1];
  return <Sheet key={top.id} spec={top} />;
}

/* ------------------------------ dialogs ------------------------------ */

interface DialogSpec { title: string; text: string; ok: string; cancel: string; safeDefault: boolean; resolve: (v: boolean) => void }
const dialog = signal<DialogSpec | null>(null);

/** `safeDefault`: focus starts on Cancel, so a stray OK press does nothing harmful (leaving, deleting). */
export function confirmDialog(title: string, text: string, ok = 'OK', cancel = 'Cancel', safeDefault = true): Promise<boolean> {
  return new Promise(resolve => { dialog.value = { title, text, ok, cancel, safeDefault, resolve }; });
}

export function Dialog() {
  const d = dialog.value;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!d || !ref.current) return;
    const pop = pushLayer(ref.current, () => done(false));
    focusFirst(ref.current);
    return pop;
  }, [d]);
  if (!d) return null;
  const done = (v: boolean) => { dialog.value = null; d.resolve(v); };
  return (
    <div class="dialog-backdrop">
      <div class="dialog" ref={ref} role="alertdialog" aria-label={d.title}>
        <h2>{d.title}</h2>
        <p>{d.text}</p>
        <div class="row">
          <button class="btn primary" data-autofocus={!d.safeDefault || undefined} onClick={() => done(true)}>{d.ok}</button>
          <button class="btn quiet" data-autofocus={d.safeDefault || undefined} onClick={() => done(false)}>{d.cancel}</button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ toasts ------------------------------ */

const toasts = signal<{ id: number; text: string; bad: boolean }[]>([]);
let nextId = 1;
export function toast(text: string, bad = false) {
  const id = nextId++;
  toasts.value = [...toasts.value.slice(-2), { id, text, bad }];
  setTimeout(() => { toasts.value = toasts.value.filter(t => t.id !== id); }, bad ? 5000 : 3000);
}
export function Toasts() {
  return <div class="toasts" aria-live="polite">{toasts.value.map(t => <div key={t.id} class={`toast${t.bad ? ' bad' : ''}`}>{t.text}</div>)}</div>;
}

/* ------------------------------ sheet building blocks ------------------------------ */

export function SheetItem(p: { icon?: ComponentChildren; label: ComponentChildren; sub?: string; value?: string; checked?: boolean; onClick: () => void; autofocus?: boolean }) {
  return (
    <button class="sheet-item" onClick={p.onClick} data-autofocus={p.autofocus || undefined}>
      {p.icon}
      <span style={{ flex: 1 }}>{p.label}{p.sub && <small>{p.sub}</small>}</span>
      {p.value && <span class="val">{p.value}</span>}
      {p.checked && <span class="check">●</span>}
    </button>
  );
}
