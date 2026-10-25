/**
 * 生成扩展图标（16/32/48/128）。纯 Node 实现，不引入图形库。
 * 用法：node scripts/make-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = fileURLToPath(new URL('../extension/icons/', import.meta.url));
const SIZES = [16, 32, 48, 128];
const SS = 4;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const hex = (value) => [
  parseInt(value.slice(1, 3), 16),
  parseInt(value.slice(3, 5), 16),
  parseInt(value.slice(5, 7), 16),
];

function insideRoundedRect(x, y, size, radius) {
  const inset = 0.5;
  const left = inset;
  const right = size - inset;
  if (x < left || x > right || y < left || y > right) return false;

  const r = radius;
  const cx = Math.min(Math.max(x, left + r), right - r);
  const cy = Math.min(Math.max(y, left + r), right - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function ringAlpha(x, y, size, outer, inner) {
  const dx = x - size / 2;
  const dy = y - size / 2;
  const dist = Math.hypot(dx, dy);
  if (dist > outer) return 0;
  return dist < inner ? 0 : 1;
}

/** 超采样绘制，返回 RGBA Buffer */
function draw(size) {
  const big = size * SS;
  const pixels = new Float32Array(big * big * 4);

  const radius = big * 0.235;
  const [bgR, bgG, bgB] = hex('#191d25');
  const [acR, acG, acB] = hex('#f5a524');
  const [hiR, hiG, hiB] = hex('#ffe0a3');

  for (let y = 0; y < big; y += 1) {
    for (let x = 0; x < big; x += 1) {
      const index = (y * big + x) * 4;
      if (!insideRoundedRect(x, y, big, radius)) continue;

      let r = bgR;
      let g = bgG;
      let b = bgB;

      const alpha = ringAlpha(x, y, big, big * 0.335, big * 0.175);
      if (alpha > 0) {
        const t = Math.min(1, Math.max(0, (x / big + y / big) / 2));
        r = hiR * (1 - t) + acR * t;
        g = hiG * (1 - t) + acG * t;
        b = hiB * (1 - t) + acB * t;
      }

      const dotDist = Math.hypot(x - big * 0.755, y - big * 0.755);
      if (dotDist <= big * 0.075) {
        r = acR;
        g = acG;
        b = acB;
      }

      pixels[index] = r;
      pixels[index + 1] = g;
      pixels[index + 2] = b;
      pixels[index + 3] = 255;
    }
  }

  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const index = ((y * SS + sy) * big + (x * SS + sx)) * 4;
          const alpha = pixels[index + 3] / 255;
          r += pixels[index] * alpha;
          g += pixels[index + 1] * alpha;
          b += pixels[index + 2] * alpha;
          a += alpha;
        }
      }
      const samples = SS * SS;
      const outIndex = (y * size + x) * 4;
      if (a === 0) continue;
      out[outIndex] = Math.round(r / a);
      out[outIndex + 1] = Math.round(g / a);
      out[outIndex + 2] = Math.round(b / a);
      out[outIndex + 3] = Math.round((a / samples) * 255);
    }
  }

  return out;
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  const png = encodePng(size, size, draw(size));
  writeFileSync(join(OUT_DIR, `icon${size}.png`), png);
  console.log(`icons/icon${size}.png  ${png.length} bytes`);
}
