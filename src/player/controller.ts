// The player: one engine, one current item, and everything the controls need, as signals.
import { signal, batch, computed } from '@preact/signals';
import { KeepAwake } from '@capacitor-community/keep-awake';
import { StatusBar } from '@capacitor/status-bar';
import { ScreenOrientation } from '@capacitor/screen-orientation';
import type { Engine, EngineState, Rect, Track } from './engine';
import { NativeEngine } from './native-engine';
import { NATIVE, PLATFORM, IS_PHONE } from '../core/platform';
import { friendlyError } from '../core/http';
import { clamp } from '../core/format';
import type { Channel, Playable } from '../sources/types';
import { noteChannelPlayed, resume, saveResume, settings, type Aspect } from '../sources/library';
import { channelPlayable, channelUrl, episodeList, episodePlayable, liveFormat } from './playables';
import { cueAt, parseSubtitles, type Cue } from '../services/subtitles';

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

/** The subtitle text to draw now: external file (with delay/rate) or the embedded track. */
export const subtitleText = computed(() => {
  const ext = external.value;
  if (ext) return cueAt(ext.cues, position.value, subDelay.value, subRate.value);
  return embeddedCue.value;
});

let engine: Engine | null = null;
let triedOtherFormat = false;
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
    time: (t: { position: number; duration: number; live: boolean; seekable: boolean }) => {
      batch(() => {
        position.value = t.position;
        duration.value = t.duration;
        seekable.value = t.seekable;
      });
      maybeSaveResume();
    },
    tracks: (t: Track[]) => { tracks.value = t; },
    cue: (text: string) => { embeddedCue.value = text; },
    error: (msg: string) => onError(msg),
  };
  engine = native ? new NativeEngine(events) : new WebEngine!(events);
  engineName.value = engine.name;
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
}

export async function play(p: Playable, o: PlayOptions = {}) {
  const prev = current.value;
  if (prev && prev !== p) saveNow();
  if (prev?.kind === 'live' && prev.channel && p.kind === 'live' && prev.channel.key !== p.channel?.key) previousChannel.value = prev.channel;
  if (o.channels) channelList.value = o.channels;

  triedOtherFormat = false;
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
  const next = list[(i + delta + list.length) % list.length];
  play(channelPlayable(next), { preview: mode.value === 'preview' });
}

/** Back to the channel watched before this one (Yellow on a remote). */
export function lastChannel() {
  const p = previousChannel.value;
  if (p) play(channelPlayable(p), { preview: mode.value === 'preview' });
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
  engine?.setMuted(muted.value);
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

/* ------------------------------ internals ------------------------------ */

function onError(msg: string) {
  const p = current.value;
  // Xtream live channels: quietly try the other stream format once before showing an error.
  if (p?.kind === 'live' && p.channel && !triedOtherFormat && !p.resolve) {
    const other = channelUrl(p.channel, liveFormat() === 'ts' ? 'm3u8' : 'ts');
    if (other !== p.url) {
      triedOtherFormat = true;
      current.value = { ...p, url: other };
      getEngine().then(e => e.load(other, { live: true }));
      return;
    }
  }
  error.value = msg;
  state.value = 'error';
}

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
