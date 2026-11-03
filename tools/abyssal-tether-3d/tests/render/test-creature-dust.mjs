// The creature's leg dust (render/creatureDust.js), Node, no GPU: the chase boost makes a creature COMING AT YOU throw a bigger cloud from
// each planted foot and leg, a distant or crawling one the old haze, and the pooled draw stays inside its per-tier caps.
//   node test-creature-dust.mjs
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register as reg } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VENDOR = pathToFileURL(path.resolve(HERE, '../../../../public/abyssal-tether-3d/vendor/three/')).href;
const SRC = pathToFileURL(path.resolve(HERE, '../../../../public/abyssal-tether-3d/src/')).href;
reg(
  'data:text/javascript,' +
    encodeURIComponent(`export async function resolve(s, c, next) {
  if (s === 'three') return { url: '${VENDOR}/three.module.min.js', shortCircuit: true };
  if (s.startsWith('three/addons/')) return { url: '${VENDOR}/addons/' + s.slice(13), shortCircuit: true };
  return next(s, c);
}`),
);
globalThis.self = globalThis;
const THREE = await import('three');
const { CreatureDust, boostOf, MAX_BOOST } = await import(`${SRC}/render/creatureDust.js`);
const { EventBus } = await import(`${SRC}/sim/config3d.js`);
void EventBus;

let n = 0;
const ok = (c, msg) => {
  assert.ok(c, msg);
  n++;
  console.log('PASS ' + msg);
};
const rngOf = (seed) => {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
};
const mkDust = (seed = 1) => {
  const scene = new THREE.Scene();
  const d = new CreatureDust(scene, {}, rngOf(seed));
  d.setBudget(2, false);
  d._head = { x: 0, y: 0, z: 0 };
  return d;
};

// 1. The boost curve.
{
  const closeFast = boostOf(6, 9);
  const closeSlow = boostOf(6, 0.5);
  const mid = boostOf(26, 9);
  const far = boostOf(60, 9);
  ok(closeFast > 2.5 && closeFast <= MAX_BOOST + 1e-9, `close and fast: ${closeFast.toFixed(2)}x (max ${MAX_BOOST})`);
  ok(closeSlow > 1 && closeSlow < closeFast * 0.6, `close but crawling: ${closeSlow.toFixed(2)}x`);
  ok(mid > 1.05 && mid < closeFast, `26 m away: ${mid.toFixed(2)}x`);
  ok(far === 1, 'beyond 42 m: exactly the old haze (1x)');
  let mono = true;
  let prev = 99;
  for (let dd = 0; dd <= 60; dd += 2) {
    const b = boostOf(dd, 8);
    if (b > prev + 1e-9) mono = false;
    prev = b;
  }
  ok(mono, 'the boost falls smoothly with distance');
  ok(boostOf(5, 8, 0.45) <= MAX_BOOST && boostOf(5, 8, 0.45) > 1, 'a small creature (skitterling scale) gets a boost within the same bounds');
}
// 2. The cloud: more particles, larger, denser; over the same seeds.
function emit(fn, boost, seeds = 40) {
  let particles = 0;
  let sizeSum = 0;
  let alphaMax = 0;
  let lifeSum = 0;
  for (let s = 1; s <= seeds; s++) {
    const d = mkDust(s);
    fn(d, boost);
    particles += d.n;
    for (let i = 0; i < d.n; i++) {
      sizeSum += d.size[i];
      lifeSum += d.max[i];
      alphaMax = Math.max(alphaMax, d.alpha[i]);
    }
  }
  return { particles: particles / seeds, size: sizeSum / Math.max(1, particles), life: lifeSum / Math.max(1, particles), alphaMax };
}
{
  const smoke = (d, b) => d.smoke(5, 0, 0, 0, 1, 0, 1, 0.8, 0, 0, 0, 0, b);
  const foot = (d, b) => d.foot(5, 0, 0, 0, 1, 0, 1, 0.8, 0, 0, 0, 0, b);
  for (const [name, fn] of [['leg smoke', smoke], ['footfall', foot]]) {
    const a = emit(fn, 1);
    const b = emit(fn, 2.6);
    ok(b.particles > a.particles * 1.8, `${name}: a creature coming at you throws ${(b.particles / a.particles).toFixed(1)}x the puffs (${a.particles.toFixed(1)} -> ${b.particles.toFixed(1)} per plant)`);
    ok(b.size > a.size * 1.2, `${name}: and larger ones (${a.size.toFixed(2)} -> ${b.size.toFixed(2)} m)`);
    ok(b.life > a.life * 1.15, `${name}: that hang longer (${a.life.toFixed(2)} -> ${b.life.toFixed(2)} s)`);
    ok(b.alphaMax <= 0.45 + 1e-6, `${name}: alpha stays bounded (${b.alphaMax.toFixed(2)} <= 0.45): a smudge, never a wall`);
  }
  const base = emit(smoke, 1);
  const same = emit((d) => d.smoke(5, 0, 0, 0, 1, 0, 1, 0.8, 0, 0, 0, 0), 1);
  ok(Math.abs(base.particles - same.particles) < 1e-9 && Math.abs(base.alphaMax - same.alphaMax) < 1e-9, 'the default (no boost argument) is exactly the old emission');
}
// 3. The pool stays inside its caps however hard it is driven.
{
  const d = mkDust(3);
  for (const tier of [0, 1, 2]) {
    d.reset();
    d.setBudget(tier, false);
    let worst = 0;
    for (let f = 0; f < 600; f++) {
      for (let k = 0; k < 8; k++) {
        d.smoke(4 + k * 0.1, 0, 0, 0, 1, 0, 1.2, 1, 0, 0, 0, 0, MAX_BOOST);
        d.foot(4, 0, 0.2 * k, 0, 1, 0, 1.1, 1, 0, 0, 0, 0, MAX_BOOST);
      }
      d.update(1 / 60, { x: 0, y: 0, z: 0 }, tier, false);
      worst = Math.max(worst, d.n);
    }
    ok(worst <= d.cap && d.n <= d.cap, `tier ${tier}: ten seconds of the heaviest cloud never passes the cap (${worst} <= ${d.cap})`);
  }
}
console.log(`\n${n} checks passed`);
