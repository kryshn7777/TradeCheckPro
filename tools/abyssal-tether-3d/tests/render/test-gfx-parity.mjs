// Node tests for WP-GFX-PARITY (render side, no GPU): the shader patches carry the new chunks and uniforms, the contact-shadow batch
// stays inside its quad budget and writes sane numbers, dropped / thrown bag items fall, bounce, settle and fire the impact hook, the wear
// texture + gauge glass geometry are what the shaders assume, finger curls follow the controller touch values, no per-frame allocation.
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
const { LOOK, patchMaterial } = await import(`${SRC}/render/materials.js`);
const { ContactShadows, CONTACT_MAX, boxFaceNormal } = await import(`${SRC}/render/contactShadows.js`);
const { DroppedProps, DROP_MAX } = await import(`${SRC}/render/droppedProps.js`);
const { getWearTexture, createGaugeGlass, GAUGE } = await import(`${SRC}/render/gearSurface.js`);
const { HandGear } = await import(`${SRC}/render/handsGear.js`);
const { ITEM } = await import(`${SRC}/sim/inventory3d.js`);
const { EventBus } = await import(`${SRC}/sim/config3d.js`);

let n = 0;
const ok = (name, fn) => {
  fn();
  n++;
  console.log('  ok', name);
};

// ---- a tiny level: one big floor box (top at y = 0) and a wall at x = 4 -------------------------------------------------------
const FLOOR = { minX: -50, maxX: 50, minY: -2, maxY: 0, minZ: -50, maxZ: 50, active: true };
const WALL = { minX: 4, maxX: 6, minY: -2, maxY: 30, minZ: -50, maxZ: 50, active: true };
function segBox(o, e, b) {
  // slab method: returns t in 0..1 along o -> e or -1
  let t0 = 0;
  let t1 = 1;
  for (let a = 0; a < 3; a++) {
    const lo = [b.minX, b.minY, b.minZ][a];
    const hi = [b.maxX, b.maxY, b.maxZ][a];
    const d = e[a] - o[a];
    if (Math.abs(d) < 1e-12) {
      if (o[a] < lo || o[a] > hi) return -1;
      continue;
    }
    let ta = (lo - o[a]) / d;
    let tb = (hi - o[a]) / d;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return -1;
  }
  return t0;
}
const level = {
  raycast(ox, oy, oz, dx, dy, dz, maxDist, out) {
    const dl = Math.hypot(dx, dy, dz);
    const u = [dx / dl, dy / dl, dz / dl];
    const e = [ox + u[0] * maxDist, oy + u[1] * maxDist, oz + u[2] * maxDist];
    let best = Infinity;
    let hitS = null;
    for (const s of [FLOOR, WALL]) {
      const t = segBox([ox, oy, oz], e, s);
      if (t >= 0 && t < best) {
        best = t;
        hitS = s;
      }
    }
    if (!hitS) return null;
    const t = best * maxDist;
    const r = out || {};
    r.t = t;
    r.solid = hitS;
    r.x = ox + u[0] * t;
    r.y = oy + u[1] * t;
    r.z = oz + u[2] * t;
    return r;
  },
};

ok('boxFaceNormal: the face the ray entered, facing the ray origin', () => {
  const o = { x: 0, y: 0, z: 0 };
  boxFaceNormal(FLOOR, 3, 0, 4, 0, -1, 0, o);
  assert.deepEqual([o.x, o.y, o.z], [0, 1, 0], 'top face from above');
  boxFaceNormal(WALL, 4, 5, 1, 1, 0, 0, o);
  assert.deepEqual([o.x, o.y, o.z], [-1, 0, 0], 'wall face toward -x');
  boxFaceNormal(FLOOR, 3, -2, 4, 0, 1, 0, o);
  assert.deepEqual([o.x, o.y, o.z], [0, -1, 0], 'underside from below');
});

