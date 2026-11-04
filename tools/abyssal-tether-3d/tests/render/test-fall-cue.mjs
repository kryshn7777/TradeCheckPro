// "Ground ahead": the blocks that stop a fall are visible through the haze while falling (render/fallCue.js), Node, no GPU.
// Reported from play: "distant hard stopping blocks [must] be visible, some spawn below the player suddenly during free fall and he dies".
// The level is only drawn out to the fog cull distance (about 25-55 m) and a fall reaches 38 m/s, so a ledge came out of the haze a second
// before the impact. While falling fast, the solids below get a marker on their top face (one draw call), drawn through the fog.
//   - the strength follows the fall speed (nothing below 4 m/s, full at 12), the marker fades out as the real block comes close;
//   - pickFallBlocks: only top faces below, nearest first, those covered by a higher block dropped, thin bars / decor / inactive solids skipped,
//     the column widens with the drift, red when the estimated impact is near-lethal;
//   - on the real level a fall from every checkpoint finds the floors beyond the fog cull distance;
//   - the FallCue object: one instanced mesh, hidden when not falling, one instance per pick, red / amber colours, off by switch;
//   - the level view creates it, updates it every frame and disposes it; it is on the scene, not in the cached level root.
//   node test-fall-cue.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register as reg } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAME = path.resolve(HERE, '../../../../public/abyssal-tether-3d');
const VENDOR = pathToFileURL(path.join(GAME, 'vendor/three/')).href;
reg(
  'data:text/javascript,' +
    encodeURIComponent(`export async function resolve(s, c, next) {
  if (s === 'three') return { url: '${VENDOR}three.module.min.js', shortCircuit: true };
  if (s.startsWith('three/addons/')) return { url: '${VENDOR}addons/' + s.slice(13), shortCircuit: true };
  return next(s, c);
}`),
);
globalThis.self = globalThis;
const THREE = await import('three');
const mod = (p) => import(pathToFileURL(path.join(GAME, p)).href);
const { FallCue, FALL_CUE, pickFallBlocks, fallCueStrength, fallCueNear, fallCueDisabled } = await mod('src/render/fallCue.js');
const { Level3D } = await mod('src/sim/level3d.js');
const { LEVEL_DATA_3D } = await mod('src/data/level-data-3d.js');

let n = 0;
const ok = (c, msg) => {
  assert.ok(c, msg);
  n++;
  console.log('PASS ' + msg);
};
const PH = { gravity: 13.5, maxFall: 38, lethal: 17 };
const box = (id, x0, y0, z0, x1, y1, z1, extra = {}) => Object.assign({ id, kind: 'stone', minX: x0, minY: y0, minZ: z0, maxX: x1, maxY: y1, maxZ: z1, active: true }, extra);
const fake = (solids) => ({
  querySolids(a, b, c, d, e, f, out) {
    out.length = 0;
    for (const s of solids) if (s.maxX >= a && s.minX <= d && s.maxY >= b && s.minY <= e && s.maxZ >= c && s.minZ <= f) out.push(s);
    return out;
  },
});

// 1. Strength and near fade.
{
  ok(fallCueStrength(0) === 0 && fallCueStrength(3.9) === 0 && fallCueStrength(-5) === 0, 'standing, walking and rising: no cue');
  ok(fallCueStrength(8) > 0.4 && fallCueStrength(8) < 0.6, `at 8 m/s down it is half (${fallCueStrength(8).toFixed(2)})`);
  ok(fallCueStrength(12) === 1 && fallCueStrength(38) === 1, 'from 12 m/s it is full');
  ok(fallCueNear(2) === 0 && fallCueNear(4) === 0 && fallCueNear(14) === 1 && fallCueNear(100) === 1, 'the marker is gone at 4 m and full from 14 m (the drawn block takes over)');
  ok(fallCueNear(9) > 0.4 && fallCueNear(9) < 0.6, 'and ramps between');
}

