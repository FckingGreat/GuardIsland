const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('guard', {
  mode: () => ipcRenderer.invoke('face-mode'),
  saveDescriptor: (arr) => ipcRenderer.invoke('save-face', arr),
  getDescriptor: () => ipcRenderer.invoke('get-face'),
  unknownFace: (payload) => ipcRenderer.send('face-unknown', payload),
  ownerSeen: () => ipcRenderer.send('face-owner'),
  modelsDir: () => ipcRenderer.invoke('models-dir'),
  downloadModels: () => ipcRenderer.invoke('download-models'),
  close: () => ipcRenderer.send('close-face')
});
