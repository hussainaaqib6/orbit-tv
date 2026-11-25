// Orbit TV — Electron main process (Windows, macOS, Linux)
const { app, BrowserWindow, session, shell, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { Jobs } = require('./desktop/recorder');
const cast = require('./desktop/cast');

// Many IPTV panels refuse browser user agents, so present as a media player.
const UA = 'VLC/3.0.21 LibVLC/3.0.21';

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

let win = null, jobs = null;
const settingsFile = () => path.join(app.getPath('userData'), 'desktop-settings.json');
const readSettings = () => { try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch { return {}; } };
const writeSettings = s => fs.writeFileSync(settingsFile(), JSON.stringify(s));
const send = (ev, data) => { if (win && !win.isDestroyed()) win.webContents.send('orbit:' + ev, data); };

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 880,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#05060B',
    title: 'Orbit TV',
    autoHideMenuBar: true,
    webPreferences: {
      // IPTV servers rarely send CORS headers and often serve plain http streams.
      // The window only loads Orbit's own local files, so it is safe to relax this here.
      webSecurity: false,
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'desktop', 'preload.js'),
    },
  });
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  // Open external links in the system browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) { e.preventDefault(); shell.openExternal(url); } });
}

app.whenReady().then(() => {
  session.defaultSession.webRequest.onBeforeSendHeaders((details, cb) => {
    const h = details.requestHeaders;
    if (!details.url.startsWith('file:') && !details.url.startsWith('devtools:')) {
      h['User-Agent'] = UA;
      delete h['Origin'];
      delete h['Referer'];
      // The page cannot set these headers itself, so it sends them as X-Orbit-* (MAC portals need them).
      for (const [from, to] of [['X-Orbit-Cookie', 'Cookie'], ['X-Orbit-UA', 'User-Agent'], ['X-Orbit-Referer', 'Referer']]) {
        const key = Object.keys(h).find(k => k.toLowerCase() === from.toLowerCase());
        if (key) { h[to] = h[key]; delete h[key]; }
      }
    }
    cb({ requestHeaders: h });
  });

  const dir = readSettings().folder || path.join(app.getPath('videos') || app.getPath('downloads'), 'Orbit TV');
  jobs = new Jobs(dir, path.join(app.getPath('userData'), 'jobs.json'), send);

  ipcMain.handle('jobs:list', () => jobs.list());
  ipcMain.handle('jobs:add', (_, o) => jobs.add(o));
  ipcMain.handle('jobs:remove', (_, id, del) => jobs.remove(id, del !== false));
  ipcMain.handle('jobs:stop', (_, id) => jobs.stop(id));
  ipcMain.handle('jobs:folder', () => jobs.dir);
  ipcMain.handle('jobs:chooseFolder', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], defaultPath: jobs.dir });
    if (r.canceled || !r.filePaths[0]) return jobs.dir;
    jobs.dir = r.filePaths[0]; writeSettings({ ...readSettings(), folder: jobs.dir });
    return jobs.dir;
  });
  ipcMain.handle('jobs:reveal', (_, id) => { const j = jobs.items.find(x => x.id === id); if (j) shell.showItemInFolder(j.path); else shell.openPath(jobs.dir); });
  ipcMain.handle('jobs:fileUrl', (_, id) => { const j = jobs.items.find(x => x.id === id); return j ? pathToFileURL(j.path).href : null; });

  ipcMain.handle('cast:devices', () => cast.devices());
  ipcMain.handle('cast:play', (_, o) => cast.play(o));
  ipcMain.handle('cast:control', (_, cmd, arg) => cast.control(cmd, arg));
  cast.start(send);

  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

// Keep recording when the window is closed on macOS; elsewhere closing the window quits.
app.on('window-all-closed', () => {
  const recording = jobs && jobs.items.some(j => j.status === 'recording' || j.status === 'downloading');
  if (process.platform !== 'darwin' && !recording) app.quit();
  if (process.platform !== 'darwin' && recording) {
    // Finish what is running, then quit.
    const t = setInterval(() => { if (!jobs.items.some(j => j.status === 'recording' || j.status === 'downloading')) { clearInterval(t); app.quit(); } }, 10000);
  }
});
