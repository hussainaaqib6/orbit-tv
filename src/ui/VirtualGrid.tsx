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

export function VirtualGrid<T>(p: VirtualGridProps<T>) {
  const box = useRef<HTMLDivElement>(null);
  const [m, setM] = useState({ cols: 6, rowPx: 300, height: 600, gap: 19 });
  const [scroll, setScroll] = useState(0);
  const pending = useRef<number | null>(null);
  const props = useRef(p);
  props.current = p;

  useLayoutEffect(() => {
    const el = box.current!;
    const measure = () => {
      const rem = remPx();
      const gap = 1.2 * rem;
      const width = el.clientWidth - 4 * rem; // padding
      const cols = Math.max(2, Math.floor((width + gap) / (p.minRem * rem + gap)));
      const cardW = (width - gap * (cols - 1)) / cols;
      setM({ cols, rowPx: cardW * p.ratio + p.extraRem * rem + gap, height: el.clientHeight, gap });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => { box.current!.scrollTop = 0; setScroll(0); }, [p.items]);

  const moveTo = (i: number) => {
    const n = props.current.items.length;
    i = Math.max(0, Math.min(n - 1, i));
    const el = box.current!;
    const row = Math.floor(i / m.cols);
    const top = row * m.rowPx, bottom = top + m.rowPx;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight + m.gap;
    setScroll(el.scrollTop);
    const card = el.querySelector<HTMLElement>(`[data-cell="${i}"] > *`);
    if (card) focusEl(card, false); else pending.current = i;
  };

  useLayoutEffect(() => {
    if (pending.current == null) return;
    const card = box.current!.querySelector<HTMLElement>(`[data-cell="${pending.current}"] > *`);
    if (card) { focusEl(card, false); pending.current = null; }
  });

  useEffect(() => onAction(box.current!, a => {
    const cell = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-cell]');
    if (!cell) return;
    const i = +cell.dataset.cell!;
    const n = props.current.items.length, c = m.cols;
    const page = Math.max(1, Math.floor(box.current!.clientHeight / m.rowPx)) * c;
    switch (a) {
      case 'left': if (i % c === 0) return false; moveTo(i - 1); return true;
      case 'right': if (i % c === c - 1 || i === n - 1) return true; moveTo(i + 1); return true;
      case 'up': if (i < c) return false; moveTo(i - c); return true;
      case 'down': if (Math.floor(i / c) === Math.floor((n - 1) / c)) return true; moveTo(Math.min(n - 1, i + c)); return true;
      case 'pageup': case 'chup': case 'rw': moveTo(i - page); return true;
      case 'pagedown': case 'chdown': case 'ff': moveTo(i + page); return true;
    }
  }), [m]);

  const rows = Math.ceil(p.items.length / m.cols);
  const first = Math.max(0, Math.floor(scroll / m.rowPx) - 2);
  const last = Math.min(rows, Math.ceil((scroll + m.height) / m.rowPx) + 2);
  const out: ComponentChildren[] = [];
  for (let r = first; r < last; r++) {
    const cells: ComponentChildren[] = [];
    for (let c = 0; c < m.cols; c++) {
      const i = r * m.cols + c;
      if (i >= p.items.length) break;
      cells.push(<div key={p.keyOf(p.items[i])} data-cell={i}>{p.render(p.items[i], i)}</div>);
    }
    out.push(
      <div key={r} class="vgrid-row" style={{ position: 'absolute', left: '2rem', right: '2rem', top: `${r * m.rowPx}px`, gridTemplateColumns: `repeat(${m.cols}, minmax(0, 1fr))`, columnGap: `${m.gap}px` }}>{cells}</div>,
    );
  }
  return (
    <div class="grid-wrap" ref={box} data-nav-group="grid" onScroll={e => setScroll((e.currentTarget as HTMLElement).scrollTop)}>
      <div style={{ position: 'relative', height: `${rows * m.rowPx + 32}px` }}>{out}</div>
    </div>
  );
}
