#!/usr/bin/env node
/*
 * Orbit Server — recording and sync companion for Orbit TV.
 *
 * Records live channels with ffmpeg on a schedule, serves the recordings back to every device,
 * and keeps profiles, favourites and settings in sync across devices.
 *
 * Environment:
 *   ORBIT_TOKEN   required. A long random secret; enter the same value in the app.
 *   PORT          default 8090
 *   DATA_DIR      default ./data   (recordings in DATA_DIR/recordings, state in DATA_DIR/state.json)
 *   PAD_BEFORE    minutes to start early, default 1
 *   PAD_AFTER     minutes to keep recording after the end, default 3
 *   FFMPEG        path to ffmpeg, default "ffmpeg"
 *   MAX_DAYS      delete finished recordings older than this many days, default 0 (never)
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const VERSION = '1.0.0';
const TOKEN = process.env.ORBIT_TOKEN || '';
const PORT = +process.env.PORT || 8090;
const DATA = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const REC_DIR = path.join(DATA, 'recordings');
const STATE = path.join(DATA, 'state.json');
const PAD_BEFORE = (+process.env.PAD_BEFORE || 1) * 60e3;
const PAD_AFTER = (+(process.env.PAD_AFTER ?? 3)) * 60e3;
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const MAX_DAYS = +process.env.MAX_DAYS || 0;
const UA = 'VLC/3.0.21 LibVLC/3.0.21';

if (!TOKEN || TOKEN.length < 8) {
  console.error('Set ORBIT_TOKEN to a secret of at least 8 characters, e.g. ORBIT_TOKEN=$(openssl rand -hex 16)');
  process.exit(1);
}
fs.mkdirSync(REC_DIR, { recursive: true });

/* ---------------- state ---------------- */
let state = { recordings: [], sync: {} };
try { state = Object.assign(state, JSON.parse(fs.readFileSync(STATE, 'utf8'))); } catch {}
let saveT = null;
function save() {
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    const tmp = STATE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, STATE);
  }, 200);
}
// Anything that was recording when the server stopped is marked as interrupted.
for (const r of state.recordings) if (r.status === 'recording') { r.status = fileSize(r) ? 'done' : 'failed'; r.error = r.error || 'Server restarted during recording'; }

function fileSize(r) { try { return fs.statSync(path.join(REC_DIR, r.file)).size; } catch { return 0; } }
const pub = r => ({ id: r.id, title: r.title, channel: r.channel, channelKey: r.channelKey, logo: r.logo, desc: r.desc, start: r.start, stop: r.stop,
  status: r.status, error: r.error || '', size: fileSize(r), file: r.file, profile: r.profile || '', createdAt: r.createdAt, ext: path.extname(r.file || '').slice(1) });