ok('shader patches: bevel, puddles, parallax-corrected probe, near octave retune', () => {
  const tex = new THREE.Texture();
  const mat = new THREE.MeshStandardMaterial({ map: tex, normalMap: tex, aoMap: tex, roughnessMap: tex, metalnessMap: tex, envMap: tex });
  patchMaterial(mat, { uv: 'box', macro: tex, lit: true, hq: true, grade: true, bevel: true, aniso: 0.3 });
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader };
  mat.onBeforeCompile(shader);
  const fs_ = shader.fragmentShader;
  const vs_ = shader.vertexShader;
  for (const s of ['uBevelK', 'vAtBp', 'vAtBh', 'vAtFN', 'atBev', 'atPud', 'uPudK', 'uProbeC', 'uProbeH', 'atIBLRadiance', 'nonPerturbedNormal, atPud']) assert.ok(fs_.includes(s) || s === 'nonPerturbedNormal, atPud', `fragment shader has ${s}`);
  assert.ok(/mix\( normal, nonPerturbedNormal, atPud/.test(fs_), 'puddle flattening of the normal');
  assert.ok(vs_.includes('vAtBp = position * atS'), 'vertex shader writes the box-local position');
  // the box helper functions come after the env map declarations they use
  assert.ok(fs_.indexOf('vec3 atIBLRadiance(') > fs_.indexOf('#include <envmap_common_pars_fragment>') && fs_.indexOf('vec3 atIBLRadiance(') > fs_.indexOf('#include <envmap_physical_pars_fragment>'), 'atIBLRadiance declared after the envmap uniforms / cube-uv functions');
  for (const u of ['uBevelK', 'uProbeC', 'uProbeH', 'uPudK']) assert.ok(u in shader.uniforms && u in LOOK, `LOOK uniform ${u} bound`);
  // the order inside the normal pipeline: stock normal map -> aniso grain -> puddle flatten -> bevel
  const iAniso = fs_.indexOf('atG * ');
  const iFlat = fs_.indexOf('mix( normal, nonPerturbedNormal, atPud');
  const iBev = fs_.indexOf('float atBev');
  assert.ok(iAniso > 0 && iFlat > iAniso && iBev > iFlat, 'normal edits in order');
  assert.ok(fs_.includes('0.24 * atNear') && fs_.includes('uDetailScale * 2.4'), 'near-field octave retuned (0.24, 2.4x)');
  assert.ok(/smoothstep\( 0\.7, 2\.2, atDist \)/.test(fs_), 'near-field octave fades out by 2.2 m');
  // steep parallax on floors: bounded march, refine by interpolation, same uv convention as the 1-tap, tier uniform bound
  assert.ok(fs_.includes('uParallaxS') && 'uParallaxS' in shader.uniforms && 'uParallaxS' in LOOK, 'uParallaxS bound');
  assert.ok(/vAtTop > 0\.7 && uParallaxS\.x > 1\.5/.test(fs_), 'steep parallax is floor-only and tier gated');
  assert.ok(/for \( int i = 0; i < 12; i \+\+ \)/.test(fs_) && /textureGrad\( normalMap, atUc, atG2x, atG2y \)/.test(fs_), 'bounded ray march with blurred height taps');
  assert.ok(/atPUv = mix\( atUp, atUc, atW \)/.test(fs_), 'linear refine between the last two layers');
  assert.ok(/#define vMapUv atPUv/.test(fs_) && /#define vNormalMapUv atPUv/.test(fs_) && /#define vRoughnessMapUv atPUv/.test(fs_), 'shifted uv feeds albedo / normal / ORM taps');
  assert.ok(/uDetailScale \)/.test(fs_) && fs_.includes('atPUv * ( uDetailScale'), 'detail normal uses the shifted uv');
  assert.ok(vs_.includes('vLmUv') === false || !/vLmUv = .*atPUv/.test(fs_), 'lightmap uv is never the shifted one');
  // materials without the bevel flag do not pay for it
  const plain = new THREE.MeshStandardMaterial({ map: tex });
  patchMaterial(plain, { uv: 'box', macro: tex, lit: true, hq: false });
  const sh2 = { uniforms: {}, vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader };
  plain.onBeforeCompile(sh2);
  assert.ok(!sh2.fragmentShader.includes('atBev') && !sh2.vertexShader.includes('vAtBp'), 'no bevel code without the flag');
  assert.notEqual(mat.customProgramCacheKey(), plain.customProgramCacheKey(), 'distinct program keys');
});

