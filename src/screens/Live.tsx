// Live TV, in two stages like a classic IPTV app:
//  1. Browse: categories down the left, and the highlighted category's channels as a grid of big
//     logo tiles on the right. Moving through the categories changes the grid.
//  2. Channels: picking a tile opens the mini screen (preview) top right playing that channel, with
//     the category's channels as a plain list on the left, so you can switch channels while it plays.
//     The channel's details sit beside the mini screen and its schedule underneath.
//     Left/Right in the list switch category; Back returns to the tiles.
// OK on the channel already playing goes full screen; Back from full screen returns to the list.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { memo } from 'preact/compat';
import { catalog, favourites, recentChannels, itemIndex, programmesFor, groupsOf, settings, updateSettings, numberOf, channelByNumber, prefetchChannels } from '../sources/library';
import { isHidden } from '../sources/restrictions';
import { isDivider, dividerLabel } from '../core/names';
import { progress, indexAt } from '../sources/epg';
import type { Channel } from '../sources/types';
import { VirtualList, rowProps } from '../ui/VirtualList';
import { VirtualGrid } from '../ui/VirtualGrid';
import { Img } from '../ui/Img';
import { Wordmark } from '../ui/brand';
import { Icon } from '../ui/icons';
import { openItemMenu } from '../ui/cards';
import { onAction } from '../nav/keys';
import { focusEl } from '../nav/focus';
import { cleanChannelName } from '../core/names';
import { clock } from '../core/format';
import * as P from '../player/controller';
import { toast } from '../ui/overlays';
import { useSectionSearch, SearchBox } from '../ui/sectionSearch';

