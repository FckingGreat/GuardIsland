'use strict';

const fs = require('fs');
const path = require('path');

function createLogger(app) {
  const file = path.join(app.getPath('userData'), 'guard.log');
  fs.mkdirSync(path.dirname(file), { recursive: true });

  function write(level, msg, extra) {
    const line = JSON.stringify({
      t: new Date().toISOString(),
      level,
      msg,
      extra: extra || null
    });
    fs.appendFile(file, line + '\n', () => {});
    console.log(`[GuardIsland ${level}] ${msg}`, extra || '');
  }

  return {
    file,
    info: (m, e) => write('info', m, e),
    warn: (m, e) => write('warn', m, e),
    alert: (m, e) => write('alert', m, e)
  };
}

module.exports = { createLogger };
