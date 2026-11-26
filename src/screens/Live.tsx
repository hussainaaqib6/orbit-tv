// Live TV, in the classic IPTV layout: a plain list of channel names on the left; on the right the
// preview with the channel's details beside it and its schedule underneath. The categories column
// slides in when you press Left from the list and goes away again when you go back into the list.
// Rows are deliberately bare (number and name, no logos or progress bars) so scrolling stays smooth
// on a TV stick. Browsing never changes channel: OK plays the highlighted channel in the preview,
// and OK on the channel that is already playing makes it full screen.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { memo } from 'preact/compat';
import { catalog, favourites, recentChannels, itemIndex, programmesFor, groupsOf, settings, updateSettings, numberOf, channelByNumber, prefetchChannels } from '../sources/library';
import { isHidden } from '../sources/restrictions';
import { isDivider, dividerLabel } from '../core/names';
import { progress, indexAt } from '../sources/epg';
import type { Channel } from '../sources/types';
import { VirtualList, rowProps } from '../ui/VirtualList';
import { Icon } from '../ui/icons';
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
  // Channels per category, worked out once so switching category is instant.
  const byGroup = useMemo(() => {
    const m = new Map<string, Channel[]>();
    for (const c of all) { let l = m.get(c.group); if (!l) m.set(c.group, (l = [])); l.push(c); }
    return m;
  }, [all]);
  const playing = P.current.value?.kind === 'live' ? P.current.value.channel : undefined;
  const playingKey = playing?.key;

  const [group, setGroup] = useState<string>(() => initialGroup ?? playing?.group ?? (favs.length ? FAV : groups[0]?.name ?? ALL));
  const chSort = (settings.value.sortByGroup[`live:${group}`] ?? 'default') as 'default' | 'az' | 'za' | 'watched';
  const list = useMemo(() => {
    const base = group === FAV ? favs : group === RECENT ? recent : group === ALL ? all : byGroup.get(group) ?? [];
    if (chSort === 'default') return base;
    const name = (c: Channel) => cleanChannelName(c.name).name;
    if (chSort === 'watched') { const r = recentChannels.value; return [...base].sort((a, b) => (r.indexOf(a.key) + 1 || 1e9) - (r.indexOf(b.key) + 1 || 1e9)); }
    const out = [...base].sort((a, b) => name(a).localeCompare(name(b), undefined, { numeric: true, sensitivity: 'base' }));
    return chSort === 'za' ? out.reverse() : out;
  }, [group, all, favs, recent, byGroup, chSort]);
  const CH_SORTS = [{ id: 'default', label: 'Playlist order' }, { id: 'az', label: 'A–Z' }, { id: 'za', label: 'Z–A' }, { id: 'watched', label: 'Recently watched' }];
  const cycleChSort = () => {
    const next = CH_SORTS[(CH_SORTS.findIndex(x => x.id === chSort) + 1) % CH_SORTS.length].id;
    updateSettings({ sortByGroup: { ...settings.value.sortByGroup, [`live:${group}`]: next } });
  };

  const [hi, setHi] = useState<Channel | null>(null);
  const screen = useRef<HTMLDivElement>(null);
  const cats = useRef<HTMLElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const hiTimer = useRef(0);
  const typed = useRef({ text: '', timer: 0 });
  const listRef = useRef(list);
  listRef.current = list;
  // Categories shown (browsing categories) or folded away (in the channel list). Toggled on the DOM
  // directly so it never re-renders the screen.
  const fold = (on: boolean) => screen.current?.firstElementChild?.classList.toggle('folded', on);
  const toCategories = () => {
    fold(false);
    requestAnimationFrame(() => focusEl(screen.current!.querySelector<HTMLElement>('.cat.on') ?? screen.current!.querySelector<HTMLElement>('.cat')));
  };

  const mini = settings.value.miniPlayer;
  const follows = mini && settings.value.previewFollows;
  const followTimer = useRef(0);

  // Tell the player where the preview box is (there is none with the mini player switched off).
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const send = () => {
      const r = el.getBoundingClientRect();
      P.setPreviewRect({ x: r.left, y: r.top, width: r.width, height: r.height });
    };
    send();
    const ro = new ResizeObserver(send);
    ro.observe(el);
    return () => { ro.disconnect(); P.setPreviewRect(null); };
  }, [mini]);

  // Opening Live TV carries on with the last channel watched, in the preview.
  useEffect(() => {
    if (P.current.value || !mini) return;
    const last = recent[0];
    if (last) P.playChannel(last, { preview: true, channels: byGroup.get(last.group) ?? all });
  }, []);

  // When the channel changes (zapping in full screen), the details show the new one again.
  useEffect(() => { setHi(null); }, [playingKey]);

  // Guide data for the first screens of a list, fetched in one go when the list changes.
  useEffect(() => { prefetchChannels(list.slice(Math.max(0, startIndex - 10), startIndex + 80)); }, [list]);

  // Where the list opens: on the playing channel. Worked out once per list so it doesn't jump about.
  const startIndex = useMemo(() => {
    const i = list.findIndex(c => c.key === playingKey);
    return i >= 0 ? i : Math.max(0, list.findIndex(c => !isDivider(c.name)));
  }, [list]);
  const [jump, setJump] = useState<{ index: number; id: number } | undefined>();

  // Coming back from full screen: focus goes to the channel that is playing, in this list.
  const lastMode = useRef(P.mode.value);
  useEffect(() => {
    const was = lastMode.current;
    lastMode.current = P.mode.value;
    if (was !== 'full' || P.mode.value === 'full') return;
    const i = listRef.current.findIndex(c => c.key === P.current.value?.channel?.key);
    setJump({ index: Math.max(0, i), id: Date.now() });
  }, [P.mode.value]);


  // OK: play in the preview; OK again on the playing channel: full screen.
  const choose = useCallback((c: Channel) => {
    if (isDivider(c.name)) return; // a heading, not a channel
    clearTimeout(hiTimer.current);
    clearTimeout(followTimer.current);
    setHi(c);
    // Without the mini player, or when the preview already follows the highlight, OK goes full screen.
    if (!settings.value.miniPlayer) { P.playChannel(c, { channels: listRef.current }); return; }
    if (settings.value.previewFollows && P.current.value?.channel?.key !== c.key) { P.playChannel(c, { channels: listRef.current }); return; }
    if (P.current.value?.channel?.key === c.key && P.mode.value === 'preview' && !P.error.value) {
      P.channelList.value = listRef.current;
      P.enterFull();
    } else {
      P.playChannel(c, { preview: true, channels: listRef.current });
    }
  }, []);
  // The details pane follows the highlight a moment later, so fast scrolling stays smooth.
  const highlight = useCallback((c: Channel) => {
    clearTimeout(hiTimer.current);
    hiTimer.current = window.setTimeout(() => setHi(c), 180);
    // Optional: the preview follows the highlight once scrolling stops, so fast scrolling never
    // opens a stream for every channel passed.
    clearTimeout(followTimer.current);
    if (settings.value.miniPlayer && settings.value.previewFollows && !isDivider(c.name)) {
      followTimer.current = window.setTimeout(() => {
        if (P.mode.value === 'full' || P.current.value?.channel?.key === c.key) return;
        P.playChannel(c, { preview: true, channels: listRef.current });
      }, 900);
    }
  }, []);
  useEffect(() => () => clearTimeout(followTimer.current), []);

  // Right from the categories: switch to the highlighted category now (if it hasn't yet), then go
  // into its list, at the playing channel if it is there.
  // Categories only switch the list on OK or Right, never while scrolling through them, so moving
  // up and down the categories costs nothing.
  const pendingGroup = useRef<string | null>(null);
  useEffect(() => onAction(cats.current!, a => {
    if (a !== 'right') return;
    const g = pendingGroup.current;
    pendingGroup.current = null;
    if (g !== null) setGroup(g);
    fold(true);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const rows = screen.current!.querySelectorAll<HTMLElement>('.chlist [data-index]');
      focusEl([...rows].find(r => r.classList.contains('playing')) ?? rows[0]);
    }));
    return true;
  }), []);

  // Number keys jump to a channel number.
  useEffect(() => onAction(screen.current!, a => {
    if (!a.startsWith('digit')) return;
    const t = typed.current;
    t.text = (t.text + a.slice(5)).slice(-4);
    toast(`Channel ${t.text}`);
    clearTimeout(t.timer);
    t.timer = window.setTimeout(() => {
      const n = +t.text; t.text = '';
      const i = listRef.current.findIndex(c => numberOf(c) === n);
      if (i >= 0) return setJump({ index: i, id: Date.now() });
      const c = channelByNumber(n);
      if (!c) return toast(`No channel ${n}`);
      setGroup(c.group);
    }, 1100);
    return true;
  }), [all]);

  const cat = (key: string, label: string, n: number) => (
    <button key={key} class={`cat${group === key ? ' on' : ''}`}
      onFocus={() => { pendingGroup.current = key === group ? null : key; }}
      onClick={() => {
        pendingGroup.current = null;
        setGroup(key);
        fold(true);
        requestAnimationFrame(() => requestAnimationFrame(() => focusEl(screen.current!.querySelector<HTMLElement>('.chlist [data-index]'))));
      }}>
      <span class="clip">{label}</span><span class="n">{n}</span>
    </button>
  );

  const groupLabel = group === FAV ? 'Favourites' : group === RECENT ? 'Recently watched' : group === ALL ? 'All channels' : group;
  const info = hi ?? playing ?? null;
  const showNumbers = settings.value.showNumbers;

  return (
    <div class="screen" ref={screen}>
      <div class="live folded">
        <aside class="cats" data-nav-group="cats" data-nav-scope="left right" ref={cats}>
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
          <div class="chlist-head">
            <Icon name="left" class="chlist-back" /><h2 class="clip">{groupLabel}</h2><span class="count">{list.length}</span><span style={{ flex: 1 }} />
            <button class="chip small" onClick={cycleChSort} aria-label="Change order"><Icon name="sort" />{CH_SORTS.find(x => x.id === chSort)!.label}</button>
          </div>
          {list.length ? (
            <VirtualList items={list} rowRem={3} keyOf={c => c.key} startIndex={startIndex} jump={jump} navGroup="channels"
              onFocusIndex={i => { highlight(list[i]); if (i % 20 === 0) prefetchChannels(list.slice(i, i + 80)); }}
              onRowAction={(a, i) => {
                if (a === 'back' || a === 'left') { toCategories(); return true; }
                if (a === 'hold-ok' || a === 'menu' || a === 'info') { openItemMenu(list[i]); return true; }
              }}
              render={(c, i) => <ChannelRow key={c.key} c={c} i={i} playing={c.key === playingKey} autofocus={i === startIndex} showNumbers={showNumbers} onHighlight={highlight} onChoose={choose} />} />
          ) : <div class="empty"><p>No channels here yet.</p></div>}
        </section>

        <section class="preview">
          <div class="pv-top">
          {mini && (
            <div class="preview-video" ref={box} onClick={() => playing && choose(playing)}>
              {!P.current.value && <div class="pv-msg"><Icon name="live" /><span>{follows ? 'Highlight a channel to preview it' : 'Press OK on a channel to watch it here'}</span></div>}
              {P.error.value && P.mode.value === 'preview' && <div class="pv-msg solid">{P.error.value}</div>}
            </div>
          )}
          {/* The picture is drawn over the box, so a stream error is shown under it. */}
          {info ? <NowInfo channel={info} isPlaying={info.key === playingKey && mini} /> : <div class="pv-info" />}
          </div>
          {mini && P.error.value && P.mode.value === 'preview' && <p class="error-text pv-error">{P.error.value}</p>}
          {info && <Schedule channel={info} />}
        </section>
      </div>
    </div>
  );
}

