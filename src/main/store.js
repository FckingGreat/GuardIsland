'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { normalizeAllowlist } = require('./util');

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
  windowBounds: null,
  theme: 'dark'
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

function makeRecoveryKey() {
  const hex = crypto.randomBytes(10).toString('hex').toUpperCase();
  return `${hex.slice(0, 5)}-${hex.slice(5, 10)}-${hex.slice(10, 15)}-${hex.slice(15, 20)}`;
}

function vaultKeyBytes(recoveryKey) {
  return crypto.scryptSync(String(recoveryKey).trim().toUpperCase(), 'guardisland-vault-v1', 32);
}

function encryptVault(plain, recoveryKey) {
  const key = vaultKeyBytes(recoveryKey);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(plain || {}), 'utf8'), cipher.final()]);
  return {
    iv: iv.toString('hex'),
    tag: cipher.getAuthTag().toString('hex'),
    data: data.toString('hex')
  };
}

function decryptVault(blob, recoveryKey) {
  if (!blob || !blob.iv || !blob.tag || !blob.data) {
    throw new Error('Хранилище паролей пусто');
  }
  try {
    const key = vaultKeyBytes(recoveryKey);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(blob.iv, 'hex'));
    decipher.setAuthTag(Buffer.from(blob.tag, 'hex'));
    const out = Buffer.concat([decipher.update(Buffer.from(blob.data, 'hex')), decipher.final()]);
    return JSON.parse(out.toString('utf8'));
  } catch {
    throw new Error('Неверный ключ восстановления');
  }
}

function emptyVault() {
  return {
    username: '',
    loginPassword: '',
    appPin: '',
    processPassword: '',
    panicPassword: ''
  };
}

function createStore(app) {
  const cfgFile = configPath(app);
  const secFile = secretsPath(app);
  let config = { ...DEFAULTS, ...loadJson(cfgFile, {}) };
  if (config.processGateMode !== 'strict') config.processGateMode = 'relaxed';
  config.allowlist = normalizeAllowlist(config.allowlist);
  let secrets = loadJson(secFile, {
    username: '',
    loginPassword: null,
    appPin: null,
    processPassword: null,
    panicPassword: null,
    faceDescriptor: null,
    recoveryHash: null,
    vault: null
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
      if (next.theme && next.theme !== 'light') next.theme = 'dark';
      if (Array.isArray(next.allowlist)) next.allowlist = normalizeAllowlist(next.allowlist);
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
        hasFace: Array.isArray(secrets.faceDescriptor) && secrets.faceDescriptor.length > 0,
        hasRecoveryKey: Boolean(secrets.recoveryHash && secrets.vault)
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
      const recoveryKey = makeRecoveryKey();
      secrets.recoveryHash = hashPassword(recoveryKey);
      secrets.vault = encryptVault({
        ...emptyVault(),
        username: secrets.username,
        loginPassword: String(loginPassword),
        appPin: String(settingsPassword || '')
      }, recoveryKey);
      config.firstRunDone = true;
      persist();
      return recoveryKey;
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
    createRecoveryKey() {
      const recoveryKey = makeRecoveryKey();
      secrets.recoveryHash = hashPassword(recoveryKey);
      let plain = emptyVault();
      plain.username = this.getUsername();
      secrets.vault = encryptVault(plain, recoveryKey);
      persist();
      return recoveryKey;
    },
    putVaultField(recoveryKey, field, value) {
      if (!secrets.recoveryHash || !verifyPassword(String(recoveryKey).trim().toUpperCase(), secrets.recoveryHash)) {
        throw new Error('Неверный ключ восстановления');
      }
      const plain = { ...emptyVault(), ...decryptVault(secrets.vault, recoveryKey) };
      if (field === 'username') plain.username = String(value || '');
      else plain[field] = String(value || '');
      secrets.vault = encryptVault(plain, recoveryKey);
      persist();
    },
    revealVault(recoveryKey) {
      const key = String(recoveryKey || '').trim().toUpperCase();
      if (!secrets.recoveryHash) {
        throw new Error('Ключ ещё не создан');
      }
      if (!verifyPassword(key, secrets.recoveryHash)) {
        throw new Error('Неверный ключ восстановления');
      }
      return { ...emptyVault(), ...decryptVault(secrets.vault, key) };
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
