// Generates all PWA / favicon raster assets from public/logo.svg using sharp.
// Run: node apps/frontend/scripts/gen-icons.mjs
import sharp from 'sharp';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pub = join(root, 'public');
const iconsDir = join(pub, 'icons');

const svg = await readFile(join(pub, 'logo.svg'));

async function png(size) {
  return sharp(svg, { density: 384 }).resize(size, size).png().toBuffer();
}

async function writePng(path, size) {
  await writeFile(path, await png(size));
  console.log('wrote', path);
}

// Build a multi-image .ico that embeds PNG payloads (16/32/48).
async function writeIco(path, sizes) {
  const images = await Promise.all(sizes.map((s) => png(s)));
  const count = images.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(count, 4);

  const entries = [];
  let offset = 6 + count * 16;
  for (let i = 0; i < count; i++) {
    const e = Buffer.alloc(16);
    const s = sizes[i];
    e.writeUInt8(s >= 256 ? 0 : s, 0); // width
    e.writeUInt8(s >= 256 ? 0 : s, 1); // height
    e.writeUInt8(0, 2); // palette
    e.writeUInt8(0, 3); // reserved
    e.writeUInt16LE(1, 4); // color planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(images[i].length, 8);
    e.writeUInt32LE(offset, 12);
    offset += images[i].length;
    entries.push(e);
  }
  await writeFile(path, Buffer.concat([header, ...entries, ...images]));
  console.log('wrote', path, `(${count} sizes)`);
}

await mkdir(iconsDir, { recursive: true });
await writePng(join(pub, 'favicon-16x16.png'), 16);
await writePng(join(pub, 'favicon-32x32.png'), 32);
await writePng(join(pub, 'favicon-48x48.png'), 48);
await writePng(join(pub, 'apple-touch-icon.png'), 180);
await writePng(join(iconsDir, 'icon-192x192.png'), 192);
await writePng(join(iconsDir, 'icon-512x512.png'), 512);
await writeIco(join(pub, 'favicon.ico'), [16, 32, 48]);
console.log('done');
