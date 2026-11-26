// The player: one engine, one current item, and everything the controls need, as signals.
import { signal, batch, computed, effect } from '@preact/signals';
import { KeepAwake } from '@capacitor-community/keep-awake';
import { StatusBar } from '@capacitor/status-bar';
import { ScreenOrientation } from '@capacitor/screen-orientation';
import type { Engine, EngineState, Rect, Track } from './engine';
import { NativeEngine } from './native-engine';
import { NATIVE, PLATFORM, IS_PHONE } from '../core/platform';
import { friendlyError } from '../core/http';
import { clamp } from '../core/format';
import type { Channel, Playable } from '../sources/types';
import { noteChannelPlayed, resume, saveResume, settings, recentChannels, itemIndex, type Aspect } from '../sources/library';
import { versionsOf } from '../sources/alternatives';
import { isDivider } from '../core/names';
import { toast, overlayOpen } from '../ui/overlays';
import { pad } from '../ui/pin';
import { booting } from '../sources/loadState';
import { OrbitPlayer } from '../core/native';
import { channelPlayable, channelUrl, episodeList, episodePlayable, liveFormat } from './playables';
import { cueAt, parseSubtitles, pickSubtitleTrack, type Cue } from '../services/subtitles';

export type Mode = 'off' | 'preview' | 'full';

export const mode = signal<Mode>('off');
export const current = signal<Playable | null>(null);
export const state = signal<EngineState>('idle');
export const error = signal('');
export const position = signal(0);
export const duration = signal(0);
export const isLive = signal(false);
export const seekable = signal(false);
export const tracks = signal<Track[]>([]);
export const embeddedCue = signal('');
export const external = signal<{ label: string; cues: Cue[] } | null>(null);
export const subDelay = signal(0);
export const subRate = signal(1);
export const aspect = signal<Aspect>('fit');
export const zoom = signal(1);
export const speed = signal(1);
export const muted = signal(false);
/** Channels to zap through (the list the channel was opened from). */
export const channelList = signal<Channel[]>([]);
export const previousChannel = signal<Channel | null>(null);
export const engineName = signal<'native' | 'web'>('web');
/** What the stream is being fetched as, for the player's info line. */
export const streamFormat = computed(() => {
  const u = current.value?.url ?? '';
  if (/\.m3u8(\?|$)|m3u8/i.test(u)) return 'HLS';
  if (/\.mpd(\?|$)/i.test(u)) return 'DASH';
  if (/\.(mp4|m4v|mov)(\?|$)/i.test(u)) return 'MP4';
  if (/\.mkv(\?|$)/i.test(u)) return 'MKV';
  if (/\.ts(\?|$)/i.test(u) || current.value?.kind === 'live') return 'MPEG-TS';
  return '';
});

/** The subtitle text to draw now: external file (with delay/rate) or the embedded track. */
export const subtitleText = computed(() => {
  const ext = external.value;
  if (ext) return cueAt(ext.cues, position.value, subDelay.value, subRate.value);
  return embeddedCue.value;
});

let engine: Engine | null = null;
let triedOtherFormat = false;
let autoSubsDone = false;
export const subtitlesRaised = signal(false);
let lastSave = 0;
let previewRect: Rect | null = null;

function wantNative() {
  return PLATFORM === 'android' && settings.value.engine === 'native';
}

/** The engine for this device. The web engine (hls.js + mpegts.js) is only downloaded when needed. */
async function getEngine(): Promise<Engine> {
  const native = wantNative();
  if (engine && (engine.name === 'native') === native) return engine;
  engine?.destroy();
  engine = null;
  const WebEngine = native ? null : (await import('./web-engine')).WebEngine;
  if (engine) return engine; // another call finished first
  const events = {
    state: (s: EngineState) => {
      state.value = s;
      if (s === 'playing') error.value = '';
      if (s === 'ended') onEnded();
    },
    time: (t: { position: number; duration: number; live: boolean; seekable: boolean; frames?: number }) => {
      batch(() => {
        position.value = t.position;
        duration.value = t.duration;
        seekable.value = t.seekable;
      });
      maybeSaveResume();
    },
    tracks: (t: Track[]) => { tracks.value = t; autoSubtitles(t); },
    cue: (text: string) => { embeddedCue.value = text; },
    error: (msg: string) => onError(msg),
  };
  engine = native ? new NativeEngine(events) : new WebEngine!(events);
  engineName.value = engine.name;
  applySubtitleStyle();
  engine.setAspect(aspect.value, zoom.value);
  return engine;
}

