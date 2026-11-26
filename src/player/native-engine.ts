// Android / Fire TV: ExoPlayer (Media3) draws the picture on a surface behind the transparent WebView,
// so live MPEG-TS, HEVC, interlaced broadcasts and Dolby audio all play with hardware decoding.
// Orbit's own controls, subtitles and menus are drawn by the web layer on top.
import type { PluginListenerHandle } from '@capacitor/core';
import { OrbitPlayer, type NativeRect } from '../core/native';
import { PLAYER_UA } from '../core/platform';
import type { Engine, EngineEvents, LoadOptions, Rect } from './engine';

// The box in CSS pixels plus the page size in CSS pixels: the native side scales by the WebView's real
// size in screen pixels. (devicePixelRatio alone isn't reliable: some Fire TV WebViews report one
// that doesn't match how the page is actually scaled, which put the preview in the wrong place.)
const toNative = (r: Rect | null): NativeRect | null => {
  if (!r) return null;
  return { x: r.x, y: r.y, width: r.width, height: r.height, vw: window.innerWidth, vh: window.innerHeight, dpr: window.devicePixelRatio || 1 };
};

export class NativeEngine implements Engine {
  readonly name = 'native' as const;
  readonly drawsEmbeddedSubtitles = true;
  private subs: Promise<PluginListenerHandle>[] = [];
  private rect: Rect | null = null;
  private live = false;

  constructor(ev: EngineEvents) {
    this.subs.push(
      OrbitPlayer.addListener('state', s => {
        if (s.state === 'ended') ev.state('ended');
        else if (s.state === 'buffering') ev.state('buffering');
        else if (s.state === 'ready') ev.state(s.playing ? 'playing' : 'paused');
        else ev.state('idle');
      }),
      OrbitPlayer.addListener('time', t => ev.time({ position: t.position, duration: t.duration, live: this.live || t.live, seekable: t.seekable, frames: (t as { frames?: number }).frames })),
      OrbitPlayer.addListener('tracks', t => ev.tracks(t.tracks.filter(x => x.type !== 'video').map(x => ({ id: x.id, type: x.type as 'audio' | 'text', label: x.label, language: x.language, selected: x.selected })))),
      OrbitPlayer.addListener('error', e => { ev.state('error'); ev.error(e.message, { http: e.http, code: e.code }); }),
    );
  }

  load(url: string, o: LoadOptions) {
    this.live = o.live;
    OrbitPlayer.load({ url, live: o.live, startPosition: o.start ?? 0, headers: { 'User-Agent': PLAYER_UA, ...o.headers }, rect: toNative(this.rect) }).catch(() => {});
  }
  play() { OrbitPlayer.play().catch(() => {}); }
  pause() { OrbitPlayer.pause().catch(() => {}); }
  stop() { OrbitPlayer.stop().catch(() => {}); }
  seek(s: number) { OrbitPlayer.seekTo({ position: Math.max(0, s) }).catch(() => {}); }
  setRect(r: Rect | null) { this.rect = r; OrbitPlayer.setRect({ rect: toNative(r) }).catch(() => {}); }
  setAspect(mode: string, zoom: number) { OrbitPlayer.setAspect({ mode, zoom }).catch(() => {}); }
  setSpeed(speed: number) { OrbitPlayer.setSpeed({ speed }).catch(() => {}); }
  setMuted(muted: boolean) { OrbitPlayer.setMuted({ muted }).catch(() => {}); }
  selectTrack(type: 'audio' | 'text', id: string | null) { OrbitPlayer.selectTrack({ type, id }).catch(() => {}); }
  setSubtitleStyle(scale: number, background: boolean, raised: boolean) { OrbitPlayer.setSubtitleStyle({ scale, background, raised }).catch(() => {}); }
  destroy() {
    this.stop();
    this.subs.forEach(p => p.then(h => h.remove()).catch(() => {}));
  }
}
