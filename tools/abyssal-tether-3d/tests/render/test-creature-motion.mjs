// Node test of the creature locomotion layers (WP-CREATURE-MOTION): the metachronal follower gait (planted feet never move, the
// gait clock follows the distance, nothing overextends), the body spring chain (finite, bounded, travels with the clock, the head
// stays on the sim point) and the ground-dust pool maths. Pure modules only (no GL).
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readGLB } from './glbRead.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '../../../../public/abyssal-tether-3d');
const R = pathToFileURL(path.join(SRC, 'src/render/mason/')).href;
const { MasonLegs, GAIT_MASON, GAIT_SKITTER } = await import(R + 'masonLegs.js');
const { BodyMotion, MOTION_MASON, MOTION_SKITTER } = await import(R + 'masonMotion.js');
const { computeFrames } = await import(R + 'masonPose.js');
const meta = (await readGLB(path.join(SRC, 'assets/models/mason_rig.glb'))).js.extras.mason;
const SEG = 20;
let n = 0;
const ok = (name, fn) => {
  fn();
  n++;
  console.log('  ok', name);
};

function walk(skit, speed, frames, wind) {
  const size = skit ? 0.45 : 1;
  const bones = new Proxy({}, { get: (t, k) => (t[k] ||= { matrixWorld: { elements: new Float64Array(16) } }) });
  const legs = new MasonLegs(bones, meta, skit ? GAIT_SKITTER : GAIT_MASON, size);
  const mot = new BodyMotion(SEG, skit ? MOTION_SKITTER : MOTION_MASON);
  const B = { spine: new Float32Array(SEG * 3), up: new Float32Array(SEG * 3), head: {} };
  const F = new Float32Array(SEG * 12);
  const S = new Float32Array(SEG).fill(0.8 * size);
  const dt = 1 / 60;
  legs.hug = 2 * size;
  let lands = 0;
  legs.onLand = () => lands++;
  const prev = new Map();
  const r = { moved: 0, lands: 0, headErr: 0, maxOff: 0, maxStretchGap: 0, finite: true, airMax: 0, cycle: 0 };
  let z = 0;
  for (let fr = 0; fr < frames; fr++) {
    z -= speed * dt;
    for (let i = 0; i < SEG; i++) {
      B.spine[i * 3] = Math.sin(i * 0.4 + fr * dt) * 0.5 * size;
      B.spine[i * 3 + 2] = z + i * 1.5 * size;
      B.up[i * 3 + 1] = 1;
    }
    B.head = { x: B.spine[0], y: 0, z: B.spine[2], fx: 0, fy: 0, fz: -1, ux: 0, uy: 1, uz: 0 };
    computeFrames(B, SEG, F);
    const hx = F[0];
    const hz = F[2];
    legs.cycle += (speed * dt) / legs.stride;
    mot.update(dt, F, B.spine, size, speed, legs.cycle, legs.loadL, legs.loadR, wind ? (fr % 120 < 40 ? fr % 120 / 40 : fr % 120 < 52 ? -0.5 : 0) : 0, 0);
    for (let i = 0; i < SEG * 12; i++) if (!isFinite(F[i])) r.finite = false;
    r.headErr = Math.max(r.headErr, Math.hypot(F[0] - hx, F[2] - hz));
    for (let i = 0; i < SEG * 3; i++) r.maxOff = Math.max(r.maxOff, Math.abs(mot.off[i]) / size);
    legs.update(dt, F, S, null, null, false, false, speed);
    let air = 0;
    for (const L of legs.legs) {
      if (L.kind === 'lead') continue;
      if (L.step >= 0) air++;
      const p = prev.get(L);
      if (p && !p[3] && L.step < 0 && fr > 90) r.moved = Math.max(r.moved, Math.hypot(L.fx - p[0], L.fy - p[1], L.fz - p[2]));
      prev.set(L, [L.fx, L.fy, L.fz, L.step >= 0]);
    }
    if (fr > 90) r.airMax = Math.max(r.airMax, air);
    if (fr > 90) r.maxStretchGap = Math.max(r.maxStretchGap, legs.stats.slide);
  }
  r.lands = lands;
  r.cycle = legs.cycle;
  return r;
}

ok('mason gait: planted feet never move, stride follows distance, no overextension', () => {
  for (const v of [0.8, 2.5, 4.5, 8]) {
    const r = walk(false, v, 600, false);
    assert.ok(r.finite, 'finite ' + v);
    assert.ok(r.moved < 1e-4, 'planted foot moved ' + r.moved + ' at ' + v);
    assert.ok(r.maxStretchGap < 0.05, 'foot slid off its target by ' + r.maxStretchGap + ' at ' + v);
    const cycles = r.cycle;
    assert.ok(Math.abs(cycles - (v * 10) / (GAIT_MASON.strideK * 7)) < 0.01, 'clock ' + cycles);
    assert.ok(r.lands > 10 * v * 0.3, 'feet land (' + r.lands + ' at ' + v + ')');
    assert.ok(r.airMax <= 18, 'too many legs in the air at once: ' + r.airMax);
  }
});

ok('skitter gait: faster than the Mason at the same speed, still planted', () => {
  const m = walk(false, 4, 600, false);
  const s = walk(true, 4, 600, false);
  assert.ok(s.finite && s.moved < 1e-4, 'planted ' + s.moved);
  assert.ok(s.lands > m.lands, 'skitter steps more often: ' + s.lands + ' vs ' + m.lands);
});

ok('body spring chain: finite, bounded, head stays on the sim point, wind-up coil follows through', () => {
  for (const skit of [false, true]) {
    const r = walk(skit, 5, 800, true);
    assert.ok(r.finite);
    assert.ok(r.maxOff <= (skit ? MOTION_SKITTER : MOTION_MASON).maxOff * 1.65 + 1e-6, 'offset ' + r.maxOff);
    assert.ok(r.headErr < 0.25 * (skit ? 0.45 : 1), 'head drift ' + r.headErr);
  }
});

console.log(n + ' tests passed');
