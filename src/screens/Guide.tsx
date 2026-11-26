// TV guide grid. The grid keeps its own cursor (channel row + programme), so it scrolls at the speed
// of the remote even with thousands of channels.
// Arrows move · OK watches (now), plays catch-up (past) or shows details (later) · hold OK: options ·
// Channel +/−: a page of channels · Rewind/Fast-forward: a day back/forward.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { catalog, favourites, itemIndex, programmesFor, groupsOf, numberOf } from '../sources/library';
import { indexAt } from '../sources/epg';
import { canCatchup } from '../sources/catchup';
import type { Channel, Programme } from '../sources/types';
import { onAction } from '../nav/keys';
import { Img } from '../ui/Img';
import { Icon } from '../ui/icons';
import { openSheet, closeAllSheets, SheetItem } from '../ui/overlays';
import { openItemMenu } from '../ui/cards';
import { clock, dayLabel } from '../core/format';
import { cleanChannelName } from '../core/names';
import * as P from '../player/controller';
import { catchupPlayable } from '../player/playables';

const HALF_HOUR = 30 * 60e3;
const SPAN = 2.5 * 3600e3; // visible time
const remPx = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
const alignHalf = (t: number) => Math.floor(t / HALF_HOUR) * HALF_HOUR;
const FAV = '\u0001fav', ALL = '\u0001all';

interface Cursor { row: number; time: number }

/** Programme at `t` in a row, or a filler block when the guide has a gap. */
function blockAt(list: Programme[], t: number): Programme {
  const i = indexAt(list, t);
  if (i >= 0 && list[i].start <= t) return list[i];
  const next = i >= 0 ? list[i] : null;
  const prev = i > 0 ? list[i - 1] : i < 0 && list.length ? list[list.length - 1] : null;
  const start = prev && prev.stop <= t ? prev.stop : alignHalf(t);
  const stop = next ? next.start : alignHalf(t) + HALF_HOUR;
  return { start: Math.min(start, alignHalf(t)), stop: Math.max(stop, start + 60e3), title: 'No guide information', desc: '' };
}