const FAV = '\u0001fav', RECENT = '\u0001recent', ALL = '\u0001all';
type Stage = 'browse' | 'channels';

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
  // Every category in menu order, for Left/Right in the channel list.
  const catKeys = useMemo(() => [...(favs.length ? [FAV] : []), ...(recent.length ? [RECENT] : []), ALL, ...groups.map(g => g.name)], [favs.length, recent.length, groups]);
  const playing = P.current.value?.kind === 'live' ? P.current.value.channel : undefined;
  const playingKey = playing?.key;

  const [stage, setStage] = useState<Stage>('browse');
  const [group, setGroup] = useState<string>(() => initialGroup ?? playing?.group ?? (favs.length ? FAV : groups[0]?.name ?? ALL));
  const chSort = (settings.value.sortByGroup[`live:${group}`] ?? 'default') as 'default' | 'az' | 'za' | 'watched';
  // Search covers every channel in Live TV, not just the category picked.
  const search = useSectionSearch(all, c => cleanChannelName(c.name).name);
  const list = useMemo(() => {
    const base = search.results ?? (group === FAV ? favs : group === RECENT ? recent : group === ALL ? all : byGroup.get(group) ?? []);
    if (chSort === 'default') return base;
    const name = (c: Channel) => cleanChannelName(c.name).name;
    if (chSort === 'watched') { const r = recentChannels.value; return [...base].sort((a, b) => (r.indexOf(a.key) + 1 || 1e9) - (r.indexOf(b.key) + 1 || 1e9)); }
    const out = [...base].sort((a, b) => name(a).localeCompare(name(b), undefined, { numeric: true, sensitivity: 'base' }));
    return chSort === 'za' ? out.reverse() : out;
  }, [group, all, favs, recent, byGroup, chSort, search.results]);
  const CH_SORTS = [{ id: 'default', label: 'Playlist order' }, { id: 'az', label: 'A–Z' }, { id: 'za', label: 'Z–A' }, { id: 'watched', label: 'Recently watched' }];
  const cycleChSort = () => {
    const next = CH_SORTS[(CH_SORTS.findIndex(x => x.id === chSort) + 1) % CH_SORTS.length].id;
    updateSettings({ sortByGroup: { ...settings.value.sortByGroup, [`live:${group}`]: next } });
  };

  const [hi, setHi] = useState<Channel | null>(null);
  const screen = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const hiTimer = useRef(0);
  const catTimer = useRef(0);
  const typed = useRef({ text: '', timer: 0 });
  const listRef = useRef(list);
  listRef.current = list;
  /** The channel picked from the tiles, played once the mini screen is on screen. */
  const toPlay = useRef<Channel | null>(null);
  /** The tile to focus when coming back to the tiles. */
  const backTo = useRef<string | null>(null);

  const mini = settings.value.miniPlayer;
  const follows = mini && settings.value.previewFollows;
  const followTimer = useRef(0);

  // Tell the player where the mini screen is. Leaving the channel list removes it, which stops the preview.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const send = () => {
      const r = el.getBoundingClientRect();
      P.setPreviewRect({ x: r.left, y: r.top, width: r.width, height: r.height });
    };
    send();
    const c = toPlay.current;
    toPlay.current = null;
    if (c) P.playChannel(c, { preview: true, channels: listRef.current });
    const ro = new ResizeObserver(send);
    ro.observe(el);
    return () => { ro.disconnect(); P.setPreviewRect(null); };
  }, [mini, stage]);

  // When the channel changes (zapping in full screen), the details show the new one again.
  useEffect(() => { setHi(null); }, [playingKey]);

  // Guide data for the first screens of a list, fetched in one go when the list changes.
  useEffect(() => { if (stage === 'channels') prefetchChannels(list.slice(Math.max(0, startIndex - 10), startIndex + 60)); }, [list, stage]);

  // Where the channel list opens: on the playing (or just picked) channel.
  const startIndex = useMemo(() => {
    const key = toPlay.current?.key ?? playingKey;
    const i = list.findIndex(c => c.key === key);
    return i >= 0 ? i : Math.max(0, list.findIndex(c => !isDivider(c.name)));
  }, [list, stage]);
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

  /** A tile was picked: open the channel list with the mini screen playing it. */
  const openChannel = useCallback((c: Channel) => {
    if (isDivider(c.name)) return;
    setHi(c);
    if (!settings.value.miniPlayer) { P.playChannel(c, { channels: listRef.current }); return; }
    toPlay.current = c;
    backTo.current = c.key;
    setStage('channels');
  }, []);

  /** Back from the channel list: the tiles again, on the channel you were on. */
  const toTiles = useCallback(() => {
    const k = P.current.value?.channel?.key ?? backTo.current;
    backTo.current = k ?? null;
    setStage('browse');
  }, []);

  // Arriving at the tiles: focus the tile we came from (or the selected category on first open).
  useEffect(() => {
    if (stage !== 'browse') return;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const root = screen.current;
      if (!root) return;
      const k = backTo.current;
      backTo.current = null;
      const tile = k ? root.querySelector<HTMLElement>(`.ch-tile[data-key="${CSS.escape(k)}"]`) : null;
      // First open: the categories. Coming back from the list: that channel's tile, or the first tile.
      focusEl(tile ?? (k ? root.querySelector<HTMLElement>('.ch-tile') : null) ?? root.querySelector<HTMLElement>('.cat.on') ?? root.querySelector<HTMLElement>('.cat'));
    }));
  }, [stage]);
  // Arriving at the channel list: focus the picked channel's row.
  useEffect(() => {
    if (stage === 'channels') requestAnimationFrame(() => setJump({ index: startIndex, id: Date.now() }));
  }, [stage]);

  // OK in the list: play in the mini screen; OK again on the playing channel: full screen.
  const choose = useCallback((c: Channel) => {
    if (isDivider(c.name)) return;
    clearTimeout(hiTimer.current);
    clearTimeout(followTimer.current);
    setHi(c);
    if (!settings.value.miniPlayer) { P.playChannel(c, { channels: listRef.current }); return; }
    if (settings.value.previewFollows && P.current.value?.channel?.key !== c.key) { P.playChannel(c, { channels: listRef.current }); return; }
    if (P.current.value?.channel?.key === c.key && P.mode.value === 'preview' && !P.error.value) {
      P.channelList.value = listRef.current;
      P.enterFull();
    } else {
      P.playChannel(c, { preview: true, channels: listRef.current });
    }
  }, []);
  // The details follow the highlight a moment later, so fast scrolling stays smooth.
  const highlight = useCallback((c: Channel) => {
    clearTimeout(hiTimer.current);
    hiTimer.current = window.setTimeout(() => setHi(c), 180);
    clearTimeout(followTimer.current);
    if (settings.value.miniPlayer && settings.value.previewFollows && !isDivider(c.name)) {
      followTimer.current = window.setTimeout(() => {
        if (P.mode.value === 'full' || P.current.value?.channel?.key === c.key) return;
        P.playChannel(c, { preview: true, channels: listRef.current });
      }, 900);
    }
  }, []);
  useEffect(() => () => { clearTimeout(followTimer.current); clearTimeout(catTimer.current); clearTimeout(hiTimer.current); }, []);

  // Left/Right in the channel list: previous/next category.
  const stepCategory = (d: number) => {
    const i = catKeys.indexOf(group);
    const next = catKeys[(i + d + catKeys.length) % catKeys.length];
    setGroup(next);
    setJump({ index: 0, id: Date.now() });
  };

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
      if (i >= 0 && stage === 'channels') return setJump({ index: i, id: Date.now() });
      const c = channelByNumber(n);
      if (!c) return toast(`No channel ${n}`);
      setGroup(c.group);
      openChannel(c);
    }, 1100);
    return true;
  }), [all, stage]);

  const groupLabel = search.results ? `Results for “${search.text.trim()}”` : group === FAV ? 'Favourites' : group === RECENT ? 'Recently watched' : group === ALL ? 'All channels' : group;
  const showNumbers = settings.value.showNumbers;

  if (stage === 'browse') {
    return (
      <div class="screen" ref={screen}>
        <Browse
          group={group} groupLabel={groupLabel} list={list} favs={favs.length} recent={recent.length} all={all.length} groups={groups}
          sortLabel={CH_SORTS.find(x => x.id === chSort)!.label} onSort={cycleChSort}
          searchText={search.text} onSearch={search.setText} searching={!!search.results}
          onGroup={(key, now) => {
            clearTimeout(catTimer.current);
            if (now) { search.clear(); setGroup(key); return; }
            if (search.results) return; // browsing categories doesn't throw away the search results
            else catTimer.current = window.setTimeout(() => setGroup(key), 250);
          }}
          onPick={openChannel} />
      </div>
    );
  }

  const info = hi ?? playing ?? null;
  return (
    <div class="screen" ref={screen}>
      <div class="live">
        <section class="chlist">
          <div class="chlist-head ch-switch">
            <Icon name="left" /><h2 class="clip">{groupLabel}</h2><Icon name="right" />
          </div>
          {list.length ? (
            <VirtualList items={list} rowRem={3} keyOf={c => c.key} startIndex={startIndex} jump={jump} navGroup="channels"
              onFocusIndex={i => { highlight(list[i]); if (i % 20 === 0) prefetchChannels(list.slice(i, i + 60)); }}
              onRowAction={(a, i) => {
                if (a === 'back') { toTiles(); return true; }
                if (a === 'left') { stepCategory(-1); return true; }
                if (a === 'right') { stepCategory(1); return true; }
                if (a === 'hold-ok' || a === 'menu' || a === 'info') { openItemMenu(list[i]); return true; }
              }}
              render={(c, i) => <ChannelRow key={c.key} c={c} i={i} playing={c.key === playingKey} autofocus={i === startIndex} showNumbers={showNumbers} onHighlight={highlight} onChoose={choose} />} />
          ) : <EmptyList onBack={toTiles} />}
        </section>

        <section class="preview">
          <div class="pv-top">
            {mini && (
              <div class="preview-video" ref={box} onClick={() => playing && choose(playing)}>
                {!P.current.value && <div class="pv-msg"><Icon name="live" /><span>{follows ? 'Highlight a channel to preview it' : 'Press OK on a channel to watch it here'}</span></div>}
                {P.error.value && P.mode.value === 'preview' && <div class="pv-msg solid">{P.error.value}</div>}
              </div>
            )}
            {info ? <NowInfo channel={info} isPlaying={info.key === playingKey && mini} /> : <div class="pv-info" />}
          </div>
          {mini && P.error.value && P.mode.value === 'preview' && <p class="error-text pv-error">{P.error.value}</p>}
          {info && <Schedule channel={info} />}
        </section>
      </div>
    </div>
  );
}

