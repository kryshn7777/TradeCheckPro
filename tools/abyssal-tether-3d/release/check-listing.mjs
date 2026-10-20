#!/usr/bin/env node
// Checks the store listing pack: text limits (name 30, short 150, long 4000) and the art / screenshot files
// (exact pixel sizes, PNG colour type: covers 24-bit, logo 32-bit with alpha).   node tools/abyssal-tether-3d/release/check-listing.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const STORE = path.join(REPO, 'docs', 'abyssal-tether-3d', 'store');
let bad = 0;
const ok = (c, m) => {
  console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`);
  if (!c) bad++;
};

const md = fs.readFileSync(path.join(STORE, 'LISTING.md'), 'utf8');
const blocks = [...md.matchAll(/```\n([\s\S]*?)```/g)].map((m) => m[1].trim());
const [short, long] = blocks;
const title = /\| Title \| `([^`]+)`/.exec(md)[1];
ok(title.length <= 30 && title === 'Abyssal Tether', `title "${title}" (${title.length}/30)`);
ok(short.length <= 150, `short description ${short.length}/150`);
ok(long.length <= 4000, `long description ${long.length}/4000`);
ok(/Intense/.test(md) && /Teens and Adults/.test(md), 'comfort Intense and age group Teens and Adults are stated');
ok(!/blood|gore/i.test(short), 'short description has no gore wording');

function png(file) {
  const b = fs.readFileSync(file);
  if (b.readUInt32BE(0) !== 0x89504e47) return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), colorType: b[25], bytes: b.length };
}
const want = [
  ['art/hero-3000x900.png', 3000, 900, [2]],
  ['art/cover-landscape-2560x1440.png', 2560, 1440, [2]],
  ['art/cover-square-1440x1440.png', 1440, 1440, [2]],
  ['art/cover-portrait-1008x1440.png', 1008, 1440, [2]],
  ['art/mini-1080x360.png', 1080, 360, [2]],
  ['art/icon-1024.png', 1024, 1024, [2]],
  ['art/icon-512.png', 512, 512, [2]],
  ['art/logo-transparent.png', 2880, 1440, [6]],
  ['screenshots/hero-2880x1600.png', 2880, 1600, [2, 6]],
];
for (let i = 1; i <= 10; i++) want.push([`screenshots/shot-${String(i).padStart(2, '0')}.png`, 1920, 1080, [2, 6]]);
let total = 0;
for (const [f, w, h, types] of want) {
  const p = path.join(STORE, f);
  if (!fs.existsSync(p)) {
    ok(false, `${f} missing`);
    continue;
  }
  const i = png(p);
  total += i ? i.bytes : 0;
  ok(i && i.w === w && i.h === h && types.includes(i.colorType), `${f} ${i ? `${i.w}x${i.h} colour type ${i.colorType}` : 'not a PNG'} (want ${w}x${h})`);
}
console.log(`art + screenshots: ${(total / 1048576).toFixed(1)} MB`);
process.exit(bad ? 1 : 0);
