const nav = document.getElementById('nav');
let state = null;
let authWaiter = null;

const GUARD_KEYS = new Set([
  'armed', 'testMode', 'usbGuard', 'usbAction', 'processGate', 'processGateMode',
  'faceGuard', 'faceAction', 'hotkeyGuard', 'hotkey', 'hotkeyAction',
  'fileAnomaly', 'fileBurstCount', 'fileAction', 'remoteWatchdog', 'autostart', 'allowlist'
]);

nav.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  nav.querySelectorAll('button').forEach((b) => {
    const on = b === btn;
    b.classList.toggle('active', on);
    b.classList.toggle('a', on);
  });
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.id === btn.dataset.tab));
});

function errMsg(e) {
  let s = String((e && e.message) || e || 'Ошибка');
  s = s.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/i, '');
  s = s.replace(/^Error:\s*/i, '');
  return s || 'Ошибка';
}

function showGate(s) {
  const gate = document.getElementById('gate');
  const login = document.getElementById('gateLogin');
  const setup = document.getElementById('gateSetup');
  const unlocked = Boolean(s.session && s.session.unlocked);
  gate.hidden = unlocked;
  if (unlocked) return;
  const needSetup = Boolean(s.session && s.session.needsSetup);
  login.hidden = needSetup;
  setup.hidden = !needSetup;
  if (!needSetup && s.session.username) {
    const u = document.getElementById('loginUser');
    if (u && !u.value) u.value = s.session.username;
  }
}

function applyTheme(s) {
  const theme = s && s.theme === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', theme);
  const btn = document.getElementById('themeBtn');
  if (btn) {
    btn.textContent = theme === 'light' ? '☾' : '☀';
    btn.title = theme === 'light' ? 'Тёмная тема' : 'Светлая тема';
  }
}

function bind(s) {
  state = s;
  applyTheme(s);
  showGate(s);
  if (!s.session || !s.session.unlocked) return;
  document.querySelectorAll('[data-cfg]').forEach((el) => {
    const key = el.dataset.cfg;
    let val = s[key];
    if (el.dataset.scale) val = Math.round((val || 0) / Number(el.dataset.scale));
    if (el.type === 'checkbox') el.checked = Boolean(val);
    else el.value = val ?? '';
  });
  const userField = document.getElementById('loginUserField');
  if (userField && document.activeElement !== userField) {
    userField.value = s.session.username || '';
  }
  document.getElementById('faceHint').textContent = s.secrets.hasFace
    ? 'Лицо записано на этом ПК.'
    : 'Лицо ещё не записано.';
  document.querySelectorAll('[data-flag]').forEach((el) => {
    const on = Boolean(s.secrets[el.dataset.flag]);
    el.textContent = on ? 'задан' : 'не задан';
    el.style.color = on ? '#e67e22' : '#a1a1aa';
  });
  document.getElementById('meta').textContent =
    `Движок: ${s.engine}`;
  document.getElementById('logPath').textContent = s.logFile || '';
  const armHead = document.getElementById('armHead');
  armHead.textContent = s.armed ? 'Снять охрану' : 'Включить охрану';
  document.getElementById('cd').classList.toggle('on', Boolean(s.armed) && s.testMode === false);
  document.getElementById('cl').textContent = !s.armed ? 'Охрана выкл' : s.testMode ? 'Тест' : 'Охрана вкл';
  const rs = document.getElementById('recoveryStatus');
  if (rs) {
    rs.textContent = s.secrets.hasRecoveryKey
      ? 'Ключ уже создан. Новый ключ заменит старый. После замены заново сохраните пароли, чтобы они попали в хранилище.'
      : 'Ключа ещё нет. Создайте его один раз и сохраните в надёжном месте.';
  }
  renderAllowList(s);
}

