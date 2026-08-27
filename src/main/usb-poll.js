'use strict';

const fs = require('fs');
const path = require('path');
const si = require('systeminformation');

function createUsbPoller(onChange, intervalMs = 1600) {
  let prev = new Set();
  let timer = null;
  let first = true;

  async function tick() {
    try {
      const list = await si.usb();
      const ids = new Set(
        (list || []).map((d) => String(d.id || d.deviceId || `${d.vendor}:${d.type}:${d.name}`))
      );
      if (!first) {
        for (const id of ids) {
          if (!prev.has(id)) {
            const device = (list || []).find((d) => String(d.id || d.deviceId || `${d.vendor}:${d.type}:${d.name}`) === id);
            onChange({
              action: 'arrive',
              kind: 'usb',
              name: device?.name || device?.type || 'USB device',
              id
            });
          }
        }
      }
      prev = ids;
      first = false;
    } catch {
      // ignore
    }
  }

  function start() {
    stop();
    first = true;
    prev = new Set();
    tick();
    timer = setInterval(tick, intervalMs);
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { start, stop };
}

function listRemovableLetters() {
  const out = [];
  for (let i = 68; i <= 90; i++) {
    const letter = String.fromCharCode(i) + ':\\';
    try {
      if (fs.existsSync(letter)) out.push(letter);
    } catch {}
  }
  return out;
}

module.exports = { createUsbPoller, listRemovableLetters };
