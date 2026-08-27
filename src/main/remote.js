'use strict';

const fs = require('fs');
const path = require('path');
const { runCaptured } = require('./util');

const TAILSCALE_CANDIDATES = [
  'C:\\Program Files\\Tailscale\\tailscale.exe',
  'C:\\Program Files (x86)\\Tailscale\\tailscale.exe'
];

function findTailscale() {
  return TAILSCALE_CANDIDATES.find((p) => fs.existsSync(p)) || null;
}

async function tailscaleStatus() {
  const exe = findTailscale();
  if (!exe) {
    return {
      installed: false,
      running: false,
      ip: null,
      dns: null,
      online: false,
      raw: null
    };
  }
  const out = await runCaptured(exe, ['status', '--json'], 6000);
  if (!out.trim()) {
    return { installed: true, running: false, ip: null, dns: null, online: false, raw: null };
  }
  try {
    const json = JSON.parse(out);
    const self = json.Self || {};
    const ips = self.TailscaleIPs || [];
    return {
      installed: true,
      running: true,
      ip: ips[0] || null,
      dns: self.DNSName || json.MagicDNSSuffix || null,
      online: Boolean(self.Online),
      hostname: self.HostName || null,
      raw: { backend: json.BackendState, peerCount: Object.keys(json.Peer || {}).length }
    };
  } catch {
    return { installed: true, running: true, ip: null, dns: null, online: false, raw: out.slice(0, 200) };
  }
}

async function ensureTailscaleUp() {
  const exe = findTailscale();
  if (!exe) return { ok: false, error: 'Tailscale не установлен' };
  await runCaptured(exe, ['up'], 15000);
  return { ok: true };
}

module.exports = { findTailscale, tailscaleStatus, ensureTailscaleUp };
