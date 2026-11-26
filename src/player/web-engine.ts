// Playback in a <video> element: hls.js for HLS, mpegts.js for raw MPEG-TS, the browser for files.
// Used on desktop, iPhone/iPad (where Safari plays HLS natively), in a browser, and on Android when
// the viewer picks the web engine.
import Hls from 'hls.js';
import mpegts from 'mpegts.js';
import type { Engine, EngineEvents, LoadOptions, Rect, Track } from './engine';
import { PLATFORM } from '../core/platform';

const FILE = /\.(mp4|mkv|webm|mov|m4v|avi|mp3|aac)$/i;

export class WebEngine implements Engine {
  readonly name = 'web' as const;
  readonly drawsEmbeddedSubtitles = false;
  private v: HTMLVideoElement;
  private hls: Hls | null = null;
  private ts: mpegts.Player | null = null;
  private tries = 0;
  private live = false;
  private aspect = { mode: 'fit', zoom: 1 };
  private rect: Rect | null = null;
  private timer = 0;

  constructor(private ev: EngineEvents) {
    let v = document.getElementById('orbit-video') as HTMLVideoElement | null;
    if (!v) {
      v = document.createElement('video');
      v.id = 'orbit-video';
      v.setAttribute('playsinline', '');
      v.preload = 'auto';
      document.body.prepend(v);
    }
    this.v = v;
    v.controls = false;
    const on = (name: string, fn: () => void) => v!.addEventListener(name, fn);
    on('playing', () => ev.state('playing'));
    on('pause', () => { if (!v!.ended) ev.state('paused'); });
    on('waiting', () => ev.state('buffering'));
    on('ended', () => ev.state('ended'));
    on('loadedmetadata', () => { this.emitTracks(); this.layout(); });
    on('error', () => {
      if (this.hls || this.ts) return; // those report their own errors
      const code = v!.error?.code;
      this.fail(code === 4 ? 'This stream format cannot be played on this device.' : 'The stream could not be played.');
    });
    v.textTracks.addEventListener?.('addtrack', () => this.emitTracks());
    this.timer = window.setInterval(() => this.tick(), 250);
    window.addEventListener('resize', this.layout);
  }

  private tick() {
    const v = this.v;
    if (!v.src && !this.hls && !this.ts) return;
    const d = v.duration;
    let seekable = false;
    try { seekable = v.seekable.length > 0 && v.seekable.end(v.seekable.length - 1) - v.seekable.start(0) > 30; } catch {}
    this.ev.time({ position: v.currentTime, duration: isFinite(d) ? d : 0, live: this.live || !isFinite(d), seekable: !this.live ? isFinite(d) : seekable });
  }

  private fail(msg: string, detail?: { http?: number; code?: string }) {
    this.ev.state('error');
    this.ev.error(msg, detail);
  }