/* ------------------------------ starting and stopping ------------------------------ */

export interface PlayOptions {
  /** Show in the Live TV preview box rather than full screen. */
  preview?: boolean;
  /** Channels to zap through with Up/Down. */
  channels?: Channel[];
  /** Start from the beginning even if there is a resume point. */
  fromStart?: boolean;
  /** Internal: a switch made by stream recovery (keeps its attempt count). */
  recovering?: boolean;
  /** Other channels showing the same thing (e.g. every stream of a match), tried after the channel's own versions. */
  alternatives?: Channel[];
}

export async function play(p: Playable, o: PlayOptions = {}) {
  const prev = current.value;
  if (prev && prev !== p) saveNow();
  if (prev?.kind === 'live' && prev.channel && p.kind === 'live' && prev.channel.key !== p.channel?.key) previousChannel.value = prev.channel;
  if (o.channels) channelList.value = o.channels;

  triedOtherFormat = false;
  autoSubsDone = false;
  if (!o.recovering) recovery = newRecovery(p, o.alternatives);
  batch(() => {
    current.value = p;
    error.value = '';
    position.value = 0;
    duration.value = 0;
    isLive.value = p.kind === 'live';
    tracks.value = [];
    embeddedCue.value = '';
    external.value = null;
    subDelay.value = 0;
    subRate.value = 1;
    speed.value = 1;
    state.value = 'loading';
    aspect.value = p.kind === 'live' ? settings.value.aspectLive : settings.value.aspectVod;
    zoom.value = 1;
  });
  setMode(o.preview ? 'preview' : 'full');
  if (p.channel && p.kind === 'live') noteChannelPlayed(p.channel.key);

  const e = await getEngine();
  if (current.value !== p) return;
  // The engine may have just been created: tell it where the picture goes before loading.
  // (Without this the first preview played full-size behind the screen, so the box stayed black.)
  e.setRect(mode.value === 'preview' ? previewRect : null);
  applyMute();
  e.setAspect(aspect.value, 1);
  e.setSpeed(1);
  let url = p.url;
  try {
    if (p.resolve) url = await p.resolve();
  } catch (err) {
    onError(friendlyError(err));
    return;
  }
  if (current.value !== p) return; // something else started meanwhile
  const start = o.fromStart || p.kind === 'live' ? 0 : resume.value[p.key]?.position ?? 0;
  e.load(url, { live: p.kind === 'live', start: start > 0 ? Math.max(0, start - 3) : 0 });
}

export function playChannel(c: Channel, o: PlayOptions = {}) {
  return play(channelPlayable(c), o);
}

/** Make what is playing in the preview box full screen. */
export function enterFull() {
  if (current.value) setMode('full');
}

/** Leave full screen. Returns to the Live TV preview if that is where it came from. */
export function exitFull() {
  if (mode.value !== 'full') return;
  saveNow();
  if (previewRect && current.value?.kind === 'live') setMode('preview');
  else close();
}

export function close() {
  saveNow();
  engine?.stop();
  batch(() => {
    current.value = null;
    state.value = 'idle';
    error.value = '';
    external.value = null;
    embeddedCue.value = '';
  });
  setMode('off');
}

/** Called by the Live TV screen: where its preview box is, or null when it goes away. */
export function setPreviewRect(r: Rect | null) {
  previewRect = r;
  if (mode.value === 'preview') {
    if (r) engine?.setRect(r);
    else close();
  }
}

/** Where focus was before going full screen, to put it back afterwards. */
export let returnFocus: HTMLElement | null = null;

