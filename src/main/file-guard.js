'use strict';

const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');
const { userWatchRoots, looksLikeTelegramExport } = require('./util');

function createFileGuard({ log, onAnomaly }) {
  let watcher = null;
  let events = [];
  let telegramHits = [];

  function prune(now, windowMs) {
    events = events.filter((e) => now - e.t < windowMs);
    telegramHits = telegramHits.filter((e) => now - e.t < 60000);
  }

  function start(cfg) {
    stop();
    const roots = userWatchRoots().filter((p) => {
      try {
        return fs.existsSync(p);
      } catch {
        return false;
      }
    });
    if (!roots.length) return;
    watcher = chokidar.watch(roots, {
      ignoreInitial: true,
      persistent: true,
      depth: 6,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 }
    });
    watcher.on('add', (file) => {
      const now = Date.now();
      let size = 0;
      try { size = fs.statSync(file).size; } catch {}
      events.push({ t: now, file, size });
      prune(now, cfg.fileBurstWindowMs || 15000);

      if (looksLikeTelegramExport(file)) {
        telegramHits.push({ t: now, file });
        const uniqueExports = new Set(
          telegramHits.map((h) => path.dirname(h.file).toLowerCase())
        );
        if (uniqueExports.size >= 2) {
          onAnomaly({
            type: 'telegram-export',
            detail: `Обнаружен массовый экспорт Telegram (${uniqueExports.size} папок)`
          });
          telegramHits = [];
          return;
        }
      }

      const count = events.length;
      const bytes = events.reduce((s, e) => s + e.size, 0);
      if (count >= (cfg.fileBurstCount || 80)) {
        onAnomaly({
          type: 'file-burst',
          detail: `Массовая выгрузка: ${count} файлов за ${(cfg.fileBurstWindowMs || 15000) / 1000}с`
        });
        events = [];
        return;
      }
      if (bytes >= 400 * 1024 * 1024 && count >= 10) {
        onAnomaly({
          type: 'file-volume',
          detail: `Большой объём копирования: ${Math.round(bytes / 1024 / 1024)} МБ`
        });
        events = [];
      }
    });
    watcher.on('error', (err) => log.warn('file-watch', String(err)));
    log.info('file-guard on', { roots });
  }

  function stop() {
    if (watcher) {
      watcher.close().catch(() => {});
      watcher = null;
    }
    events = [];
    telegramHits = [];
  }

  return { start, stop };
}

module.exports = { createFileGuard };
