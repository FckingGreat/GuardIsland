const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('guard', {
  getState: () => ipcRenderer.invoke('get-state'),
  setConfig: (patch) => ipcRenderer.invoke('set-config', patch),
  setTheme: (theme) => ipcRenderer.invoke('set-theme', theme),
  setupAccount: (payload) => ipcRenderer.invoke('setup-account', payload),
  login: (username, password) => ipcRenderer.invoke('login', { username, password }),
  setPassword: (payload) => ipcRenderer.invoke('set-password', payload),
  checkPassword: (kind, password) => ipcRenderer.invoke('check-password', { kind, password }),
  windowsHello: () => ipcRenderer.invoke('windows-hello'),
  tailscale: () => ipcRenderer.invoke('tailscale-status'),
  tailscaleUp: () => ipcRenderer.invoke('tailscale-up'),
  openTailscaleSite: () => ipcRenderer.send('open-tailscale'),
  openUrl: (url) => ipcRenderer.send('open-url', url),
  enrollFace: () => ipcRenderer.invoke('open-enroll'),
  pickHotkey: (key) => ipcRenderer.invoke('set-config', { hotkey: key }),
  getLogPath: () => ipcRenderer.invoke('log-path'),
  minimize: () => ipcRenderer.send('settings-min'),
  maximize: () => ipcRenderer.send('settings-max'),
  closeWindow: () => ipcRenderer.send('settings-close'),
  onState: (cb) => {
    const fn = (_e, s) => cb(s);
    ipcRenderer.on('state', fn);
    return () => ipcRenderer.removeListener('state', fn);
  }
});
