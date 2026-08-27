'use strict';

const fs = require('fs');

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

function createUsbPoller(onChange, intervalMs = 4000) {
  let prev = new Set();
  let timer = null;
  let first = true;

  function tick() {
    try {
      const ids = new Set(listRemovableLetters());
      if (!first) {
        for (const id of ids) {
          if (!prev.has(id)) {
            onChange({
              action: 'arrive',
              kind: 'usb',
              name: `Съёмный диск ${id}`,
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
    timer.unref?.();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { start, stop };
}

module.exports = { createUsbPoller, listRemovableLetters };