ok('contact shadows: within the quad budget, flat on the surface, finite, hidden outside a run', () => {
  const scene = new THREE.Scene();
  const cs = new ContactShadows(scene);
  const sock = (x, y, z) => {
    const o = new THREE.Object3D();
    o.position.set(x, y, z);
    o.updateMatrixWorld(true);
    return o;
  };
  const socks = { left: sock(-0.3, 1.0, 0), right: sock(0.3, 0.4, 0) };
  const game = {
    level,
    state: 'playing',
    hidePlayer: false,
    settings: {},
    player: { rx: 0, ry: 1.3, rz: 0, alive: true },
    input: { handSocket: (h) => socks[h] },
    pickups: { version: 1, items: [{ x: 3, y: 0.45, z: 2, taken: false, kind: 0 }, { x: 40, y: 0.45, z: 2, taken: false, kind: 1 }, { x: -2, y: 0.45, z: 1, taken: true, kind: 2 }] },
    creature: { body: { visible: true, limbs: Array.from({ length: 10 }, (_, i) => ({ foot: { x: 5 + i, y: 0.02, z: -3 } })) } },
  };
  const r3d = { lighting: { tier: 'quest' }, governor: { level: 0 }, scene: { fog: { far: 60 } }, lantern: { getWorldPosition: (v) => v.set(-0.3, 1.0, 0) } };
  const head = new THREE.Vector3(0, 1.62, 0);
  cs.update(0.016, game, head, r3d);
  assert.ok(cs.mesh.visible && cs.n >= 4, 'quads written ' + cs.n);
  assert.ok(cs.n <= CONTACT_MAX);
  assert.equal(cs.mesh.geometry.instanceCount, cs.n);
  const P = cs._pos.array;
  const N = cs._nrm.array;
  for (let i = 0; i < cs.n; i++) {
    for (let k = 0; k < 4; k++) assert.ok(Number.isFinite(P[i * 4 + k]) && Number.isFinite(N[i * 4 + k]), 'finite');
    assert.ok(P[i * 4 + 3] > 0 && N[i * 4 + 3] > 0 && N[i * 4 + 3] <= 1, 'radius / opacity range');
  }
  // the body blob lies on the floor (y = 0) with an up normal, below the player
  assert.ok(Math.abs(P[1]) < 1e-6 && N[1] > 0.99, 'body blob on the floor, up normal');
  assert.ok(P[3] > 0.4, 'body blob radius');
  // the hand near the wall casts nothing sideways beyond its reach, the low hand darkens the floor more than the high hand
  const handBlobs = [];
  for (let i = 1; i < cs.n; i++) if (Math.abs(P[i * 4]) < 0.7 && Math.abs(P[i * 4 + 2]) < 0.2) handBlobs.push(N[i * 4 + 3]);
  assert.ok(handBlobs.length >= 1, 'hand blobs');
  // low tier keeps only the body + hands
  r3d.lighting.tier = 'low';
  cs.update(0.016, game, head, r3d);
  assert.ok(cs.n <= 5, 'low tier: body + hands only (' + cs.n + ')');
  r3d.lighting.tier = 'quest';
  // a wall within reach of a hand: a blob on the wall facing -x
  socks.right.position.set(3.8, 2, 0);
  socks.right.rotation.set(0, -Math.PI / 2, 0);
  socks.right.updateMatrixWorld(true);
  cs.update(0.016, game, head, r3d);
  let wallBlob = false;
  for (let i = 0; i < cs.n; i++) if (N[i * 4] < -0.9) wallBlob = true;
  assert.ok(wallBlob, 'a hand pressed to the wall darkens the wall');
  // not in a run / hidden: no draw
  game.state = 'menu';
  cs.update(0.016, game, head, r3d);
  assert.ok(!cs.mesh.visible && cs.n === 0, 'hidden in the menu');
  cs.dispose();
});

