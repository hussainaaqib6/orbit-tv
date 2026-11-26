// Live Sports: competitions | fixtures (today and the week ahead, live scores) | the highlighted
// fixture with the streams in the playlist that show it. OK on a stream watches it full screen.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { catalog, settings, updateSettings, sourceById } from '../sources/library';
import { connectionsLabel, refreshConnections } from '../services/connections';
import type { Channel } from '../sources/types';
import { LEAGUES, fixturesFor, indexChannels, matchStreams, leagueChannels, eventChannels, type Fixture, type League } from '../services/sports';
import { friendlyError } from '../core/http';
import { Img } from '../ui/Img';
import { Icon } from '../ui/icons';
import { onAction } from '../nav/keys';
import { focusEl } from '../nav/focus';
import { clock, dayLabel } from '../core/format';
import { cleanChannelName } from '../core/names';
import * as P from '../player/controller';

const EVENTS = '\u0001events';

type Load = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; fixtures: Fixture[] };

export function Sports() {
  const live = catalog.value.live;
  const ix = useMemo(() => indexChannels(live), [live]);
  const events = useMemo(() => eventChannels(ix), [ix]);
  const [sel, setSel] = useState<string>(LEAGUES[0].id);
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [hi, setHi] = useState<Fixture | null>(null);
  const screen = useRef<HTMLDivElement>(null);
  const timer = useRef(0);
  const league = LEAGUES.find(l => l.id === sel);

  useEffect(() => {
    if (!league) return;
    let alive = true;
    const get = () => fixturesFor(league)
      .then(fixtures => { if (alive) { setLoad({ state: 'ready', fixtures }); } })
      .catch(e => { if (alive) setLoad({ state: 'error', message: friendlyError(e) }); });
    setLoad({ state: 'loading' });
    setHi(null);
    get();
    const t = setInterval(get, 60e3); // scores and kick-off states
    return () => { alive = false; clearInterval(t); };
  }, [sel]);

  // Fixtures worth showing: still to come, on now, or finished in the last six hours.
  const streamsOf = useMemo(() => {
    const m = new Map<string, Channel[]>();
    return (f: Fixture) => { let s = m.get(f.id); if (!s) m.set(f.id, (s = matchStreams(ix, f))); return s; };
  }, [ix, load]);
  const mine = settings.value.sportsMyChannels;
  const fixtures = useMemo(() => load.state === 'ready'
    ? load.fixtures.filter(f => (f.state !== 'post' || Date.now() - f.start < 9 * 3600e3) && (!mine || streamsOf(f).length > 0))
    : [], [load, mine, streamsOf]);
  const big = settings.value.matchCards === 'big';
  // Single-match channels belong to their own fixture, not to "channels that show this league".
  const usual = useMemo(() => {
    if (!league) return [];
    const ev = new Set(events);
    return leagueChannels(ix, league).filter(c => !ev.has(c));
  }, [ix, league, events]);
  const shown = hi ?? fixtures.find(f => f.state === 'in') ?? fixtures[0] ?? null;

  const pick = (id: string) => { clearTimeout(timer.current); setSel(id); };
  const leagueBtn = (l: League | { id: string; name: string }, n?: number) => (
    <button key={l.id} class={`cat${sel === l.id ? ' on' : ''}`} data-autofocus={sel === l.id || undefined}
      onFocus={() => { clearTimeout(timer.current); timer.current = window.setTimeout(() => setSel(l.id), 350); }}
      onClick={() => { pick(l.id); requestAnimationFrame(() => focusEl(screen.current!.querySelector<HTMLElement>('.fx-list button'))); }}>
      <span class="clip">{l.name}</span>{n !== undefined && <span class="n">{n}</span>}
    </button>
  );

  // Left from the fixtures or streams goes back a column; Back from anywhere goes to the competitions.
  useEffect(() => onAction(screen.current!, a => {
    const t = document.activeElement;
    if (a === 'back' && t && !t.closest('.cats')) { focusEl(screen.current!.querySelector<HTMLElement>('.cat.on')); return true; }
  }), []);

  // If a match stream fails, the player moves on to the match's other streams.
  const play = (c: Channel, list: Channel[]) => P.playChannel(c, { channels: list, alternatives: list.filter(x => x.key !== c.key) });

  return (
    <div class="screen" ref={screen}>
      <div class="sports">
        <aside class="cats" data-nav-group="cats" data-nav-scope="left right">
          <div class="cats-head"><h1>Live Sports</h1></div>
          <div class="cats-list">
            <div class="cat-sep">Football</div>
            {LEAGUES.filter(l => l.section === 'Football').map(l => leagueBtn(l))}
            <div class="cat-sep">More sports</div>
            {LEAGUES.filter(l => l.section === 'More sports').map(l => leagueBtn(l))}
            {events.length > 0 && <div class="cat-sep">From your playlist</div>}
            {events.length > 0 && leagueBtn({ id: EVENTS, name: 'Event channels' }, events.length)}
          </div>
        </aside>

        {sel === EVENTS ? (
          <section class="fx-col wide">
            <div class="chlist-head"><h2>Event channels</h2><span class="count">{events.length}</span></div>
            <p class="fx-note">Channels your provider has set up for single matches and fights.</p>
            <div class="fx-list" data-nav-group="fixtures">
              {events.map(c => <StreamRow key={c.key} c={c} onChoose={() => play(c, events)} showGroup />)}
            </div>
          </section>
        ) : (
          <>
            <section class="fx-col">
              <div class="chlist-head">
                <h2 class="clip">{league?.name}</h2>{load.state === 'ready' && <span class="count">{fixtures.length}</span>}
                <span style={{ flex: 1 }} />
                <button class={`chip small${mine ? ' on' : ''}`} onClick={() => updateSettings({ sportsMyChannels: !mine })} aria-pressed={mine}>My channels only</button>
              </div>
              <div class="fx-list" data-nav-group="fixtures">
                {load.state === 'loading' && <div class="empty"><span class="spinner big" /></div>}
                {load.state === 'error' && <div class="empty"><p>Couldn't get the fixtures.</p><p class="hint">{load.message}</p></div>}
                {load.state === 'ready' && !fixtures.length && <div class="empty"><p>{mine && load.fixtures.length ? `None of this week's ${league?.name} fixtures has a stream in your playlists yet.` : `No ${league?.name} fixtures in the next week.`}</p></div>}
                {fixtures.map((f, i) => [
                  (i === 0 || dayLabel(f.start) !== dayLabel(fixtures[i - 1].start)) && <div class="fx-day" key={`d${f.id}`}>{dayLabel(f.start)}</div>,
                  <FixtureRow key={f.id} f={f} streams={streamsOf(f).length} big={big} league={league!.name}
                    onFocus={() => setHi(f)}
                    onClick={() => { setHi(f); requestAnimationFrame(() => focusEl(screen.current!.querySelector<HTMLElement>('.fx-detail button'))); }} />,
                ])}
              </div>
            </section>
            <section class="fx-detail" data-nav-group="streams">
              {shown ? <FixtureDetail f={shown} streams={streamsOf(shown)} usual={usual} league={league!} play={play} /> : null}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function Crest({ src, name }: { src?: string; name: string }) {
  return <span class="crest">{src ? <Img src={src} alt={name} /> : <span class="initials">{name.slice(0, 2).toUpperCase()}</span>}</span>;
}

function Status({ f }: { f: Fixture }) {
  if (f.status === 'postponed') return <span class="fx-off">Postponed</span>;
  if (f.status === 'cancelled') return <span class="fx-off">Cancelled</span>;
  if (f.status === 'halftime') return <span class="fx-live">Half time</span>;
  if (f.state === 'in') return <span class="fx-live">{f.detail || 'Live'}</span>;
  if (f.state === 'post') return <span class="fx-ft">{f.detail || 'FT'}</span>;
  return <span class="fx-time tnum">{clock(f.start)}</span>;
}

/** A team's colour, made dark enough for white text to stay readable on it. */
function teamTint(hex: string, fallback: string) {
  const h = /^#([0-9a-f]{6})$/i.exec(hex)?.[1];
  if (!h) return fallback;
  const n = parseInt(h, 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const k = lum > 0.55 ? 0.45 : lum > 0.35 ? 0.7 : 1; // darken light colours
  return `rgb(${Math.round(r * k)},${Math.round(g * k)},${Math.round(b * k)})`;
}

/** Big match card: the two halves in each team's colours, crests, the time or score in the middle. */
function BigCard({ f, streams, league, onFocus, onClick }: { f: Fixture; streams: number; league: string; onFocus: () => void; onClick: () => void }) {
  const h = f.home!, a = f.away!;
  const showScore = f.state !== 'pre';
  return (
    <button class={`bigfx${f.state === 'in' ? ' on-now' : ''}`} onFocus={onFocus} onClick={onClick}
      style={{ '--home': teamTint(h.color, '#3a1018'), '--away': teamTint(a.color, '#1c1417') } as never}>
      <span class="bf-side home"><Crest src={h.logo} name={h.short} /><b class="clip">{h.short}</b></span>
      <span class="bf-mid">
        {showScore ? <span class="bf-score tnum">{h.score}<i>–</i>{a.score}</span> : <span class="bf-time tnum">{clock(f.start)}</span>}
        {f.status !== 'upcoming' && <Status f={f} />}
      </span>
      <span class="bf-side away"><Crest src={a.logo} name={a.short} /><b class="clip">{a.short}</b></span>
      <span class="bf-foot"><span class="clip">{league}</span><span class={`fx-streams${streams ? ' has' : ''}`}>{streams ? `${streams} stream${streams === 1 ? '' : 's'}` : 'No stream yet'}</span></span>
    </button>
  );
}

function FixtureRow({ f, streams, big, league, onFocus, onClick }: { f: Fixture; streams: number; big: boolean; league: string; onFocus: () => void; onClick: () => void }) {
  if (big && f.home && f.away) return <BigCard f={f} streams={streams} league={league} onFocus={onFocus} onClick={onClick} />;
  const showScore = f.state !== 'pre' && f.home && f.away;
  return (
    <button class={`fx${f.state === 'in' ? ' on-now' : ''}`} onFocus={onFocus} onClick={onClick}>
      <span class="fx-when"><Status f={f} /></span>
      {f.home && f.away ? (
        <span class="fx-teams">
          <span class="fx-team"><Crest src={f.home.logo} name={f.home.short} /><span class="clip">{f.home.short}</span>{showScore && <b class="tnum">{f.home.score}</b>}</span>
          <span class="fx-team"><Crest src={f.away.logo} name={f.away.short} /><span class="clip">{f.away.short}</span>{showScore && <b class="tnum">{f.away.score}</b>}</span>
        </span>
      ) : <span class="fx-title clip">{f.title}</span>}
      <span class={`fx-streams${streams ? ' has' : ''}`}>{streams ? `${streams} stream${streams === 1 ? '' : 's'}` : ''}</span>
    </button>
  );
}

function FixtureDetail({ f, streams, usual, league, play }: { f: Fixture; streams: Channel[]; usual: Channel[]; league: League; play: (c: Channel, l: Channel[]) => void }) {
  const others = usual.filter(c => !streams.includes(c));
  // Provider connection use for the playlists these streams come from.
  const srcIds = [...new Set(streams.concat(others).map(c => c.sourceId))];
  useEffect(() => { srcIds.forEach(id => { const src = sourceById(id); if (src) refreshConnections(src); }); }, [f.id]);
  const conn = srcIds.map(id => sourceById(id)).filter(x => x?.type === 'xtream').map(x => `${x!.name}: ${connectionsLabel(x!).replace('Connections: ', '')}`);
  return (
    <div class="fxd">
      <div class="fxd-head">
        {f.home && f.away ? (
          <div class="fxd-teams">
            <div class="fxd-side"><Crest src={f.home.logo} name={f.home.short} /><span>{f.home.name}</span></div>
            <div class="fxd-score tnum">{f.state === 'pre' ? 'v' : `${f.home.score} – ${f.away.score}`}</div>
            <div class="fxd-side"><Crest src={f.away.logo} name={f.away.short} /><span>{f.away.name}</span></div>
          </div>
        ) : <h2>{f.title}</h2>}
        <div class="fxd-meta">{f.state !== 'pre' && <Status f={f} />}<span>{dayLabel(f.start)} {clock(f.start)}</span>{f.venue && <span class="clip">{f.venue}</span>}</div>
      </div>
      <div class="fxd-streams">
        {conn.length > 0 && <p class="fxd-conn tnum">Connections · {conn.join(' · ')}</p>}
        <h3>Match streams</h3>
        {streams.length
          ? streams.map(c => <StreamRow key={c.key} c={c} onChoose={() => play(c, streams)} />)
          : <p class="hint">No channel for this match in your playlist yet. Providers usually add event channels a few hours before the start.</p>}
        {others.length > 0 && <h3>Channels that show {league.name}</h3>}
        {others.map(c => <StreamRow key={c.key} c={c} onChoose={() => play(c, others)} />)}
      </div>
    </div>
  );
}

function StreamRow({ c, onChoose, showGroup }: { c: Channel; onChoose: () => void; showGroup?: boolean }) {
  const n = cleanChannelName(c.name);
  return (
    <button class="srow" onClick={onChoose}>
      <span class="logo"><Img src={c.logo} alt={n.name} /></span>
      <span class="meta"><span class="clip name">{n.name}</span><span class="clip sub">{showGroup ? c.group : n.quality || c.group}</span></span>
      <Icon name="play" />
    </button>
  );
}
