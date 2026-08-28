'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const exe = process.argv[3];
const userData = process.argv[4] || '';
const heartbeatFile = path.join(userData, 'heartbeat');
const cleanFile = path.join(userData, 'clean-exit');
const relaunchFile = path.join(userData, 'watchdog-relaunch');

function heartbeatFresh() {
  try {
    const age = Date.now() - fs.statSync(heartbeatFile).mtimeMs;
    return age >= 0 && age < 15000;
  } catch {
    return false;
  }
}

function recentlyRelaunched() {
  try {
    const t = Number(fs.readFileSync(relaunchFile, 'utf8'));
    return Number.isFinite(t) && Date.now() - t < 45000;
  } catch {
    return false;
  }
}

function tick() {
  if (cleanFile && fs.existsSync(cleanFile)) process.exit(0);
  if (heartbeatFresh()) return;
  if (recentlyRelaunched()) process.exit(0);
  const base = path.basename(String(exe || '')).toLowerCase();
  if (!exe || base === 'electron.exe' || base === 'node.exe') process.exit(0);
  try { fs.writeFileSync(relaunchFile, String(Date.now())); } catch {}
  try {
    const child = spawn(exe, [], { detached: true, stdio: 'ignore', windowsHide: false });
    child.unref();
  } catch {}
  process.exit(0);
}

setInterval(tick, 2000);
