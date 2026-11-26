// Cards for shelves and grids, and the options sheet that opens on hold OK / Menu / right-click.
import { useEffect, useRef } from 'preact/hooks';
import { memo } from 'preact/compat';
import type { Channel, Item, Movie, Series } from '../sources/types';
import { Img } from './Img';
import { Icon } from './icons';
import { openSheet, replaceSheet, closeAllSheets, SheetItem, toast } from './overlays';
import { onAction } from '../nav/keys';
import { push } from '../nav/router';
import { isFavourite, toggleFavourite, resume, nowNextFor, programmesFor, settings, updateSettings, guide, catalog, reloadGuide } from '../sources/library';
import { programmesById } from '../sources/guideStore';
import { progress } from '../sources/epg';
import { canCatchup } from '../sources/catchup';
import { cleanTitle, matchKey } from '../core/names';
import { clock, dayLabel } from '../core/format';
import * as P from '../player/controller';
import { catchupPlayable, moviePlayable } from '../player/playables';

/** Calls `fn` on hold OK / Menu / Info while `ref` is focused. */
export function useItemMenu(ref: { current: HTMLElement | null }, fn: () => void) {
  useEffect(() => onAction(ref.current!, a => {
    if (a === 'hold-ok' || a === 'menu' || a === 'info') { fn(); return true; }
  }), [fn]);
}

export function openItem(it: Item, channels?: Channel[]) {
  if (it.kind === 'live') P.playChannel(it, { channels: channels ?? catalog.value.live.filter(c => c.group === it.group) });
  else if (it.kind === 'movie') push({ name: 'movie', key: it.key });
  else push({ name: 'show', key: it.key });
}

export const PosterCard = memo(function PosterCard({ item, sub }: { item: Movie | Series; sub?: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  useItemMenu(ref, () => openItemMenu(item));
  const rp = resume.value[item.key];
  return (
    <button class="poster-card" ref={ref} onClick={() => openItem(item)}>
      <div class="art">
        <Img src={item.poster} alt={item.name} />
        {rp && rp.duration > 0 && <div class="progress"><i style={{ width: `${(rp.position / rp.duration) * 100}%` }} /></div>}
      </div>
      <div class="t clip">{cleanTitle(item.name).title}</div>
      {sub !== undefined ? <div class="s clip">{sub}</div> : item.year ? <div class="s">{item.year}</div> : null}
    </button>
  );
});

export function ChannelCard({ channel, list }: { channel: Channel; list?: Channel[] }) {
  const ref = useRef<HTMLButtonElement>(null);
  useItemMenu(ref, () => openItemMenu(channel));
  const { now } = nowNextFor(channel);
  return (
    <button class="channel-card" ref={ref} onClick={() => openItem(channel, list)}>
      <div class="art">
        <Img src={channel.logo} alt={channel.name} fit="contain" />
        {now && <div class="progress"><i style={{ width: `${progress(now) * 100}%`, background: 'var(--onair)' }} /></div>}
      </div>
      <div class="t clip">{channel.name}</div>
      <div class="s clip">{now ? now.title : channel.group}</div>
    </button>
  );
}

/* ------------------------------ item options ------------------------------ */

export function openItemMenu(it: Item) {
  openSheet(it.name, () => {
    const fav = isFavourite(it.key);
    return (
      <>
        {it.kind === 'live' && <SheetItem icon={<Icon name="play" />} label="Watch" autofocus onClick={() => { closeAllSheets(); openItem(it); }} />}
        {it.kind === 'movie' && <SheetItem icon={<Icon name="play" />} label={resume.value[it.key] ? 'Resume' : 'Play'} autofocus onClick={() => { closeAllSheets(); P.play(moviePlayable(it)); }} />}
        {it.kind === 'movie' && resume.value[it.key] && <SheetItem icon={<Icon name="restart" />} label="Play from the start" onClick={() => { closeAllSheets(); P.play(moviePlayable(it), { fromStart: true }); }} />}
        {it.kind !== 'live' && <SheetItem icon={<Icon name="info" />} label="Details" autofocus={it.kind === 'series'} onClick={() => { closeAllSheets(); openItem(it); }} />}
        <SheetItem icon={<Icon name="star" />} label={fav ? 'Remove from favourites' : 'Add to favourites'} onClick={() => toast(toggleFavourite(it.key) ? 'Added to favourites' : 'Removed from favourites')} />
        {it.kind === 'live' && it.catchup && <SheetItem icon={<Icon name="history" />} label="Catch up" sub={`Last ${it.catchup.days} days`} onClick={() => replaceSheet(`Catch up · ${it.name}`, () => <CatchupList channel={it} />)} />}
        {it.kind === 'live' && <SheetItem icon={<Icon name="guide" />} label="Choose guide channel" sub={programmesFor(it).length ? 'Guide matched' : 'No guide yet'} onClick={() => replaceSheet(`Guide for ${it.name}`, () => <GuideMatch channel={it} />)} />}
      </>
    );
  }, it.group);
}

function CatchupList({ channel }: { channel: Channel }) {
  const now = Date.now();
  const past = programmesFor(channel).filter(p => canCatchup(channel, p, now)).reverse();
  if (!past.length) return <p class="hint" style={{ padding: '0 0.9rem' }}>No past programmes in the guide for this channel.</p>;
  return (
    <>{past.map((p, i) => (
      <SheetItem key={p.start} autofocus={i === 0} label={p.title} sub={`${dayLabel(p.start)} ${clock(p.start)} – ${clock(p.stop)}`}
        onClick={() => { const x = catchupPlayable(channel, p); closeAllSheets(); if (x) P.play(x); else toast('Catch-up is not available for this channel.', true); }} />
    ))}</>
  );
}

function GuideMatch({ channel }: { channel: Channel }) {
  const g = guide.value;
  const key = matchKey(channel.name);
  const short = key.slice(0, Math.max(3, Math.min(6, key.length)));
  const options = [...g.displayNames].filter(([id, name]) => matchKey(name).includes(short) || matchKey(id).includes(short))
    .sort((a, b) => +g.has.has(b[0]) - +g.has.has(a[0])).slice(0, 60);
  const chosen = settings.value.epgMap[channel.key];
  const set = (id: string | null) => {
    const map = { ...settings.value.epgMap };
    if (id) map[channel.key] = id; else delete map[channel.key];
    updateSettings({ epgMap: map });
    // The guide only keeps channels in the playlist; a newly chosen one needs the guide read again.
    if (id && !g.has.has(id)) { reloadGuide(); toast('Guide channel saved. Loading its programmes…'); }
    else toast(id ? 'Guide channel saved' : 'Back to automatic matching');
    closeAllSheets();
  };
  return (
    <>
      <SheetItem label="Automatic" checked={!chosen} autofocus onClick={() => set(null)} />
      {options.map(([id, name]) => {
        const t = Date.now();
        const now = g.has.has(id) ? programmesById(id).find(x => x.start <= t && x.stop > t) : undefined;
        return <SheetItem key={id} label={name} sub={now ? `Now: ${now.title}` : id} checked={chosen === id} onClick={() => set(id)} />;
      })}
      {!options.length && <p class="hint" style={{ padding: '0.5rem 0.9rem' }}>No guide channels with a similar name. Add another guide link in Settings → TV guide.</p>}
    </>
  );
}
