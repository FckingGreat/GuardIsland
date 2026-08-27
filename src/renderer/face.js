const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const hint = document.getElementById('hint');
const actions = document.getElementById('actions');
let mode = 'watch';
let samples = [];
let owner = null;
let unknownStreak = 0;

function dist(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return Math.sqrt(s);
}

async function boot() {
  mode = await window.guard.mode();
  actions.hidden = mode !== 'enroll';
  hint.textContent = 'Загрузка моделей распознавания…';
  const uri = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model';
  await faceapi.nets.tinyFaceDetector.loadFromUri(uri);
  await faceapi.nets.faceLandmark68Net.loadFromUri(uri);
  await faceapi.nets.faceRecognitionNet.loadFromUri(uri);
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
  video.srcObject = stream;
  await video.play();
  owner = await window.guard.getDescriptor();
  hint.textContent = mode === 'enroll'
    ? 'Снимите 4–6 кадров своего лица при разном свете.'
    : 'Камера следит за кадрами.';
  loop();
}

async function descriptorFromVideo() {
  const det = await faceapi
    .detectAllFaces(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 }))
    .withFaceLandmarks()
    .withFaceDescriptors();
  return det;
}

async function loop() {
  try {
    const det = await descriptorFromVideo();
    if (mode === 'watch') {
      if (!owner || !det.length) {
        unknownStreak = 0;
      } else {
        const hasOwner = det.some((d) => dist(Array.from(d.descriptor), owner) < 0.48);
        const hasOther = det.some((d) => dist(Array.from(d.descriptor), owner) >= 0.48);
        if (hasOther && !hasOwner) unknownStreak += 1;
        else if (hasOther && hasOwner) unknownStreak += 1;
        else unknownStreak = 0;
        if (unknownStreak >= 3) {
          unknownStreak = 0;
          window.guard.unknownFace({ count: det.length });
        }
        if (hasOwner) window.guard.ownerSeen();
      }
    }
  } catch (e) {
    hint.textContent = String(e.message || e);
  }
  setTimeout(loop, mode === 'enroll' ? 600 : 700);
}

document.getElementById('shot')?.addEventListener('click', async () => {
  const det = await descriptorFromVideo();
  if (!det.length) {
    hint.textContent = 'Лицо не найдено, посмотрите в камеру.';
    return;
  }
  samples.push(Array.from(det[0].descriptor));
  hint.textContent = `Кадров: ${samples.length}. Нужно минимум 4.`;
});

document.getElementById('save')?.addEventListener('click', async () => {
  if (samples.length < 4) {
    hint.textContent = 'Сначала снимите хотя бы 4 кадра.';
    return;
  }
  const dim = samples[0].length;
  const avg = new Array(dim).fill(0);
  for (const s of samples) for (let i = 0; i < dim; i++) avg[i] += s[i];
  for (let i = 0; i < dim; i++) avg[i] /= samples.length;
  await window.guard.saveDescriptor(avg);
  hint.textContent = 'Лицо сохранено только локально.';
});

document.getElementById('close')?.addEventListener('click', () => window.guard.close());

boot().catch((e) => { hint.textContent = 'Камера/модели: ' + (e.message || e); });
