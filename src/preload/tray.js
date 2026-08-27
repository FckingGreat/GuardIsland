const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('guard', {
  tray: (act) => ipcRenderer.send('tray-action', act),
  getState: () => ipcRenderer.invoke('get-state'),
  onState: (cb) => {
    const fn = (_e, s) => cb(s);
    ipcRenderer.on('state', fn);
    return () => ipcRenderer.removeListener('state', fn);
  }
});
