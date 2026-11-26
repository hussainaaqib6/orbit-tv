// A poster wall that only renders the rows on screen and moves focus itself with the D-pad.
// Left from the first column and Up from the first row leave the grid.
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { onAction } from '../nav/keys';
import { focusEl } from '../nav/focus';

const remPx = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;

export interface VirtualGridProps<T> {
  items: T[];
  /** Minimum card width in rem. */
  minRem: number;
  /** Card height = width * ratio + extra rem (for the title). */
  ratio: number;
  extraRem: number;
  keyOf: (item: T) => string;
  render: (item: T, index: number) => ComponentChildren;
}

interface Metrics { cols: number; rowPx: number; height: number; gap: number; pad: number; cardW: number }

export function VirtualGrid<T>(p: VirtualGridProps<T>) {
  const box = useRef<HTMLDivElement>(null);
  const [m, setM] = useState<Metrics>({ cols: 6, rowPx: 300, height: 600, gap: 16, pad: 32, cardW: 120 });
  const [rowRange, setRowRange] = useState({ first: 0, last: 6 });
  const pending = useRef<number | null>(null);
  const props = useRef(p);
  props.current = p;
  const mRef = useRef(m);
  mRef.current = m;

  const update = () => {
    const el = box.current;
    if (!el) return;
    const { rowPx, height } = mRef.current;
    const first = Math.max(0, Math.floor(el.scrollTop / rowPx) - 1);
    const last = Math.ceil((el.scrollTop + height) / rowPx) + 1;
    setRowRange(r => (r.first === first && r.last === last ? r : { first, last }));
  };

  useLayoutEffect(() => {
    const el = box.current!;
    const measure = () => {
      const rem = remPx();
      const gap = 1 * rem, pad = 1.8 * rem;
      const width = el.clientWidth - pad * 2;
      const cols = Math.max(2, Math.floor((width + gap) / (p.minRem * rem + gap)));
      const cardW = (width - gap * (cols - 1)) / cols;
      const next = { cols, rowPx: Math.round(cardW * p.ratio + p.extraRem * rem + gap), height: el.clientHeight, gap, pad, cardW };
      mRef.current = next;
      setM(next);
      update();
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => { box.current!.scrollTop = 0; update(); }, [p.items]);

  const moveTo = (i: number) => {
    const n = props.current.items.length;
    i = Math.max(0, Math.min(n - 1, i));
    const el = box.current!;
    const { cols, rowPx } = mRef.current;
    const row = Math.floor(i / cols);
    const top = row * rowPx, bottom = top + rowPx;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight;
    update();
    const card = el.querySelector<HTMLElement>(`[data-cell="${i}"] > *`);
    if (card) focusEl(card, false); else pending.current = i;
  };

  useLayoutEffect(() => {
    if (pending.current == null) return;
    const card = box.current!.querySelector<HTMLElement>(`[data-cell="${pending.current}"] > *`);
    if (card) { focusEl(card, false); pending.current = null; }
  });

  // Held keys: apply at most one move per frame.
  const busy = useRef(false);
  useEffect(() => onAction(box.current!, (a, d) => {
    const cell = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-cell]');
    if (!cell) return;
    if (d.repeat && busy.current) return true;
    busy.current = true;
    requestAnimationFrame(() => { busy.current = false; });
    const i = +cell.dataset.cell!;
    const n = props.current.items.length, c = mRef.current.cols;
    const page = Math.max(1, Math.floor(box.current!.clientHeight / mRef.current.rowPx)) * c;
    switch (a) {
      case 'left': if (i % c === 0) return false; moveTo(i - 1); return true;
      case 'right': if (i % c === c - 1 || i === n - 1) return true; moveTo(i + 1); return true;
      case 'up': if (i < c) return false; moveTo(i - c); return true;
      case 'down': if (Math.floor(i / c) === Math.floor((n - 1) / c)) return true; moveTo(Math.min(n - 1, i + c)); return true;
      case 'pageup': case 'chup': case 'rw': moveTo(i - page); return true;
      case 'pagedown': case 'chdown': case 'ff': moveTo(i + page); return true;
    }
  }), []);

  // Cells are positioned one by one (not inside row wrappers) and keyed by item, so the focused
  // poster keeps its element, and its focus, when the number of columns changes.
  const rows = Math.ceil(p.items.length / m.cols);
  const out: ComponentChildren[] = [];
  const from = rowRange.first * m.cols, to = Math.min(p.items.length, rowRange.last * m.cols);
  for (let i = from; i < to; i++) {
    const r = Math.floor(i / m.cols), c = i % m.cols;
    out.push(
      <div key={p.keyOf(p.items[i])} class="vgrid-cell" data-cell={i}
        style={{ width: `${m.cardW}px`, transform: `translate(${m.pad + c * (m.cardW + m.gap)}px, ${r * m.rowPx}px)` }}>
        {p.render(p.items[i], i)}
      </div>,
    );
  }
  return (
    <div class="grid-wrap" ref={box} data-nav-group="grid" onScroll={update}>
      <div style={{ position: 'relative', height: `${rows * m.rowPx + 40}px` }}>{out}</div>
    </div>
  );
}
