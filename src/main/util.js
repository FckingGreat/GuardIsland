'use strict';

const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const SYSTEM_NAMES = new Set([
  'system', 'registry', 'smss.exe', 'csrss.exe', 'wininit.exe', 'winlogon.exe',
  'services.exe', 'lsass.exe', 'svchost.exe', 'fontdrvhost.exe', 'dwm.exe',
  'explorer.exe', 'sihost.exe', 'taskhostw.exe', 'runtimebroker.exe',
  'searchhost.exe', 'startmenuexperiencehost.exe', 'shellexperiencehost.exe',
  'applicationframehost.exe', 'systemsettings.exe', 'textinputhost.exe',
  'ctfmon.exe', 'conhost.exe', 'dllhost.exe', 'wmiprvse.exe', 'unsecapp.exe',
  'spoolsv.exe', 'searchindexer.exe', 'securityhealthservice.exe',
  'securityhealthsystray.exe', 'msmpeng.exe', 'nissrv.exe', 'smartscreen.exe',
  'audiodg.exe', 'lsaiso.exe', 'lsm.exe', 'memory compression',
  'secure system', 'idle', 'userinit.exe', 'logonui.exe', 'lockapp.exe',
  'consent.exe', 'trustedinstaller.exe', 'tiworker.exe',
  'taskmgr.exe', 'mmc.exe',
  'openconsole.exe', 'windowsterminal.exe', 'electron.exe', 'guardisland.exe',
  'node.exe', 'nodejs.exe', 'npm.exe', 'npx.exe', 'pnpm.exe', 'yarn.exe', 'bun.exe', 'deno.exe',
  'wsl.exe', 'wslhost.exe', 'wslservice.exe', 'wslrelay.exe', 'wslg.exe', 'wslconfig.exe',
  'vmmem.exe', 'vmmemwsl.exe', 'lxssmanager.exe',
  'git.exe', 'ssh.exe', 'ssh-agent.exe',
  'usoclient.exe', 'usocoreworker.exe', 'mousocoreworker.exe',
  'waasmedicagent.exe', 'wuauclt.exe', 'musnotification.exe', 'musnotifyicon.exe',
  'windowsupdatebox.exe', 'setuphost.exe', 'setupprep.exe', 'sedsvc.exe',
  'microsoftedgeupdate.exe', 'microsoftedgeupdatecore.exe', 'msedge.exe',
  'msedgewebview2.exe', 'onedrive.exe', 'onedrivesetup.exe',
  'officeclicktorun.exe', 'integrator.exe', 'wermgr.exe', 'werfault.exe',
  'compattelrunner.exe', 'deviceenroller.exe', 'mpcmdrun.exe', 'sgrmbroker.exe',
  'backgroundtaskhost.exe', 'searchprotocolhost.exe', 'searchfilterhost.exe',
  'searchapp.exe', 'widgets.exe', 'widgetservice.exe', 'gamebar.exe',
  'gamingservices.exe', 'yourphone.exe', 'phoneexperiencehost.exe',
  'crossdeviceresume.exe', 'systemsettingsbroker.exe', 'userobroker.exe',
  'filecoauth.exe', 'dataexchangehost.exe', 'shellhost.exe', 'sppsvc.exe',
  'clipup.exe', 'usocoreworker.exe', 'musupdatenotifications.exe',
  'windowspackagemanagerserver.exe', 'winget.exe', 'storedesktop.exe',
  'defrag.exe', 'cleanmgr.exe', 'chkdsk.exe', 'fodhelper.exe',
  'computerdefaults.exe', 'launchtm.exe', 'slui.exe', 'slmgr.exe',
  'sihclient.exe', 'usocoreworker.exe', 'waasmediccapsule.exe',
  'microsoft.photos.exe', 'calculatorapp.exe', 'copilot.exe',
  'securityhealthhost.exe', 'securityhealthservice.exe'
].map((s) => s.toLowerCase()));

const INTERPRETERS = new Set([
  'cmd.exe', 'powershell.exe', 'pwsh.exe', 'wscript.exe', 'cscript.exe',
  'mshta.exe', 'msiexec.exe', 'bash.exe', 'python.exe', 'pythonw.exe',
  'hh.exe'
]);