function setMode(m: Mode) {
  const was = mode.value;
  if (m === 'full' && was !== 'full') returnFocus = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
  mode.value = m;
  if (engine) engine.setRect(m === 'preview' ? previewRect : null);
  applyMute();
  document.body.classList.toggle('video-full', m === 'full');
  document.body.classList.toggle('video-preview', m === 'preview');
  if (was === m) return;
  if (NATIVE) {
    if (m === 'full') {
      KeepAwake.keepAwake().catch(() => {});
      if (IS_PHONE) { StatusBar.hide().catch(() => {}); ScreenOrientation.lock({ orientation: 'landscape' }).catch(() => {}); }
    } else if (was === 'full') {
      KeepAwake.allowSleep().catch(() => {});
      if (IS_PHONE) { StatusBar.show().catch(() => {}); ScreenOrientation.unlock().catch(() => {}); }
    }
  }
}

/**
 * Android: the preview picture is drawn above the app (see OrbitPlayerPlugin.setOnTop), except while
 * a menu, dialog, PIN pad or the start-up screen is over it.
 */
effect(() => {
  if (PLATFORM !== 'android' || engineName.value !== 'native') return;
  const onTop = mode.value === 'preview' && !overlayOpen.value && !pad.value && !booting.value;
  OrbitPlayer.setOnTop({ onTop }).catch(() => {});
});

/* ------------------------------ controls ------------------------------ */

export function togglePause() {
  if (!engine || !current.value) return;
  if (state.value === 'playing' || state.value === 'buffering') engine.pause();
  else engine.play();
}
export const pause = () => engine?.pause();
export const resumePlay = () => engine?.play();

export function seekTo(sec: number) {
  if (!engine || !seekable.value) return;
  const d = duration.value;
  const t = d > 0 ? clamp(sec, 0, d - 1) : Math.max(0, sec);
  position.value = t;
  engine.seek(t);
}
export const seekBy = (delta: number) => seekTo(position.value + delta);

/** Next/previous channel in the list the channel was opened from. */
export function zap(delta: number) {
  const c = current.value?.channel;
  const list = channelList.value;
  if (!c || current.value?.kind !== 'live' || list.length < 2) return;
  const i = Math.max(0, list.findIndex(x => x.key === c.key));
  // Skip the provider's divider rows.
  let next = list[(i + delta + list.length) % list.length];
  for (let k = 2; isDivider(next.name) && k <= list.length; k++) next = list[(i + delta * k + list.length * k) % list.length];
  play(channelPlayable(next), { preview: mode.value === 'preview' });
}

/** The channel to go back to: the one before the channel playing now, or the last one watched. */
export function lastChannelTarget(): Channel | null {
  const playingKey = current.value?.kind === 'live' ? current.value.channel?.key : undefined;
  const p = previousChannel.value;
  if (p && p.key !== playingKey) return p;
  const idx = itemIndex.value;
  for (const k of recentChannels.value) {
    if (k === playingKey) continue;
    const c = idx.get(k);
    if (c?.kind === 'live') return c;
  }
  return null;
}

/**
 * Last channel (the remote's Last/Yellow key, or the menu shortcut): swaps between the two most
 * recent channels. From any screen it opens the last channel full screen.
 */
export function lastChannel(): boolean {
  const c = lastChannelTarget();
  if (!c) { toast('No previous channel yet'); return false; }
  play(channelPlayable(c), { preview: mode.value === 'preview', channels: channelList.value.some(x => x.key === c.key) ? channelList.value : undefined });
  return true;
}

export function playEpisodeOffset(delta: number): boolean {
  const p = current.value;
  if (!p?.series || !p.episode) return false;
  const list = episodeList(p.series);
  const i = list.findIndex(e => e.key === p.episode!.key);
  const next = list[i + delta];
  if (!next) return false;
  play(episodePlayable(p.series, next));
  return true;
}

