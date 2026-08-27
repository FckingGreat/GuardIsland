const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('guard', {
  showIsland: () => ipcRenderer.send('show-island')
});