const ALWAYS_ALLOW_NAMES = new Set([
  'wsl.exe', 'wslhost.exe', 'wslservice.exe', 'wslrelay.exe', 'wslg.exe', 'wslconfig.exe',
  'vmmem.exe', 'vmmemwsl.exe', 'lxssmanager.exe',
  'node.exe', 'nodejs.exe', 'npm.exe', 'npx.exe', 'pnpm.exe', 'yarn.exe', 'bun.exe', 'deno.exe',
  'git.exe', 'ssh.exe', 'ssh-agent.exe'
]);

const TRUSTED_PARENTS = new Set([
  'services.exe', 'svchost.exe', 'wininit.exe', 'winlogon.exe',
  'taskeng.exe', 'taskhostw.exe', 'trustedinstaller.exe', 'tiworker.exe',
  'usoclient.exe', 'mousocoreworker.exe', 'wmiprvse.exe'
]);

function isMicrosoftName(name) {
  const n = String(name || '').toLowerCase();
  if (!n) return false;
  if (SYSTEM_NAMES.has(n)) return true;
  if (n.includes('microsoft')) return true;
  if (n.startsWith('msedge')) return true;
  if (n.startsWith('onedrive')) return true;
  if (n.startsWith('office')) return true;
  if (n.includes('windows') && n.endsWith('.exe')) return true;
  if (n.includes('update') && (n.includes('uso') || n.includes('wu') || n.includes('edge'))) return true;
  return false;
}

