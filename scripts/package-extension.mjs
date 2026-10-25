// 把 extension/ 打成可直接安装的 zip。纯 Node，不依赖 zip 命令或第三方库。
// 产物根目录就是 manifest.json，解压后能直接「加载已解压的扩展程序」。
import { readFileSync, writeFileSync, readdirSync, mkdirSync, statSync } from 'node:fs';
import { join, relative, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC = join(ROOT, 'extension');
const manifest = JSON.parse(readFileSync(join(SRC, 'manifest.json'), 'utf8'));

// 固定时间戳，让同样的源码打出同样的字节，便于校验发布产物
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (10 << 5) | 25;

const CRC_TABLE = new Int32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[i] = c;
}

function crc32(buf) {
  let c = -1;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const files = walk(SRC)
  .map((full) => ({ full, name: relative(SRC, full).split(sep).join('/') }))
  .sort((a, b) => (a.name < b.name ? -1 : 1));

const locals = [];
const centrals = [];
let offset = 0;

for (const { full, name } of files) {
  const raw = readFileSync(full);
  const deflated = deflateRawSync(raw, { level: 9 });
  const stored = deflated.length >= raw.length;
  const body = stored ? raw : deflated;
  const nameBuf = Buffer.from(name, 'utf8');
  const crc = crc32(raw);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6); // 文件名是 UTF-8
  local.writeUInt16LE(stored ? 0 : 8, 8);
  local.writeUInt16LE(DOS_TIME, 10);
  local.writeUInt16LE(DOS_DATE, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(body.length, 18);
  local.writeUInt32LE(raw.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  local.writeUInt16LE(0, 28);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(stored ? 0 : 8, 10);
  central.writeUInt16LE(DOS_TIME, 12);
  central.writeUInt16LE(DOS_DATE, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(body.length, 20);
  central.writeUInt32LE(raw.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt32LE(0o644 << 16, 38); // 外部属性：普通文件
  central.writeUInt32LE(offset, 42);

  locals.push(local, nameBuf, body);
  centrals.push(central, nameBuf);
  offset += local.length + nameBuf.length + body.length;
}

const centralBuf = Buffer.concat(centrals);
const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0);
eocd.writeUInt16LE(files.length, 8);
eocd.writeUInt16LE(files.length, 10);
eocd.writeUInt32LE(centralBuf.length, 12);
eocd.writeUInt32LE(offset, 16);

const zip = Buffer.concat([...locals, centralBuf, eocd]);
const outDir = join(ROOT, 'dist');
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, `leadlens-extension-${manifest.version}.zip`);
writeFileSync(outFile, zip);

console.log(`${files.length} 个文件 → ${relative(ROOT, outFile)} (${(zip.length / 1024).toFixed(1)} KB)`);
