// Generates the toolbar icons (PNG) without external dependencies.
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

function roundedRect(x, y, x0, y0, x1, y1, r) {
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r && x >= x0 && x <= x1 && y >= y0 && y <= y1;
}

// Shapes in a 0..1 coordinate space, painted in order.
const shapes = [
  { color: [122, 75, 31], test: (x, y) => roundedRect(x, y, 0.02, 0.02, 0.98, 0.98, 0.2) },
  { color: [251, 250, 247], test: (x, y) => roundedRect(x, y, 0.2, 0.18, 0.8, 0.82, 0.06) },
  { color: [255, 205, 80], test: (x, y) => roundedRect(x, y, 0.28, 0.3, 0.72, 0.44, 0.02) },
  { color: [60, 52, 44], test: (x, y) => roundedRect(x, y, 0.28, 0.52, 0.72, 0.58, 0.02) },
  { color: [150, 140, 128], test: (x, y) => roundedRect(x, y, 0.28, 0.66, 0.6, 0.72, 0.02) },
];

function png(size) {
  const ss = 4;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0;
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++)
        for (let sx = 0; sx < ss; sx++) {
          const x = (px + (sx + 0.5) / ss) / size;
          const y = (py + (sy + 0.5) / ss) / size;
          let col = null;
          for (const s of shapes) if (s.test(x, y)) col = s.color;
          if (col) { r += col[0]; g += col[1]; b += col[2]; a += 255; }
        }
      const n = ss * ss;
      const covered = a / 255;
      const o = py * (size * 4 + 1) + 1 + px * 4;
      raw[o] = covered ? Math.round(r / covered) : 0;
      raw[o + 1] = covered ? Math.round(g / covered) : 0;
      raw[o + 2] = covered ? Math.round(b / covered) : 0;
      raw[o + 3] = Math.round(a / n);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

mkdirSync("public/icons", { recursive: true });
for (const size of [16, 32, 48, 128]) writeFileSync(`public/icons/icon${size}.png`, png(size));
console.log("icons written");
