import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
await mkdir('dist/renderer', { recursive: true });
await mkdir('dist/assets', { recursive: true });
for (const file of ['index.html', 'styles.css'])
  await copyFile(`src/renderer/${file}`, `dist/renderer/${file}`);
function crc(bytes) {
  let value = 0xffffffff;
  for (const b of bytes) {
    value ^= b;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type),
    length = Buffer.alloc(4),
    checksum = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  checksum.writeUInt32BE(crc(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}
function segment(x, y, ax, ay, bx, by) {
  const t = Math.max(
    0,
    Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)),
  );
  return Math.hypot(x - ax - t * (bx - ax), y - ay - t * (by - ay));
}
function png(size, appIcon = false) {
  const rows = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let coverage = 0;
      for (let sy = 0; sy < 4; sy++)
        for (let sx = 0; sx < 4; sx++) {
          const px = ((x + (sx + 0.5) / 4) / size) * 18,
            py = ((y + (sy + 0.5) / 4) / size) * 18;
          const ring = Math.abs(Math.hypot(px - 9, py - 9) - 6.3) < 0.9;
          const tick =
            segment(px, py, 5.8, 9.1, 8, 11.3) < 0.85 || segment(px, py, 8, 11.3, 12.3, 6.8) < 0.85;
          if (ring || tick) coverage++;
        }
      const at = y * (1 + size * 4) + 1 + x * 4;
      if (appIcon) {
        const inset = size * 0.04,
          radius = size * 0.21;
        const dx = Math.max(inset + radius - x, 0, x - (size - inset - radius)),
          dy = Math.max(inset + radius - y, 0, y - (size - inset - radius));
        const inside = Math.hypot(dx, dy) <= radius;
        const a = coverage / 16;
        rows[at] = Math.round(23 * (1 - a) + 224 * a);
        rows[at + 1] = Math.round(62 * (1 - a) + 244 * a);
        rows[at + 2] = Math.round(48 * (1 - a) + 206 * a);
        rows[at + 3] = inside ? 255 : 0;
      } else {
        rows[at] = 0;
        rows[at + 1] = 0;
        rows[at + 2] = 0;
        rows[at + 3] = Math.round((coverage / 16) * 255);
      }
    }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
await writeFile('dist/assets/trayTemplate.png', png(18));
await writeFile('dist/assets/trayTemplate@2x.png', png(36));
await writeFile('dist/assets/app.png', png(1024, true));
const appPng = png(1024, true);
const icnsHeader = Buffer.alloc(8),
  icnsChunk = Buffer.alloc(8);
icnsHeader.write('icns');
icnsHeader.writeUInt32BE(16 + appPng.length, 4);
icnsChunk.write('ic10');
icnsChunk.writeUInt32BE(8 + appPng.length, 4);
await writeFile('dist/assets/app.icns', Buffer.concat([icnsHeader, icnsChunk, appPng]));
