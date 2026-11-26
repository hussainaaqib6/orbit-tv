// A list that only renders the rows on screen, so a 10,000-channel playlist scrolls smoothly on a
// Fire TV Stick. It moves focus itself on Up/Down/Page/Channel keys; Left/Right leave the list.
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { onAction } from '../nav/keys';
import { focusEl } from '../nav/focus';

const remPx = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;

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
  const [scroll, setScroll] = useState(0);
  const [height, setHeight] = useState(600);
  const [rowPx, setRowPx] = useState(p.rowRem * 16);
  const focusIndex = useRef(Math.max(0, p.startIndex ?? 0));
  const pendingFocus = useRef<number | null>(null);
  const props = useRef(p);
  props.current = p;

  useLayoutEffect(() => {
    const el = box.current!;
    const measure = () => { setHeight(el.clientHeight); setRowPx(p.rowRem * remPx()); };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [p.rowRem]);

  // Jump to the start index when the list changes (new category).
  useLayoutEffect(() => {
    const i = Math.min(Math.max(0, p.startIndex ?? 0), Math.max(0, p.items.length - 1));
    focusIndex.current = i;
    const el = box.current!;
    el.scrollTop = Math.max(0, i * rowPx - el.clientHeight / 2 + rowPx / 2);
    setScroll(el.scrollTop);
  }, [p.items, rowPx]);

  const ensureVisible = (i: number) => {
    const el = box.current!;
    const top = i * rowPx, bottom = top + rowPx;
    if (top < el.scrollTop + rowPx * 0.5) el.scrollTop = Math.max(0, top - rowPx * 0.5);
    else if (bottom > el.scrollTop + el.clientHeight - rowPx * 0.5) el.scrollTop = bottom - el.clientHeight + rowPx * 0.5;
    setScroll(el.scrollTop);
  };

  const moveTo = (i: number) => {
    const n = props.current.items.length;
    if (!n) return;
    i = Math.max(0, Math.min(n - 1, i));
    focusIndex.current = i;
    ensureVisible(i);
    pendingFocus.current = i;
    // If the row is already rendered, focus it now; otherwise after the next render.
    const row = box.current!.querySelector<HTMLElement>(`[data-index="${i}"]`);
    if (row) { focusEl(row, false); pendingFocus.current = null; }
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
    const page = Math.max(1, Math.floor(box.current!.clientHeight / rowPx) - 1);
    switch (a) {
      case 'up': if (i === 0) return d.repeat ? true : false; moveTo(i - 1); return true;
      case 'down': if (i >= props.current.items.length - 1) return true; moveTo(i + 1); return true;
      case 'pageup': case 'chup': case 'rw': moveTo(i - page); return true;
      case 'pagedown': case 'chdown': case 'ff': moveTo(i + page); return true;
    }
  }), [rowPx]);

  const first = Math.max(0, Math.floor(scroll / rowPx) - 4);
  const last = Math.min(p.items.length, Math.ceil((scroll + height) / rowPx) + 4);
  const rows: ComponentChildren[] = [];
  for (let i = first; i < last; i++) {
    const item = p.items[i];
    rows.push(
      <div class="vlist-item" key={p.keyOf(item)} style={{ top: `${i * rowPx}px`, height: `${rowPx}px` }}>
        {p.render(item, i)}
      </div>,
    );
  }
  return (
    <div class={`vlist ${p.class ?? ''}`} ref={box} data-nav-group={p.navGroup} onScroll={e => setScroll((e.currentTarget as HTMLElement).scrollTop)}>
      <div class="vlist-inner" style={{ height: `${p.items.length * rowPx}px` }}>{rows}</div>
    </div>
  );
}

/** Index the list wants focused when focus arrives from outside (spatial nav lands on any visible row). */
export const rowProps = (i: number) => ({ 'data-index': String(i), tabIndex: 0 });
