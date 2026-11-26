// Live TV: categories | channels with what's on now | the highlighted channel playing, with its guide.
// Highlighting a channel plays it in the preview after a moment; OK makes it full screen.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { catalog, favourites, recentChannels, itemIndex, nowNextFor, programmesFor, groupsOf, settings } from '../sources/library';
import { progress, indexAt } from '../sources/epg';
import type { Channel } from '../sources/types';
import { VirtualList, rowProps } from '../ui/VirtualList';
import { Img } from '../ui/Img';
import { openItemMenu } from '../ui/cards';
import { onAction } from '../nav/keys';
import { focusEl } from '../nav/focus';
import { cleanChannelName } from '../core/names';
import { clock } from '../core/format';
import * as P from '../player/controller';
import { toast } from '../ui/overlays';

const FAV = '\u0001fav', RECENT = '\u0001recent', ALL = '\u0001all';

export function Live({ initialGroup }: { initialGroup?: string }) {
  const all = catalog.value.live;
  const idx = itemIndex.value;
  const favs = useMemo(() => favourites.value.map(k => idx.get(k)).filter((x): x is Channel => x?.kind === 'live'), [favourites.value, idx]);
  const recent = useMemo(() => recentChannels.value.map(k => idx.get(k)).filter((x): x is Channel => x?.kind === 'live'), [recentChannels.value, idx]);
  const groups = useMemo(() => groupsOf(all), [all]);
  const playingKey = P.current.value?.channel?.key;

  const [group, setGroup] = useState<string>(() => {
    if (initialGroup) return initialGroup;
    const playing = P.current.value?.channel;
    if (playing) return playing.group;
    return favs.length ? FAV : groups[0]?.name ?? ALL;
  });
  const list = useMemo(() => {
    if (group === FAV) return favs;
    if (group === RECENT) return recent;
    if (group === ALL) return all;
    return all.filter(c => c.group === group);
  }, [group, all, favs, recent]);

  const [hi, setHi] = useState<Channel | null>(null);
  const screen = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const cats = useRef<HTMLElement>(null);
  const previewTimer = useRef(0);
  const catTimer = useRef(0);
  const typed = useRef({ text: '', timer: 0 });

  // Tell the player where the preview box is.
  useLayoutEffect(() => {
    const el = box.current!;
    const send = () => {
      const r = el.getBoundingClientRect();
      P.setPreviewRect({ x: r.left, y: r.top, width: r.width, height: r.height });
    };
    send();
    const ro = new ResizeObserver(send);
    ro.observe(el);
    window.addEventListener('resize', send);
    return () => { ro.disconnect(); window.removeEventListener('resize', send); P.setPreviewRect(null); };
  }, []);

  // Where the list opens: on the playing channel. Computed once per list so previews don't scroll it.
  const startIndex = useMemo(() => Math.max(0, list.findIndex(c => c.key === playingKey)), [list]);
  const [jump, setJump] = useState<{ index: number; id: number } | undefined>();

  const preview = (c: Channel) => {
    clearTimeout(previewTimer.current);
    previewTimer.current = window.setTimeout(() => {
      if (P.current.value?.channel?.key !== c.key) P.playChannel(c, { preview: true, channels: list });
    }, 650);
  };

  const watch = (c: Channel) => {
    clearTimeout(previewTimer.current);
    if (P.current.value?.channel?.key === c.key && P.mode.value === 'preview' && !P.error.value) { P.channelList.value = list; P.enterFull(); }
    else P.playChannel(c, { channels: list });
  };

  // Right from the categories goes into the channel list, at the highlighted channel.
  useEffect(() => onAction(cats.current!, a => {
    if (a !== 'right') return;
    const rows = screen.current!.querySelectorAll<HTMLElement>('.chlist [data-index]');
    const playing = [...rows].find(r => r.classList.contains('playing'));
    focusEl(playing ?? rows[0]);
    return true;
  }), []);

  // Number keys jump to a channel number in this list (or in all channels).
  useEffect(() => onAction(screen.current!, a => {
    if (!a.startsWith('digit')) return;
    const t = typed.current;
    t.text = (t.text + a.slice(5)).slice(-4);
    toast(`Channel ${t.text}`);
    clearTimeout(t.timer);
    t.timer = window.setTimeout(() => {
      const n = +t.text; t.text = '';
      const i = list.findIndex(c => c.number === n);
      if (i < 0) {
        const c = all.find(x => x.number === n);
        if (!c) return toast(`No channel ${n}`);
        setGroup(c.group);
        return;
      }
      setJump({ index: i, id: Date.now() });
    }, 1200);
    return true;
  }), [list, all]);

  const cat = (key: string, label: string, n: number) => (
    <button key={key} class={`cat${group === key ? ' on' : ''}`}
      onFocus={() => { clearTimeout(catTimer.current); catTimer.current = window.setTimeout(() => setGroup(key), 280); }}
      onClick={() => { clearTimeout(catTimer.current); setGroup(key); requestAnimationFrame(() => focusEl(screen.current!.querySelector<HTMLElement>('.chlist [data-index]'))); }}>
      <span class="clip">{label}</span><span class="n">{n}</span>
    </button>
  );

  const groupLabel = group === FAV ? 'Favourites' : group === RECENT ? 'Recently watched' : group === ALL ? 'All channels' : group;
  const showing = hi ?? (P.current.value?.channel ?? null);

  return (
    <div class="screen" ref={screen}>
      <div class="live">
        <aside class="cats" data-nav-group="cats" ref={cats}>
          <div class="cats-head"><h1>Live TV</h1></div>
          <div class="cats-list">
            {favs.length > 0 && cat(FAV, 'Favourites', favs.length)}
            {recent.length > 0 && cat(RECENT, 'Recently watched', recent.length)}
            {cat(ALL, 'All channels', all.length)}
            <div class="cat-sep">Categories</div>
            {groups.map(g => cat(g.name, g.name, g.count))}
          </div>
        </aside>

        <section class="chlist">
          <div class="chlist-head"><h2 class="clip">{groupLabel}</h2><span class="muted">{list.length}</span></div>
          {list.length ? (
            <VirtualList items={list} rowRem={4.6} keyOf={c => c.key} startIndex={startIndex} jump={jump} navGroup="channels"
              onFocusIndex={i => { setHi(list[i]); preview(list[i]); }}
              onRowAction={(a, i) => {
                if (a === 'back' || a === 'left') { focusEl(screen.current!.querySelector<HTMLElement>('.cat.on')); return true; }
                if (a === 'hold-ok' || a === 'menu' || a === 'info') { openItemMenu(list[i]); return true; }
                if (a === 'right') { watch(list[i]); return true; }
              }}
              render={(c, i) => <ChannelRow c={c} i={i} playing={c.key === playingKey} autofocus={i === startIndex} onFocus={() => { setHi(c); preview(c); }} onClick={() => watch(c)} />} />
          ) : <div class="empty"><p>No channels here yet.</p></div>}
        </section>

        <section class="preview">
          <div class="preview-video" ref={box} onClick={() => showing && watch(showing)}>
            {!P.current.value && <div class="pv-msg">Highlight a channel to preview it</div>}
            {P.error.value && P.mode.value === 'preview' && <div class="pv-msg" style={{ background: '#000' }}>{P.error.value}</div>}
          </div>
          {showing && <ProgrammeInfo channel={showing} />}
        </section>
      </div>
    </div>
  );
}

