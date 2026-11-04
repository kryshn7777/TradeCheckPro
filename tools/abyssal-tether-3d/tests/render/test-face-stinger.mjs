// The Mason's face and tail (render/mason/masonFace.js, masonStinger.js), Node, no GPU:
//   - the stinger: a closed, banded, bulb-then-needle tube that ends in a point under 1 cm at kit scale, big (10 m long at kit scale), curling up
//     off the wall the creature clings to, a small triangle budget;
//   - the eyes: RED (the red channel dominates by an order of magnitude), brighter as it hunts and flaring through the wind-up and strike;
//   - the maw: the gape follows the jaw (shut at rest, wide through the wind-up, slamming shut on the strike), the cavity only draws while open,
//     the teeth interlock (upper points down, lower points up);
//   - all mounted on a root with driven matrices (the rig's bones are not in the scene graph), few draw calls, nothing allocated per frame.
//   node test-face-stinger.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
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
const { STINGER, Stinger, stingerGeometry } = await import(`${SRC}/render/mason/masonStinger.js`);
const { EYES, MAW, Eyes, Maw, eyeGlow, mawOpen, teethRow } = await import(`${SRC}/render/mason/masonFace.js`);

let n = 0;
const ok = (c, msg) => {
  assert.ok(c, msg);
  n++;
  console.log('PASS ' + msg);
};

