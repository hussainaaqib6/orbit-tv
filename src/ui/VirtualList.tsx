// A list that only renders the rows on screen, so a 10,000-channel playlist scrolls smoothly on a
// Fire TV Stick. It moves focus itself on Up/Down/Page/Channel keys; Left/Right leave the list.
// Scrolling is tracked in a ref; the component only re-renders when the range of rows it needs to
// draw changes, which on a held key is every few rows rather than every row.
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { onAction } from '../nav/keys';
import { focusEl } from '../nav/focus';

const remPx = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
const OVERSCAN = 6;
const STEP = 4; // re-render in steps of this many rows

export interface VirtualListProps<T> {
  items: T[];
  /** Row height in rem. */
  rowRem: number;
  keyOf: (item: T) => string;
  render: (item: T, index: number) => ComponentChildren;
  /** Index to show and focus first (e.g. the playing channel). */
  startIndex?: number;
  onFocusIndex?: (i: number) => void;
  /** Handle an action on the focused row (return true to consume). */
  onRowAction?: (action: string, index: number) => boolean | void;
  class?: string;
  navGroup?: string;
  /** Ask the list to move focus to a row (change `id` to ask again). */
  jump?: { index: number; id: number };
}

export function VirtualList<T>(p: VirtualListProps<T>) {
  const box = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState({ first: 0, last: 30 });
  const rowPx = useRef(p.rowRem * 16);
  const viewH = useRef(600);
  const pendingFocus = useRef<number | null>(null);
  const props = useRef(p);
  props.current = p;

  /** Works out which rows to draw for the current scroll position; re-renders only if that changed. */
  const update = () => {
    const el = box.current;
    if (!el) return;
    const rp = rowPx.current;
    const top = Math.floor(el.scrollTop / rp);
    const first = Math.max(0, Math.floor((top - OVERSCAN) / STEP) * STEP);
    const last = Math.min(props.current.items.length, Math.ceil((top + viewH.current / rp + OVERSCAN) / STEP) * STEP);
    setRange(r => (r.first === first && r.last === last ? r : { first, last }));
  };

  useLayoutEffect(() => {
    const el = box.current!;
    const measure = () => { viewH.current = el.clientHeight; rowPx.current = p.rowRem * remPx(); update(); };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [p.rowRem]);

  // A new list (another category): open it at the start index.
  useLayoutEffect(() => {
    const n = p.items.length;
    const i = Math.min(Math.max(0, p.startIndex ?? 0), Math.max(0, n - 1));
    const el = box.current!;
    el.scrollTop = Math.max(0, i * rowPx.current - el.clientHeight / 2 + rowPx.current / 2);
    update();
  }, [p.items]);

  const moveTo = (i: number) => {
    const n = props.current.items.length;
    if (!n) return;
    i = Math.max(0, Math.min(n - 1, i));
    const el = box.current!;
    const rp = rowPx.current;
    const top = i * rp, bottom = top + rp;
    // Keep one row of context above and below the focused row.
    if (top < el.scrollTop + rp) el.scrollTop = Math.max(0, top - rp);
    else if (bottom > el.scrollTop + el.clientHeight - rp) el.scrollTop = bottom - el.clientHeight + rp;
    update();
    const row = el.querySelector<HTMLElement>(`[data-index="${i}"]`);
    if (row) { focusEl(row, false); pendingFocus.current = null; } else pendingFocus.current = i;
    props.current.onFocusIndex?.(i);
  };

  useEffect(() => { if (p.jump) moveTo(p.jump.index); }, [p.jump?.id]);

  useLayoutEffect(() => {
    if (pendingFocus.current == null) return;
    const row = box.current!.querySelector<HTMLElement>(`[data-index="${pendingFocus.current}"]`);
    if (row) { focusEl(row, false); pendingFocus.current = null; }
  });

  useEffect(() => onAction(box.current!, (a, d) => {
    const cur = document.activeElement as HTMLElement | null;
    const idxAttr = cur?.closest<HTMLElement>('[data-index]')?.dataset.index;
    if (idxAttr == null) return;
    const i = +idxAttr;
    if (props.current.onRowAction?.(a, i) === true) return true;
    const page = Math.max(1, Math.floor(box.current!.clientHeight / rowPx.current) - 1);
    switch (a) {
      case 'up': if (i === 0) return d.repeat ? true : false; moveTo(i - 1); return true;
      case 'down': moveTo(i + 1); return true;
      case 'pageup': case 'chup': case 'rw': moveTo(i - page); return true;
      case 'pagedown': case 'chdown': case 'ff': moveTo(i + page); return true;
    }
  }), []);

  const rp = rowPx.current;
  const rows: ComponentChildren[] = [];
  const end = Math.min(range.last, p.items.length);
  for (let i = range.first; i < end; i++) {
    const item = p.items[i];
    rows.push(
      <div class="vlist-item" key={p.keyOf(item)} style={{ transform: `translateY(${i * rp}px)`, height: `${rp}px` }}>
        {p.render(item, i)}
      </div>,
    );
  }
  return (
    <div class={`vlist ${p.class ?? ''}`} ref={box} data-nav-group={p.navGroup} onScroll={update}>
      <div class="vlist-inner" style={{ height: `${p.items.length * rp}px` }}>{rows}</div>
    </div>
  );
}

/** Attributes for a focusable row inside a VirtualList. */
export const rowProps = (i: number) => ({ 'data-index': String(i), tabIndex: 0 });
