const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('guard', {
  onPrompt: (cb) => ipcRenderer.on('prompt-data', (_e, d) => cb(d)),
  submit: (password) => ipcRenderer.send('prompt-submit', password),
  cancel: () => ipcRenderer.send('prompt-cancel')
});
