'use strict';

const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const mainPid = Number(process.argv[2]);
const exe = process.argv[3];
const userData = process.argv[4];
const lockOnDeath = process.argv[5] === '1';
const cleanFile = path.join(userData || '', 'clean-exit');

function alive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function tick() {
  if (alive(mainPid)) return;
  if (cleanFile && fs.existsSync(cleanFile)) process.exit(0);
  if (lockOnDeath) {
    try {
      execFileSync('rundll32.exe', ['user32.dll,LockWorkStation'], { windowsHide: true, timeout: 4000 });
    } catch {}
  }
  if (exe) {
    try {
      const child = spawn(exe, [], { detached: true, stdio: 'ignore', windowsHide: false });
      child.unref();
    } catch {}
  }
  process.exit(0);
}

setInterval(tick, 1500);
tick();