export const ASPECTS: Aspect[] = ['fit', 'fill', 'stretch', '16:9', '4:3'];
export function setAspect(a: Aspect) {
  aspect.value = a;
  engine?.setAspect(a, zoom.value);
}
export const cycleAspect = () => setAspect(ASPECTS[(ASPECTS.indexOf(aspect.value) + 1) % ASPECTS.length]);
export function setZoom(z: number) {
  zoom.value = clamp(Math.round(z * 100) / 100, 1, 1.5);
  engine?.setAspect(aspect.value, zoom.value);
}
export function setSpeed(s: number) {
  speed.value = s;
  engine?.setSpeed(s);
}
export function toggleMute() {
  muted.value = !muted.value;
  applyMute();
}
/** Muted when the viewer muted, or in the preview box when previews are set to be silent. */
function applyMute() {
  engine?.setMuted(muted.value || (mode.value === 'preview' && settings.value.previewMuted));
}
export function selectAudio(id: string) {
  engine?.selectTrack('audio', id);
}
export function selectEmbeddedSubtitles(id: string | null) {
  external.value = null;
  engine?.selectTrack('text', id);
}
export function loadExternalSubtitles(text: string, label: string): number {
  const cues = parseSubtitles(text);
  if (!cues.length) throw new Error('That subtitle file has no readable lines.');
  engine?.selectTrack('text', null);
  batch(() => {
    external.value = { label, cues };
    subDelay.value = 0;
    subRate.value = 1;
  });
  return cues.length;
}
export function subtitlesOff() {
  external.value = null;
  engine?.selectTrack('text', null);
  embeddedCue.value = '';
}
export const nudgeSubtitles = (sec: number) => { subDelay.value = Math.round((subDelay.value + sec) * 100) / 100; };

/** Try the same channel in the other format (MPEG-TS <-> HLS). */
export function retryOtherFormat() {
  const p = current.value;
  if (!p?.channel) return retry();
  const fmt = /\.m3u8(\?|$)/i.test(p.url) ? 'ts' : 'm3u8';
  const url = channelUrl(p.channel, fmt);
  if (url === p.url) return retry();
  triedOtherFormat = true;
  current.value = { ...p, url };
  error.value = '';
  state.value = 'loading';
  getEngine().then(e => e.load(url, { live: true }));
}

export function retry() {
  const p = current.value;
  if (p) play(p, { preview: mode.value === 'preview' });
}

/** Native engines draw the stream's own subtitles; keep their look in step with the settings. */
export function applySubtitleStyle() {
  const s = settings.value;
  engine?.setSubtitleStyle(s.subSize / 100, s.subBackground, subtitlesRaised.value);
}
export const embeddedDrawnNatively = () => !!engine?.drawsEmbeddedSubtitles;

/** Films and episodes: switch on the stream's own subtitles in the viewer's language, once per item. */
function autoSubtitles(list: Track[]) {
  const p = current.value;
  if (autoSubsDone || !list.length || !p) return;
  const live = p.kind === 'live' || p.kind === 'catchup';
  // Live: only when switched on (Settings → Subtitles), and only once the channel sends subtitles.
  if (live && (!settings.value.liveSubtitles || !list.some(t => t.type === 'text'))) return;
  autoSubsDone = true;
  if ((!live && !settings.value.autoSubtitles) || external.value) return;
  const text = list.filter(t => t.type === 'text');
  if (text.some(t => t.selected)) return;
  // Live channels often label subtitle tracks oddly or not at all: take the first if none matches.
  const pick = pickSubtitleTrack(text, settings.value.subLang) ?? (live ? text[0] : undefined);
  if (pick) engine?.selectTrack('text', pick.id);
}

/* ------------------------------ internals ------------------------------ */

function onError(msg: string) {
  const p = current.value;
  // Xtream live channels: quietly try the other stream format once before showing an error.
  if (p?.kind === 'live' && p.channel && !triedOtherFormat && !p.resolve) {
    const other = channelUrl(p.channel, liveFormat() === 'ts' ? 'm3u8' : 'ts');
    if (other !== p.url) {
      triedOtherFormat = true;
      current.value = { ...p, url: other };
      if (mode.value === 'full') toast(`Trying the ${/m3u8/.test(other) ? 'HLS' : 'MPEG-TS'} version of this stream`);
      getEngine().then(e => e.load(other, { live: true }));
      return;
    }
  }
  // A channel that won't start goes straight to its next version rather than waiting.
  if (p?.kind === 'live' && failover()) return;
  error.value = msg;
  state.value = 'error';
}