function EmptyList({ onBack }: { onBack: () => void }) {
  return <div class="empty"><p>No channels in this category.</p><button class="btn" data-autofocus onClick={onBack}>Back</button></div>;
}

/* ------------------------------ stage 1: categories and tiles ------------------------------ */

interface BrowseProps {
  group: string; groupLabel: string; list: Channel[]; favs: number; recent: number; all: number; groups: { name: string; count: number }[];
  sortLabel: string; onSort: () => void; onGroup: (key: string, now: boolean) => void; onPick: (c: Channel) => void;
  searchText: string; onSearch: (v: string) => void; searching: boolean;
}

function Browse({ group, groupLabel, list, favs, recent, all, groups, sortLabel, onSort, onGroup, onPick, searchText, onSearch, searching }: BrowseProps) {
  const cats = useRef<HTMLElement>(null);
  const grid = useRef<HTMLElement>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(t); }, []);

  const intoGrid = () => requestAnimationFrame(() => requestAnimationFrame(() => focusEl(grid.current?.querySelector<HTMLElement>('.ch-tile'))));
  // Right from a category: open it now (if the grid hasn't caught up yet) and go into the tiles.
  useEffect(() => onAction(cats.current!, a => {
    if (a !== 'right') return;
    const k = (document.activeElement as HTMLElement | null)?.dataset.cat;
    if (k && !searching) onGroup(k, true);
    intoGrid();
    return true;
  }), [onGroup, searching]);
  // Back in the tiles: up to the categories (clearing a search first, so Back always leads out).
  useEffect(() => onAction(grid.current!, a => {
    if (a !== 'back') return;
    if (searching) onSearch('');
    requestAnimationFrame(() => focusEl(cats.current?.querySelector<HTMLElement>('[data-autofocus]') ?? cats.current?.querySelector<HTMLElement>('.cat')));
    return true;
  }), [searching, onSearch]);

  const cat = (key: string, label: string, n: number) => (
    <button key={key} data-cat={key} data-autofocus={group === key || undefined} class={`cat${group === key && !searching ? ' on' : ''}`} onFocus={() => onGroup(key, false)} onClick={() => { onGroup(key, true); intoGrid(); }}>
      <span class="clip">{label}</span><span class="n">{n}</span>
    </button>
  );
  return (
    <div class="live-browse">
      <header class="lb-bar">
        <div class="gx-clock"><b class="tnum">{clock(now)}</b><span>{new Date(now).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })}</span></div>
        <Wordmark class="gx-logo" player={false} />
        <div class="lb-bar-right">
          <SearchBox text={searchText} onText={onSearch} placeholder="Search channels" />
          <button class="gx-iconbtn" onClick={onSort} aria-label={`Order: ${sortLabel}`} title={sortLabel}><Icon name="sort" /></button>
        </div>
      </header>
      <div class="lb-body">
        <aside class="cats" data-nav-group="cats" data-nav-scope="right up" ref={cats}>
          <div class="cats-list">
            {favs > 0 && cat(FAV, 'Favourites', favs)}
            {recent > 0 && cat(RECENT, 'Recently watched', recent)}
            {cat(ALL, 'All channels', all)}
            {groups.map(g => cat(g.name, g.name, g.count))}
          </div>
        </aside>
        <section class="lb-main" ref={grid}>
          <div class="lb-title"><b class="clip">{groupLabel}</b><span class="tnum">{list.length.toLocaleString()} channels</span></div>
          {list.length
            ? <VirtualGrid items={list} minRem={8.6} ratio={0.78} extraRem={2.7} keyOf={c => c.key} render={c => <ChannelTile c={c} onPick={onPick} />} />
            : <div class="empty"><p>{searching ? 'No channels match your search.' : 'No channels in this category.'}</p></div>}
        </section>
      </div>
    </div>
  );
}

const ChannelTile = memo(function ChannelTile({ c, onPick }: { c: Channel; onPick: (c: Channel) => void }) {
  const name = isDivider(c.name) ? dividerLabel(c.name) : cleanChannelName(c.name).name;
  return (
    <button class="ch-tile" data-key={c.key} onClick={() => onPick(c)} onContextMenu={e => { e.preventDefault(); openItemMenu(c); }}>
      <span class="ch-tile-logo"><Img src={c.logo} alt={name} fit="contain" defer /></span>
      <span class="ch-tile-name clamp2">{name}</span>
    </button>
  );
});

/* ------------------------------ stage 2: list, mini screen and schedule ------------------------------ */

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

/** Beside the mini screen: the channel, what's on now and how far through it is. */
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

/** Under the mini screen: now and the next programmes, each with a line of description. */
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
