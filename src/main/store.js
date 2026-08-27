'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULTS = {
  armed: false,
  testMode: true,
  islandVisible: true,
  autostart: false,
  faceGuard: false,
  faceAction: 'lock',
  hotkeyGuard: false,
  hotkey: 'Insert',
  hotkeyAction: 'shutdown',
  usbGuard: false,
  usbAction: 'shutdown',
  processGate: false,
  processGateMode: 'relaxed',
  processGraceMs: 4000,
  processDefault: 'prompt',
  fileAnomaly: false,
  fileBurstCount: 80,
  fileBurstWindowMs: 15000,
  fileAction: 'lock',
  remoteWatchdog: false,
  allowlist: [],
  customAllow: [],
  firstRunDone: false,
  windowBounds: null
};

const PASSWORD_KINDS = ['appPin', 'processPassword', 'panicPassword', 'loginPassword'];

function userDataDir(app) {
  return app.getPath('userData');
}

function configPath(app) {
  return path.join(userDataDir(app), 'config.json');
}

function secretsPath(app) {
  return path.join(userDataDir(app), 'secrets.json');
}

function loadJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function saveJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function hashPassword(password, salt) {
  const s = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, s, 64).toString('hex');
  return { salt: s, hash };
}

function verifyPassword(password, rec) {
  if (!rec || !rec.hash || !rec.salt) return false;
  const { hash } = hashPassword(password, rec.salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(rec.hash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function normalizeUsername(name) {
  return String(name || '').trim();
}

function assertUsername(name) {
  const u = normalizeUsername(name);
  if (u.length < 2 || u.length > 32) {
    throw new Error('Логин: от 2 до 32 символов');
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(u)) {
    throw new Error('Логин: только латиница, цифры, точка, _ и -');
  }
  return u;
}

function assertPassword(password) {
  if (!password || String(password).length < 4) {
    throw new Error('Пароль слишком короткий (минимум 4 символа)');
  }
  return String(password);
}

function createStore(app) {
  const cfgFile = configPath(app);
  const secFile = secretsPath(app);
  let config = { ...DEFAULTS, ...loadJson(cfgFile, {}) };
  if (config.processGateMode !== 'strict') config.processGateMode = 'relaxed';
  let secrets = loadJson(secFile, {
    username: '',
    loginPassword: null,
    appPin: null,
    processPassword: null,
    panicPassword: null,
    faceDescriptor: null
  });

  function persist() {
    saveJson(cfgFile, config);
    saveJson(secFile, secrets);
  }

  return {
    get() {
      return { ...config };
    },
    set(patch) {
      const next = { ...patch };
      if (next.processGateMode && next.processGateMode !== 'strict') {
        next.processGateMode = 'relaxed';
      }
      config = { ...config, ...next };
      persist();
      return this.get();
    },
    hasAccount() {
      return Boolean(normalizeUsername(secrets.username) && secrets.loginPassword);
    },
    getUsername() {
      return normalizeUsername(secrets.username);
    },
    secretsMeta() {
      return {
        hasAppPin: Boolean(secrets.appPin),
        hasProcessPassword: Boolean(secrets.processPassword),
        hasPanicPassword: Boolean(secrets.panicPassword),
        hasLoginPassword: Boolean(secrets.loginPassword),
        hasAccount: Boolean(normalizeUsername(secrets.username) && secrets.loginPassword),
        username: normalizeUsername(secrets.username),
        hasFace: Array.isArray(secrets.faceDescriptor) && secrets.faceDescriptor.length > 0
      };
    },
    setupAccount({ username, loginPassword, settingsPassword }) {
      if (this.hasAccount()) {
        throw new Error('Аккаунт уже создан');
      }
      secrets.username = assertUsername(username);
      secrets.loginPassword = hashPassword(assertPassword(loginPassword));
      if (settingsPassword) {
        secrets.appPin = hashPassword(assertPassword(settingsPassword));
      } else if (!secrets.appPin) {
        throw new Error('Задайте пароль настроек');
      }
      config.firstRunDone = true;
      persist();
    },
    checkLogin(username, password) {
      if (!this.hasAccount()) return false;
      if (normalizeUsername(username).toLowerCase() !== this.getUsername().toLowerCase()) {
        return false;
      }
      return verifyPassword(String(password || ''), secrets.loginPassword);
    },
    setUsername(username) {
      secrets.username = assertUsername(username);
      persist();
    },
    setPassword(kind, password) {
      if (!PASSWORD_KINDS.includes(kind)) {
        throw new Error('unknown password kind');
      }
      secrets[kind] = hashPassword(assertPassword(password));
      persist();
    },
    checkPassword(kind, password) {
      return verifyPassword(String(password || ''), secrets[kind]);
    },
    whichPassword(password) {
      const p = String(password || '');
      if (secrets.panicPassword && verifyPassword(p, secrets.panicPassword)) return 'panic';
      if (secrets.processPassword && verifyPassword(p, secrets.processPassword)) return 'allow';
      if (secrets.appPin && verifyPassword(p, secrets.appPin)) return 'app';
      return null;
    },
    setFace(descriptor) {
      secrets.faceDescriptor = descriptor;
      persist();
    },
    getFace() {
      return secrets.faceDescriptor;
    }
  };
}

module.exports = { createStore, DEFAULTS };