// 2. The pick.
{
  const out = [];
  const lvl = fake([
    box('far', -5, -140, -5, 5, -138, 5), // 138 m below the head at y 0
    box('mid', -4, -62, -4, 4, -60, 4), // 60 m
    box('near', -3, -22, -3, 3, -20, 3), // 20 m
    box('covered', -1, -42, -1, 1, -41, 1), // 41 m, under `near`? no: not covered by it (near is 6 wide; covered is at -1..1 inside near's footprint)
    box('above', -3, 5, -3, 3, 8, 3), // above the head
    box('bar', -3, -30, -0.05, 3, -29.9, 0.05), // a thin bar
    box('decor', -3, -35, -3, 3, -34, 3, { decor: true }),
    box('off', -3, -50, -3, 3, -49, 3, { active: false }),
    box('beside', 40, -25, 40, 46, -24, 46), // far to the side
  ]);
  pickFallBlocks(lvl, 0, 0, 0, 0, -30, 0, PH, out);
  const ids = out.map((b) => b.s.id).join(',');
  ok(ids === 'near,mid,far', `the nearest top faces below, nearest first (${ids}): above the head, bars, decor, inactive, far to the side and covered ones are left out`);
  ok(out[0].dist === 20 && Math.abs(out[0].top - -20) < 1e-9, 'a pick carries the distance to the top face (20 m)');
  ok(out.length === 3 && out.every((b) => b.sx > 0 && b.sz > 0 && b.danger), 'all three are near-lethal impacts at 30 m/s (red)');
  // slow fall: nothing; a drop of 2 m/s: nothing
  pickFallBlocks(lvl, 0, 0, 0, 0, -3, 0, PH, out);
  ok(out.length === 0, 'at 3 m/s down nothing is picked');
  // a short, slow fall onto a ledge is not red
  const ledge = fake([box('ledge', -3, -5, -3, 3, -4, 3)]);
  pickFallBlocks(ledge, 0, 0, 0, 0, -5, 0, PH, out);
  ok(out.length === 1 && !out[0].danger && out[0].impact < 17 * 0.85, `a 4 m drop at 5 m/s lands at ${out[0].impact.toFixed(1)} m/s: amber, not red`);
  // the cap on the count, the reach and the drift
  const many = fake(Array.from({ length: 40 }, (_, i) => box('b' + i, -3 - i * 0.1, -10 - i * 3, -3, 3 + i * 0.1, -9 - i * 3, 3)));
  pickFallBlocks(many, 0, 0, 0, 0, -30, 0, PH, out);
  ok(out.length === FALL_CUE.maxBlocks, `at most ${FALL_CUE.maxBlocks} markers`);
  const drift = fake([box('side', 14, -30, -3, 20, -29, 3)]);
  pickFallBlocks(drift, 0, 0, 0, 0, -30, 0, PH, out);
  const still = out.length;
  pickFallBlocks(drift, 0, 0, 0, 9, -30, 0, PH, out);
  ok(still === 0 && out.length === 1, 'a block 14 m to the side is picked only when the horizontal speed makes the column wider');
  const deep = fake([box('deep', -3, -400, -3, 3, -399, 3)]);
  pickFallBlocks(deep, 0, 0, 0, 0, -38, 0, PH, out);
  ok(out.length === 0, 'beyond the reach (170 m) nothing is picked');
  ok(pickFallBlocks(null, 0, 0, 0, 0, -30, 0, PH, out).length === 0 && pickFallBlocks({}, 0, 0, 0, 0, -30, 0, PH, out).length === 0, 'no level / no querySolids: nothing, no throw');
}

// 3. The real level: the cue shows the floors the fog hides.
{
  const L = new Level3D(LEVEL_DATA_3D, 'normal');
  const out = [];
  let far = 0;
  let total = 0;
  let fallsWithFarFloor = 0;
  for (let s = 0; s < L.sections.length; s++) {
    const cp = L.sections[s].checkpoint;
    pickFallBlocks(L, cp.x, cp.y, cp.z, 0, -30, 0, PH, out);
    total += out.length;
    const beyond = out.filter((b) => b.dist > 45).length; // the fog cull distance is 25-55 m
    far += beyond;
    if (beyond) fallsWithFarFloor++;
    ok(out.every((b, i) => i === 0 || b.top <= out[i - 1].top + 1e-9) && out.every((b) => b.dist > 1.5), `section ${s}: ${out.length} markers, nearest first, all below the head`);
  }
  ok(total > 12 && far > 0, `over the checkpoints ${total} markers, ${far} of them past 45 m (what the fog used to hide until the last second)`);
  ok(fallsWithFarFloor >= 3, `${fallsWithFarFloor} of ${L.sections.length} falls have a floor past 45 m that is now marked`);
}

