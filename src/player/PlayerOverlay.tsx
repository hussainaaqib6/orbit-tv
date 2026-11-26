// Full-screen player controls. The picture itself is drawn underneath by the engine.
//
// Remote, controls hidden:  OK shows controls · Up/Down change channel (live) · Left opens the
//   channel list (live) or skips back · Right shows info (live) or skips ahead · Back closes.
// Remote, controls shown:   arrows move between buttons · Left/Right on the progress bar seek ·
//   Back hides the controls.
// Any time: Play/Pause, Rewind/Fast-forward (30 s), Channel +/−, Menu/Info (options), number keys,
//   Yellow (last channel), Subtitle, Audio and Zoom keys.
import { useEffect, useRef, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import * as P from './controller';
import { onAction, type Action } from '../nav/keys';
import { pushLayer, focusEl, focusFirst } from '../nav/focus';
import { Icon } from '../ui/icons';
import { Img } from '../ui/Img';
import { VirtualList, rowProps } from '../ui/VirtualList';
import { toast, sheetOpen, closeAllSheets } from '../ui/overlays';
import { openAudio, openEpisodes, openOptions, openPicture, openSubtitles } from './sheets';
import { catalog, isFavourite, nowNextFor, settings, toggleFavourite } from '../sources/library';
import { progress } from '../sources/epg';
import { clock, duration as fmt } from '../core/format';
import { cueHtml } from '../services/subtitles';
import { cleanChannelName } from '../core/names';
import { goRoot } from '../nav/router';
import type { Channel } from '../sources/types';

const controls = signal(false);
const panel = signal(false);
const digits = signal('');
let hideTimer = 0;
let digitTimer = 0;

function armHide() {
  clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => {
    const vodPaused = !P.isLive.value && P.state.value === 'paused';
    if (!sheetOpen() && !vodPaused && !panel.value) controls.value = false;
  }, settings.value.controlsTimeout * 1000);
}

export function showControls(focusSel?: string) {
  controls.value = true;
  armHide();
  requestAnimationFrame(() => {
    const root = document.querySelector<HTMLElement>('.player');
    if (!root) return;
    const target = focusSel ? root.querySelector<HTMLElement>(focusSel) : null;
    if (target) focusEl(target, false);
    else if (!root.querySelector('.p-bottom')?.contains(document.activeElement)) focusFirst(root.querySelector('.p-bottom') ?? root);
  });
}

function hideControls() {
  controls.value = false;
  clearTimeout(hideTimer);
  (document.querySelector('.player') as HTMLElement | null)?.focus();
}

function enterDigit(d: string) {
  digits.value = (digits.value + d).slice(-4);
  clearTimeout(digitTimer);
  digitTimer = window.setTimeout(() => {
    const n = +digits.value;
    digits.value = '';
    const all = catalog.value.live;
    const c = all.find(x => x.number === n);
    if (!c) { toast(`No channel ${n}`); return; }
    const list = P.channelList.value.some(x => x.key === c.key) ? P.channelList.value : all;
    P.playChannel(c, { channels: list });
  }, 1400);
}

/** Keys that work whether or not the controls are showing. */
function globalAction(a: Action): boolean {
  const live = P.isLive.value;
  const cur = P.current.value;
  if (a.startsWith('digit')) { if (live) enterDigit(a.slice(5)); return true; }
  switch (a) {
    case 'playpause': P.togglePause(); showControls(); return true;
    case 'play': P.resumePlay(); return true;
    case 'pause': P.pause(); showControls(); return true;
    case 'stop': P.exitFull(); return true;
    case 'ff': if (live) P.zap(1); else { P.seekBy(30); showControls('.seek'); } return true;
    case 'rw': if (live) P.zap(-1); else { P.seekBy(-30); showControls('.seek'); } return true;
    case 'chup': case 'next': if (live) P.zap(1); else P.playEpisodeOffset(1); return true;
    case 'chdown': case 'prev': if (live) P.zap(-1); else P.playEpisodeOffset(-1); return true;
    case 'pageup': if (live) P.zap(1); return true;
    case 'pagedown': if (live) P.zap(-1); return true;
    case 'menu': case 'info': openOptions(); return true;
    case 'subtitle': openSubtitles(); return true;
    case 'audio': openAudio(); return true;
    case 'zoom': case 'blue': P.cycleAspect(); toast(`Picture: ${P.aspect.value}`); return true;
    case 'yellow': P.lastChannel(); return true;
    case 'mute': P.toggleMute(); toast(P.muted.value ? 'Muted' : 'Sound on'); return true;
    case 'fav': case 'red': {
      const k = cur?.channel?.key ?? cur?.series?.key ?? cur?.key;
      if (k) toast(toggleFavourite(k) ? 'Added to favourites' : 'Removed from favourites');
      return true;
    }
    case 'guide': P.exitFull(); goRoot({ name: 'guide' }); return true;
    case 'fullscreen':
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      else document.documentElement.requestFullscreen().catch(() => {});
      return true;
  }
  return false;
}

