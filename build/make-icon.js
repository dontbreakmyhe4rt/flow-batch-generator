/*
 * Tao build/icon.ico ma khong can thu vien ngoai nao.
 *
 * File .ico = header + danh sach muc + cac anh noi duoi. Tu Windows Vista,
 * .ico chap nhan anh PNG ben trong, nen ta tu ma hoa PNG bang zlib co san
 * cua Node roi ghep lai.
 *
 * Chay:  npm run icon
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZES = [16, 24, 32, 48, 64, 128, 256];

/* ---------- bang mau, lay theo palette cua app ---------- */
const BG_TOP = [0x23, 0x2b, 0x3d];
const BG_BOT = [0x14, 0x16, 0x1a];
const ACCENT = [0x6e, 0xa8, 0xfe];
const ACCENT_DIM = [0x3f, 0x6d, 0xb8];
const SPARK = [0xff, 0xd8, 0x6e];

/** Ve mot khung anh RGBA cho kich thuoc n x n. */
function draw(n) {
  const px = Buffer.alloc(n * n * 4);

  const put = (x, y, [r, g, b], a = 255) => {
    if (x < 0 || y < 0 || x >= n || y >= n) return;
    const i = (y * n + x) * 4;
    const inv = 255 - a;
    px[i] = (px[i] * inv + r * a) / 255;
    px[i + 1] = (px[i + 1] * inv + g * a) / 255;
    px[i + 2] = (px[i + 2] * inv + b * a) / 255;
    px[i + 3] = Math.max(px[i + 3], a);
  };

  // nen bo goc, chuyen mau doc
  const r = n * 0.18;
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      const dx = Math.min(x, n - 1 - x);
      const dy = Math.min(y, n - 1 - y);
      let a = 255;
      if (dx < r && dy < r) {
        const d = Math.hypot(r - dx, r - dy);
        if (d > r) continue;
        if (d > r - 1.2) a = Math.round((255 * (r - d)) / 1.2);
      }
      const t = y / (n - 1);
      const col = [0, 1, 2].map((c) => Math.round(BG_TOP[c] * (1 - t) + BG_BOT[c] * t));
      put(x, y, col, a);
    }
  }

  // khung anh
  const m = Math.max(1, Math.round(n * 0.02));
  const x0 = Math.round(n * 0.20);
  const x1 = Math.round(n * 0.80);
  const y0 = Math.round(n * 0.26);
  const y1 = Math.round(n * 0.70);

  for (let x = x0; x <= x1; x += 1) {
    for (let d = 0; d < m; d += 1) { put(x, y0 + d, ACCENT); put(x, y1 - d, ACCENT); }
  }
  for (let y = y0; y <= y1; y += 1) {
    for (let d = 0; d < m; d += 1) { put(x0 + d, y, ACCENT); put(x1 - d, y, ACCENT); }
  }

  // hai ngon "nui" trong khung
  const baseY = y1 - m;
  const peak = (cx, cy, half, col) => {
    for (let x = cx - half; x <= cx + half; x += 1) {
      const h = Math.round((1 - Math.abs(x - cx) / half) * (baseY - cy));
      for (let y = baseY - h; y < baseY; y += 1) put(x, y, col);
    }
  };
  peak(Math.round(n * 0.40), Math.round(n * 0.44), Math.round(n * 0.14), ACCENT_DIM);
  peak(Math.round(n * 0.58), Math.round(n * 0.38), Math.round(n * 0.16), ACCENT);

  // tia sang goc tren phai - y noi "tao anh bang AI"
  const sx = Math.round(n * 0.735);
  const sy = Math.round(n * 0.235);
  const arm = Math.max(2, Math.round(n * 0.10));
  for (let d = -arm; d <= arm; d += 1) {
    const fade = 1 - Math.abs(d) / (arm + 1);
    const a = Math.round(255 * fade * fade);
    const w = Math.max(1, Math.round(m * fade));
    for (let k = 0; k < w; k += 1) {
      put(sx + d, sy + k, SPARK, a);
      put(sx + k, sy + d, SPARK, a);
    }
  }

  return px;
}

/* ---------- ma hoa PNG ---------- */
const crcTable = (() => {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function toPng(px, n) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(n, 0);
  ihdr.writeUInt32BE(n, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA

  const stride = n * 4 + 1;
  const raw = Buffer.alloc(stride * n);
  for (let y = 0; y < n; y += 1) {
    raw[y * stride] = 0; // filter: none
    px.copy(raw, y * stride + 1, y * n * 4, (y + 1) * n * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------- ghep .ico ---------- */
const pngs = SIZES.map((n) => ({ n, buf: toPng(draw(n), n) }));

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2); // 1 = icon
header.writeUInt16LE(pngs.length, 4);

let offset = 6 + pngs.length * 16;
const entries = [];
for (const { n, buf } of pngs) {
  const e = Buffer.alloc(16);
  e[0] = n >= 256 ? 0 : n; // 0 nghia la 256
  e[1] = n >= 256 ? 0 : n;
  e[4] = 1; // so mat phang mau
  e.writeUInt16LE(32, 6); // bit moi diem
  e.writeUInt32LE(buf.length, 8);
  e.writeUInt32LE(offset, 12);
  entries.push(e);
  offset += buf.length;
}

const out = Buffer.concat([header, ...entries, ...pngs.map((p) => p.buf)]);
fs.writeFileSync(path.join(__dirname, 'icon.ico'), out);
fs.writeFileSync(path.join(__dirname, 'icon-preview.png'), pngs[pngs.length - 1].buf);

console.log(`build/icon.ico  ${out.length} bytes  ·  ${SIZES.join(', ')} px`);