interface RowProps { c: Channel; i: number; playing: boolean; autofocus: boolean; showNumbers: boolean; onHighlight: (c: Channel) => void; onChoose: (c: Channel) => void }

const ChannelRow = memo(function ChannelRow({ c, i, playing, autofocus, showNumbers, onHighlight, onChoose }: RowProps) {
  const name = cleanChannelName(c.name);
  // Providers put divider rows in their lists ("##### UNITED KINGDOM #####"): show them as headings.
  if (isDivider(c.name)) {
    return (
      <button class="chrow divider" {...rowProps(i)} data-autofocus={autofocus || undefined} onFocus={() => onHighlight(c)} onClick={() => onChoose(c)}>
        <span class="num" /><span class="divider-name clip">{dividerLabel(c.name)}</span>
      </button>
    );
  }
  return (
    <button class={`chrow${playing ? ' playing' : ''}`} {...rowProps(i)} data-autofocus={autofocus || undefined} onFocus={() => onHighlight(c)} onClick={() => onChoose(c)}>
      <span class="num">{showNumbers ? numberOf(c) : ''}</span>
      <span class="name clip">{name.name}</span>
      {name.quality && <span class="tag">{name.quality}</span>}
      {isHidden(settings.value, 'live', c.group) && <Icon name="hidden" class="hidden-mark" />}
      {playing && <span class="eq" aria-label="Playing"><i /><i /><i /></span>}
    </button>
  );
});