  load(url: string, o: LoadOptions) {
    this.stop();
    this.tries = 0;
    this.live = o.live;
    const v = this.v, path = url.split('?')[0];
    this.ev.state('loading');
    const isHls = /\.m3u8$/i.test(path) || /\/(index|playlist|master)\b/i.test(path);
    const start = o.start ?? 0;
    const seekOnce = () => { if (start > 0) v.currentTime = start; v.removeEventListener('loadedmetadata', seekOnce); };
    v.addEventListener('loadedmetadata', seekOnce);

    if (isHls && (PLATFORM === 'ios' || !Hls.isSupported())) {
      v.src = url; // Apple's own HLS: HEVC, Dolby, AirPlay
    } else if (isHls) {
      const h = this.hls = new Hls({ enableWorker: true, backBufferLength: 60, maxBufferLength: 30, startPosition: start > 0 ? start : -1 });
      h.on(Hls.Events.MANIFEST_PARSED, () => this.emitTracks());
      h.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => this.emitTracks());
      h.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, () => this.emitTracks());
      h.on(Hls.Events.ERROR, (_e, d) => {
        if (!d.fatal) return;
        const http = d.response?.code;
        if (d.type === Hls.ErrorTypes.NETWORK_ERROR && this.tries++ < 3 && !/^manifest/i.test(d.details)) setTimeout(() => this.hls === h && h.startLoad(), 1500);
        else if (d.type === Hls.ErrorTypes.MEDIA_ERROR && this.tries++ < 3) h.recoverMediaError();
        else this.fail(http ? `The server returned an error (${http}).` : 'The stream could not be played.', { http, code: d.details });
      });
      h.loadSource(url);
      h.attachMedia(v);
    } else if (!FILE.test(path) && mpegts.getFeatureList().mseLivePlayback) {
      const p = this.ts = mpegts.createPlayer({ type: 'mpegts', isLive: o.live, url }, {
        enableWorker: true, lazyLoad: false, liveBufferLatencyChasing: o.live, autoCleanupSourceBuffer: true,
      });
      p.on(mpegts.Events.ERROR, (type: string, detail: string, info?: { code?: number }) =>
        this.fail(info?.code ? `The server returned an error (${info.code}).` : 'The stream could not be played.', { http: info?.code, code: `${type}:${detail}` }));
      p.attachMediaElement(v);
      p.load();
    } else {
      v.src = url;
    }
    v.play().catch(() => {});
    this.layout();
  }

  play() { this.v.play().catch(() => {}); }
  pause() { this.v.pause(); }

  stop() {
    if (this.hls) { this.hls.destroy(); this.hls = null; }
    if (this.ts) { try { this.ts.pause(); this.ts.unload(); this.ts.detachMediaElement(); this.ts.destroy(); } catch {} this.ts = null; }
    this.v.pause();
    this.v.removeAttribute('src');
    this.v.load();
    for (const t of Array.from(this.v.textTracks)) t.mode = 'disabled';
    this.ev.state('idle');
  }

  seek(s: number) {
    const v = this.v;
    if (isFinite(v.duration)) s = Math.min(s, v.duration - 1);
    v.currentTime = Math.max(0, s);
  }

  setRect(r: Rect | null) { this.rect = r; this.layout(); }
  setAspect(mode: string, zoom: number) { this.aspect = { mode, zoom }; this.layout(); }
  setSpeed(s: number) { this.v.playbackRate = s; }
  setMuted(m: boolean) { this.v.muted = m; }

  /** Positions the video for the rect and aspect mode (object-fit cannot do 16:9 / 4:3 on its own). */
  private layout = () => {
    const v = this.v;
    const box = this.rect ?? { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
    const { mode, zoom } = this.aspect;
    let w = box.width, h = box.height;
    const forced = mode === '16:9' ? 16 / 9 : mode === '4:3' ? 4 / 3 : 0;
    if (forced) { if (w / h > forced) w = h * forced; else h = w / forced; }
    Object.assign(v.style, {
      left: `${box.x + (box.width - w) / 2}px`, top: `${box.y + (box.height - h) / 2}px`, width: `${w}px`, height: `${h}px`,
      objectFit: forced || mode === 'stretch' ? 'fill' : mode === 'fill' ? 'cover' : 'contain',
      transform: zoom !== 1 ? `scale(${zoom})` : '',
    });
    v.classList.toggle('is-preview', !!this.rect);
  };

  private emitTracks() {
    const out: Track[] = [];
    if (this.hls) {
      this.hls.audioTracks.forEach((t, i) => out.push({ id: String(i), type: 'audio', label: t.name || t.lang || `Audio ${i + 1}`, language: t.lang || '', selected: i === this.hls!.audioTrack }));
      this.hls.subtitleTracks.forEach((t, i) => out.push({ id: `hls:${i}`, type: 'text', label: t.name || t.lang || `Subtitles ${i + 1}`, language: t.lang || '', selected: i === this.hls!.subtitleTrack }));
    } else {
      Array.from(this.v.textTracks).forEach((t, i) => {
        if (t.kind !== 'subtitles' && t.kind !== 'captions') return;
        out.push({ id: `tt:${i}`, type: 'text', label: t.label || t.language || `Subtitles ${i + 1}`, language: t.language, selected: t.mode !== 'disabled' });
      });
    }
    this.ev.tracks(out);
  }

  selectTrack(type: 'audio' | 'text', id: string | null) {
    if (type === 'audio' && this.hls && id != null) this.hls.audioTrack = +id;
    if (type === 'text') {
      if (this.hls) this.hls.subtitleTrack = id?.startsWith('hls:') ? +id.slice(4) : -1;
      // Embedded cues are drawn by Orbit (so they share size and delay settings), so keep tracks hidden.
      Array.from(this.v.textTracks).forEach((t, i) => {
        const on = id === `tt:${i}` || (this.hls != null && id?.startsWith('hls:') && t.mode !== 'disabled');
        t.mode = on ? 'hidden' : 'disabled';
        t.oncuechange = on ? () => {
          const cues = t.activeCues ? Array.from(t.activeCues) as VTTCue[] : [];
          this.ev.cue(cues.map(c => c.text).join('\n'));
        } : null;
      });
      if (!id) this.ev.cue('');
    }
    this.emitTracks();
  }

  setSubtitleStyle() { /* drawn by the web layer */ }

  destroy() {
    this.stop();
    clearInterval(this.timer);
    window.removeEventListener('resize', this.layout);
  }
}
