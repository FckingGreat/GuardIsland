'use strict';

const path = require('path');
const win32 = require('./win32');
const { startWmiProcessWatch } = require('./process-watch');

let native = null;
try {
  native = require(path.join(__dirname, '..', '..', 'native', 'build', 'Release', 'guard_native.node'));
} catch {
  try {
    native = require(path.join(__dirname, '..', '..', 'build', 'Release', 'guard_native.node'));
  } catch {
    native = null;
  }
}

function createBridge() {
  const engine = native ? 'native' : 'koffi';
  let stopProc = null;

  return {
    engine,
    lock() {
      if (native?.lock) return native.lock();
      return win32.lockWorkstation();
    },
    shutdown() {
      if (native?.shutdown) return native.shutdown(true);
      return win32.shutdownComputer();
    },
    kill(pid) {
      if (native?.kill) return native.kill(pid);
      return win32.killPid(pid);
    },
    suspend(pid) {
      return win32.suspendPid(pid);
    },
    resume(pid) {
      return win32.resumePid(pid);
    },
    setAutostart(enabled, exePath) {
      if (native?.setAutostart) return native.setAutostart(enabled, exePath, '');
      return win32.setAutostart(enabled, exePath);
    },
    isAutostart() {
      if (native?.isAutostart) return native.isAutostart();
      return win32.isAutostart();
    },
    onProcess(cb) {
      const stops = [];
      try {
        stops.push(startWmiProcessWatch(cb));
      } catch {}
      if (native?.onProcess) native.onProcess(cb);
      stops.push(win32.startProcessPoll(cb, 500));
      stopProc = () => {
        for (const s of stops) {
          try { s(); } catch {}
        }
        if (native?.offProcess) native.offProcess();
      };
    },
    offProcess() {
      if (stopProc) {
        stopProc();
        stopProc = null;
      }
    },
    onUsb(cb) {
      if (native?.onUsb) native.onUsb(cb);
    },
    offUsb() {
      if (native?.offUsb) native.offUsb();
    },
    onHotkey(vk, mods, cb) {
      if (native?.onHotkey) native.onHotkey(vk, mods, cb);
    },
    offHotkey() {
      if (native?.offHotkey) native.offHotkey();
    },
    start() {
      if (native?.start) native.start();
    },
    stop() {
      this.offProcess();
      if (native?.stop) native.stop();
    }
  };
}

module.exports = { createBridge };