function esc(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function renderAllowList(s) {
  const box = document.getElementById('allowList');
  if (!box) return;
  const items = Array.isArray(s.allowlist) ? s.allowlist : [];
  if (!items.length) {
    box.innerHTML = '<p class="hint">Пока пусто. Когда вылезет запрос пароля — «Внести в лист и разрешить».</p>';
    return;
  }
  box.innerHTML = items.map((e, i) => {
    const name = typeof e === 'string' ? e : (e.name || '');
    const pth = typeof e === 'string' ? '' : (e.path || '');
    return `<div class="row-card allow-item">
      <div><b>${esc(name)}</b><span>${esc(pth)}</span></div>
      <button type="button" class="btn" data-del-allow="${i}">Удалить</button>
    </div>`;
  }).join('');
}

function askAuth(why) {
  const modal = document.getElementById('authModal');
  const pin = document.getElementById('authPin');
  const err = document.getElementById('authErr');
  document.getElementById('authWhy').textContent = why || 'Подтвердите изменение';
  err.textContent = '';
  pin.value = '';
  modal.hidden = false;
  pin.focus();
  return new Promise((resolve) => {
    if (authWaiter) authWaiter(null);
    authWaiter = resolve;
  }).finally(() => {
    modal.hidden = true;
    pin.value = '';
    err.textContent = '';
    authWaiter = null;
  });
}

function finishAuth(value) {
  const fn = authWaiter;
  authWaiter = null;
  if (fn) fn(value);
}

document.getElementById('authOk').addEventListener('click', () => {
  const pin = document.getElementById('authPin').value;
  if (!pin) {
    document.getElementById('authErr').textContent = 'Введите пароль настроек';
    return;
  }
  finishAuth({ currentPassword: pin, useHello: false });
});
document.getElementById('authHello').addEventListener('click', () => {
  finishAuth({ currentPassword: '', useHello: true });
});
document.getElementById('authCancel').addEventListener('click', () => finishAuth(null));
document.getElementById('authPin').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('authOk').click();
  if (e.key === 'Escape') document.getElementById('authCancel').click();
});

function showKey(recoveryKey) {
  const modal = document.getElementById('keyModal');
  const input = document.getElementById('keyValue');
  input.value = recoveryKey || '';
  modal.hidden = false;
  input.focus();
  input.select();
}

document.getElementById('keyOk').addEventListener('click', () => {
  document.getElementById('keyModal').hidden = true;
});
document.getElementById('keyCopy').addEventListener('click', async () => {
  const v = document.getElementById('keyValue').value;
  try {
    await navigator.clipboard.writeText(v);
    document.getElementById('keyCopy').textContent = 'Скопировано';
  } catch {
    document.getElementById('keyValue').select();
  }
});

function readCfgValue(el) {
  let value = el.type === 'checkbox' ? el.checked : el.value;
  if (el.type === 'number') value = Number(value);
  if (el.dataset.scale) value = Number(value) * Number(el.dataset.scale);
  return value;
}

function restoreCfg(el, prev) {
  let v = prev;
  if (el.dataset.scale) v = Math.round((v || 0) / Number(el.dataset.scale));
  if (el.type === 'checkbox') el.checked = Boolean(v);
  else el.value = v ?? '';
}

document.getElementById('allowList')?.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-del-allow]');
  if (!btn || !state) return;
  const idx = Number(btn.dataset.delAllow);
  const auth = await askAuth('Чтобы изменить список разрешённых программ');
  if (!auth) return;
  const next = (state.allowlist || []).filter((_, i) => i !== idx);
  try {
    await window.guard.setConfig({ allowlist: next, ...auth });
  } catch (err) {
    document.getElementById('authErr').textContent = errMsg(err);
  }
});