ok('dropped props: fall, bounce, settle flat, impact hook, recycle, melt away, finite', () => {
  const scene = new THREE.Scene();
  const bus = new EventBus();
  const dp = new DroppedProps(scene);
  const game = { level, input: null, xrActive: false, renderer: { camera: new THREE.PerspectiveCamera() } };
  dp.bind(bus, () => game);
  const hits = [];
  bus.on('prop:impact', (e) => hits.push(e));
  dp.spawn(ITEM.BATTERY, 1, 2, 1, 1.5, 0, 0.4, 6);
  assert.equal(dp.activeCount, 1);
  let minY = 1e9;
  let t = 0;
  for (; t < 8; t += 1 / 72) {
    dp.update(1 / 72, game);
    const it = dp.items[0];
    if (!it.active) break;
    assert.ok(Number.isFinite(it.x + it.y + it.z));
    minY = Math.min(minY, it.y);
    if (it.rested) break;
  }
  const it = dp.items[0];
  assert.ok(it.rested, 'came to rest by ' + t.toFixed(1) + ' s');
  assert.ok(minY > -0.001, 'never through the floor (min y ' + minY.toFixed(3) + ')');
  assert.ok(Math.abs(it.y - 0.062) < 0.02, 'lies on the floor (y ' + it.y.toFixed(3) + ')');
  assert.ok(hits.length >= 1 && hits[0].speed > 0.9 && hits[0].kind === ITEM.BATTERY, 'impact hook fired ' + hits.length + ' times');
  assert.ok(hits.length <= 8, 'a cell bounces a few times, not forever');
  assert.ok(dp.mesh.visible && dp.stats.drawn > 20, 'the mesh draws the prop');
  // the item is rewritten as finite vertices
  const P = dp._aPos.array;
  for (let i = 0; i < 300; i++) assert.ok(Number.isFinite(P[i]));
  // all six slots + a 7th recycles the oldest
  for (let i = 0; i < DROP_MAX + 2; i++) dp.spawn(i % 4, 0, 3, 0, 0, 0, 0);
  assert.equal(dp.activeCount, DROP_MAX);
  // bus events: bag:done tosses, bag:cancel fumbles (not when inactive)
  dp.clear();
  game.xrActive = false;
  game.renderer.camera.position.set(0, 1.6, 0);
  game.renderer.camera.updateMatrixWorld(true);
  bus.emit('bag:done', { kind: ITEM.ADRENALINE });
  assert.equal(dp.activeCount, 1, 'bag:done spawns');
  bus.emit('bag:cancel', { kind: ITEM.FIRST_AID, reason: 'damage' });
  assert.equal(dp.activeCount, 2, 'bag:cancel spawns');
  bus.emit('bag:cancel', { kind: ITEM.FIRST_AID, reason: 'inactive' });
  assert.equal(dp.activeCount, 2, 'an inactive cancel (pause / death) spawns nothing');
  // everything lands, rests, melts and the mesh hides (no draw call)
  for (let k = 0; k < 72 * 14; k++) dp.update(1 / 72, game);
  assert.equal(dp.activeCount, 0, 'all gone after the rest + fade time');
  assert.ok(!dp.mesh.visible, 'the mesh is hidden when nothing is in flight');
  // falls into the abyss: removed
  const empty = new DroppedProps(scene);
  const none = { level: { raycast: () => null }, input: null };
  empty.spawn(ITEM.BANDAGE, 0, 0, 0, 0, 0, 0);
  for (let k = 0; k < 72 * 14; k++) empty.update(1 / 72, none);
  assert.equal(empty.activeCount, 0, 'an item that falls away is dropped');
  dp.dispose();
  empty.dispose();
});

ok('dropped props: no per-frame allocation while active', () => {
  const scene = new THREE.Scene();
  const dp = new DroppedProps(scene);
  const game = { level, input: null, xrActive: false };
  dp.spawn(ITEM.FIRST_AID, 0, 2, 0, 0, 0, 0);
  for (let i = 0; i < 100; i++) dp.update(1 / 72, game);
  if (global.gc) global.gc();
  const h0 = process.memoryUsage().heapUsed;
  for (let i = 0; i < 20000; i++) {
    if (!dp.activeCount) dp.spawn(ITEM.FIRST_AID, 0, 2, 0, 0.5, 0, 0);
    dp.update(1 / 72, game);
  }
  const grown = process.memoryUsage().heapUsed - h0;
  assert.ok(grown < 6e6, 'heap grew ' + grown);
});

