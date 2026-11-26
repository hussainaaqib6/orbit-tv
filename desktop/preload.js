// Exposes a small, fixed API from the desktop shell to the Orbit TV page.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('orbitDesktop', {
  platform: process.platform,
  /** HTTP without browser CORS limits, for playlists, guides and APIs. */
  request: opts => ipcRenderer.invoke('http:request', opts),
  setFullscreen: on => ipcRenderer.invoke('win:fullscreen', on),
  isFullscreen: () => ipcRenderer.invoke('win:isFullscreen'),
  quit: () => ipcRenderer.invoke('app:quit'),
});
