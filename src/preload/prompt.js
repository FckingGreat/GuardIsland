const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('guard', {
  onPrompt: (cb) => ipcRenderer.on('prompt-data', (_e, d) => cb(d)),
  submit: (password, remember) => ipcRenderer.send('prompt-submit', { password, remember: Boolean(remember) }),
  cancel: () => ipcRenderer.send('prompt-cancel')
});
