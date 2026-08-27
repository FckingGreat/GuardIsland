'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crc32 = require('zlib').crc32 || null;

function crc(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const t = Buffer.from(type);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.concat([t, data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(crcBuf), 0);
  return Buffer.concat([len, t, data, c]);
}

const S = 256;
const cx = (S - 1) / 2;
const cy = (S - 1) / 2;
const R = S / 2 - 1.5;
const islandY = Math.round(S * 0.58);
const radius = 22;
const raw = Buffer.alloc(S * (1 + S * 4));

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function insideCircle(x, y) {
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= R * R;
}

function inIsland(x, y) {
  if (y < islandY) return false;
  const localY = y - islandY;
  if (localY >= radius) return true;
  if (x >= radius && x < S - radius) return true;
  const lx = x < radius ? x - radius : x - (S - radius);
  const ly = localY - radius;
  return lx * lx + ly * ly <= radius * radius;
}

for (let y = 0; y < S; y++) {
  const row = y * (1 + S * 4);
  raw[row] = 0;
  for (let x = 0; x < S; x++) {
    const i = row + 1 + x * 4;
    if (!insideCircle(x, y)) {
      raw[i] = 0; raw[i + 1] = 0; raw[i + 2] = 0; raw[i + 3] = 0;
      continue;
    }
    if (inIsland(x, y)) {
      raw[i] = 10; raw[i + 1] = 10; raw[i + 2] = 10; raw[i + 3] = 255;
      if (Math.abs(y - (islandY + 11)) <= 1 && x > 14 && x < S - 14) {
        raw[i] = 255; raw[i + 1] = 210; raw[i + 2] = 150; raw[i + 3] = 255;
      }
      continue;
    }
    const t = Math.min(1, Math.max(0, y / (S * 0.72)));
    raw[i] = Math.round(lerp(230, 255, t));
    raw[i + 1] = Math.round(lerp(126, 186, t));
    raw[i + 2] = Math.round(lerp(34, 110, t));
    raw[i + 3] = 255;
  }
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8;
ihdr[9] = 6;
const idat = zlib.deflateSync(raw, { level: 9 });
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', idat),
  chunk('IEND', Buffer.alloc(0))
]);

const assets = path.join(__dirname, '..', 'assets');
const renderer = path.join(__dirname, '..', 'src', 'renderer');
fs.mkdirSync(assets, { recursive: true });
const dest = path.join(assets, 'logo.png');
fs.writeFileSync(dest, png);
fs.writeFileSync(path.join(renderer, 'logo.png'), png);

const icoHeader = Buffer.alloc(6);
icoHeader.writeUInt16LE(0, 0);
icoHeader.writeUInt16LE(1, 2);
icoHeader.writeUInt16LE(1, 4);
const icoEntry = Buffer.alloc(16);
icoEntry[0] = 0;
icoEntry[1] = 0;
icoEntry.writeUInt16LE(1, 4);
icoEntry.writeUInt16LE(32, 6);
icoEntry.writeUInt32LE(png.length, 8);
icoEntry.writeUInt32LE(22, 12);
const ico = Buffer.concat([icoHeader, icoEntry, png]);
const icoDest = path.join(assets, 'logo.ico');
fs.writeFileSync(icoDest, ico);
console.log(dest, png.length);
console.log(icoDest, ico.length);
