const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('guard', {
  onState: (cb) => {
    const fn = (_e, s) => cb(s);
    ipcRenderer.on('state', fn);
    return () => ipcRenderer.removeListener('state', fn);
  },
  onToast: (cb) => {
    const fn = (_e, t) => cb(t);
    ipcRenderer.on('toast', fn);
    return () => ipcRenderer.removeListener('toast', fn);
  },
  getState: () => ipcRenderer.invoke('get-state'),
  resize: (w, h) => ipcRenderer.send('island-resize', { w, h }),
  onCollapse: (cb) => {
    ipcRenderer.on('island-collapse', cb);
  },
  openSettings: () => ipcRenderer.send('open-settings'),
  panicLock: () => ipcRenderer.invoke('panic-lock'),
  setArmed: (v) => ipcRenderer.invoke('set-config', { armed: v }),
  toggle: (key, value) => ipcRenderer.invoke('set-config', { [key]: value }),
  hideIsland: () => ipcRenderer.send('hide-island')
});
