'use strict';

const { app, BrowserWindow, ipcMain, globalShortcut, Tray, Menu, nativeImage, shell, screen, powerMonitor } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { createStore } = require('./store');
const { createLogger } = require('./logger');
const { createBridge } = require('./bridge');
const { shouldIgnoreProcess } = require('./util');
const { requestWindowsHello } = require('./hello');
const { createFileGuard } = require('./file-guard');
const { tailscaleStatus, ensureTailscaleUp } = require('./remote');
const { createUsbPoller } = require('./usb-poll');

let store;
let log;
let bridge;
let islandWin;
let settingsWin;
let promptWin;
let faceWin;
let tray;
let trayMenuWin;
let fileGuard;
let usbPoller;
let lastState = {};
let pendingProc = null;
let frozen = new Map();
let promptTimer = null;
let seenPids = new Set();
let lastFaceAlarm = 0;
let startedAt = Date.now();
let remoteTimer = null;
let sessionUnlocked = false;
let saveBoundsTimer = null;
let allowQuit = false;
let promptKind = 'process';
const sessionAllowedPids = new Set();

const MODEL_FILES = [
  'tiny_face_detector_model-weights_manifest.json',
  'tiny_face_detector_model-shard1',
  'face_landmark_68_model-weights_manifest.json',
  'face_landmark_68_model-shard1',
  'face_recognition_model-weights_manifest.json',
  'face_recognition_model-shard1',
  'face_recognition_model-shard2'
];
const MODEL_BASE = 'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js-models@master';

function modelsDir() {
  return path.join(app.getPath('userData'), 'models');
}

function publicState() {
  const cfg = store.get();
  return {
    ...cfg,
    secrets: store.secretsMeta(),
    session: {
      unlocked: sessionUnlocked,
      needsSetup: !store.hasAccount(),
      username: store.getUsername()
    },
    engine: bridge.engine,
    logFile: log.file,
    uptimeMs: Date.now() - startedAt
  };
}

function requireSession() {
  if (!sessionUnlocked) throw new Error('Сначала войдите в Guard Island');
}

function broadcast() {
  lastState = publicState();
  for (const w of [islandWin, settingsWin]) {
    if (w && !w.isDestroyed()) w.webContents.send('state', lastState);
  }
}

function toast(kind, text) {
  log.info('toast', { kind, text });
  if (islandWin && !islandWin.isDestroyed()) {
    islandWin.webContents.send('toast', { kind, text, t: Date.now() });
  }
}

function canAct() {
  const cfg = store.get();
  return cfg.armed === true;
}

function isTest() {
  return store.get().testMode !== false;
}

function performAction(action, reason) {
  const cfg = store.get();
  log.alert(reason, { action, armed: cfg.armed, testMode: cfg.testMode });
  toast(isTest() || !canAct() ? 'test' : 'alert', reason);

  if (!canAct()) {
    toast('info', 'Охрана выключена — действие не выполнено');
    return;
  }
  if (isTest()) {
    toast('test', `ТЕСТ: было бы «${action}» — ${reason}`);
    return;
  }

  if (action === 'notify') return;
  if (action === 'lock') {
    bridge.lock();
    return;
  }
  if (action === 'shutdown') {
    toast('alert', 'Выключение через 1с…');
    setTimeout(() => bridge.shutdown(), 800);
  }
}

function placeTopWindow(win, w, h) {
  if (!win || win.isDestroyed()) return;
  const display = screen.getPrimaryDisplay();
  const x = Math.round(display.bounds.x + (display.bounds.width - w) / 2);
  const y = display.bounds.y;
  win.setBounds({ x, y, width: w, height: h }, false);
}

function logoPath() {
  return path.join(__dirname, '..', '..', 'assets', 'logo.png');
}

function getAppIcon() {
  const p = logoPath();
  if (!fs.existsSync(p)) return null;
  const img = nativeImage.createFromPath(p);
  return img.isEmpty() ? null : img;
}