document.querySelectorAll('[data-cfg]').forEach((el) => {
  el.addEventListener('change', async () => {
    const key = el.dataset.cfg;
    const value = readCfgValue(el);
    const prev = state ? state[key] : undefined;
    if (!GUARD_KEYS.has(key)) {
      try {
        await window.guard.setConfig({ [key]: value });
      } catch (err) {
        restoreCfg(el, prev);
      }
      return;
    }
    const auth = await askAuth('Чтобы изменить этот параметр');
    if (!auth) {
      restoreCfg(el, prev);
      return;
    }
    try {
      await window.guard.setConfig({ [key]: value, ...auth });
    } catch (err) {
      restoreCfg(el, prev);
      document.getElementById('authModal').hidden = false;
      document.getElementById('authErr').textContent = errMsg(err);
      setTimeout(() => {
        document.getElementById('authModal').hidden = true;
        document.getElementById('authErr').textContent = '';
      }, 1400);
    }
  });
});

async function saveSecret(form, useHello) {
  const kind = form.dataset.kind;
  let auth = { currentPassword: '', useHello: Boolean(useHello) };
  if (!useHello) {
    const asked = await askAuth('Чтобы сохранить этот пароль');
    if (!asked) return;
    auth = asked;
  }
  const payload = { kind, ...auth };
  if (kind === 'username') {
    payload.username = document.getElementById('loginUserField').value;
  } else {
    const input = form.querySelector('input[type="password"]');
    payload.password = input ? input.value : '';
  }
  try {
    await window.guard.setPassword(payload);
    form.querySelectorAll('input[type="password"]').forEach((i) => { i.value = ''; });
  } catch (err) {
    const modal = document.getElementById('authModal');
    modal.hidden = false;
    document.getElementById('authErr').textContent = errMsg(err);
    await new Promise((r) => setTimeout(r, 1400));
    modal.hidden = true;
    document.getElementById('authErr').textContent = '';
  }
}

document.querySelectorAll('form[data-kind]').forEach((form) => {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveSecret(form, false);
  });
  const helloBtn = form.querySelector('[data-hello]');
  if (helloBtn) {
    helloBtn.addEventListener('click', async () => {
      await saveSecret(form, true);
    });
  }
});

document.getElementById('recoveryCreate').addEventListener('click', async () => {
  const auth = await askAuth('Чтобы создать ключ восстановления');
  if (!auth) return;
  try {
    const r = await window.guard.createRecoveryKey(auth);
    if (r && r.recoveryKey) showKey(r.recoveryKey);
  } catch (err) {
    document.getElementById('authModal').hidden = false;
    document.getElementById('authErr').textContent = errMsg(err);
    await new Promise((r) => setTimeout(r, 1400));
    document.getElementById('authModal').hidden = true;
    document.getElementById('authErr').textContent = '';
  }
});

document.getElementById('recoveryReveal').addEventListener('click', () => {
  document.getElementById('revealErr').textContent = '';
  document.getElementById('revealKey').value = '';
  document.getElementById('revealModal').hidden = false;
  document.getElementById('revealKey').focus();
});

document.getElementById('revealCancel').addEventListener('click', () => {
  document.getElementById('revealModal').hidden = true;
});
document.getElementById('revealOk').addEventListener('click', async () => {
  const key = document.getElementById('revealKey').value.trim();
  const err = document.getElementById('revealErr');
  err.textContent = '';
  if (!key) {
    err.textContent = 'Вставьте ключ';
    return;
  }
  try {
    const vault = await window.guard.revealVault(key);
    document.getElementById('revealModal').hidden = true;
    const box = document.getElementById('vaultBox');
    const labels = {
      username: 'Логин',
      loginPassword: 'Пароль входа',
      appPin: 'Пароль настроек',
      processPassword: 'Пароль запуска и выхода',
      panicPassword: 'Пароль паники'
    };
    box.hidden = false;
    box.textContent = Object.keys(labels).map((k) => {
      const v = vault && vault[k];
      return `${labels[k]}: ${v ? v : '—'}`;
    }).join('\n');
  } catch (e) {
    err.textContent = errMsg(e);
  }
});
document.getElementById('revealKey').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('revealOk').click();
});

document.getElementById('enrollBtn').addEventListener('click', () => window.guard.enrollFace());