// 1. The stinger.
{
  const { geometry, tip, triangles, radiusAt } = stingerGeometry();
  const pos = geometry.getAttribute('position');
  const col = geometry.getAttribute('color');
  ok(triangles > 300 && triangles <= 800, `the stinger is ${triangles} triangles`);
  ok(pos.count === col.count && geometry.index.count === triangles * 3, 'positions, colours and the index agree');
  let finite = true;
  for (let i = 0; i < pos.count * 3; i++) if (!Number.isFinite(pos.array[i]) || !Number.isFinite(col.array[i])) finite = false;
  ok(finite, 'every number is finite');
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  ok(bb.max.z > STINGER.length * 0.9 && STINGER.length >= 9, `it is big: ${bb.max.z.toFixed(1)} m long at kit scale (the tail bone scales it ~0.4-0.6)`);
  ok(tip[1] > STINGER.length * 0.25 && tip[0] === 0, `it curls UP over the back (the tip is ${tip[1].toFixed(1)} m above the root line) and stays on the centre line`);
  ok(radiusAt(1) < 0.01, `it ends in a needle point (tip radius ${(radiusAt(1) * 100).toFixed(2)} cm)`);
  ok(radiusAt(0.1) > radiusAt(0.02) && radiusAt(0.1) > radiusAt(0.5) * 3, `a venom bulb at the root (${radiusAt(0.1).toFixed(2)} m) tapering to ${radiusAt(0.5).toFixed(2)} m at the middle`);
  const lum = (i) => col.getX(i) * 0.3 + col.getY(i) * 0.59 + col.getZ(i) * 0.11;
  const sides = STINGER.sides;
  let lo = 9;
  let hi = 0;
  for (let r = 1; r < Math.floor(STINGER.rings * 0.4); r++) {
    lo = Math.min(lo, lum(r * sides));
    hi = Math.max(hi, lum(r * sides));
  }
  ok(hi > lo * 4, `hornet banding over the bulb (luminance ${lo.toFixed(2)} .. ${hi.toFixed(2)})`);
  ok(lum(STINGER.rings * sides) > 0.4, 'the point is pale amber');
  const s = new Stinger({ variant: true });
  ok(s.tip[2] < tip[2] * 0.9, 'skitterlings carry a smaller one');
  const root = new THREE.Group();
  s.mount(root);
  ok(s.group.parent === root && s.group.matrixAutoUpdate === false, 'mounted on the view root with a driven matrix');
  const tailWorld = new THREE.Matrix4().compose(new THREE.Vector3(1, 2, 3), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, -0.7, 0.1)), new THREE.Vector3(0.5, 0.5, 0.5));
  s.follow(tailWorld);
  root.updateMatrixWorld(true);
  ok(new THREE.Vector3().setFromMatrixPosition(s.group.matrixWorld).distanceTo(new THREE.Vector3(1, 2, 3)) < 1e-9, 'follow() puts it on the last spine bone');
  let found = 0;
  root.traverse((o) => o.name === 'Stinger' && found++);
  ok(found === 1, 'reachable by a traversal from the root (a child of a bone would not be)');
  s.update(false);
  ok(s.group.visible === false, 'hidden below full detail');
}
// 2. The eyes.
{
  const base = { state: 'DORMANT', phase: null, atkT: 0, atkWindup: 0.75, listening: false, distance: 80 };
  const rest = eyeGlow(base, 0, 0);
  const near = eyeGlow({ ...base, state: 'PURSUING', distance: 7 }, 0, 0);
  const wind0 = eyeGlow({ ...base, phase: 'windup', atkT: 0 }, 0, 0);
  const wind1 = eyeGlow({ ...base, phase: 'windup', atkT: 0.75 }, 0, 0);
  const strike = eyeGlow({ ...base, phase: 'strike' }, 0, 0);
  ok(rest > 0.5 && rest < 0.9, `at rest they breathe (${rest.toFixed(2)})`);
  ok(near > rest + 0.3, `brighter as it hunts close (${near.toFixed(2)})`);
  ok(wind1 > wind0 + 0.5 && wind1 > 1.5, `flare through the wind-up (${wind0.toFixed(2)} -> ${wind1.toFixed(2)})`);
  ok(strike > wind1 && strike >= 1.8, `flash on the strike (${strike.toFixed(2)})`);
  ok(Number.isFinite(eyeGlow(null, 0, 0)), 'no snapshot is fine');
  const e = new Eyes({ seed: 0.2 });
  for (const g of [{ ...base }, { ...base, state: 'PURSUING', distance: 6 }, { ...base, phase: 'strike' }]) {
    e.update(g, 1, true);
    const c = e.material.color;
    ok(c.r > c.g * 10 && c.r > c.b * 10 && c.r >= 0.55, `the eyes are RED (r ${c.r.toFixed(2)}, g ${c.g.toFixed(3)}, b ${c.b.toFixed(3)}) at glow ${e.glow.toFixed(2)}`);
  }
  ok(e.haloMaterial.color.r > e.haloMaterial.color.g * 10 && e.haloMaterial.opacity > 0.4 && e.haloMaterial.opacity <= 1, 'the halo is red too, and strong on the strike');
  ok(e.material.fog === false && e.material.toneMapped === false, 'unlit and unfogged: a red glow in the dark');
  e.geometry.computeBoundingBox();
  const bb = e.geometry.boundingBox;
  ok(Math.abs(bb.max.x + bb.min.x) < 1e-6 && bb.max.x > EYES.x, `two eyes, mirrored about the face's centre line (x ${bb.min.x.toFixed(2)} .. ${bb.max.x.toFixed(2)})`);
  const root = new THREE.Group();
  e.mount(root);
  e.update(base, 0, false);
  ok(e.calls() === 0 && (e.update(base, 0, true), e.calls() === 2), 'two draw calls while shown, none while hidden');
}
// 3. The maw.
{
  ok(mawOpen(0.3) < 0.15 && mawOpen(-0.55) === 0 && mawOpen(1.1) === 1, `the gape: shut at rest (${mawOpen(0.3).toFixed(2)}), shut on the strike, wide at the wind-up flare`);
  let mono = true;
  let prev = -1;
  for (let j = -0.7; j <= 1.3; j += 0.05) {
    const g = mawOpen(j);
    if (g < prev - 1e-12) mono = false;
    prev = g;
  }
  ok(mono, 'the gape rises monotonically with the jaw angle');
  const up = teethRow(-1);
  const lo = teethRow(1);
  up.computeBoundingBox();
  lo.computeBoundingBox();
  ok(up.boundingBox.min.y < -MAW.tooth * 0.5 && lo.boundingBox.max.y > MAW.tooth * 0.5, 'the upper teeth point down and the lower ones up (they interlock)');
  ok(up.getAttribute('position').count === MAW.teeth * 6, `${MAW.teeth} teeth in a row`);
  const m = new Maw();
  const root = new THREE.Group();
  m.mount(root);
  m.update(1 / 60, 0.3, true);
  ok(m.cavity.visible === false && m.calls() === 2, 'shut: the cavity is not drawn');
  const gap = () => m.upper.position.y - m.lower.position.y;
  const g0 = gap();
  for (let f = 0; f < 40; f++) m.update(1 / 60, 1.1, true);
  const g1 = gap();
  ok(m.cavity.visible && m.calls() === 3 && g1 > g0 + 1.3, `through the wind-up the mouth opens (gap ${g0.toFixed(2)} -> ${g1.toFixed(2)} m, the cavity draws)`);
  let frames = -1;
  for (let f = 0; f < 30; f++) {
    m.update(1 / 60, -0.55, true);
    if (m.gape < 0.1 && frames < 0) frames = f;
  }
  ok(frames >= 0 && frames <= 8, `the strike slams it shut within ${frames} frames (${((frames / 60) * 1000).toFixed(0)} ms)`);
  m.update(1 / 60, 0.3, false);
  ok(m.group.visible === false && m.calls() === 0, 'hidden below full detail');
  const before = process.memoryUsage().heapUsed;
  for (let f = 0; f < 20000; f++) m.update(1 / 60, 0.5 + 0.5 * Math.sin(f / 9), true);
  ok((process.memoryUsage().heapUsed - before) / 1e6 < 8, 'no allocation per frame');
}
// Which level of detail shows what (render/masonRigView.js). The eyes are what is seen from afar, so they show at LOD1 and with only the glow
// mesh drawn; on Quest (LOD1 from 12 m) a Mason seen from further off had NO red eyes while they were LOD0-only.
{
  const src = fs.readFileSync(path.resolve(HERE, '../../../../public/abyssal-tether-3d/src/render/masonRigView.js'), 'utf8');
  ok(/this\.eyes\.update\(this\.graph\.snapshot, this\._time, true\)/.test(src), 'the eyes are shown at every level of detail (and when only the glow mesh draws): red lights in the dark from afar');
  ok(/this\.maw\.update\(dt, this\.mandibles\.open, show\)/.test(src), 'the maw shows with the tusks (it was LOD0-only: beyond 12 m on Quest the open mouth was not drawn at all)');
  ok(/mat\.emissive\.setRGB\(1, 0\.004, 0\.002\)/.test(src) && /Math\.min\(0\.78, 0\.14 \+ 0\.28 \* emK\)/.test(src), 'the baked eye pits are a pure red and their intensity is capped so the tone mapper cannot wash them to pink');
  ok(/const show = !this\._glowOnly && \(near \|\| !this\.opts\.variant\);/.test(src) && /this\.mandibles\.update\([^)]*show\)/.test(src) && /this\.stinger\.update\(show\)/.test(src), 'the tusks and the stinger show whenever the Mason\'s body is drawn (the small hunters only at LOD0)');
}
// The eyes are RED on the display: the colour the display shows is the linear colour through the sRGB curve (the slit eyes and the halo are unlit and
// not tone mapped, so nothing washes them toward pink / orange).
{
  const srgb = (c) => Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(Math.min(c, 1), 1 / 2.4) - 0.055));
  const e = new Eyes();
  let worstG = 0;
  let worstB = 0;
  let minR = 999;
  for (const snap of [null, { phase: 'windup', atkT: 0.5, atkWindup: 0.75, distance: 8 }, { phase: 'strike', distance: 4 }, { state: 'PURSUING', distance: 20 }, { listening: true, distance: 30 }]) {
    for (let t = 0; t < 3; t += 0.37) {
      e.update(snap, t, true);
      const c = e.material.color;
      worstG = Math.max(worstG, srgb(c.g));
      worstB = Math.max(worstB, srgb(c.b));
      minR = Math.min(minR, srgb(c.r));
    }
  }
  ok(minR >= 200 && worstG <= 12 && worstB <= 10, `the slit eyes show as (>= ${minR}, <= ${worstG}, <= ${worstB}) on the display: red, never pink or white`);
  ok(e.haloMaterial.toneMapped === false && e.haloMaterial.color.g < 0.01 && e.haloMaterial.color.b < 0.01 && EYES.halo >= 4, 'the halo is pure red, drawn untoned, and big enough to see from afar');
}
console.log(`\n${n} checks passed`);