// 4. The FallCue object.
{
  const parent = new THREE.Group();
  const cue = new FallCue(parent);
  ok(cue.mesh.isInstancedMesh && parent.children.includes(cue.mesh) && !cue.mesh.visible && cue.mesh.count === 0, 'ONE instanced mesh on the parent, hidden and empty at the start');
  const m = cue.material;
  ok(m.fog === false && m.depthWrite === false && m.depthTest === true && m.transparent && m.toneMapped === false && m.blending === THREE.AdditiveBlending, 'unlit, no fog, additive, depth-tested (a wall in front still hides it), not tone mapped');
  const lvl = fake([box('f1', -6, -80, -6, 6, -78, 6), box('f2', -5, -50, -5, 5, -48, 5)]);
  const head = new THREE.Vector3(0, 0, 0);
  const pl = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, alive: true };
  cue.update(1 / 60, lvl, pl, head, { lethalImpact: 17 });
  ok(!cue.mesh.visible, 'not falling: nothing shown');
  pl.vy = -30;
  for (let i = 0; i < 20; i++) cue.update(1 / 60, lvl, pl, head, { lethalImpact: 17 });
  ok(cue.mesh.visible && cue.mesh.count === 2 && cue.material.uniforms.uAlpha.value > 0.9, `falling at 30 m/s: ${cue.mesh.count} markers shown, alpha ${cue.material.uniforms.uAlpha.value.toFixed(2)}`);
  const e = cue.mesh.instanceMatrix.array;
  ok(Math.abs(e[13] - -48) < 1e-6 && Math.abs(e[12]) < 1e-6 && Math.abs(e[0] - 10) < 1e-6 && Math.abs(e[10] - 10) < 1e-6, 'the first instance sits on the top face of the nearest block (y -48), scaled to its footprint (10 x 10)');
  const col = cue.mesh.instanceColor.array;
  ok(col[0] > 0.9 && col[1] < 0.3, 'a near-lethal impact is red');
  // off by switch
  cue.update(1 / 60, lvl, pl, head, { lethalImpact: 17 }, false);
  for (let i = 0; i < 80; i++) cue.update(1 / 60, lvl, pl, head, { lethalImpact: 17 }, false);
  ok(!cue.mesh.visible && cue.mesh.count === 0, 'switched off: it fades away and the mesh is hidden (no draw call)');
  // back on, then a rope catch: the fall stops
  for (let i = 0; i < 20; i++) cue.update(1 / 60, lvl, pl, head, { lethalImpact: 17 });
  pl.vy = 0;
  for (let i = 0; i < 120; i++) cue.update(1 / 60, lvl, pl, head, { lethalImpact: 17 });
  ok(!cue.mesh.visible, 'after the fall stops it fades out and is hidden');
  pl.vy = -30;
  pl.alive = false;
  for (let i = 0; i < 120; i++) cue.update(1 / 60, lvl, pl, head, { lethalImpact: 17 });
  ok(!cue.mesh.visible, 'a dead player sees no cue');
  // the near fade: at 3 m above the block the colour is gone
  pl.alive = true;
  for (let i = 0; i < 30; i++) cue.update(1 / 60, lvl, pl, head, { lethalImpact: 17 });
  head.y = -46;
  cue.update(1 / 60, lvl, pl, head, { lethalImpact: 17 });
  ok(cue.mesh.instanceColor.array[0] === 0, 'right above the block (2 m) its marker is gone: the drawn block takes over');
  cue.dispose();
  ok(!parent.children.includes(cue.mesh), 'dispose removes the mesh');
  ok(fallCueDisabled({ fallCue: false }) === true && fallCueDisabled({}) === false && fallCueDisabled(null) === false, 'settings.fallCue === false turns it off');
}

// 5. The wiring.
{
  const lv = fs.readFileSync(path.join(GAME, 'src/render/levelView.js'), 'utf8');
  ok(/import \{ FallCue, fallCueDisabled \} from '\.\/fallCue\.js'/.test(lv) && /this\._fallCue = new FallCue\(scene\)/.test(lv), 'the level view creates it on the scene (not in the cached level root)');
  ok(/this\._fallCue\.update\(dt, this\.level, game \? game\.player : null, head, game \? game\.diff : null, !fallCueDisabled\(game \? game\.settings : null\)\)/.test(lv), 'and updates it every frame');
  ok(/this\._fallCue\.dispose\(\)/.test(lv), 'and disposes it');
  const fc = fs.readFileSync(path.join(GAME, 'src/render/fallCue.js'), 'utf8');
  ok(/\[\?&\]fallcue=/.test(fc), '?fallcue=off is read');
}
console.log(`\n${n} checks passed`);