function normPath(p) {
  return String(p || '').toLowerCase().replace(/\//g, '\\');
}

function isWindowsTree(p) {
  if (!p) return false;
  const n = normPath(p);
  const win = (process.env.SystemRoot || 'C:\\Windows').toLowerCase();
  return n === win || n.startsWith(win + '\\');
}

function isInstalledAppPath(p) {
  if (!p) return false;
  const n = normPath(p);
  return (
    n.includes('\\program files\\') ||
    n.includes('\\program files (x86)\\') ||
    n.includes('\\appdata\\local\\programs\\') ||
    n.includes('\\windowsapps\\')
  );
}

function isSuspiciousPath(p) {
  if (!p) return false;
  const n = normPath(p);
  const hot = [
    '\\downloads\\',
    '\\temp\\',
    '\\tmp\\',
    '\\recycle.bin\\',
    '\\appdata\\local\\temp\\',
    '\\appdata\\local\\tmp\\'
  ];
  if (hot.some((h) => n.includes(h))) return true;
  const desk = path.join(os.homedir(), 'Desktop').toLowerCase();
  if (n.startsWith(desk + '\\')) {
    const rel = n.slice(desk.length + 1);
    if (rel && !rel.includes('\\')) return true;
  }
  const sysDrive = (process.env.SystemDrive || 'C:').toLowerCase();
  if (/^[a-z]:\\/.test(n) && n.slice(0, 2) !== sysDrive) return true;
  return false;
}

function isSystemPath(p) {
  if (!p) return false;
  if (isWindowsTree(p)) return true;
  const n = normPath(p);
  const markers = [
    '\\windowsdefender\\',
    '\\windowsapps\\',
    '\\program files\\windowsapps\\',
    '\\program files\\microsoft ',
    '\\program files\\microsoft\\',
    '\\program files (x86)\\microsoft',
    '\\programdata\\microsoft\\',
    '\\appdata\\local\\microsoft\\',
    '\\appdata\\local\\packages\\microsoft.',
    '\\edgeupdate\\',
    '\\$windows.~bt\\',
    '\\$windows.~ws\\',
    '\\systemroot\\'
  ];
  return markers.some((m) => n.includes(m));
}

function isOwnProcess(p, name) {
  const n = String(name || '').toLowerCase();
  if (n === 'guardisland.exe' || n === 'electron.exe' || n === 'guard island.exe') return true;
  if (!p) return false;
  const low = p.toLowerCase();
  return low.includes('guardisland') || low.includes(`${path.sep}electron${path.sep}`);
}

function isInterpreter(name) {
  return INTERPRETERS.has(String(name || '').toLowerCase());
}

function parentIsTrusted(parentName, parentPath, ppid) {
  if (ppid && Number(ppid) === process.pid) return true;
  const n = String(parentName || '').toLowerCase();
  if (TRUSTED_PARENTS.has(n)) return true;
  if (isInterpreter(n)) return false;
  if (parentPath && isSystemPath(parentPath) && !isInterpreter(n)) return true;
  return false;
}

function shouldIgnoreProcess(proc, extraAllow, mode = 'relaxed') {
  const n = String(proc.name || '').toLowerCase();
  const exePath = proc.path || '';
  if (isOwnProcess(exePath, n)) return true;
  if (proc.ppid && Number(proc.ppid) === process.pid) return true;
  if (ALWAYS_ALLOW_NAMES.has(n)) return true;
  if (isWindowsTree(exePath)) return true;
  if (isMicrosoftName(n)) return true;
  if (isSystemPath(exePath)) return true;
  const extras = extraAllow || [];
  const exe = path.basename(exePath || n).toLowerCase();
  if (extras.some((x) => String(x).toLowerCase() === exe || String(x).toLowerCase() === n)) {
    return true;
  }
  const relaxed = mode !== 'strict';
  if (relaxed) {
    if (!exePath) return true;
    if (isInstalledAppPath(exePath)) return true;
    if (!isSuspiciousPath(exePath)) return true;
    return false;
  }
  if (isInterpreter(n)) {
    return parentIsTrusted(proc.parentName, proc.parentPath, proc.ppid);
  }
  return false;
}

function userWatchRoots() {
  const home = os.homedir();
  const appdata = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  return [
    path.join(home, 'Desktop'),
    path.join(home, 'Documents'),
    path.join(home, 'Downloads'),
    path.join(appdata, 'Telegram Desktop')
  ];
}

function looksLikeTelegramExport(filePath) {
  const n = filePath.replace(/\//g, '\\').toLowerCase();
  if (n.includes('\\tdata\\')) return true;
  if (/chatexport/i.test(n)) return true;
  if (/telegram desktop\\tdata/i.test(n)) return true;
  if (/result\.html$/i.test(n) && /chatexport/i.test(n)) return true;
  return false;
}

function normalizeAllowlist(list) {
  const out = [];
  const seen = new Set();
  for (const x of list || []) {
    const item = typeof x === 'string'
      ? { name: x, path: '' }
      : { name: String(x?.name || path.basename(x?.path || '')), path: String(x?.path || '') };
    item.name = String(item.name || '').trim();
    item.path = String(item.path || '').trim();
    if (!item.name && !item.path) continue;
    if (!item.name && item.path) item.name = path.basename(item.path);
    const key = (item.path || item.name).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function isOnAllowlist(proc, list) {
  const name = String(proc?.name || path.basename(proc?.path || '')).toLowerCase();
  const pth = String(proc?.path || '').toLowerCase();
  for (const e of normalizeAllowlist(list)) {
    const en = e.name.toLowerCase();
    const ep = e.path.toLowerCase();
    if (en && en === name) return true;
    if (ep && pth && ep === pth) return true;
    if (en && pth && (pth.endsWith('\\' + en) || pth.endsWith('/' + en))) return true;
  }
  return false;
}

function runCaptured(cmd, args, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { windowsHide: true });
    let out = '';
    const t = setTimeout(() => {
      try { child.kill(); } catch {}
      resolve(out);
    }, timeoutMs);
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.on('close', () => {
      clearTimeout(t);
      resolve(out);
    });
    child.on('error', () => {
      clearTimeout(t);
      resolve('');
    });
  });
}

module.exports = {
  SYSTEM_NAMES,
  INTERPRETERS,
  ALWAYS_ALLOW_NAMES,
  shouldIgnoreProcess,
  isInterpreter,
  isWindowsTree,
  userWatchRoots,
  looksLikeTelegramExport,
  runCaptured,
  normalizeAllowlist,
  isOnAllowlist
};