function createIsland() {
  const w = 248;
  const h = 36;
  const icon = getAppIcon();
  islandWin = new BrowserWindow({
    width: w,
    height: h,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    focusable: true,
    roundedCorners: false,
    autoHideMenuBar: true,
    icon: icon || undefined,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'island.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  placeTopWindow(islandWin, w, h);
  islandWin.setAlwaysOnTop(true, 'screen-saver');
  islandWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  islandWin.setMenuBarVisibility(false);
  islandWin.setMenu(null);
  islandWin.loadFile(path.join(__dirname, '..', 'renderer', 'island.html'));
  islandWin.once('ready-to-show', () => placeTopWindow(islandWin, 248, 36));
  islandWin.on('closed', () => { islandWin = null; });
}

function syncIslandVisibility() {
  const visible = store.get().islandVisible !== false;
  if (visible) islandWin?.showInactive();
  else islandWin?.hide();
}

function saveSettingsBounds() {
  if (!settingsWin || settingsWin.isDestroyed() || settingsWin.isMaximized()) return;
  const b = settingsWin.getBounds();
  if (!b || b.width < 400 || b.height < 300) return;
  store.set({ windowBounds: { x: b.x, y: b.y, width: b.width, height: b.height } });
}

function scheduleSaveSettingsBounds() {
  if (saveBoundsTimer) clearTimeout(saveBoundsTimer);
  saveBoundsTimer = setTimeout(() => {
    saveBoundsTimer = null;
    try { saveSettingsBounds(); } catch {}
  }, 250);
}

function settingsBounds() {
  const saved = store.get().windowBounds;
  const display = screen.getPrimaryDisplay();
  const work = display.workArea;
  const fallback = {
    width: Math.min(1100, work.width),
    height: Math.min(700, work.height)
  };
  if (!saved || !saved.width || !saved.height) return fallback;
  const width = Math.min(Math.max(saved.width, 900), work.width);
  const height = Math.min(Math.max(saved.height, 550), work.height);
  let x = Number.isFinite(saved.x) ? saved.x : Math.round(work.x + (work.width - width) / 2);
  let y = Number.isFinite(saved.y) ? saved.y : Math.round(work.y + (work.height - height) / 2);
  if (x + 80 > work.x + work.width || y + 80 > work.y + work.height || x + width < work.x + 40) {
    x = Math.round(work.x + (work.width - width) / 2);
    y = Math.round(work.y + (work.height - height) / 2);
  }
  return { x, y, width, height };
}

function createSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show();
    settingsWin.focus();
    return;
  }
  const icon = getAppIcon();
  const bounds = settingsBounds();
  settingsWin = new BrowserWindow({
    ...bounds,
    minWidth: 900,
    minHeight: 550,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#000000',
    title: 'Guard Island',
    icon: icon || undefined,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'settings.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  settingsWin.setMenuBarVisibility(false);
  settingsWin.setMenu(null);
  if (icon) settingsWin.setIcon(icon);
  settingsWin.loadFile(path.join(__dirname, '..', 'renderer', 'settings.html'));
  settingsWin.on('resize', scheduleSaveSettingsBounds);
  settingsWin.on('move', scheduleSaveSettingsBounds);
  settingsWin.on('close', () => {
    try { saveSettingsBounds(); } catch {}
  });
  settingsWin.on('closed', () => { settingsWin = null; });
}

function createPrompt(data) {
  closePrompt();
  promptWin = new BrowserWindow({
    width: 420,
    height: data?.mode === 'quit' ? 300 : 280,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    closable: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'prompt.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  promptWin.setAlwaysOnTop(true, 'screen-saver');
  promptWin.loadFile(path.join(__dirname, '..', 'renderer', 'prompt.html'));
  promptWin.webContents.on('did-finish-load', () => {
    if (promptWin && !promptWin.isDestroyed()) promptWin.webContents.send('prompt-data', data);
  });
  const win = promptWin;
  win.on('closed', () => {
    if (promptWin === win) {
      promptWin = null;
      if (promptKind === 'quit') promptKind = 'process';
    }
  });
}

function closePrompt() {
  if (promptTimer) {
    clearTimeout(promptTimer);
    promptTimer = null;
  }
  const win = promptWin;
  promptWin = null;
  if (win && !win.isDestroyed()) win.close();
}

function requestQuit() {
  if (allowQuit) {
    app.quit();
    return;
  }
  hideTrayMenu();
  const hasPassword = Boolean(store.secretsMeta().hasProcessPassword);
  promptKind = 'quit';
  createPrompt({
    mode: 'quit',
    hasPassword,
    name: hasPassword ? 'Тот же пароль, что на запуск программ' : 'Пароль не задан'
  });
}

function confirmQuit() {
  allowQuit = true;
  promptKind = 'process';
  closePrompt();
  app.quit();
}

function cancelQuitPrompt() {
  promptKind = 'process';
  closePrompt();
  if (pendingProc) {
    const name = pendingProc.name || path.basename(pendingProc.path || '');
    createPrompt({
      name,
      path: pendingProc.path || '',
      pid: pendingProc.pid,
      testMode: isTest()
    });
  }
}

function openFace(mode) {
  if (faceWin && !faceWin.isDestroyed()) {
    faceWin.webContents.send('face-mode', mode);
    return faceWin;
  }
  faceWin = new BrowserWindow({
    width: mode === 'enroll' ? 520 : 320,
    height: mode === 'enroll' ? 620 : 240,
    show: mode === 'enroll',
    frame: mode === 'enroll',
    title: 'Камера Guard Island',
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    icon: getAppIcon() || undefined,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'face.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  faceWin.mode = mode;
  faceWin.setMenu(null);
  faceWin.setMenuBarVisibility(false);
  if (mode !== 'enroll') {
    faceWin.setSkipTaskbar(true);
    faceWin.setPosition(40, 80);
  }
  faceWin.loadFile(path.join(__dirname, '..', 'renderer', 'face.html'));
  faceWin.on('closed', () => { faceWin = null; });
  return faceWin;
}

function appExecutablePath() {
  return process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
}

function applyAutostart(enabled) {
  const exe = appExecutablePath();
  app.setLoginItemSettings({ openAtLogin: Boolean(enabled), path: exe });
  try {
    bridge.setAutostart(Boolean(enabled), exe);
  } catch (e) {
    log.warn('autostart', String(e));
  }
}

function registerHotkey() {
  globalShortcut.unregisterAll();
  const cfg = store.get();
  if (!cfg.hotkeyGuard || !cfg.hotkey) return;
  const accel = cfg.hotkey;
  const ok = globalShortcut.register(accel, () => {
    performAction(cfg.hotkeyAction || 'shutdown', `Горячая клавиша ${accel}`);
  });
  log.info('hotkey', { accel, ok });
  if (!ok) toast('info', `Не удалось занять клавишу ${accel}`);
}

function startUsb() {
  usbPoller?.stop();
  const cfg = store.get();
  if (!cfg.usbGuard) return;
  usbPoller = createUsbPoller((evt) => {
    if (evt.action !== 'arrive') return;
    if (Date.now() - startedAt < 8000) return;
    performAction(cfg.usbAction || 'shutdown', `Новое устройство: ${evt.name}`);
  });
  usbPoller.start();
  if (islandWin && !islandWin.isDestroyed()) {
    try {
      islandWin.hookWindowMessage(0x0219, (wParam) => {
        const wp = Buffer.isBuffer(wParam) ? wParam.readBigUInt64LE(0) : wParam;
        const code = Number(wp);
        if (code === 0x8000) {
          performAction(cfg.usbAction || 'shutdown', 'WM_DEVICECHANGE: устройство подключено');
        }
      });
    } catch (e) {
      log.warn('hookWindowMessage', String(e));
    }
  }
}

function stopUsb() {
  usbPoller?.stop();
}

const { queryPath, listProcesses } = require('./win32');

function fillProc(proc) {
  if (!proc.path) proc.path = queryPath(proc.pid);
  if (!proc.parentName && proc.ppid) {
    const parent = listProcesses().find((p) => p.pid === proc.ppid);
    proc.parentName = parent?.name || '';
    if (parent && !proc.parentPath) proc.parentPath = queryPath(parent.pid);
  }
}

function groupKeyOf(proc) {
  return String(proc.name || path.basename(proc.path || '')).toLowerCase();
}

function takeFrozenGroup(proc) {
  if (!proc) return [];
  const key = groupKeyOf(proc);
  const group = [];
  for (const [pid, p] of frozen) {
    if (groupKeyOf(p) === key) {
      group.push(p);
      frozen.delete(pid);
    }
  }
  if (pendingProc && groupKeyOf(pendingProc) === key) pendingProc = null;
  return group;
}

function showNextPrompt() {
  if (pendingProc) return;
  const n = frozen.values().next();
  if (n.done) return;
  pendingProc = n.value;
  const name = pendingProc.name || path.basename(pendingProc.path || '');
  createPrompt({
    name,
    path: pendingProc.path || '',
    pid: pendingProc.pid,
    testMode: isTest()
  });
}

function handleNewProcess(proc) {
  const cfg = store.get();
  if (!sessionUnlocked) return;
  if (!cfg.processGate) return;
  if (!canAct()) return;
  if (Date.now() - startedAt < 2500) return;
  fillProc(proc);
  const name = proc.name || path.basename(proc.path || '');
  if (sessionAllowedPids.has(proc.pid) || sessionAllowedPids.has(Number(proc.ppid))) return;
  if (shouldIgnoreProcess(proc, cfg.customAllow || [], cfg.processGateMode || 'relaxed')) return;
  const allow = (cfg.allowlist || []).map((x) => String(x).toLowerCase());
  const key = (proc.path || name).toLowerCase();
  const base = name.toLowerCase();
  if (allow.includes(key) || allow.includes(base)) return;
  if (seenPids.has(proc.pid)) return;
  seenPids.add(proc.pid);

  const sameGroup = [...frozen.values()].some((p) => groupKeyOf(p) === groupKeyOf(proc));
  const froze = bridge.suspend(proc.pid);
  proc.frozen = froze;
  if (!froze && !isTest()) {
    bridge.kill(proc.pid);
    proc.killed = true;
  }
  frozen.set(proc.pid, proc);
  if (!sameGroup) showNextPrompt();
}

function denyProcess(why) {
  const proc = pendingProc;
  const group = takeFrozenGroup(proc);
  closePrompt();
  if (!group.length) {
    showNextPrompt();
    return;
  }
  if (isTest()) {
    for (const p of group) bridge.resume(p.pid);
    toast('test', `ТЕСТ: заблокировали бы ${proc.name} (${why})`);
    showNextPrompt();
    return;
  }
  let ok = true;
  for (const p of group) {
    if (!bridge.kill(p.pid)) ok = false;
  }
  toast(ok ? 'alert' : 'info', ok ? `Запуск остановлен: ${proc.name}` : `Не удалось остановить ${proc.name} (нужны права)`);
  showNextPrompt();
}

function allowProcess(always) {
  const proc = pendingProc;
  const group = takeFrozenGroup(proc);
  closePrompt();
  if (!group.length) {
    showNextPrompt();
    return;
  }
  if (always) {
    const cfg = store.get();
    const names = group.map((p) => (p.name || '').toLowerCase()).filter(Boolean);
    const allowlist = Array.from(new Set([...(cfg.allowlist || []), ...names]));
    store.set({ allowlist });
    broadcast();
  }
  for (const p of group) {
    sessionAllowedPids.add(p.pid);
    if (p.killed && p.path) {
      try {
        spawn(p.path, [], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
      } catch (e) {
        log.warn('relaunch', String(e));
      }
    } else {
      bridge.resume(p.pid);
    }
  }
  toast('info', `Разрешено: ${proc.name}`);
  showNextPrompt();
}

function startProcessGate() {
  bridge.offProcess();
  if (!store.get().processGate) return;
  bridge.onProcess((p) => {
    try { handleNewProcess(p); } catch (e) { log.warn('proc', String(e)); }
  });
}

function startFileGuard() {
  fileGuard?.stop();
  if (!store.get().fileAnomaly) return;
  fileGuard.start(store.get());
}

function syncFaceWindow() {
  const cfg = store.get();
  if (cfg.faceGuard && cfg.armed && store.secretsMeta().hasFace) {
    openFace('watch');
  } else if (faceWin && !faceWin.isDestroyed() && faceWin.mode === 'watch') {
    faceWin.close();
  }
}

function startRemoteWatch() {
  if (remoteTimer) clearInterval(remoteTimer);
  remoteTimer = null;
  if (!store.get().remoteWatchdog) return;
  remoteTimer = setInterval(async () => {
    try {
      const s = await tailscaleStatus();
      if (!s.installed) return;
      if (!s.running) await ensureTailscaleUp();
    } catch (e) {
      log.warn('tailscale-watch', String(e));
    }
  }, 60000);
}

function unlockSession() {
  sessionUnlocked = true;
  startedAt = Date.now();
  if (!islandWin || islandWin.isDestroyed()) createIsland();
  applyConfig();
}

async function confirmSettingsAuth({ currentPassword, useHello }) {
  if (useHello) {
    const r = await requestWindowsHello();
    if (r.ok) return true;
    throw new Error(r.message || 'Windows Hello не подтвердил');
  }
  if (!store.secretsMeta().hasAppPin) {
    throw new Error('Сначала задайте пароль настроек');
  }
  if (!store.checkPassword('appPin', currentPassword)) {
    throw new Error('Неверный пароль настроек');
  }
  return true;
}

function applyConfig() {
  const cfg = store.get();
  applyAutostart(cfg.autostart);
  if (!sessionUnlocked) {
    stopUsb();
    bridge.offProcess();
    fileGuard?.stop();
    if (remoteTimer) {
      clearInterval(remoteTimer);
      remoteTimer = null;
    }
    broadcast();
    return;
  }
  registerHotkey();
  if (cfg.usbGuard) startUsb(); else stopUsb();
  startProcessGate();
  startFileGuard();
  startRemoteWatch();
  syncFaceWindow();
  syncIslandVisibility();
  broadcast();
}

function hideTrayMenu() {
  if (trayMenuWin && !trayMenuWin.isDestroyed()) trayMenuWin.hide();
}

function createTrayMenuWindow() {
  if (trayMenuWin && !trayMenuWin.isDestroyed()) return;
  trayMenuWin = new BrowserWindow({
    width: 228,
    height: 236,
    frame: false,
    show: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    resizable: false,
    movable: false,
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'tray.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  trayMenuWin.setMenu(null);
  trayMenuWin.setMenuBarVisibility(false);
  trayMenuWin.loadFile(path.join(__dirname, '..', 'renderer', 'tray.html'));
  trayMenuWin.on('blur', () => hideTrayMenu());
  trayMenuWin.on('closed', () => { trayMenuWin = null; });
}

function showTrayMenu(bounds) {
  createTrayMenuWindow();
  const w = 228;
  const h = 236;
  const display = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y });
  let x = Math.round(bounds.x + bounds.width / 2 - w / 2);
  let y = bounds.y - h - 6;
  if (y < display.workArea.y) y = bounds.y + bounds.height + 6;
  x = Math.min(Math.max(x, display.workArea.x), display.workArea.x + display.workArea.width - w);
  trayMenuWin.setBounds({ x, y, width: w, height: h });
  trayMenuWin.show();
  trayMenuWin.focus();
}

function createTray() {
  const icon = getAppIcon();
  const img = icon ? icon.resize({ width: 16, height: 16 }) : nativeImage.createEmpty();
  tray = new Tray(img);
  tray.setToolTip('Guard Island');
  createTrayMenuWindow();
  tray.on('right-click', (_e, bounds) => showTrayMenu(bounds));
  tray.on('click', () => createSettings());
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const file = fs.createWriteStream(dest);
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        fs.unlink(dest, () => {});
        return downloadFile(res.headers.location, dest).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        return reject(new Error('HTTP ' + res.statusCode));
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', reject);
  });
}

function wireIpc() {
  ipcMain.handle('get-state', () => publicState());
  ipcMain.handle('setup-account', (_e, payload) => {
    store.setupAccount(payload || {});
    unlockSession();
    return publicState();
  });
  ipcMain.handle('login', (_e, { username, password }) => {
    if (!store.checkLogin(username, password)) {
      throw new Error('Неверный логин или пароль');
    }
    unlockSession();
    return publicState();
  });
  ipcMain.handle('set-config', (_e, patch) => {
    requireSession();
    const next = store.set(patch || {});
    applyConfig();
    return next;
  });
  ipcMain.handle('set-password', async (_e, payload) => {
    requireSession();
    const { kind, password, username, currentPassword, useHello } = payload || {};
    await confirmSettingsAuth({ currentPassword, useHello: Boolean(useHello) });
    if (kind === 'username') {
      store.setUsername(username);
    } else {
      store.setPassword(kind, password);
    }
    broadcast();
    return store.secretsMeta();
  });
  ipcMain.handle('windows-hello', async () => requestWindowsHello());
  ipcMain.handle('check-password', (_e, { kind, password }) => store.checkPassword(kind, password));
  ipcMain.handle('panic-lock', () => {
    performAction(isTest() ? 'notify' : 'lock', 'Паника с острова (блокировка, без удаления данных)');
    return true;
  });
  ipcMain.handle('tailscale-status', () => tailscaleStatus());
  ipcMain.handle('tailscale-up', () => ensureTailscaleUp());
  ipcMain.handle('log-path', () => log.file);
  ipcMain.handle('open-enroll', () => {
    requireSession();
    openFace('enroll');
    return true;
  });
  ipcMain.handle('face-mode', (e) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    return w?.mode || 'watch';
  });
  ipcMain.handle('save-face', (_e, arr) => {
    store.setFace(arr);
    broadcast();
    return true;
  });
  ipcMain.handle('get-face', () => store.getFace());
  ipcMain.handle('models-dir', () => modelsDir());
  ipcMain.handle('download-models', async () => {
    const dir = modelsDir();
    fs.mkdirSync(dir, { recursive: true });
    for (const f of MODEL_FILES) {
      const dest = path.join(dir, f);
      if (!fs.existsSync(dest)) {
        await downloadFile(`${MODEL_BASE}/${f}`, dest);
      }
    }
    return dir;
  });
  ipcMain.on('island-resize', (_e, { w, h }) => {
    placeTopWindow(islandWin, w, h);
  });
  ipcMain.on('open-settings', () => createSettings());
  ipcMain.on('hide-island', () => {
    store.set({ islandVisible: false });
    applyConfig();
  });
  ipcMain.on('show-island', () => {
    store.set({ islandVisible: true });
    applyConfig();
    if (islandWin && !islandWin.isDestroyed()) islandWin.webContents.send('island-collapse');
  });
  ipcMain.on('settings-min', () => settingsWin?.minimize());
  ipcMain.on('settings-max', () => {
    if (!settingsWin) return;
    if (settingsWin.isMaximized()) settingsWin.unmaximize();
    else settingsWin.maximize();
  });
  ipcMain.on('settings-close', () => settingsWin?.close());
  ipcMain.on('tray-action', (_e, act) => {
    hideTrayMenu();
    if (act === 'settings') createSettings();
    if (act === 'show') {
      store.set({ islandVisible: true });
      applyConfig();
      if (islandWin && !islandWin.isDestroyed()) islandWin.webContents.send('island-collapse');
    }
    if (act === 'hide') { store.set({ islandVisible: false }); applyConfig(); }
    if (act === 'disarm') { store.set({ armed: false }); applyConfig(); }
    if (act === 'quit') requestQuit();
  });
  ipcMain.on('open-tailscale', () => shell.openExternal('https://tailscale.com/download/windows'));
  ipcMain.on('open-url', (_e, url) => {
    const u = String(url || '');
    if (u.startsWith('https://t.me/') || u.startsWith('https://github.com/')) {
      shell.openExternal(u);
    }
  });
  ipcMain.on('prompt-submit', (_e, password) => {
    if (promptKind === 'quit') {
      if (!store.secretsMeta().hasProcessPassword) {
        cancelQuitPrompt();
        createSettings();
        return;
      }
      const kind = store.whichPassword(password);
      if (kind === 'panic') {
        cancelQuitPrompt();
        performAction('lock', 'Введён пароль паники — блокировка сессии. Данные НЕ удаляются.');
        return;
      }
      if (kind === 'allow' || kind === 'app') {
        confirmQuit();
        return;
      }
      if (promptWin && !promptWin.isDestroyed()) {
        promptWin.webContents.send('prompt-data', {
          mode: 'quit',
          hasPassword: true,
          name: 'Тот же пароль, что на запуск программ',
          error: 'Неверный пароль'
        });
      }
      return;
    }
    const kind = store.whichPassword(password);
    if (kind === 'panic') {
      closePrompt();
      pendingProc = null;
      performAction('lock', 'Введён пароль паники — блокировка сессии. Данные НЕ удаляются.');
      return;
    }
    if (kind === 'allow' || kind === 'app') {
      allowProcess(true);
      return;
    }
    if (promptWin && !promptWin.isDestroyed()) {
      promptWin.webContents.send('prompt-data', {
        ...(pendingProc || {}),
        error: 'Неверный пароль'
      });
    }
  });
  ipcMain.on('prompt-cancel', () => {
    if (promptKind === 'quit') {
      cancelQuitPrompt();
      return;
    }
    denyProcess('отмена');
  });
  ipcMain.on('face-unknown', () => {
    if (Date.now() - lastFaceAlarm < 4000) return;
    lastFaceAlarm = Date.now();
    const cfg = store.get();
    performAction(cfg.faceAction || 'lock', 'Камера: в кадре чужое лицо');
  });
  ipcMain.on('face-owner', () => {});
  ipcMain.on('close-face', () => {
    if (faceWin && !faceWin.isDestroyed()) faceWin.close();
  });
}

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  app.setAppUserModelId('local.guardisland.app');
  store = createStore(app);
  log = createLogger(app);
  bridge = createBridge();
  fileGuard = createFileGuard({
    log,
    onAnomaly: (a) => performAction(store.get().fileAction || 'lock', a.detail)
  });
  startedAt = Date.now();
  wireIpc();
  createTray();
  createSettings();
  powerMonitor.on('shutdown', () => { allowQuit = true; });
  log.info('started', { engine: bridge.engine, userData: app.getPath('userData') });
});

app.on('window-all-closed', (e) => {
  e.preventDefault();
});

app.on('before-quit', (e) => {
  if (allowQuit) return;
  e.preventDefault();
  requestQuit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  stopUsb();
  fileGuard?.stop();
  bridge?.stop();
});