/* ---------------- recorder ---------------- */
const running = new Map();
function startRecording(r) {
  const until = r.stop + PAD_AFTER;
  const secs = Math.max(10, Math.round((until - Date.now()) / 1000));
  r.file = `${r.id}.ts`;
  const out = path.join(REC_DIR, r.file);
  const args = ['-nostdin', '-hide_banner', '-loglevel', 'error', '-user_agent', r.userAgent || UA,
    '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_on_network_error', '1', '-reconnect_delay_max', '10',
    '-i', r.url, '-map', '0:v?', '-map', '0:a?', '-map', '0:s?', '-c', 'copy', '-f', 'mpegts', '-t', String(secs), '-y', out];
  const p = spawn(FFMPEG, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let err = '';
  p.stderr.on('data', d => { err = (err + d).slice(-2000); });
  p.on('error', e => { r.status = 'failed'; r.error = `Could not start ffmpeg: ${e.message}`; running.delete(r.id); save(); });
  p.on('exit', code => {
    running.delete(r.id);
    if (r.status === 'cancelled') return save();
    const size = fileSize(r);
    if (size > 50000) { r.status = 'done'; r.error = code ? lastLine(err) : ''; remux(r); }
    else { r.status = 'failed'; r.error = lastLine(err) || `ffmpeg exited with code ${code}`; }
    save();
    log(`finished ${r.title} (${r.status}, ${Math.round(size / 1e6)} MB)`);
  });
  running.set(r.id, p);
  r.status = 'recording'; r.startedAt = Date.now();
  save();
  log(`recording ${r.title} on ${r.channel} for ${secs}s`);
}
const lastLine = s => String(s || '').trim().split('\n').pop().slice(0, 300);
// MP4 plays on every device (iPhones cannot play .ts files). Keep the .ts if the copy fails.
function remux(r) {
  const src = path.join(REC_DIR, r.file), mp4 = `${r.id}.mp4`, dst = path.join(REC_DIR, mp4);
  const p = spawn(FFMPEG, ['-nostdin', '-loglevel', 'error', '-i', src, '-map', '0:v?', '-map', '0:a?', '-c', 'copy', '-movflags', '+faststart', '-y', dst], { stdio: 'ignore' });
  p.on('error', () => {});
  p.on('exit', code => {
    if (code === 0 && fs.existsSync(dst) && fs.statSync(dst).size > 50000) { fs.unlink(src, () => {}); r.file = mp4; save(); }
    else fs.unlink(dst, () => {});
  });
}
function tick() {
  const now = Date.now();
  for (const r of state.recordings) {
    if (r.status === 'scheduled' && r.start - PAD_BEFORE <= now) {
      if (r.stop + PAD_AFTER <= now) { r.status = 'failed'; r.error = 'The programme ended before the server could start recording'; save(); }
      else startRecording(r);
    }
  }
  if (MAX_DAYS) {
    const cutoff = now - MAX_DAYS * 864e5;
    for (const r of state.recordings.filter(x => (x.status === 'done' || x.status === 'failed') && x.stop < cutoff)) removeRecording(r);
  }
}
function removeRecording(r) {
  const p = running.get(r.id);
  if (p) { r.status = 'cancelled'; p.kill('SIGINT'); }
  if (r.file) fs.unlink(path.join(REC_DIR, r.file), () => {});
  state.recordings = state.recordings.filter(x => x !== r);
  save();
}
function stopRecording(r) {
  const p = running.get(r.id);
  if (p) { r.stop = Date.now() - PAD_AFTER; p.kill('SIGINT'); }
}

/* ---------------- http ---------------- */
function send(res, code, body, headers = {}) {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(code, Object.assign({ 'Content-Type': typeof body === 'string' ? 'text/html; charset=utf-8' : 'application/json', 'Content-Length': Buffer.byteLength(data) }, cors(), headers));
  res.end(data);
}
const cors = () => ({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS', 'Access-Control-Expose-Headers': 'Content-Length, Content-Range' });
function authed(req, url) {
  const h = req.headers.authorization || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : url.searchParams.get('token') || '';
  const a = Buffer.from(t), b = Buffer.from(TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function readBody(req, limit = 5e6) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', c => { n += c.length; if (n > limit) { reject(new Error('Body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
function serveFile(req, res, file) {
  let st; try { st = fs.statSync(file); } catch { return send(res, 404, { error: 'Not found' }); }
  const type = file.endsWith('.mp4') ? 'video/mp4' : 'video/mp2t';
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  if (range) {
    const start = range[1] ? +range[1] : st.size - +range[2];
    const end = range[1] && range[2] ? Math.min(+range[2], st.size - 1) : st.size - 1;
    if (start >= st.size || start > end) return send(res, 416, { error: 'Bad range' }, { 'Content-Range': `bytes */${st.size}` });
    res.writeHead(206, Object.assign({ 'Content-Type': type, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Accept-Ranges': 'bytes' }, cors()));
    fs.createReadStream(file, { start, end }).pipe(res);
  } else {
    res.writeHead(200, Object.assign({ 'Content-Type': type, 'Content-Length': st.size, 'Accept-Ranges': 'bytes' }, cors()));
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  }
}
const log = (...a) => console.log(new Date().toISOString(), ...a);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  if (req.method === 'OPTIONS') { res.writeHead(204, cors()); return res.end(); }
  if (p === '/' && req.method === 'GET') return send(res, 200, statusPage());
  if (p === '/api/health') return send(res, 200, { ok: true, name: 'Orbit Server', version: VERSION, authed: authed(req, url), features: ['record', 'sync'], time: Date.now() });
  if (!authed(req, url)) return send(res, 401, { error: 'Wrong or missing token' });
  try {
    if (p === '/api/recordings' && req.method === 'GET') {
      return send(res, 200, state.recordings.slice().sort((a, b) => b.start - a.start).map(pub));
    }
    if (p === '/api/recordings' && req.method === 'POST') {
      const b = await readBody(req);
      if (!/^https?:\/\//i.test(b.url || '')) return send(res, 400, { error: 'A stream URL is required' });
      const start = +b.start || Date.now(), stop = +b.stop || start + 3600e3;
      if (stop <= start) return send(res, 400, { error: 'The recording must end after it starts' });
      if (stop + PAD_AFTER < Date.now()) return send(res, 400, { error: 'That programme has already finished' });
      const dupe = state.recordings.find(r => r.channelKey && r.channelKey === b.channelKey && r.start === start && r.status !== 'failed');
      if (dupe) return send(res, 200, pub(dupe));
      const r = { id: crypto.randomBytes(6).toString('hex'), title: String(b.title || 'Recording').slice(0, 200), channel: String(b.channel || '').slice(0, 200),
        channelKey: String(b.channelKey || ''), logo: String(b.logo || ''), desc: String(b.desc || '').slice(0, 2000), url: b.url, userAgent: b.userAgent || '',
        start, stop, status: 'scheduled', profile: String(b.profile || ''), createdAt: Date.now(), file: '' };
      state.recordings.push(r); save(); tick();
      return send(res, 201, pub(r));
    }
    let m = /^\/api\/recordings\/([0-9a-f]+)(\/stop)?$/.exec(p);
    if (m) {
      const r = state.recordings.find(x => x.id === m[1]);
      if (!r) return send(res, 404, { error: 'No such recording' });
      if (m[2] && req.method === 'POST') { stopRecording(r); return send(res, 200, pub(r)); }
      if (req.method === 'DELETE') { removeRecording(r); return send(res, 200, { ok: true }); }
      if (req.method === 'GET') return send(res, 200, pub(r));
    }
    m = /^\/media\/([0-9a-f]+)(\.\w+)?$/.exec(p);
    if (m && (req.method === 'GET' || req.method === 'HEAD')) {
      const r = state.recordings.find(x => x.id === m[1]);
      if (!r || !r.file) return send(res, 404, { error: 'Not found' });
      return serveFile(req, res, path.join(REC_DIR, r.file));
    }
    // Sync: one JSON document per account. Each top-level key carries its own timestamp so devices can merge.
    m = /^\/api\/sync\/([\w.-]{1,64})$/.exec(p);
    if (m) {
      const id = m[1];
      if (req.method === 'GET') return send(res, 200, state.sync[id] || { rev: 0, data: {} });
      if (req.method === 'PUT') {
        const b = await readBody(req, 20e6);
        const cur = state.sync[id] || { rev: 0, data: {} };
        const merged = Object.assign({}, cur.data);
        for (const [k, v] of Object.entries(b.data || {})) if (!merged[k] || (v && +v.t >= +merged[k].t)) merged[k] = v;
        state.sync[id] = { rev: cur.rev + 1, data: merged, updatedAt: Date.now() };
        save();
        return send(res, 200, state.sync[id]);
      }
    }
    send(res, 404, { error: 'Not found' });
  } catch (e) {
    send(res, 500, { error: e.message });
  }
});

function statusPage() {
  const rows = state.recordings.slice().sort((a, b) => b.start - a.start).slice(0, 50)
    .map(r => `<tr><td>${esc(r.title)}</td><td>${esc(r.channel)}</td><td>${new Date(r.start).toLocaleString()}</td><td>${r.status}</td></tr>`).join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Orbit Server</title>
<style>body{font:15px/1.5 system-ui,sans-serif;background:#05060b;color:#eef0f7;margin:0;padding:32px}h1{margin:0 0 4px}p{color:#8f95ad}table{border-collapse:collapse;width:100%;max-width:900px}td{padding:8px;border-bottom:1px solid #20253a}</style></head>
<body><h1>Orbit Server ${VERSION}</h1><p>Running. Add this address and your token in Orbit TV → Settings → Orbit Server. ${state.recordings.length} recordings.</p><table>${rows}</table></body></html>`;
}
const esc = s => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

setInterval(tick, 5000);
tick();
server.listen(PORT, () => log(`Orbit Server ${VERSION} listening on :${PORT}, data in ${DATA}`));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => {
  for (const p of running.values()) p.kill('SIGINT');
  clearTimeout(saveT); fs.writeFileSync(STATE, JSON.stringify(state));
  process.exit(0);
});