function ChannelRow({ c, i, playing, autofocus, onFocus, onClick }: { c: Channel; i: number; playing: boolean; autofocus: boolean; onFocus: () => void; onClick: () => void }) {
  const { now } = nowNextFor(c);
  const name = cleanChannelName(c.name);
  return (
    <button class={`chrow${playing ? ' playing' : ''}`} {...rowProps(i)} data-autofocus={autofocus || undefined} onFocus={onFocus} onClick={onClick}>
      <span class="num">{settings.value.showNumbers ? c.number : ''}</span>
      <span class="logo"><Img src={c.logo} alt={name.name} /></span>
      <span>
        <div class="name"><span class="clip">{name.name}</span>{name.quality && <span class="tag">{name.quality}</span>}{c.catchup && <span class="tag">CATCH-UP</span>}</div>
        <div class="now clip">{now ? now.title : 'No guide information'}</div>
        {now && <div class="bar"><i style={{ width: `${progress(now) * 100}%` }} /></div>}
      </span>
    </button>
  );
}

function ProgrammeInfo({ channel }: { channel: Channel }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick(x => x + 1), 30000); return () => clearInterval(t); }, []);
  const list = programmesFor(channel);
  const i = indexAt(list, Date.now());
  const now = i >= 0 && list[i].start <= Date.now() ? list[i] : null;
  const upcoming = list.slice(now ? i + 1 : Math.max(0, i), (now ? i + 1 : Math.max(0, i)) + 5);
  return (
    <div class="preview-info">
      <div class="muted">{channel.number}  {channel.name}</div>
      {now ? (
        <>
          <h2>{now.title}</h2>
          <div class="when"><span class="dot-live" />{clock(now.start)} – {clock(now.stop)}</div>
          <div class="livebar"><i style={{ width: `${progress(now) * 100}%` }} /></div>
          {now.desc && <p class="desc clamp3">{now.desc}</p>}
        </>
      ) : <h2>{channel.name}</h2>}
      {upcoming.length > 0 && (
        <div class="up-next">
          {upcoming.map(p => <div key={p.start}><span class="tnum">{clock(p.start)}</span><b class="clip">{p.title}</b></div>)}
        </div>
      )}
    </div>
  );
}