export function Guide() {
  const all = catalog.value.live;
  const idx = itemIndex.value;
  const favs = useMemo(() => favourites.value.map(k => idx.get(k)).filter((x): x is Channel => x?.kind === 'live'), [favourites.value, idx]);
  const [group, setGroup] = useState<string>(favs.length ? FAV : ALL);
  const rows = useMemo(() => group === FAV ? favs : group === ALL ? all : all.filter(c => c.group === group), [group, all, favs]);

  const [t0, setT0] = useState(() => alignHalf(Date.now()) - HALF_HOUR);
  const [cur, setCur] = useState<Cursor>({ row: 0, time: Date.now() });
  const [topRow, setTopRow] = useState(0);
  const [size, setSize] = useState({ w: 1000, h: 600, row: 64, ch: 224 });
  const grid = useRef<HTMLDivElement>(null);
  const [, tick] = useState(0);

  useLayoutEffect(() => {
    const el = grid.current!;
    const measure = () => { const rem = remPx(); setSize({ w: el.clientWidth, h: el.clientHeight - 2.4 * rem, row: 4 * rem, ch: 14 * rem }); };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    const t = setInterval(() => tick(x => x + 1), 60000);
    return () => { ro.disconnect(); clearInterval(t); };
  }, []);
  useEffect(() => { setCur({ row: 0, time: Math.max(Date.now(), t0) }); setTopRow(0); }, [rows]);

  const visibleRows = Math.max(1, Math.floor(size.h / size.row));
  const trackW = size.w - size.ch;
  const pxPerMs = trackW / SPAN;
  const t1 = t0 + SPAN;
  const now = Date.now();
  const minT = alignHalf(now - 7 * 86400e3), maxT = alignHalf(now + 7 * 86400e3);

  const focusedChannel = rows[cur.row];
  const focusedProg = focusedChannel ? blockAt(programmesFor(focusedChannel), cur.time) : null;

  // Keep the cursor's programme on screen.
  const showTime = (p: Programme) => {
    if (p.start < t0 || p.start >= t1) setT0(Math.max(minT, Math.min(maxT, alignHalf(Math.max(p.start, p.stop - SPAN + HALF_HOUR)))));
  };
  const showRow = (r: number) => {
    if (r < topRow) setTopRow(r);
    else if (r >= topRow + visibleRows) setTopRow(r - visibleRows + 1);
  };

  const act = (p: Programme, c: Channel) => {
    if (p.start <= now && p.stop > now || p.title === 'No guide information') { P.playChannel(c, { channels: rows }); return; }
    if (p.stop <= now && canCatchup(c, p, now)) { const x = catchupPlayable(c, p); if (x) { P.play(x); return; } }
    openSheet(p.title, () => (
      <>
        <p style={{ padding: '0 0.9rem 1rem', color: 'var(--muted)' }}>{p.desc || 'No description.'}</p>
        <SheetItem icon={<Icon name="play" />} label={`Watch ${c.name} now`} autofocus onClick={() => { closeAllSheets(); P.playChannel(c, { channels: rows }); }} />
      </>
    ), `${c.name} · ${dayLabel(p.start)} ${clock(p.start)} – ${clock(p.stop)}`);
  };

  useEffect(() => onAction(grid.current!, a => {
    const c = rows[cur.row];
    if (!c) return;
    const list = programmesFor(c);
    const p = blockAt(list, cur.time);
    const moveRow = (r: number) => {
      r = Math.max(0, Math.min(rows.length - 1, r));
      const time = Math.max(cur.time, t0);
      setCur({ row: r, time });
      showRow(r);
    };
    switch (a) {
      case 'left': {
        if (p.start <= minT) return true;
        const prev = blockAt(list, p.start - 1);
        setCur({ row: cur.row, time: Math.max(prev.start, minT) });
        showTime(prev);
        return true;
      }
      case 'right': {
        if (p.stop >= maxT) return true;
        const next = blockAt(list, p.stop);
        setCur({ row: cur.row, time: next.start });
        showTime(next);
        return true;
      }
      case 'up': if (cur.row === 0) return false; moveRow(cur.row - 1); return true;
      case 'down': moveRow(cur.row + 1); return true;
      case 'pageup': case 'chup': moveRow(cur.row - visibleRows); return true;
      case 'pagedown': case 'chdown': moveRow(cur.row + visibleRows); return true;
      case 'ff': case 'rw': shiftDay(a === 'ff' ? 1 : -1); return true;
      case 'ok': act(p, c); return true;
      case 'hold-ok': case 'menu': case 'info': openItemMenu(c); return true;
    }
  }), [rows, cur, t0, size]);

  const shiftDay = (n: number) => {
    const t = Math.max(minT, Math.min(maxT, cur.time + n * 86400e3));
    setT0(alignHalf(t) - HALF_HOUR);
    setCur(c => ({ ...c, time: t }));
  };
  const goNow = () => { setT0(alignHalf(Date.now()) - HALF_HOUR); setCur(c => ({ ...c, time: Date.now() })); grid.current?.focus(); };

  const chooseCategory = () => openSheet('Category', () => (
    <>
      {favs.length > 0 && <SheetItem label="Favourites" checked={group === FAV} autofocus={group === FAV} onClick={() => { setGroup(FAV); closeAllSheets(); }} />}
      <SheetItem label="All channels" value={String(all.length)} checked={group === ALL} autofocus={group === ALL} onClick={() => { setGroup(ALL); closeAllSheets(); }} />
      {groupsOf(all).map(g => <SheetItem key={g.name} label={g.name} value={String(g.count)} checked={group === g.name} autofocus={group === g.name} onClick={() => { setGroup(g.name); closeAllSheets(); }} />)}
    </>
  ));

  const ticks: number[] = [];
  for (let t = t0; t < t1; t += HALF_HOUR) ticks.push(t);
  const groupLabel = group === FAV ? 'Favourites' : group === ALL ? 'All channels' : group;

  return (
    <div class="screen opaque">
      <div class="guide">
        <div class="guide-head">
          <h1>TV Guide</h1>
          <button class="chip" onClick={chooseCategory}><Icon name="list" />{groupLabel}</button>
          <button class="chip" onClick={() => shiftDay(-1)} aria-label="Previous day"><Icon name="left" /></button>
          <span class="tnum" style={{ minWidth: '7rem', textAlign: 'center', fontWeight: 650 }}>{dayLabel(cur.time)}</span>
          <button class="chip" onClick={() => shiftDay(1)} aria-label="Next day"><Icon name="right" /></button>
          <button class="chip" onClick={goNow}>Now</button>
        </div>
        <div class="guide-detail">
          {focusedProg && focusedChannel ? (
            <>
              <div>
                <div class="when">{cleanChannelName(focusedChannel.name).name}  ·  {dayLabel(focusedProg.start)} {clock(focusedProg.start)} – {clock(focusedProg.stop)}
                  {focusedProg.stop <= now && canCatchup(focusedChannel, focusedProg, now) ? '  ·  Catch-up available' : ''}</div>
                <h2 class="clip">{focusedProg.title}</h2>
                {focusedProg.desc && <p class="clamp2">{focusedProg.desc}</p>}
              </div>
            </>
          ) : <div class="muted">{rows.length ? '' : 'No channels in this category.'}</div>}
        </div>
        <div class="guide-grid" ref={grid} tabIndex={0} data-autofocus aria-label="TV guide">
          <div class="guide-ruler">
            <div style={{ width: `${size.ch}px`, flex: 'none' }} />
            <div style={{ position: 'relative', flex: 1 }}>
              {ticks.map(t => <div key={t} class="tick" style={{ left: `${(t - t0) * pxPerMs}px` }}>{clock(t)}</div>)}
            </div>
          </div>
          <div style={{ position: 'relative', height: `${size.h}px`, overflow: 'hidden' }}>
            {rows.slice(topRow, topRow + visibleRows + 1).map((c, k) => {
              const r = topRow + k;
              const list = programmesFor(c);
              let i = Math.max(0, indexAt(list, t0));
              const blocks: Programme[] = [];
              if (!list.length || list[i]?.start > t1 || indexAt(list, t0) < 0) blocks.push(blockAt(list, Math.max(t0, cur.time)));
              for (; i < list.length && list[i].start < t1; i++) blocks.push(list[i]);
              return (
                <div key={c.key} class="guide-row" style={{ top: `${k * size.row}px`, height: `${size.row}px` }}>
                  <div class="guide-ch" style={{ width: `${size.ch}px` }}>
                    <span class="logo"><Img src={c.logo} alt={c.name} fit="contain" /></span>
                    <span><div class="num">{numberOf(c)}</div><b class="clip" style={{ display: 'block' }}>{cleanChannelName(c.name).name}</b></span>
                  </div>
                  <div class="guide-track">
                    {blocks.map(p => {
                      const left = Math.max(0, (p.start - t0) * pxPerMs);
                      const right = Math.min(trackW, (p.stop - t0) * pxPerMs);
                      if (right <= 0 || left >= trackW) return null;
                      const isFocus = r === cur.row && p.start <= cur.time && p.stop > cur.time;
                      const cls = ['prog', p.stop <= now ? 'past' : p.start <= now ? 'now' : '', p.stop <= now && canCatchup(c, p, now) ? 'cu' : '', p.title === 'No guide information' ? 'empty' : '', isFocus ? 'focus' : ''].join(' ');
                      return (
                        <div key={p.start} class={cls} style={{ left: `${left}px`, width: `${right - left}px` }}
                          onClick={() => { setCur({ row: r, time: p.start }); if (isFocus) act(p, c); }}>
                          <div class="pt">{p.title}</div>
                          <div class="pw">{clock(p.start)}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            {now >= t0 && now < t1 && <div class="nowline" style={{ left: `${size.ch + (now - t0) * pxPerMs}px` }} />}
          </div>
        </div>
      </div>
    </div>
  );
}