function hiddenAction(a: Action): boolean {
  const live = P.isLive.value;
  switch (a) {
    case 'ok': showControls(); return true;
    case 'hold-ok': if (live) panel.value = true; else showControls(); return true;
    case 'up': if (live) P.zap(1); else showControls('.seek'); return true;
    case 'down': if (live) P.zap(-1); else showControls(); return true;
    case 'left': if (live) panel.value = true; else { P.seekBy(-settings.value.skipStep); showControls('.seek'); } return true;
    case 'right': if (live) showControls(); else { P.seekBy(settings.value.skipStep); showControls('.seek'); } return true;
    case 'back': P.exitFull(); return true;
  }
  return false;
}

/* ------------------------------ seek bar ------------------------------ */

function SeekBar() {
  const ref = useRef<HTMLDivElement>(null);
  const [scrub, setScrub] = useState<number | null>(null);
  const commit = useRef(0);
  const dur = P.duration.value;
  const pos = scrub ?? P.position.value;
  const canSeek = P.seekable.value && dur > 0;

  useEffect(() => onAction(ref.current!, (a, d) => {
    if (a !== 'left' && a !== 'right') return;
    if (!canSeek) return true;
    const step = settings.value.skipStep * (d.repeat ? 3 : 1);
    setScrub(s => {
      const next = Math.max(0, Math.min(dur - 1, (s ?? P.position.value) + (a === 'right' ? step : -step)));
      clearTimeout(commit.current);
      commit.current = window.setTimeout(() => { P.seekTo(next); setScrub(null); }, 650);
      return next;
    });
    armHide();
    return true;
  }), [canSeek, dur]);

  const onPointer = (e: PointerEvent) => {
    if (!canSeek) return;
    const r = ref.current!.querySelector('.track')!.getBoundingClientRect();
    const t = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * dur;
    if (e.type === 'pointerup') { P.seekTo(t); setScrub(null); } else if (e.buttons) setScrub(t);
    armHide();
  };

  return (
    <div class="seek" ref={ref} tabIndex={0} role="slider" aria-label="Position" aria-valuemin={0} aria-valuemax={Math.round(dur)} aria-valuenow={Math.round(pos)}
      onPointerDown={onPointer} onPointerMove={onPointer} onPointerUp={onPointer}>
      <span class="t tnum">{fmt(pos)}</span>
      <div class="track">
        <i style={{ width: `${dur ? (pos / dur) * 100 : 0}%` }} />
        <b style={{ left: `${dur ? (pos / dur) * 100 : 0}%` }} />
      </div>
      <span class="t tnum">{dur ? `−${fmt(Math.max(0, dur - pos))}` : '--:--'}</span>
    </div>
  );
}

/* ------------------------------ live programme strip ------------------------------ */

function LiveStrip({ channel }: { channel: Channel }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick(x => x + 1), 30000); return () => clearInterval(t); }, []);
  const { now, next } = nowNextFor(channel);
  return (
    <div class="p-live">
      <div class="p-live-now">
        {now ? (
          <>
            <div class="when tnum"><span class="dot-live" />{clock(now.start)} – {clock(now.stop)}</div>
            <div class="p-prog">{now.title}</div>
            <div class="livebar"><i style={{ width: `${progress(now) * 100}%` }} /></div>
            {now.desc && <p class="p-desc clamp2">{now.desc}</p>}
          </>
        ) : <div class="when"><span class="dot-live" />Live</div>}
      </div>
      {next && <div class="p-next tnum"><span class="muted">Next {clock(next.start)}</span> {next.title}</div>}
    </div>
  );
}

/* ------------------------------ channel list beside the picture ------------------------------ */