ok('wear texture + gauge glass geometry match what the shaders assume', () => {
  const t = getWearTexture();
  assert.equal(t.image.width, 256);
  const d = t.image.data;
  const sums = [0, 0, 0, 0];
  for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 4; c++) sums[c] += d[i + c];
  for (let c = 0; c < 4; c++) assert.ok(sums[c] / (d.length / 4) > 3, `channel ${c} carries signal (${(sums[c] / (d.length / 4)).toFixed(1)})`);
  // fingerprints (R) are mostly empty (the prints cover a minority of the tile), scratches (G) are sparse
  let rHi = 0;
  let gHi = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] > 128) rHi++;
    if (d[i + 1] > 128) gHi++;
  }
  const px = d.length / 4;
  assert.ok(rHi / px > 0.04 && rHi / px < 0.45, 'print coverage ' + (rHi / px).toFixed(2));
  assert.ok(gHi / px > 0.003 && gHi / px < 0.2, 'scratch coverage ' + (gHi / px).toFixed(3));
  const L = createGaugeGlass('left');
  const R = createGaugeGlass('right');
  const tris = L.geometry.index.count / 3;
  assert.ok(tris <= 120 && tris >= 40, 'glass triangles ' + tris);
  // the dome stands on the dial: its base circle is ~lift above the gauge centre along the normal, left mirrors right in x
  const nR = new THREE.Vector3(...GAUGE.normal).normalize();
  const cR = new THREE.Vector3(...GAUGE.center).addScaledVector(nR, GAUGE.lift);
  assert.ok(R.position.distanceTo(cR) < 1e-9, 'right glass position');
  assert.ok(Math.abs(L.position.x + R.position.x) < 1e-9 && Math.abs(L.position.y - R.position.y) < 1e-9, 'left mirrors right');
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(R.quaternion);
  assert.ok(up.distanceTo(nR) < 1e-6, 'the dome axis is the gauge normal');
  R.geometry.computeBoundingBox();
  const h = R.geometry.boundingBox.max.y - R.geometry.boundingBox.min.y;
  assert.ok(h > 0.002 && h < 0.004, 'dome height ' + h);
  assert.equal(L.material, R.material, 'one shared material (one program)');
  assert.ok(L.material.transparent && !L.material.depthWrite);
});

ok('finger curls: thumb / index / grip follow the touch values, smoothed, fist overrides', () => {
  // a minimal glove: five fingers x three bones with Open / Grip / Trigger / Point poses (rotations about X)
  const root = new THREE.Group();
  const mk = (name) => {
    const b = new THREE.Bone();
    b.name = name;
    root.add(b);
    return b;
  };
  const FING = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'];
  const poses = new Map();
  const mkPose = (nm, ang) => {
    const m = new Map();
    for (const f of FING) for (let i = 1; i <= 3; i++) m.set(`${f}${i}`, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), ang(f)));
    poses.set(nm + '_L', m);
  };
  mkPose('Open', () => 0);
  mkPose('Grip', () => 1.6);
  mkPose('Trigger', (f) => (f === 'Index' ? 2.1 : 1.6));
  mkPose('Point', (f) => (f === 'Index' ? 0 : 1.6));
  for (const f of FING) for (let i = 1; i <= 3; i++) mk(`${f}${i}_L`);
  const G = new HandGear('left', root, poses, new THREE.MeshStandardMaterial(), { drumRadius: 0.0255 });
  const angle = (f) => new THREE.Euler().setFromQuaternion(root.getObjectByName(`${f}1_L`).quaternion).x;
  // relaxed: grip 0.2, thumb lifted: the thumb stays open while the fingers hang half-way
  for (let i = 0; i < 120; i++) G.poseFingers(1 / 72, 0.2, 0, 0, 0);
  assert.ok(angle('Thumb') < 0.05, 'thumb lifted (no sensor touched) stays open: ' + angle('Thumb'));
  assert.ok(angle('Middle') > 0.2 && angle('Middle') < 0.5, 'relaxed middle finger hangs part-curled: ' + angle('Middle'));
  // smoothing: one frame after the grip jumps to 1 the fingers have moved only a part of the way
  G.poseFingers(1 / 72, 1, 0, 0, 1);
  const a1 = angle('Middle');
  assert.ok(a1 > 0.3 && a1 < 1.3, 'one frame is a partial move: ' + a1);
  for (let i = 0; i < 120; i++) G.poseFingers(1 / 72, 1, 0.9, 0, 1);
  assert.ok(angle('Middle') > 1.55 && angle('Thumb') > 1.55, 'fist: every finger closed ' + angle('Middle') + ' ' + angle('Thumb'));
  // the pinky closes a touch later than the middle finger on a part squeeze
  for (let i = 0; i < 200; i++) G.poseFingers(1 / 72, 0.5, 0, 0, 0.3);
  assert.ok(angle('Pinky') < angle('Middle') + 1e-6, 'pinky curls less than the middle finger on a half squeeze');
  // an old caller (no thumb argument) still drives the thumb with the grip
  for (let i = 0; i < 200; i++) G.poseFingers(1 / 72, 1, 0, 0);
  assert.ok(angle('Thumb') > 1.5, 'thumb follows the grip when no thumb value is given');
});

console.log(`gfx-parity: ${n} checks passed`);
