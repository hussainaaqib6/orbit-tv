// Orbit TV desktop: local recordings and downloads, without needing ffmpeg.
// Records raw MPEG-TS streams directly and HLS streams by appending their segments.
'use strict';
const fs = require('fs');
const path = require('path');

const UA = 'VLC/3.0.21 LibVLC/3.0.21';
const sleep = ms => new Promise(r => setTimeout(r, ms));

class Jobs {
  constructor(dir, stateFile, emit) {
    this.dir = dir; this.stateFile = stateFile; this.emit = emit;
    this.items = [];
    this.active = new Map(); // id -> AbortController
    try { this.items = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch {}
    for (const j of this.items) if (j.status === 'recording' || j.status === 'downloading') { j.status = this.size(j) ? 'done' : 'failed'; j.error = j.error || 'Interrupted when the app closed'; }
    fs.mkdirSync(dir, { recursive: true });
    this.save();
    this.timer = setInterval(() => this.tick(), 5000);
    this.tick();
  }
  save() { try { fs.writeFileSync(this.stateFile, JSON.stringify(this.items)); } catch {} }
  size(j) { try { return fs.statSync(j.path).size; } catch { return 0; } }
  list() { return this.items.map(j => ({ ...j, size: this.size(j) })); }
  changed(j) { this.save(); this.emit('job', { ...j, size: this.size(j) }); }
  add(opts) {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const safe = String(opts.title || 'Orbit').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Orbit';
    const ext = opts.kind === 'download' ? (String(opts.url).split('?')[0].match(/\.(mp4|mkv|avi|mov|m4v|webm|ts)$/i) || [, 'mp4'])[1].toLowerCase() : 'ts';
    const j = { id, kind: opts.kind, title: opts.title || 'Orbit', channel: opts.channel || '', channelKey: opts.channelKey || '', itemKey: opts.itemKey || '', poster: opts.poster || '',
      url: opts.url, start: +opts.start || Date.now(), stop: +opts.stop || 0, path: path.join(this.dir, `${safe} ${id}.${opts.kind === 'download' && /m3u8/i.test(opts.url) ? 'ts' : ext}`),
      status: opts.kind === 'download' ? 'queued' : 'scheduled', progress: 0, total: 0, error: '', createdAt: Date.now(), profile: opts.profile || '' };
    this.items.push(j); this.changed(j); this.tick();
    return { ...j };
  }
  remove(id, deleteFile = true) {
    const j = this.items.find(x => x.id === id); if (!j) return false;
    const c = this.active.get(id); if (c) c.abort();
    if (deleteFile) fs.unlink(j.path, () => {});
    this.items = this.items.filter(x => x !== j); this.save(); this.emit('removed', { id });
    return true;
  }
  stop(id) { const j = this.items.find(x => x.id === id); if (j && j.kind === 'record') { j.stop = Date.now(); } const c = this.active.get(id); if (c) c.abort(); }
  tick() {
    const now = Date.now();
    for (const j of this.items) {
      if (this.active.has(j.id)) continue;
      if (j.status === 'scheduled' && j.start - 60e3 <= now) {
        if (j.stop && j.stop + 180e3 < now) { j.status = 'failed'; j.error = 'Missed: the app was not running'; this.changed(j); continue; }
        this.run(j);
      }
      if (j.status === 'queued' && [...this.active.keys()].filter(k => (this.items.find(x => x.id === k) || {}).kind === 'download').length < 2) this.run(j);
    }
  }
  async run(j) {
    const ctrl = new AbortController(); this.active.set(j.id, ctrl);
    j.status = j.kind === 'download' ? 'downloading' : 'recording'; j.error = ''; this.changed(j);
    const until = j.kind === 'record' ? () => (j.stop || Date.now() + 3600e3) + 180e3 : () => Infinity;
    const out = fs.createWriteStream(j.path, { flags: 'w' });
    let last = 0;
    const progress = n => { j.progress += n; if (Date.now() - last > 1000) { last = Date.now(); this.emit('job', { ...j, size: j.progress }); } };
    try {
      if (/\.m3u8(\?|$)/i.test(j.url)) await this.hls(j, out, ctrl.signal, until, progress);
      else await this.direct(j, out, ctrl.signal, until, progress);
      j.status = 'done';
    } catch (e) {
      if (ctrl.signal.aborted && this.size(j) > 50000) j.status = 'done';
      else if (!this.items.includes(j)) return;
      else { j.status = this.size(j) > 50000 && j.kind === 'record' ? 'done' : 'failed'; j.error = ctrl.signal.aborted ? 'Stopped' : String(e.message || e); }
    } finally {
      await new Promise(r => out.end(r));
      this.active.delete(j.id);
      if (this.items.includes(j)) this.changed(j);
      this.tick();
    }
  }
  async get(url, signal, range) {
    const headers = { 'User-Agent': UA };
    if (range) headers.Range = range;
    const r = await fetch(url, { headers, signal, redirect: 'follow' });
    if (!r.ok && r.status !== 206) throw new Error(`HTTP ${r.status}`);
    return r;
  }
  async direct(j, out, signal, until, progress) {
    const r = await this.get(j.url, signal);
    j.total = +r.headers.get('content-length') || 0;
    const reader = r.body.getReader();
    while (true) {
      if (Date.now() > until()) { await reader.cancel(); break; }
      const { done, value } = await reader.read();
      if (done) break;
      if (!out.write(Buffer.from(value))) await new Promise(res => out.once('drain', res));
      progress(value.length);
    }
  }
  async hls(j, out, signal, until, progress) {
    let url = j.url;
    const seen = new Set();
    let fails = 0;
    while (Date.now() < until()) {
      let text, base;
      try { const r = await this.get(url, signal); base = r.url; text = await r.text(); fails = 0; }
      catch (e) { if (signal.aborted || ++fails > 6) throw e; await sleep(2000); continue; }
      const lines = text.split(/\r?\n/);
      if (lines.some(l => l.startsWith('#EXT-X-STREAM-INF'))) {
        // master playlist: pick the highest bandwidth variant
        let best = null, bw = -1;
        lines.forEach((l, i) => { const m = /BANDWIDTH=(\d+)/.exec(l); if (m && +m[1] > bw && lines[i + 1]) { bw = +m[1]; best = lines[i + 1].trim(); } });
        url = new URL(best, base).href; continue;
      }
      const target = +((/#EXT-X-TARGETDURATION:(\d+)/.exec(text) || [, 4])[1]);
      const segs = lines.filter(l => l && !l.startsWith('#')).map(l => new URL(l.trim(), base).href);
      if (segs.length && !j.total && text.includes('#EXT-X-ENDLIST')) j.total = segs.length;
      for (const s of segs) {
        if (seen.has(s)) continue;
        seen.add(s);
        if (Date.now() > until()) return;
        const r = await this.get(s, signal);
        const buf = Buffer.from(await r.arrayBuffer());
        if (!out.write(buf)) await new Promise(res => out.once('drain', res));
        progress(buf.length);
        if (j.total) { j.done = (j.done || 0) + 1; }
      }
      if (text.includes('#EXT-X-ENDLIST')) return;
      await sleep(Math.max(1000, target * 500));
    }
  }
}
module.exports = { Jobs };
