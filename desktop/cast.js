// Chromecast for the desktop app: finds Cast devices on the local network (mDNS) and plays a stream URL
// with Google's Default Media Receiver. The Chromecast fetches the stream itself, so it must be reachable
// from the TV (http/https URLs from your provider work; local files do not).
'use strict';
const { Bonjour } = require('bonjour-service');
const { Client, DefaultMediaReceiver } = require('castv2-client');

const found = new Map(); // id -> { id, name, host, port, model }
let bonjour = null, browser = null, emit = () => {};
let session = null; // { client, player, device }

function start(send) {
  emit = send;
  try {
    bonjour = new Bonjour();
    browser = bonjour.find({ type: 'googlecast' }, svc => {
      const txt = svc.txt || {};
      const id = txt.id || svc.name;
      const host = (svc.addresses || []).find(a => /^\d+\.\d+\.\d+\.\d+$/.test(a)) || svc.host;
      found.set(id, { id, name: txt.fn || svc.name, host, port: svc.port || 8009, model: txt.md || '' });
      emit('castDevices', [...found.values()]);
    });
  } catch (e) { console.warn('Cast discovery unavailable:', e.message); }
}
async function devices() {
  if (browser) { try { browser.update(); } catch {} }
  return [...found.values()];
}
function close() {
  if (session) { try { session.client.close(); } catch {} }
  session = null;
}
function play(o) {
  return new Promise((resolve, reject) => {
    const dev = found.get(o.deviceId) || (o.host ? { id: o.host, name: o.host, host: o.host, port: 8009 } : null);
    if (!dev) return reject(new Error('That Cast device is no longer available'));
    close();
    const client = new Client();
    const fail = e => { try { client.close(); } catch {} reject(e instanceof Error ? e : new Error(String(e))); };
    client.on('error', e => { emit('castStatus', { state: 'error', error: e.message }); close(); });
    client.connect({ host: dev.host, port: dev.port }, () => {
      client.launch(DefaultMediaReceiver, (err, player) => {
        if (err) return fail(err);
        const media = {
          contentId: o.url,
          contentType: o.contentType || (/\.m3u8/i.test(o.url) ? 'application/x-mpegURL' : /\.mp4/i.test(o.url) ? 'video/mp4' : 'video/mp2t'),
          streamType: o.live ? 'LIVE' : 'BUFFERED',
          metadata: { type: 0, metadataType: 0, title: o.title || 'Orbit TV', subtitle: o.subtitle || '', images: o.image ? [{ url: o.image }] : [] },
        };
        player.on('status', st => emit('castStatus', { state: st.playerState, time: st.currentTime, device: dev.name }));
        player.load(media, { autoplay: true, currentTime: o.startAt || 0 }, (e2, st) => {
          if (e2) return fail(e2);
          session = { client, player, device: dev };
          emit('castStatus', { state: (st && st.playerState) || 'PLAYING', device: dev.name });
          resolve({ device: dev.name });
        });
      });
    });
    setTimeout(() => { if (!session) fail(new Error(`${dev.name} did not answer`)); }, 15000);
  });
}
async function control(cmd, arg) {
  if (!session) return false;
  // Make sure the media session is known (some receivers only report it when asked).
  if (!session.player.media || !session.player.media.currentSession) await new Promise(r => session.player.getStatus(() => r()));
  return new Promise((resolve, reject) => {
    if (!session) return resolve(false);
    const p = session.player, done = e => e ? reject(e) : resolve(true);
    if (cmd === 'pause') p.pause(done);
    else if (cmd === 'play') p.play(done);
    else if (cmd === 'seek') p.seek(+arg || 0, done);
    else if (cmd === 'stop') { p.stop(() => { close(); emit('castStatus', { state: 'IDLE' }); resolve(true); }); }
    else if (cmd === 'volume') session.client.setVolume({ level: Math.max(0, Math.min(1, +arg)) }, done);
    else resolve(false);
  });
}
module.exports = { start, devices, play, control };