function ChannelPanel() {
  const ref = useRef<HTMLDivElement>(null);
  const list = P.channelList.value.length ? P.channelList.value : catalog.value.live;
  const curKey = P.current.value?.channel?.key;
  const start = Math.max(0, list.findIndex(c => c.key === curKey));
  useEffect(() => {
    const pop = pushLayer(ref.current!, () => { panel.value = false; });
    requestAnimationFrame(() => focusEl(ref.current!.querySelector<HTMLElement>(`[data-index="${start}"]`) ?? ref.current!.querySelector<HTMLElement>('[data-index]'), false));
    return pop;
  }, []);
  return (
    <div class="p-panel" ref={ref}>
      <div class="p-panel-head"><b>{list[0]?.group && P.channelList.value.length ? list[0].group : 'All channels'}</b><span class="muted">{list.length}</span></div>
      <VirtualList items={list} rowRem={4.6} keyOf={c => c.key} startIndex={start}
        onRowAction={a => { if (a === 'left' || a === 'right') return true; }}
        render={(c, i) => {
          const { now } = nowNextFor(c);
          return (
            <button class={`chrow${c.key === curKey ? ' playing' : ''}`} {...rowProps(i)} onClick={() => { panel.value = false; P.playChannel(c); }}>
              <span class="num">{c.number}</span>
              <span class="logo"><Img src={c.logo} alt={c.name} /></span>
              <span><div class="name clip">{cleanChannelName(c.name).name}</div><div class="now clip">{now ? now.title : c.group}</div></span>
            </button>
          );
        }} />
    </div>
  );
}

/* ------------------------------ the overlay ------------------------------ */

