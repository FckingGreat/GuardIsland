const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('guard', {
  tray: (act) => ipcRenderer.send('tray-action', act)
});