async function refreshTs() {
  const box = document.getElementById('remoteBox');
  box.textContent = '…';
  const s = await window.guard.tailscale();
  if (!s.installed) {
    box.textContent = 'Tailscale не найден. Установите с официального сайта и войдите в свой аккаунт.';
    return;
  }
  box.textContent = [
    `Установлен: да`,
    `Запущен: ${s.running ? 'да' : 'нет'}`,
    `Online: ${s.online ? 'да' : 'нет'}`,
    `Tailscale IP: ${s.ip || '—'}`,
    `DNS: ${s.dns || '—'}`,
    `Имя: ${s.hostname || '—'}`
  ].join('\n');
}
document.getElementById('tsRefresh').addEventListener('click', refreshTs);
document.getElementById('tsUp').addEventListener('click', async () => {
  await window.guard.tailscaleUp();
  refreshTs();
});
document.getElementById('tsSite').addEventListener('click', () => window.guard.openTailscaleSite());
document.getElementById('armHead').addEventListener('click', async () => {
  const next = !(state && state.armed);
  const auth = await askAuth(next ? 'Чтобы включить охрану' : 'Чтобы снять охрану');
  if (!auth) return;
  try {
    await window.guard.setConfig({ armed: next, ...auth });
  } catch (err) {
    document.getElementById('authModal').hidden = false;
    document.getElementById('authErr').textContent = errMsg(err);
    await new Promise((r) => setTimeout(r, 1400));
    document.getElementById('authModal').hidden = true;
    document.getElementById('authErr').textContent = '';
  }
});
document.getElementById('hideIslandBtn').addEventListener('click', () => {
  window.guard.setConfig({ islandVisible: false }).catch(() => {});
});
document.getElementById('tgLink').addEventListener('click', (e) => {
  e.preventDefault();
  window.guard.openUrl('https://t.me/fcking_great_bot');
});
document.querySelectorAll('a[href^="https://t.me/"]').forEach((a) => {
  a.addEventListener('click', (e) => {
    e.preventDefault();
    window.guard.openUrl(a.href);
  });
});
document.getElementById('themeBtn').addEventListener('click', () => {
  const next = (state && state.theme === 'light') ? 'dark' : 'light';
  window.guard.setTheme(next).then(bind).catch(() => {});
});
document.getElementById('minBtn').addEventListener('click', () => window.guard.minimize());
document.getElementById('maxBtn').addEventListener('click', () => window.guard.maximize());
document.getElementById('closeBtn').addEventListener('click', () => window.guard.closeWindow());

document.getElementById('loginBtn').addEventListener('click', async () => {
  const err = document.getElementById('loginErr');
  err.textContent = '';
  try {
    const s = await window.guard.login(
      document.getElementById('loginUser').value,
      document.getElementById('loginPass').value
    );
    document.getElementById('loginPass').value = '';
    bind(s);
    refreshTs();
  } catch (e) {
    err.textContent = errMsg(e);
  }
});
document.getElementById('loginPass').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('loginBtn').click();
});

document.getElementById('setupBtn').addEventListener('click', async () => {
  const err = document.getElementById('setupErr');
  err.textContent = '';
  const login = document.getElementById('setupLogin').value;
  const pin = document.getElementById('setupPin').value;
  if (login !== document.getElementById('setupLogin2').value) {
    err.textContent = 'Пароли входа не совпадают';
    return;
  }
  if (pin !== document.getElementById('setupPin2').value) {
    err.textContent = 'Пароли настроек не совпадают';
    return;
  }
  try {
    const s = await window.guard.setupAccount({
      username: document.getElementById('setupUser').value,
      loginPassword: login,
      settingsPassword: pin
    });
    bind(s);
    refreshTs();
    if (s.recoveryKey) showKey(s.recoveryKey);
  } catch (e) {
    err.textContent = errMsg(e);
  }
});

window.guard.onState(bind);
window.guard.getState().then((s) => {
  bind(s);
  if (s.session && s.session.unlocked) refreshTs();
});