export function PlayerOverlay() {
  const ref = useRef<HTMLDivElement>(null);
  const full = P.mode.value === 'full';

  useEffect(() => {
    if (!full) { controls.value = false; panel.value = false; return; }
    const el = ref.current!;
    const pop = pushLayer(el, () => { if (controls.value && !P.error.value) hideControls(); else P.exitFull(); });
    showControls();
    const off = onAction(el, (a, d) => {
      if (P.error.value && document.activeElement?.closest('.p-error')) {
        if (a === 'back') { P.exitFull(); return true; }
        return globalAction(a);
      }
      if (!controls.value && !panel.value && hiddenAction(a)) return true;
      if (globalAction(a)) return true;
      if (controls.value) {
        armHide();
        if (a === 'back') { hideControls(); return true; }
        // Down from the buttons on live TV shows the channel list.
        if (a === 'down' && P.isLive.value && document.activeElement?.closest('.p-buttons')) { panel.value = true; return true; }
      }
      void d;
      return false;
    });
    return () => {
      off(); pop(); closeAllSheets();
      // Back to where the viewer was (the channel row, the film page).
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const area = document.querySelector('.screen-area');
        if (area?.contains(document.activeElement)) return; // the screen already chose (Live TV does)
        const r = P.returnFocus;
        if (r?.isConnected && !r.closest('[inert]')) focusEl(r);
        else focusFirst(area ?? document.body);
      }));
    };
  }, [full]);

  // A new channel or episode: show what it is for a few seconds.
  useEffect(() => { if (full && P.current.value) showControls(); }, [P.current.value?.key]);
  // Native subtitles move up while the controls show, and follow the size/background settings.
  useEffect(() => { P.subtitlesRaised.value = full && controls.value; P.applySubtitleStyle(); }, [full, controls.value, settings.value.subSize, settings.value.subBackground]);

  // An error takes focus so OK means "Try again".
  useEffect(() => {
    if (full && P.error.value) requestAnimationFrame(() => focusEl(document.querySelector<HTMLElement>('.p-error .btn')));
  }, [P.error.value, full]);
  // Paused films keep their controls; when playback resumes they hide again.
  useEffect(() => { if (full && controls.value) armHide(); }, [P.state.value]);

  if (!full) return null;
  const cur = P.current.value;
  const live = P.isLive.value;
  const st = P.state.value;
  const playing = st === 'playing' || st === 'buffering' || st === 'loading';
  const s = settings.value;
  const favKey = cur?.channel?.key ?? cur?.series?.key ?? cur?.key ?? '';
  const sub = P.subtitleText.value;

  return (
    <div class={`player${controls.value ? ' show' : ''}`} ref={ref} tabIndex={-1}
      onClick={e => { if (e.target === e.currentTarget) { if (controls.value) hideControls(); else showControls(); } }}>
      {sub && (
        <div class={`p-subs${controls.value ? ' raised' : ''}`} style={{ fontSize: `${(s.subSize / 100) * 2.1}rem` }}>
          <span class={s.subBackground ? 'boxed' : 'outlined'} dangerouslySetInnerHTML={{ __html: cueHtml(sub) }} />
        </div>
      )}

      {(st === 'loading' || st === 'buffering') && !P.error.value && <div class="p-center"><span class="spinner big" /></div>}
      {P.error.value && (
        <div class="p-center">
          <div class="p-error" role="alert">
            <h2>{live ? 'This channel is not playing' : 'This video is not playing'}</h2>
            <p>{P.error.value}</p>
            <div class="row" style={{ justifyContent: 'center' }} data-nav-scope="">
              <button class="btn primary" data-autofocus onClick={P.retry}><Icon name="refresh" />Try again</button>
              {live && cur?.channel?.xtId != null && <button class="btn" onClick={P.retryOtherFormat}>Try the other stream format</button>}
              {live && <button class="btn" onClick={() => { panel.value = true; }}><Icon name="list" />Channels</button>}
              <button class="btn quiet" onClick={P.exitFull}>Close</button>
            </div>
          </div>
        </div>
      )}

      {cur && (
        <div class="p-top">
          {cur.channel && <span class="p-logo"><Img src={cur.channel.logo} alt={cur.channel.name} /></span>}
          <div class="p-title">
            <h1 class="clip">{cur.channel && live ? <><span class="faint tnum">{cur.channel.number}</span> {cur.title}</> : cur.title}</h1>
            {cur.subtitle && <div class="muted clip">{live ? cur.channel?.group : cur.subtitle}</div>}
          </div>
          <div class="p-clock tnum">{clock(Date.now())}</div>
        </div>
      )}

      {cur && (
        <div class="p-bottom">
          {live && cur.channel ? <LiveStrip channel={cur.channel} /> : <SeekBar />}
          <div class="p-buttons" data-nav-scope="up">
            <button class="pbtn big" onClick={() => { P.togglePause(); armHide(); }} aria-label={playing ? 'Pause' : 'Play'} data-autofocus><Icon name={playing ? 'pause' : 'play'} /></button>
            {!live && <button class="pbtn wide" onClick={() => P.seekBy(-s.skipStep)} aria-label={`Back ${s.skipStep} seconds`}><Icon name="back10" /><span>{s.skipStep} s</span></button>}
            {!live && <button class="pbtn wide" onClick={() => P.seekBy(s.skipStep)} aria-label={`Forward ${s.skipStep} seconds`}><span>{s.skipStep} s</span><Icon name="fwd10" /></button>}
            {live && <button class="pbtn" onClick={() => P.zap(-1)} aria-label="Previous channel"><Icon name="up" /></button>}
            {live && <button class="pbtn" onClick={() => P.zap(1)} aria-label="Next channel"><Icon name="down" /></button>}
            {live && <button class="pbtn wide" onClick={() => { panel.value = true; }}><Icon name="list" /><span>Channels</span></button>}
            {!live && cur.series && <button class="pbtn wide" onClick={openEpisodes}><Icon name="episodes" /><span>Episodes</span></button>}
            {!live && cur.series && <button class="pbtn" onClick={() => P.playEpisodeOffset(1)} aria-label="Next episode"><Icon name="next" /></button>}
            <span class="p-gap" />
            <button class="pbtn wide" onClick={openSubtitles}><Icon name="cc" /><span>Subtitles</span></button>
            <button class="pbtn wide" onClick={openAudio}><Icon name={P.muted.value ? 'mute' : 'audio'} /><span>Audio</span></button>
            <button class="pbtn wide" onClick={openPicture}><Icon name="aspect" /><span>{P.aspect.value === 'fit' ? 'Picture' : P.aspect.value}</span></button>
            {live && <button class={`pbtn${isFavourite(favKey) ? ' on' : ''}`} aria-label="Favourite" onClick={() => toast(toggleFavourite(favKey) ? 'Added to favourites' : 'Removed from favourites')}><Icon name="star" /></button>}
            <button class="pbtn" onClick={openOptions} aria-label="Options"><Icon name="more" /></button>
            <button class="pbtn" onClick={P.exitFull} aria-label="Close player"><Icon name="close" /></button>
          </div>
        </div>
      )}

      {panel.value && <ChannelPanel />}
      {digits.value && <div class="p-digits tnum">{digits.value}<span>_</span></div>}
    </div>
  );
}
