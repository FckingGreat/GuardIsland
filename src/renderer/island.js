const island = document.getElementById('island');
const pill = document.getElementById('pill');
const chip = document.getElementById('chip');
const toastEl = document.getElementById('toast');
const armBtn = document.getElementById('armBtn');
const sub = document.getElementById('sub');
let expanded = false;
let state = null;

function sizes() {
  return expanded ? { w: 460, h: 118 } : { w: 236, h: 36 };
}

function resize() {
  const { w, h } = sizes();
  window.guard.resize(w, h);
}

function collapse() {
  expanded = false;
  island.classList.add('collapsed');
  resize();
}

function expand() {
  expanded = true;
  island.classList.remove('collapsed');
  resize();
}

function apply(s) {
  state = s;
  document.documentElement.setAttribute('data-theme', s.theme === 'light' ? 'light' : 'dark');
  island.classList.toggle('collapsed', !expanded);
  const armed = s.armed;
  const test = s.testMode !== false;
  chip.textContent = !armed ? 'выкл' : test ? 'тест' : 'вкл';
  sub.textContent = !armed
    ? 'Охрана выключена'
    : test
      ? 'Тест: ПК не гасится'
      : 'Охрана включена';
  armBtn.textContent = armed ? 'Снять охрану' : 'Включить охрану';
  resize();
}

pill.addEventListener('click', expand);
document.getElementById('homeBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  collapse();
});
armBtn.addEventListener('click', async (e) => {
  e.stopPropagation();
  await window.guard.setArmed(!(state && state.armed));
});
document.getElementById('lockBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  window.guard.panicLock();
});
document.getElementById('setBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  window.guard.openSettings();
});
document.getElementById('hideBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  window.guard.hideIsland();
});

window.guard.onState(apply);
window.guard.onCollapse(() => collapse());
window.guard.onToast((t) => {
  toastEl.textContent = t.text || 'Нет событий';
});
window.guard.getState().then(apply);
