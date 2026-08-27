const nav = document.getElementById('nav');
let state = null;

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

function bind(s) {
  state = s;
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
}

document.querySelectorAll('[data-cfg]').forEach((el) => {
  const ev = el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'change';
  el.addEventListener(ev, () => {
    const key = el.dataset.cfg;
    let value = el.type === 'checkbox' ? el.checked : el.value;
    if (el.type === 'number') value = Number(value);
    if (el.dataset.scale) value = Number(value) * Number(el.dataset.scale);
    window.guard.setConfig({ [key]: value });
  });
});

async function saveSecret(form, useHello) {
  const kind = form.dataset.kind;
  const confirm = form.querySelector('[data-confirm]');
  const payload = {
    kind,
    currentPassword: confirm ? confirm.value : '',
    useHello: Boolean(useHello)
  };
  if (kind === 'username') {
    payload.username = document.getElementById('loginUserField').value;
  } else {
    const input = form.querySelector('input:not([data-confirm])');
    payload.password = input.value;
  }
  await window.guard.setPassword(payload);
  form.querySelectorAll('input[type="password"]').forEach((i) => { i.value = ''; });
}

document.querySelectorAll('form[data-kind]').forEach((form) => {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await saveSecret(form, false);
    } catch (err) {
      alert(err.message || String(err));
    }
  });
  const helloBtn = form.querySelector('[data-hello]');
  if (helloBtn) {
    helloBtn.addEventListener('click', async () => {
      try {
        await saveSecret(form, true);
      } catch (err) {
        alert(err.message || String(err));
      }
    });
  }
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
document.getElementById('armHead').addEventListener('click', () => {
  window.guard.setConfig({ armed: !(state && state.armed) });
});
document.getElementById('hideIslandBtn').addEventListener('click', () => {
  window.guard.setConfig({ islandVisible: false });
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
    err.textContent = e.message || String(e);
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
  } catch (e) {
    err.textContent = e.message || String(e);
  }
});

window.guard.onState(bind);
window.guard.getState().then((s) => {
  bind(s);
  if (s.session && s.session.unlocked) refreshTs();
});
