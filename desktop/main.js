// Matrix TV desktop shell (Windows, macOS, Linux).
const { app, BrowserWindow, session, shell, ipcMain, net } = require('electron');
const path = require('path');

// Many IPTV panels refuse browser user agents, so present as a media player.
const UA = 'VLC/3.0.21 LibVLC/3.0.21';

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// Let Chromium use the GPU for HEVC where the system supports it.
app.commandLine.appendSwitch('enable-features', 'PlatformHEVCDecoderSupport');

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 880,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#0b0709',
    title: 'Matrix TV',
    icon: path.join(__dirname, '..', 'dist', 'brand', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  // Links open in the system browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) { e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); } });
  win.on('enter-full-screen', () => win.webContents.send('orbit:fullscreen', true));
  win.on('leave-full-screen', () => win.webContents.send('orbit:fullscreen', false));
}

app.whenReady().then(() => {
  const s = session.defaultSession;
  // Video streams are fetched by hls.js / mpegts.js from the page. IPTV servers almost never send
  // CORS headers, so add them to responses (instead of switching web security off for everything).
  s.webRequest.onBeforeSendHeaders({ urls: ['http://*/*', 'https://*/*'] }, (d, cb) => {
    const h = d.requestHeaders;
    h['User-Agent'] = UA;
    delete h.Origin;
    delete h.Referer;
    cb({ requestHeaders: h });
  });
  s.webRequest.onHeadersReceived({ urls: ['http://*/*', 'https://*/*'] }, (d, cb) => {
    const h = d.responseHeaders || {};
    for (const k of Object.keys(h)) if (/^access-control-allow-/i.test(k)) delete h[k];
    h['Access-Control-Allow-Origin'] = ['*'];
    h['Access-Control-Allow-Headers'] = ['*'];
    h['Access-Control-Expose-Headers'] = ['*'];
    cb({ responseHeaders: h });
  });

  // Playlists, guides and APIs go through the main process, where any header can be sent.
  ipcMain.handle('http:request', async (_e, o) => {
    if (!/^https?:\/\//i.test(String(o && o.url))) throw new Error('Only http and https addresses are allowed.');
    const headers = { 'User-Agent': UA, ...(o.headers || {}) };
    const res = await net.fetch(o.url, { method: o.method || 'GET', headers, body: o.method && o.method !== 'GET' && o.method !== 'HEAD' ? o.body : undefined, bypassCustomProtocolHandlers: true });
    const outHeaders = {};
    res.headers.forEach((v, k) => { outHeaders[k] = v; });
    const data = o.method === 'HEAD' ? (o.type === 'bytes' ? new Uint8Array() : '') : o.type === 'bytes' ? new Uint8Array(await res.arrayBuffer()) : await res.text();
    return { status: res.status, data, headers: outHeaders };
  });
  ipcMain.handle('win:fullscreen', (_e, on) => { if (win) win.setFullScreen(!!on); });
  ipcMain.handle('win:isFullscreen', () => !!(win && win.isFullScreen()));
  ipcMain.handle('app:quit', () => app.quit());

  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