/* ------------------------------ stream recovery ------------------------------ */
// A live stream that stalls (buffering, or the picture stops moving) for longer than the recovery
// delay is reconnected; if that doesn't hold, the other stream format is tried, then other versions
// of the channel. Only one stream is ever open: the old one is stopped before the next starts, so
// provider connection limits are respected. Each step is tried once per channel, so it can't loop.

interface Recovery { key: string; reconnects: number; tried: Set<string>; alts: Channel[]; since: number; lastPos: number; lastMove: number; goodSince: number }
let recovery: Recovery = newRecovery(null);
function newRecovery(p: Playable | null, alts: Channel[] = []): Recovery {
  return { key: p?.channel?.key ?? p?.key ?? '', reconnects: 0, tried: new Set(p?.channel ? [p.channel.key] : []), alts, since: 0, lastPos: -1, lastMove: Date.now(), goodSince: 0 };
}

/** Switches to the next untried version of the channel. Returns false when there is none. */
function failover(): boolean {
  const p = current.value;
  const c = p?.channel;
  if (!c || !settings.value.autoFailover) return false;
  const next = [...versionsOf(c), ...recovery.alts].find(v => !recovery.tried.has(v.key));
  if (!next) return false;
  recovery.tried.add(next.key);
  recovery.reconnects = 0;
  toast(`Switched to ${next.name}`);
  engine?.stop();
  play(channelPlayable(next), { preview: mode.value === 'preview', recovering: true });
  return true;
}

function recover(why: string) {
  const p = current.value;
  if (!p || p.kind !== 'live') return;
  console.info(`[orbit] recovery: ${why}`);
  recovery.since = 0;
  recovery.goodSince = 0;
  recovery.lastMove = Date.now();
  if (recovery.reconnects < 2) {
    recovery.reconnects++;
    if (mode.value === 'full') toast('Reconnecting…');
    getEngine().then(e => e.load(p.url, { live: true }));
    return;
  }
  if (failover()) return;
  onError('The stream keeps stopping. The provider may be having problems with this channel.');
}

setInterval(() => {
  const p = current.value;
  const delay = settings.value.recoveryDelay * 1000;
  if (!p || p.kind !== 'live' || !delay || error.value) { recovery.since = 0; return; }
  const now = Date.now();
  const st = state.value;
  if (st === 'playing') { recovery.since = 0; if (!recovery.goodSince) recovery.goodSince = now; else if (recovery.reconnects && now - recovery.goodSince > 120000) recovery.reconnects = 0; return; }
  if (st !== 'buffering' && st !== 'loading') { recovery.since = 0; return; }
  if (!recovery.since) recovery.since = now;
  // Buffering after the channel had been playing: reconnect after the chosen delay. A channel that
  // is still starting gets much longer (some providers take a while to open a stream), so a slow
  // start is never interrupted.
  const limit = recovery.goodSince ? delay : Math.max(delay, 30000);
  if (now - recovery.since > limit) recover(`${st} for ${Math.round((now - recovery.since) / 1000)}s`);
}, 1000);

function onEnded() {
  const p = current.value;
  saveNow();
  if (p?.kind === 'episode' && settings.value.autoplayNext && playEpisodeOffset(1)) return;
  if (p?.kind !== 'live') exitFull();
}

function maybeSaveResume() {
  const now = Date.now();
  if (now - lastSave < 10000) return;
  lastSave = now;
  saveNow();
}

function saveNow() {
  const p = current.value;
  if (!p || p.kind === 'live' || p.kind === 'catchup' || !duration.value) return;
  saveResume(p.key, {
    position: position.value, duration: duration.value, at: Date.now(), title: p.kind === 'episode' ? `${p.title} · ${p.subtitle}` : p.title,
    image: p.image, seriesKey: p.series?.key, episodeKey: p.episode?.key,
  });
}

window.addEventListener('beforeunload', saveNow);
