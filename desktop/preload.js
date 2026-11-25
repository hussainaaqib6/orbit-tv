// Exposes a small, fixed API from the desktop shell to the Orbit TV page.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('orbitDesktop', {
  platform: process.platform,
  jobs: {
    list: () => ipcRenderer.invoke('jobs:list'),
    add: opts => ipcRenderer.invoke('jobs:add', opts),
    remove: (id, deleteFile) => ipcRenderer.invoke('jobs:remove', id, deleteFile),
    stop: id => ipcRenderer.invoke('jobs:stop', id),
    folder: () => ipcRenderer.invoke('jobs:folder'),
    chooseFolder: () => ipcRenderer.invoke('jobs:chooseFolder'),
    reveal: id => ipcRenderer.invoke('jobs:reveal', id),
    fileUrl: id => ipcRenderer.invoke('jobs:fileUrl', id),
  },
  cast: {
    devices: () => ipcRenderer.invoke('cast:devices'),
    play: opts => ipcRenderer.invoke('cast:play', opts),
    control: (cmd, arg) => ipcRenderer.invoke('cast:control', cmd, arg),
  },
  on: (event, fn) => {
    const h = (_, data) => fn(data);
    ipcRenderer.on('orbit:' + event, h);
    return () => ipcRenderer.removeListener('orbit:' + event, h);
  },
});