/** Re-renders every 30 seconds so "now" and the progress bar stay current. */
function useMinuteTick() {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick(x => x + 1), 30000); return () => clearInterval(t); }, []);
}

/** Beside the preview: the channel, what's on now and how far through it is. */
function NowInfo({ channel, isPlaying }: { channel: Channel; isPlaying: boolean }) {
  useMinuteTick();
  const list = programmesFor(channel);
  const i = indexAt(list, Date.now());
  const now = i >= 0 && list[i].start <= Date.now() ? list[i] : null;
  return (
    <div class="pv-info">
      <span class="pv-badge">{isPlaying ? 'LIVE TV' : 'OK to watch'}</span>
      <div class="pv-channel clip"><span class="tnum">{numberOf(channel)}</span> {cleanChannelName(channel.name).name}</div>
      {now ? (
        <>
          <div class="pv-title clamp2">{now.title}</div>
          <div class="pv-when tnum">{clock(now.start)} – {clock(now.stop)}</div>
          <div class="livebar"><i style={{ width: `${progress(now) * 100}%` }} /></div>
        </>
      ) : <div class="pv-when">No guide information</div>}
    </div>
  );
}

/** Under the preview: now and the next programmes, each with a line of description. */
function Schedule({ channel }: { channel: Channel }) {
  useMinuteTick();
  const list = programmesFor(channel);
  const i = indexAt(list, Date.now());
  const from = Math.max(0, i);
  const rows = i >= 0 ? list.slice(from, from + 8) : [];
  if (!rows.length) return <div class="pv-epg"><p class="muted">No guide information for this channel.</p></div>;
  return (
    <div class="pv-epg">
      {rows.map((p, k) => (
        <div key={p.start} class={`pv-prog${k === 0 && p.start <= Date.now() ? ' now' : ''}`}>
          <span class="tnum">{clock(p.start)} – {clock(p.stop)}</span>
          <b class="clip">{p.title}</b>
          {p.desc && <span class="clip">{p.desc}</span>}
        </div>
      ))}
    </div>
  );
}
