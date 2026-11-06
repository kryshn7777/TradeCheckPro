// THE USHER's view (render/usherView.js), Node, no GPU: the pool of ushers drawn from the real assets/models/usher.glb.
//   - the GLB parsed with the game's loader (meshopt) builds a pool of 6 (5 ordinary + the head) sharing geometry and materials; LOD1 / LOD2
//     are clustered copies within budget; the throat's skin weights are rebuilt as a partition of unity (normalised, the ring pure Maw)
//   - before the model is in, everything is a no-op; load() resolves true over HTTP and false for a missing file, never throws
//   - setStates / update: pool slots by id (sticky, the head first then the nearest), unused members hidden, yaw / position / scale 1.8 for the head
//   - clips scrubbed to t (loops wrap, once-clips hold, Sit falls back to Idle, an unknown name to Idle), a 0.2 s crossfade on a change
//   - the head's throat pays out by `stretch`: the chain from the collar to the ring grows exactly by it, the posed throat mesh grows, and
//     it does NOT tear (the old weights did: the control run below); the other ushers ignore it; the bounds follow it
//   - the torch: one shell per sphere following its state, recoloured per stage (pale, warming, GOLD, white-gold, dying), fading when it is
//     snuffed or gone, a thin line from the ring (given or read off the skeleton) to the centre; reduced effects; the glint of a far ushers
//   - levels of detail by distance (tier table, hysteresis, the head judged as 1/1.8), no ink hulls, stats (<= 150 calls), no allocation, dispose
//   node test-usher-view.mjs
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import v8 from 'node:v8';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAME = path.resolve(HERE, '../../../../public/abyssal-tether-3d');
const VENDOR = pathToFileURL(path.join(GAME, 'vendor/three/')).href;
register(
  'data:text/javascript,' +
    encodeURIComponent(`export async function resolve(s, c, next) {
  if (s === 'three') return { url: '${VENDOR}three.module.min.js', shortCircuit: true };
  if (s.startsWith('three/addons/')) return { url: '${VENDOR}addons/' + s.slice(13), shortCircuit: true };
  return next(s, c);
}`),
);
globalThis.self = globalThis;
if (typeof globalThis.ProgressEvent === 'undefined') {
  globalThis.ProgressEvent = class ProgressEvent extends Event {
    constructor(type, init = {}) {
      super(type);
      Object.assign(this, init);
    }
  }; // (FileLoader reports progress with it; Node has none)
}
const THREE = await import('three');
const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
const { MeshoptDecoder } = await import('three/addons/libs/meshopt_decoder.module.js');
await MeshoptDecoder.ready;
const mod = (p) => import(pathToFileURL(path.join(GAME, p)).href);
const U = await mod('src/render/usherView.js');
const { UsherView, pickLod, LOD_DIST, STAGE, HEAD_SCALE, POOL_SIZE, POOL_ORDINARY, HEAD_SLOT, STRETCH_MAX, GLINT_FAR } = U;

let pass = 0;
let fail = 0;
const verbose = process.argv.includes('-v');
const ok = (c, m) => {
  if (c) {
    pass++;
    if (verbose) console.log('PASS', m);
  } else {
    fail++;
    console.log('FAIL:', m);
  }
};

const GLB = path.join(GAME, 'assets/models/usher.glb');
async function parse() {
  const buf = fs.readFileSync(GLB);
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  loader.pluginCallbacks.unshift(() => ({ name: 'noTex', loadTexture: () => Promise.resolve(null) })); // Node has no image decoding
  return new Promise((res, rej) => loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', res, rej));
}
async function make(opts) {
  const renderer = { scene: new THREE.Scene(), qualityTier: 'quest' };
  const v = new UsherView(renderer);
  v.buildFromGLTF(await parse(), opts);
  return { v, renderer };
}
const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 500);
camera.position.set(0, 1.6, -6);
camera.lookAt(0, 1.6, 0);
camera.updateMatrixWorld(true);
const st = (o) => Object.assign({ id: 'u', head: false, x: 0, y: 0, z: 0, yaw: 0, clip: 'Idle', t: 0.5, stretch: 1, ring: null, sphere: null, visible: true }, o);
/** Runs `n` frames of dt on the same states (lets crossfades and envelopes settle). */
function frames(v, list, n = 20, dt = 0.05, cam = camera) {
  for (let i = 0; i < n; i++) {
    v.setStates(list);
    v.update(dt, cam);
  }
}
const slotOf = (v, id) => v.members.find((m) => m.used && m.id === id);
const bonePos = (m, name) => m.bones.find((b) => b.name === name);
const throatLen = (m) => {
  m.root.updateMatrixWorld(true);
  return bonePos(m, 'Neck01').getWorldPosition(new THREE.Vector3()).distanceTo(m.maw.getWorldPosition(new THREE.Vector3()));
};
/** The posed vertices (model space, real units) of one LOD0 primitive of a member. */
function posed(m, name) {
  m.root.updateMatrixWorld(true);
  const sm = [...m.lod0, m.glow].find((s) => s.name === 'usher_' + name);
  sm.skeleton.update();
  const p = sm.geometry.attributes.position;
  const out = new Float32Array(p.count * 3);
  const w = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    w.fromBufferAttribute(p, i);
    sm.applyBoneTransform(i, w);
    out[i * 3] = w.x;
    out[i * 3 + 1] = w.y;
    out[i * 3 + 2] = w.z;
  }
  return out;
}
const bbox = (arr) => {
  const b = new THREE.Box3();
  const v = new THREE.Vector3();
  for (let i = 0; i < arr.length; i += 3) b.expandByPoint(v.set(arr[i], arr[i + 1], arr[i + 2]));
  return b;
};
/** How much the throat edges (a primitive's triangle edges) grew from pose a to pose b: { max, over } (edges longer than 4 mm before). */
function edgeGrowth(geometry, a, b, limit) {
  const idx = geometry.index;
  let max = 0;
  let over = 0;
  let total = 0;
  for (let t = 0; t < idx.count; t += 3) {
    for (let e = 0; e < 3; e++) {
      const i = idx.getX(t + e);
      const j = idx.getX(t + ((e + 1) % 3));
      const la = Math.hypot(a[i * 3] - a[j * 3], a[i * 3 + 1] - a[j * 3 + 1], a[i * 3 + 2] - a[j * 3 + 2]);
      if (la < 0.004) continue;
      const lb = Math.hypot(b[i * 3] - b[j * 3], b[i * 3 + 1] - b[j * 3 + 1], b[i * 3 + 2] - b[j * 3 + 2]);
      total++;
      max = Math.max(max, lb / la);
      if (lb / la > limit) over++;
    }
  }
  return { max, over, total };
}
/** The angle (rad) between two rotations. */
const quatDist = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(a.dot(b))));

// ---------------------------------------------------------------------------------------------------------------------
// 1. Before the model: a no-op. The pure pieces.
// ---------------------------------------------------------------------------------------------------------------------
{
  const renderer = { scene: new THREE.Scene() };
  const v = new UsherView(renderer);
  ok(renderer.scene.children.length === 1 && renderer.scene.children[0] === v.root, 'the view adds exactly one group to the scene');
  v.setStates([st({ head: true })]);
  v.update(0.016, camera);
  ok(!v.ready && v.members.length === 0 && v.stats.shown === 0 && v.stats.drawCalls === 0 && v.stats.poolSize === 0, 'before the model is in setStates / update do nothing');
  ok(v.tier === 'quest', 'no renderer tier: quest');
  v.setTier('low');
  ok(v.tier === 'low', 'setTier overrides');
  v.setTier(null);
  const r2 = new UsherView({ scene: new THREE.Scene(), qualityTier: 'high' });
  ok(r2.tier === 'high', "the renderer's qualityTier is read like DresserView does");
  r2.dispose();
  v.dispose();
  ok(renderer.scene.children.length === 0, 'dispose takes the group out of the scene');
}
{
  const bad = new UsherView({ scene: new THREE.Scene() });
  let r;
  let threw = false;
  const warn = console.warn;
  console.warn = () => {}; // (load() says why it failed)
  try {
    r = await bad.load(new URL('./__no_such_usher__.glb', import.meta.url).href);
  } catch {
    threw = true;
  }
  console.warn = warn;
  ok(!threw && r === false && !bad.ready, 'load() of a missing file resolves false and never throws');
  bad.dispose();
  const gone = new UsherView({ scene: new THREE.Scene() });
  gone.dispose();
  console.warn = () => {};
  ok((await gone.load()) === false, 'load() after dispose resolves false');
  console.warn = warn;
}
{
  // the real load path over HTTP (fetch + parse + build)
  const srv = http.createServer((q, r) => {
    r.writeHead(200, { 'content-type': 'model/gltf-binary' });
    fs.createReadStream(GLB).pipe(r);
  });
  await new Promise((res) => srv.listen(0, '127.0.0.1', res));
  const v = new UsherView({ scene: new THREE.Scene() });
  const p1 = v.load(`http://127.0.0.1:${srv.address().port}/usher.glb`);
  const p2 = v.load();
  ok(p1 === p2, 'load() is idempotent while loading');
  const r = await p1;
  ok(r === true && v.ready && v.members.length === POOL_SIZE && v.stats.poolSize === POOL_SIZE && UsherView.ready === true, 'load() fetched and parsed usher.glb and built the pool');
  ok((await v.load()) === true, 'and loading again resolves true');
  v.dispose();
  srv.close();
}
{
  const lq = LOD_DIST.quest;
  ok(pickLod(1, 'quest') === 0 && pickLod(lq[0] + 1, 'quest') === 1 && pickLod(lq[1] + 1, 'quest') === 2 && pickLod(lq[2] + 1, 'quest') === 3 && pickLod(GLINT_FAR + 1, 'quest') === -1, 'LOD by distance: full, LOD1, LOD2, glint only, nothing');
  ok(pickLod(lq[0] + 1, 'quest', 0) === 1 && pickLod(lq[0] - 1, 'quest', 1) === 1 && pickLod(lq[0] - 3, 'quest', 1) === 0, 'hysteresis: a finer LOD needs the camera 2 m closer than the switch');
  ok(LOD_DIST.low[0] < LOD_DIST.quest[0] && LOD_DIST.quest[0] < LOD_DIST.high[0] && LOD_DIST.low[2] < LOD_DIST.high[2], 'the low tier switches nearer, the high tier farther');
  ok(pickLod(40, 'nonsense') === pickLod(40, 'quest'), 'an unknown tier is quest');
  ok(lq[2] >= 60 && lq[2] <= 80, 'past ~70 m on Quest an usher is a glint (the direction doc: LOD2 to 70 m)');
}

// ---------------------------------------------------------------------------------------------------------------------
// 2. The pool
// ---------------------------------------------------------------------------------------------------------------------
const { v, renderer } = await make();
{
  ok(v.members.length === POOL_SIZE && POOL_SIZE === 6 && POOL_ORDINARY === 5 && HEAD_SLOT === 5, 'a pool of 6: 5 ordinary + the head');
  ok(v.members.every((m, i) => (i === HEAD_SLOT) === m.head), 'only the last slot is the head');
  const geoOf = (m) => m.lod0.map((s) => s.geometry);
  ok(v.members.every((m) => geoOf(m).every((g, k) => g === geoOf(v.members[0])[k])), 'every member shares the same geometries');
  ok(v.members.every((m) => m.lod0.every((s, k) => s.material === v.members[0].lod0[k].material) && m.body1.material === v.members[0].body1.material), 'and the same materials');
  ok(new Set(v.members.map((m) => m.skeleton)).size === POOL_SIZE && v.members.every((m) => m.bones.length === 34 && m.skeleton.bones.length === 34), 'but each has its own 34-bone skeleton');
  ok(v.members.every((m) => m.lod0.length === 5 && m.glow && m.lod0.every((s) => s.skeleton === m.skeleton) && m.body1.skeleton === m.skeleton && m.body2.skeleton === m.skeleton), 'every mesh of a member is bound to that skeleton');
  ok(v.info.triangles[0] > 15000 && v.info.triangles[0] <= 32000, `LOD0 is the model: ${v.info.triangles[0]} triangles in 6 draws`);
  ok(v.info.triangles[1] > 4000 && v.info.triangles[1] < 9000, `LOD1 is ~7 k triangles (${v.info.triangles[1]}) in 2 draws`);
  ok(v.info.triangles[2] > 900 && v.info.triangles[2] < 2600, `LOD2 is ~1.8 k triangles (${v.info.triangles[2]}) in 2 draws`);
  ok(v.members.every((m) => !m.root.visible && m.lod0.every((s) => !s.visible) && !m.body1.visible && !m.body2.visible), 'nothing shows before the first state');
  ok(Math.abs(v.members[HEAD_SLOT].root.scale.x - HEAD_SCALE) < 1e-9 && HEAD_SCALE === 1.8 && v.members[0].root.scale.x === 1, 'the head is the same model at 1.8, the others at 1');
  // LOD1 / LOD2: valid geometry in the same skinning space
  for (const [nm, g] of [['LOD1', v.members[0].body1.geometry], ['LOD2', v.members[0].body2.geometry]]) {
    let valid = true;
    for (let i = 0; i < g.index.count; i++) if (!(g.index.getX(i) < g.attributes.position.count)) valid = false;
    for (let i = 0; i < g.attributes.position.count; i++) {
      const sum = g.attributes.skinWeight.getX(i) + g.attributes.skinWeight.getY(i) + g.attributes.skinWeight.getZ(i) + g.attributes.skinWeight.getW(i);
      if (!(Math.abs(sum - 1) < 0.03) || !isFinite(g.attributes.position.getX(i)) || !isFinite(g.attributes.normal.getX(i))) valid = false;
    }
    ok(valid && g.attributes.color && g.index.count % 3 === 0, `${nm}: indices in range, weights normalised, finite, with baked colours`);
  }
}

// the throat's weights: a partition of unity, the ring pure Maw, nothing lost
{
  const m0 = v.members[0];
  const names = m0.bones.map((b) => b.name);
  const maw = names.indexOf('Maw');
  const neckSet = new Set(names.map((n, i) => (/^Neck\d\d$/.test(n) ? i : -1)).filter((i) => i >= 0));
  let bad = 0;
  let throatVerts = 0;
  let ringVerts = 0;
  let ringNotMaw = 0;
  let memNotMaw = 0;
  for (const s of [...m0.lod0, m0.glow]) {
    const g = s.geometry;
    const si = g.attributes.skinIndex;
    const sw = g.attributes.skinWeight;
    for (let i = 0; i < sw.count; i++) {
      const sum = sw.getX(i) + sw.getY(i) + sw.getZ(i) + sw.getW(i);
      if (Math.abs(sum - 1) > 0.02) bad++;
      let nw = 0;
      let mw = 0;
      for (let k = 0; k < 4; k++) {
        if (sw.getComponent(i, k) > 0 && neckSet.has(si.getComponent(i, k))) nw += sw.getComponent(i, k);
        if (sw.getComponent(i, k) > 0 && si.getComponent(i, k) === maw) mw += sw.getComponent(i, k);
      }
      if (nw > 0) throatVerts++;
      if (mw >= 0.99) ringVerts++;
      if (s === m0.glow && mw < 0.99) memNotMaw++;
    }
  }
  ok(bad === 0, 'every skin weight in the pool\'s geometry is normalised');
  ok(throatVerts > 8000, `the throat vertices are rebuilt (${throatVerts})`);
  ok(ringVerts > 500 && memNotMaw === 0 && ringNotMaw === 0, `the ring and its membrane are pure Maw (${ringVerts} vertices)`);
  // a vertex between two links takes (1 - f, f) of the two: at most two throat bones per vertex
  let manyBones = 0;
  const skin = m0.lod0.find((s) => s.name === 'usher_skin').geometry;
  for (let i = 0; i < skin.attributes.skinWeight.count; i++) {
    let c = 0;
    for (let k = 0; k < 4; k++) if (skin.attributes.skinWeight.getComponent(i, k) > 0 && neckSet.has(skin.attributes.skinIndex.getComponent(i, k))) c++;
    if (c > 2) manyBones++;
  }
  ok(manyBones === 0, 'a throat vertex follows at most two neighbouring links');
}

// ---------------------------------------------------------------------------------------------------------------------
// 3. States, slots, placement
// ---------------------------------------------------------------------------------------------------------------------
{
  const list = [st({ id: 'head', head: true, x: 0, y: 0, z: 4, yaw: 0.5 }), st({ id: 'a', x: -3, z: 0, yaw: -1 }), st({ id: 'b', x: 3, z: 1, clip: 'Walk', t: 0.3 })];
  frames(v, list, 3);
  const h = slotOf(v, 'head');
  const a = slotOf(v, 'a');
  const b = slotOf(v, 'b');
  ok(h && h.index === HEAD_SLOT && h.head && a && !a.head && b && !b.head, 'the head takes the head slot, the others the ordinary ones');
  ok(h.root.visible && a.root.visible && b.root.visible, 'used members show');
  ok(v.members.filter((m) => m.root.visible).length === 3 && v.members.filter((m) => !m.used).every((m) => !m.root.visible), 'unused pool members are hidden');
  ok(v.stats.shown === 3 && v.stats.poolSize === POOL_SIZE, 'stats: 3 shown of a pool of 6');
  ok(Math.abs(h.root.scale.x - 1.8) < 1e-9 && Math.abs(h.root.scale.y - 1.8) < 1e-9 && a.root.scale.x === 1, 'the head is posed at scale 1.8');
  ok(h.root.position.z === 4 && a.root.position.x === -3 && Math.abs(h.root.rotation.y - 0.5) < 1e-9 && Math.abs(a.root.rotation.y + 1) < 1e-9, 'position and yaw are applied (yaw 0 faces +z)');
  const maw = new THREE.Vector3();
  h.root.updateMatrixWorld(true);
  h.maw.getWorldPosition(maw);
  ok(maw.y > 3.0 && maw.y < 6.5, `the head's ring hangs at ${maw.y.toFixed(2)} m (a 3.5 m man, a throat of 6.75 m)`);

  // the caller reuses its objects: a mutation after setStates must not leak into the pool until the next setStates
  list[1].x = 99;
  v.update(0.05, camera);
  ok(slotOf(v, 'a').root.position.x === -3, 'the states are copied, not kept');
  // stickiness: the same ids keep their slots when the list is reordered
  const ia = a.index;
  const ib = b.index;
  frames(v, [list[2], list[0], st({ id: 'a', x: -3, z: 0 })], 2);
  ok(slotOf(v, 'a').index === ia && slotOf(v, 'b').index === ib, 'an usher keeps its pool slot while its id stays in the list');
  // a state that leaves hides its member
  frames(v, [st({ id: 'a', x: -3 })], 2);
  ok(v.stats.shown === 1 && !v.members[ib].root.visible && !v.members[HEAD_SLOT].root.visible, 'ushers that leave the list are hidden');
  // visible:false keeps the slot but draws no body
  frames(v, [st({ id: 'a', x: -3, visible: false })], 2);
  ok(v.stats.shown === 0 && v.stats.drawCalls === 0 && !v.members[ia].root.visible, 'visible:false draws no body');
  frames(v, [], 2);
  ok(v.stats.shown === 0 && v.members.every((m) => !m.root.visible && !m.used), 'an empty list hides everything');
  frames(v, null, 1);
  ok(v.stats.shown === 0, 'a null list is an empty list');
  frames(v, [null, undefined, st({ id: 'z', x: NaN, y: 'a', z: undefined, yaw: Infinity, t: -3 })], 2);
  const z = slotOf(v, 'z');
  ok(z && z.root.position.x === 0 && z.root.position.y === 0 && z.root.rotation.y === 0 && isFinite(z.t), 'junk entries and non-finite numbers do not break it');
}
// the head's `pos` in the sim is its collar: `collar: true` puts the collar there
{
  for (const yaw of [0, 0.9, -2.2]) {
    frames(v, [st({ id: 'h', head: true, x: 5, y: 10, z: -3, yaw, collar: true })], 3);
    const m = slotOf(v, 'h');
    m.root.updateMatrixWorld(true);
    const c = bonePos(m, 'Neck01').getWorldPosition(new THREE.Vector3());
    ok(c.distanceTo(new THREE.Vector3(5, 10, -3)) < 0.08, `collar: true puts the base of the throat at x, y, z whatever the yaw (${yaw}): ${(c.distanceTo(new THREE.Vector3(5, 10, -3)) * 100).toFixed(1)} cm off (the spine sways in the pose)`);
  }
  frames(v, [st({ id: 'h', head: true, x: 5, y: 10, z: -3, yaw: 0 })], 3);
  ok(slotOf(v, 'h').root.position.y === 10, 'without it x, y, z are the feet');
  frames(v, [st({ id: 'o', x: 1, y: 2, z: 3, yaw: 1, collar: true })], 3);
  const oc = slotOf(v, 'o');
  oc.root.updateMatrixWorld(true);
  ok(bonePos(oc, 'Neck01').getWorldPosition(new THREE.Vector3()).distanceTo(new THREE.Vector3(1, 2, 3)) < 0.06, 'and the same for an ordinary usher (its collar is lower, 1 x)');
  frames(v, [], 3);
}
// more ushers than the pool
{
  const list = [];
  for (let i = 0; i < 9; i++) list.push(st({ id: 'o' + i, x: i * 4 - 16, z: 8 }));
  list.push(st({ id: 'H', head: true, z: 20 }));
  list.push(st({ id: 'H2', head: true, z: 30 }));
  frames(v, list, 3);
  ok(v.stats.shown === POOL_SIZE, 'a list longer than the pool draws 6');
  ok(slotOf(v, 'H') && slotOf(v, 'H').head && !slotOf(v, 'H2'), 'the head is always drawn, a second head is not');
  const ids = v.members.filter((m) => m.used && !m.head).map((m) => m.id).sort();
  // the camera is at x = 0: the five ordinary ones nearest to it are the middle five (x = -8 .. 8)
  ok(ids.join(',') === 'o2,o3,o4,o5,o6', `of nine ordinary ushers the five nearest the camera are drawn (${ids.join(',')})`);
  // a list of 70 entries (more than the scratch) is still fine
  const big = [];
  for (let i = 0; i < 70; i++) big.push(st({ id: 'b' + i, x: i, z: 3 }));
  frames(v, big, 1);
  ok(v.stats.shown === POOL_ORDINARY, 'a very long list is capped, five ordinary drawn');
  frames(v, [], 2);
}

// ---------------------------------------------------------------------------------------------------------------------
// 4. Clips
// ---------------------------------------------------------------------------------------------------------------------
{
  const M = (clip, t, id = 'c') => {
    frames(v, [st({ id, clip, t })], 12, 0.05);
    return slotOf(v, id);
  };
  const q = (m, n) => bonePos(m, n).quaternion.clone();
  const idle = q(M('Idle', 0.4), 'Neck07');
  const lunge = q(M('Lunge', 0.9), 'Neck07');
  ok(quatDist(idle, lunge) > 0.2, 'Idle and Lunge pose the throat differently');
  const walkA = q(M('Walk', 0.3), 'Thigh_L');
  const walkB = q(M('Walk', 0.3 + 1.375), 'Thigh_L');
  const walkC = q(M('Walk', 0.3 + 0.55), 'Thigh_L');
  ok(quatDist(walkA, walkB) < 1e-3 && quatDist(walkA, walkC) > 0.02, 'a looping clip wraps t (Walk at t and t + its length are the same pose)');
  const l1 = q(M('Lunge', 1.6), 'Neck07');
  const l2 = q(M('Lunge', 9), 'Neck07');
  const l0 = q(M('Lunge', 0), 'Neck07');
  const lm = q(M('Lunge', 0.6), 'Neck07');
  ok(quatDist(l1, l2) < 1e-3 && quatDist(l0, lm) > 0.05 && quatDist(lm, l1) > 0.05, 'a once clip holds its last pose (Lunge at 9 s = at its end) and starts at its first');
  const i1 = q(M('Idle', 0.7), 'Neck05');
  const s1 = q(M('Sit', 0.7), 'Neck05');
  ok(quatDist(i1, s1) < 1e-3, "a clip the model lacks (Sit) falls back to Idle");
  const d1 = q(M('Dance', 0.7), 'Neck05');
  ok(quatDist(i1, d1) < 1e-3, 'an unknown clip name is Idle');
  const lis = q(M('Listen', 1.0), 'Neck12');
  ok(quatDist(lis, q(M('Idle', 1.0), 'Neck12')) > 0.003, 'Listen is its own clip');
  // scrubbing: the pose follows t both ways
  const fwd = q(M('Lunge', 0.3), 'Neck07');
  const mid = q(M('Lunge', 0.8), 'Neck07');
  const back = q(M('Lunge', 0.3), 'Neck07');
  ok(quatDist(fwd, mid) > 0.03 && quatDist(fwd, back) < 1e-3, 'the clip is scrubbed by t (the sim drives COIL / WHIP / RECOIL), in either direction');
  // the ring opens in the Lunge (the Maw scale), compensated for the pure-Maw ring
  const open = M('Lunge', 0.77).maw.scale.x;
  ok(open > 1.2 && open < 1.7, `the ring opens in the Lunge (Maw scale ${open.toFixed(2)})`);
  // crossfade: the frame a clip changes is still the old pose, and it arrives within ~0.2 s
  frames(v, [st({ id: 'x', clip: 'Idle', t: 0.4 })], 12, 0.05);
  const from = q(slotOf(v, 'x'), 'Neck07');
  const target = (() => {
    frames(v, [st({ id: 'tmp', clip: 'Lunge', t: 0.9 })], 12, 0.05);
    return q(slotOf(v, 'tmp'), 'Neck07');
  })();
  frames(v, [st({ id: 'x', clip: 'Idle', t: 0.4 }), st({ id: 'tmp2', clip: 'Idle', t: 0 })], 12, 0.05);
  frames(v, [st({ id: 'x', clip: 'Lunge', t: 0.9 })], 1, 0.016);
  const first = q(slotOf(v, 'x'), 'Neck07');
  ok(quatDist(first, from) < quatDist(first, target), 'a clip change crossfades: the first frame is still near the old pose');
  frames(v, [st({ id: 'x', clip: 'Lunge', t: 0.9 })], 6, 0.05);
  ok(quatDist(q(slotOf(v, 'x'), 'Neck07'), target) < 1e-3, 'and 0.3 s later it is the new one');
  frames(v, [], 2);
}

// ---------------------------------------------------------------------------------------------------------------------
// 5. The long throat
// ---------------------------------------------------------------------------------------------------------------------
{
  const setup = async (opts) => {
    const r = await make(opts);
    return r.v;
  };
  const measure = (view, stretch, id = 'h', head = true) => {
    const list = [st({ id, head, stretch, clip: 'Idle', t: 0.5 })];
    frames(view, list, 8, 0.05);
    const m = slotOf(view, id);
    return { m, len: throatLen(m), skin: posed(m, 'skin'), vein: posed(m, 'vein'), radius: m.bs.radius };
  };
  const a = measure(v, 1);
  const b = measure(v, 3);
  const c = measure(v, 5.5);
  ok(Math.abs(b.len / a.len - 3) < 0.01 && Math.abs(c.len / a.len - 5.5) < 0.01, `the throat from the collar to the ring grows exactly by stretch (${a.len.toFixed(2)} -> ${b.len.toFixed(2)} -> ${c.len.toFixed(2)} m)`);
  // the head at stretch 1: 6.75 m of throat when straight (3.75 m x 1.8): its coiled chord is shorter
  ok(a.len > 1.5 && a.len < 6.75, `at stretch 1 the coiled throat is ${a.len.toFixed(2)} m from collar to ring (6.75 m of tube)`);
  const bba = bbox(a.vein);
  const bbb = bbox(b.vein);
  const dia = bba.max.distanceTo(bba.min);
  const dib = bbb.max.distanceTo(bbb.min);
  ok(dib > dia * 2.2, `the posed throat mesh (veins) is ${(dib / dia).toFixed(1)} x longer in its bounding box at stretch 3`);
  const bsk = bbox(b.skin);
  ok(bsk.max.y - bsk.min.y > bbox(a.skin).max.y - bbox(a.skin).min.y + 2, 'and so is the skin mesh (it ends well above the body)');
  ok(b.radius > a.radius * 2 && c.radius > b.radius, `the frustum bounds follow the stretch (${a.radius.toFixed(1)} -> ${b.radius.toFixed(1)} -> ${c.radius.toFixed(1)} m)`);
  // the thickness does not change: no shear, no thinning: the radius of the tube near its middle stays
  const widthAt = (arr, y0, y1) => {
    let mn = 1e9;
    let mx = -1e9;
    for (let i = 0; i < arr.length; i += 3) if (arr[i + 1] >= y0 && arr[i + 1] <= y1) {
      mn = Math.min(mn, arr[i]);
      mx = Math.max(mx, arr[i]);
    }
    return mx - mn;
  };
  void widthAt;
  // no tears: no edge of the throat mesh is stretched more than the throat itself (plus the tight bends' share)
  const skinGeo = b.m.lod0.find((s) => s.name === 'usher_skin').geometry;
  const g1 = edgeGrowth(skinGeo, a.skin, a.skin, 1);
  const g3 = edgeGrowth(skinGeo, a.skin, b.skin, 3.5);
  const g55 = edgeGrowth(skinGeo, a.skin, c.skin, 6.5);
  ok(g1.max < 1.0001, 'a pose against itself is not stretched');
  // (the inside of the tight hook of the throat must grow more than the stretch: the angles stay, the radius of the bend scales, the tube does not)
  ok(g3.max < 6 && g3.over / g3.total < 0.015, `stretch 3: the skin's worst edge grows ${g3.max.toFixed(1)}x (${g3.over} of ${g3.total} edges beyond 3.5x): the tube is continuous`);
  ok(g55.max < 11.5 && g55.over / g55.total < 0.02, `stretch 5.5: the worst edge grows ${g55.max.toFixed(1)}x (${g55.over} beyond 6.5x)`);
  const gv = edgeGrowth(b.m.lod0.find((s) => s.name === 'usher_vein').geometry, a.vein, b.vein, 3.5);
  ok(gv.max < 11 && gv.over / gv.total < 0.02, `the veins and thorns follow the tube (worst edge ${gv.max.toFixed(1)}x)`);
  // the ring stays on the tube: the membrane sits at the Maw bone, not left behind
  const mem = posed(b.m, 'skin');
  void mem;
  b.m.root.updateMatrixWorld(true);
  const ringMesh = new THREE.Box3();
  const gl = posed(b.m, 'glow');
  ringMesh.copy(bbox(gl));
  const mw = b.m.maw.getWorldPosition(new THREE.Vector3());
  const toWorld = new THREE.Vector3((ringMesh.min.x + ringMesh.max.x) / 2, (ringMesh.min.y + ringMesh.max.y) / 2, (ringMesh.min.z + ringMesh.max.z) / 2).applyMatrix4(b.m.root.matrixWorld);
  ok(toWorld.distanceTo(mw) < 0.4 * HEAD_SCALE, `the glowing membrane is carried to the end of the stretched throat (${toWorld.distanceTo(mw).toFixed(2)} m from the Maw bone)`);
  // the same control with the ORIGINAL weights tears (that is why they are rebuilt)
  const ctl = await setup({ reweight: false });
  const ca = measure(ctl, 1);
  const cb = measure(ctl, 3);
  const cg = edgeGrowth(cb.m.lod0.find((s) => s.name === 'usher_skin').geometry, ca.skin, cb.skin, 3.5);
  ok(cg.max > g3.max * 3 && cg.over > g3.over * 2, `control: the file's own weights tear at stretch 3 (worst edge ${cg.max.toFixed(0)}x, ${cg.over} edges beyond 3.5x)`);
  ctl.dispose();
  // the ordinary ushers ignore stretch; bad values clamp
  const o1 = measure(v, 1, 'o', false);
  const o3 = measure(v, 4, 'o', false);
  ok(Math.abs(o3.len - o1.len) < 1e-6 && o3.m.stretch === 1, 'an ordinary usher ignores `stretch`');
  const lo = measure(v, 0.2);
  ok(Math.abs(lo.len - a.len) < 1e-6 && lo.m.stretch === 1, 'a stretch below 1 is 1');
  ok(measure(v, NaN).m.stretch === 1 && measure(v, undefined).m.stretch === 1, 'a missing or NaN stretch is 1');
  ok(measure(v, 1000).m.stretch === STRETCH_MAX, `and one beyond ${STRETCH_MAX} is ${STRETCH_MAX}`);
  // the stretch does not leak into the next pose (positions are rewritten from the clip every frame)
  const back = measure(v, 1);
  ok(Math.abs(back.len - a.len) < 1e-6, 'going back to stretch 1 restores the throat exactly');
  // each link grows evenly (an even tube, not a bunched one)
  const heads = slotOf(v, 'h') || back.m;
  void heads;
  frames(v, [], 2);
}

// ---------------------------------------------------------------------------------------------------------------------
// 6. The torch
// ---------------------------------------------------------------------------------------------------------------------
{
  const hex = (view, i) => view.spheres[i].material.uniforms.uColor.value.getHexString();
  const sph = (stage, over = {}) => ({ x: 2, y: 1.5, z: 6, r: 3, stage, ...over });
  const list = (sp, ring) => [st({ id: 'a', x: -1, z: 0, sphere: sp, ring })];
  frames(v, [], 30, 0.05); // nothing left over
  ok(v.spheres.every((s) => !s.visible) && !v.stats.sphereShown && !v.line.visible, 'no sphere, no line when there are no states');
  frames(v, list(sph('listen')), 20, 0.05);
  const m = slotOf(v, 'a');
  const mesh = v.spheres[m.index];
  ok(mesh.visible && v.stats.sphereShown && mesh.position.x === 2 && mesh.position.y === 1.5 && mesh.position.z === 6 && mesh.scale.x === 3, 'the sphere mesh sits on the state\'s sphere with its radius');
  ok(hex(v, m.index) === 'b8e8ff', `listen: pale cyan-white (#${hex(v, m.index)})`);
  const uni = mesh.material.uniforms;
  const iListen = uni.uI.value;
  ok(iListen > 0.4 && iListen < 0.75, `listen is pale and wide, not bright (${iListen.toFixed(2)})`);
  ok(mesh.material.blending === THREE.AdditiveBlending && mesh.material.depthWrite === false && mesh.material.depthTest === true && mesh.material.fog === false && mesh.material.toneMapped === false && mesh.material.transparent, 'additive, no depth write, depth test on, no fog, not tone mapped');
  ok(mesh.geometry.index.count / 3 >= 300 && mesh.geometry.index.count / 3 <= 600, `a shell of ${mesh.geometry.index.count / 3} triangles`);
  ok(v.spheres.every((s) => s.geometry === mesh.geometry), 'the spheres share one geometry (a mesh each, up to 6)');
  // it follows the state (the sim moves it)
  frames(v, list(sph('listen', { x: -4, y: 2, z: 9, r: 3.4 })), 1, 0.016);
  ok(mesh.position.x === -4 && mesh.position.z === 9 && mesh.scale.x === 3.4, 'it follows the sphere as the sim moves it');
  // coil: the radius tightens, it warms and brightens
  frames(v, list(sph('coil', { r: 3 })), 2, 0.016);
  const coilStart = hex(v, m.index);
  const iCoil0 = uni.uI.value;
  for (let r = 3; r > 1.8; r -= 0.1) frames(v, list(sph('coil', { r })), 6, 0.016);
  const col = uni.uColor.value;
  const listenCol = new THREE.Color('#b8e8ff');
  ok(uni.uI.value > iCoil0 && uni.uI.value > iListen, `coil brightens as it tightens (${iCoil0.toFixed(2)} -> ${uni.uI.value.toFixed(2)})`);
  ok(col.r >= listenCol.r - 1e-6 && col.b < listenCol.b && hex(v, m.index) !== coilStart, `and warms toward gold (#${hex(v, m.index)})`);
  ok(uni.uPow.value > 2.8, 'and its rim sharpens');
  frames(v, list(sph('commit', { r: 1.8 })), 20, 0.016);
  ok(hex(v, m.index) === 'ffc24d' && uni.uI.value > 0.97, 'commit: GOLD (#ffc24d)');
  const iCommit = uni.uI.value;
  const phase1 = uni.uI.value;
  frames(v, list(sph('commit', { r: 1.8 })), 17, 0.016);
  ok(Math.abs(uni.uI.value - phase1) < 1e-3 && uni.uColor.value.getHexString() === 'ffc24d', 'and frozen: no pulse while committed');
  frames(v, list(sph('whip', { r: 1.8 })), 1, 0.016);
  ok(hex(v, m.index) === 'fff1c4' && uni.uI.value > iCommit, `whip: a white-gold flash (#${hex(v, m.index)})`);
  ok(uni.uI.value / iCommit < 1.3, `the flash steps the light by ${((uni.uI.value / iCommit - 1) * 100).toFixed(0)} % (comfort limit 30 %)`);
  frames(v, list(sph('whip', { r: 1.8 })), 30, 0.016);
  ok(uni.uI.value < iCommit * 1.05, 'and settles');
  // snuff (sim/usher3d.js: the Round's 2 m sphere on a lamp cluster for ~1.5 s, then the dip): steady and warm, brightening, white-gold while lethal
  frames(v, list(null), 60, 0.016);
  frames(v, list(sph('snuff', { r: 2 })), 3, 0.016);
  const sn0 = uni.uI.value;
  ok(mesh.visible && hex(v, m.index) === 'ffe2a8' && sn0 < 0.6, `snuff: a warm sphere that starts dim (${sn0.toFixed(2)}), not the dying one`);
  frames(v, list(sph('snuff', { r: 2 })), 120, 0.016);
  ok(mesh.visible && uni.uI.value > sn0 + 0.25 && uni.uI.value < 1, `and brightens through the warning (${uni.uI.value.toFixed(2)}) without vanishing`);
  frames(v, list(sph('snuff', { r: 2, lethal: true })), 1, 0.016);
  ok(hex(v, m.index) === 'fff1c4' && uni.uI.value > 0.9, 'while it is lethal (the dip) it flashes white-gold');
  frames(v, list(sph('snuff', { r: 2 })), 4, 0.016);
  ok(hex(v, m.index) === 'ffe2a8', 'and back to warm when it is not');
  // the sphere goes away (RECOIL: the sim gives null): it dies where it was
  const iBefore = uni.uI.value;
  frames(v, list(null), 3, 0.016);
  ok(mesh.visible && uni.uI.value < iBefore && uni.uI.value > 0.1, 'a sphere that goes away starts to die, not a pop');
  frames(v, list(null), 40, 0.016);
  ok(!mesh.visible && !v.stats.sphereShown, 'and is gone within a second');
  // a sphere that simply goes null fades too, where it was
  frames(v, list(sph('commit')), 12, 0.016);
  ok(mesh.visible, 'a new sphere shows again');
  frames(v, list(null), 2, 0.016);
  ok(mesh.visible && mesh.position.x === 2 && mesh.position.z === 6, 'a sphere that goes null fades out where it was');
  frames(v, list(null), 60, 0.016);
  ok(!mesh.visible, 'and is gone');
  // unknown stage = listen
  frames(v, list(sph('mystery')), 12, 0.05);
  ok(hex(v, m.index) === 'b8e8ff', 'an unknown stage reads as listen');
  // a state with a sphere but not visible: the sphere shows (a telegraph is gameplay), the body does not
  frames(v, [st({ id: 'a', x: -1, visible: false, sphere: sph('listen') })], 12, 0.05);
  ok(!slotOf(v, 'a').root.visible && v.spheres[slotOf(v, 'a').index].visible && v.stats.shown === 0, 'a hidden usher still shows its sphere');
  // up to six spheres at once, one mesh each
  const six = [];
  for (let i = 0; i < 5; i++) six.push(st({ id: 'm' + i, x: i * 3 - 6, z: 2, sphere: sph('listen', { x: i * 3 - 6, z: 8 }) }));
  six.push(st({ id: 'H', head: true, z: 14, sphere: sph('commit', { x: 0, z: 25, r: 2.6 }) }));
  frames(v, six, 20, 0.05);
  ok(v.spheres.filter((s) => s.visible).length === 6, 'six spheres at once');
  ok(new Set(v.spheres.map((s) => s.material)).size === 6, 'each with its own material (its own stage colour)');
  ok(hex(v, HEAD_SLOT) === 'ffc24d' && hex(v, slotOf(v, 'm0').index) === 'b8e8ff', 'each shell has its own colour');
  frames(v, [], 60, 0.05);
  ok(v.spheres.every((s) => !s.visible), 'all gone');

  // the line back to the ring
  const lineAt = (k) => {
    const p = v.line.geometry.attributes.position.array;
    const mid = (a, b) => new THREE.Vector3((p[k * 12 + a * 3] + p[k * 12 + b * 3]) / 2, (p[k * 12 + a * 3 + 1] + p[k * 12 + b * 3 + 1]) / 2, (p[k * 12 + a * 3 + 2] + p[k * 12 + b * 3 + 2]) / 2);
    return { ring: mid(0, 1), sphere: mid(2, 3), width: Math.hypot(p[k * 12] - p[k * 12 + 3], p[k * 12 + 1] - p[k * 12 + 4], p[k * 12 + 2] - p[k * 12 + 5]) };
  };
  frames(v, list(sph('listen'), { x: 0.5, y: 2.1, z: 0.3 }), 12, 0.05);
  ok(v.line.visible, 'a sphere draws its line');
  const L = lineAt(0);
  ok(L.ring.distanceTo(new THREE.Vector3(0.5, 2.1, 0.3)) < 1e-4 && L.sphere.distanceTo(new THREE.Vector3(2, 1.5, 6)) < 1e-4, "the line runs from the sim's ring to the sphere's centre");
  ok(L.width > 0.02 && L.width < 0.12, `and is thin (${(L.width * 100).toFixed(1)} cm across at this range)`);
  frames(v, list(sph('listen'), null), 12, 0.05);
  const L2 = lineAt(0);
  const ma = slotOf(v, 'a');
  ma.root.updateMatrixWorld(true);
  const lip = new THREE.Vector3(0, 0.1, 0).applyMatrix4(ma.maw.matrixWorld);
  ok(L2.ring.distanceTo(lip) < 1e-4 && L2.ring.y > 1.4 && L2.ring.y < 3.6, `with no ring in the state it is read off the skeleton (the lip of the Maw bone, y ${L2.ring.y.toFixed(2)})`);
  // a line far away stays about as thick on screen
  const far = new THREE.PerspectiveCamera();
  far.position.set(0, 1.6, -60);
  far.updateMatrixWorld(true);
  frames(v, list(sph('listen'), { x: 0.5, y: 2.1, z: 0.3 }), 4, 0.05, far);
  ok(lineAt(0).width > L.width * 2, 'the line widens with distance (a constant angular width)');
  // the line is one draw for all spheres
  ok(v.line.geometry.index.count === POOL_SIZE * 6, 'one batched ribbon for up to six lines');
  frames(v, [], 60, 0.05);
  ok(!v.line.visible, 'no line without a sphere');

  // reduced effects: a thin outline, no pulse
  v.setReducedEffects(true);
  frames(v, list(sph('listen')), 40, 0.05);
  ok(uni.uFill.value === 0 && uni.uPow.value >= 6, 'reduced effects draws the sphere as an outline (no fill, a thin sharp rim)');
  const r1 = uni.uI.value;
  frames(v, list(sph('listen')), 5, 0.07);
  ok(Math.abs(uni.uI.value - r1) < 1e-3, 'and does not pulse');
  v.setReducedEffects(false);
  frames(v, [], 60, 0.05);
}

// ---------------------------------------------------------------------------------------------------------------------
// 7. Levels of detail, glints, stats
// ---------------------------------------------------------------------------------------------------------------------
{
  const at = (z) => st({ id: 'f', x: 0, z });
  const lodShown = (view, id) => {
    const m = slotOf(view, id);
    return { lod0: m.lod0[0].visible, glow: m.glow.visible, l1: m.body1.visible, l2: m.body2.visible, root: m.root.visible, lod: m.lod };
  };
  const cam = new THREE.PerspectiveCamera();
  cam.position.set(0, 1.6, -1);
  cam.updateMatrixWorld(true);
  frames(v, [at(4)], 3, 0.05, cam);
  let s = lodShown(v, 'f');
  ok(s.lod0 && s.glow && !s.l1 && !s.l2 && s.lod === 0, 'near: the full model');
  ok(v.stats.drawCalls === 6 && v.stats.triangles === v.info.triangles[0] && v.stats.lods[0] === 1, `stats near: 6 draws, ${v.stats.triangles} triangles`);
  frames(v, [at(20)], 3, 0.05, cam);
  s = lodShown(v, 'f');
  ok(!s.lod0 && s.glow && s.l1 && !s.l2, 'mid: LOD1 (the clustered body) + the glow');
  ok(v.stats.drawCalls === 2 && v.stats.triangles === v.info.triangles[1] && v.stats.lods[1] === 1, `stats mid: 2 draws, ${v.stats.triangles} triangles`);
  frames(v, [at(50)], 3, 0.05, cam);
  s = lodShown(v, 'f');
  ok(!s.lod0 && s.glow && !s.l1 && s.l2 && v.stats.drawCalls === 2 && v.stats.triangles === v.info.triangles[2], `far: LOD2 (${v.stats.triangles} triangles)`);
  frames(v, [at(110)], 3, 0.05, cam);
  s = lodShown(v, 'f');
  ok(!s.lod0 && !s.glow && !s.l1 && !s.l2 && !s.root && s.lod === 3, 'beyond 70 m: no mesh');
  ok(v.glints.visible && v.stats.drawCalls === 1 && v.stats.shown === 1 && v.stats.lods[3] === 1 && v.stats.triangles === 2, 'only the ring glint is drawn (one batch, one quad)');
  {
    const p = v.glints.geometry.attributes.position.array;
    const c = new THREE.Vector3(0, 0, 0);
    for (let k = 0; k < 4; k++) c.add(new THREE.Vector3(p[k * 3], p[k * 3 + 1], p[k * 3 + 2]));
    c.multiplyScalar(0.25);
    ok(Math.abs(c.z - 110) < 1.5 && c.y > 1.2 && c.y < 3.6, `the glint sits on the ring (${c.y.toFixed(1)} m up)`);
    const wq = Math.hypot(p[0] - p[3], p[1] - p[4], p[2] - p[5]);
    ok(wq > 0.5, `and is big enough to see at 110 m (${(wq * 100).toFixed(0)} cm across)`);
  }
  frames(v, [at(GLINT_FAR + 30)], 3, 0.05, cam);
  ok(v.stats.shown === 0 && v.stats.drawCalls === 0 && !v.glints.visible && lodShown(v, 'f').lod === -1, `beyond ${GLINT_FAR} m nothing at all`);
  // hysteresis in motion: crossing the LOD0/LOD1 switch back and forth does not flicker
  const sw = LOD_DIST.quest[0];
  frames(v, [at(4)], 3, 0.05, cam);
  frames(v, [at(sw - 1 - 0.2)], 1, 0.05, cam); // camera is at z = -1 -> distance sw - 0.2
  const l0 = lodShown(v, 'f').lod;
  frames(v, [at(sw - 1 + 0.5)], 1, 0.05, cam);
  const l1 = lodShown(v, 'f').lod;
  frames(v, [at(sw - 1 - 0.5)], 1, 0.05, cam);
  const l2 = lodShown(v, 'f').lod;
  frames(v, [at(sw - 1 - 2.5)], 1, 0.05, cam);
  const l3 = lodShown(v, 'f').lod;
  ok(l0 === 0 && l1 === 1 && l2 === 1 && l3 === 0, 'a finer LOD is not taken back the moment the switch distance is crossed back (hysteresis), only 2 m inside it');
  // tiers
  v.setTier('low');
  frames(v, [at(15)], 3, 0.05, cam);
  const lowLod = lodShown(v, 'f').lod;
  v.setTier('high');
  frames(v, [at(15)], 3, 0.05, cam);
  ok(lowLod >= 1 && lodShown(v, 'f').lod === 0, 'the low tier drops the detail sooner, the high tier later (14 m)');
  v.setTier(null);
  // the head is judged by distance / 1.8
  frames(v, [st({ id: 'f', head: true, z: 18 })], 3, 0.05, cam);
  const hq = lodShown(v, 'f').lod;
  frames(v, [st({ id: 'g', head: false, z: 18 })], 3, 0.05, cam);
  ok(hq === 0 && lodShown(v, 'g').lod === 1, 'the head keeps the full model farther out (19 m: head LOD0, ordinary LOD1)');
  frames(v, [], 3);

  // no ink hulls any more (the cel look and its outlines are gone): six draws near, two mid, two far
  frames(v, [at(4)], 3, 0.05, cam);
  const mm = slotOf(v, 'f');
  ok(v.stats.drawCalls === 6 && v.stats.triangles === v.info.triangles[0] && !('hullNear' in mm) && !('hulls' in v.stats), 'near: the model alone in 6 draws, no outline hull');
  frames(v, [at(20)], 3, 0.05, cam);
  ok(v.stats.drawCalls === 2, 'mid: the cheap body and the glow (2 draws)');
  frames(v, [], 3);

  // the worst case: six ushers, all near, six spheres
  const worst = [];
  for (let i = 0; i < 5; i++) worst.push(st({ id: 'w' + i, x: i - 2, z: 3, sphere: { x: i, y: 1.5, z: 9, r: 3, stage: 'coil' } }));
  worst.push(st({ id: 'WH', head: true, x: 0, z: 9, stretch: 4, sphere: { x: 0, y: 3, z: 20, r: 4.4, stage: 'listen' } }));
  frames(v, worst, 10, 0.05, cam);
  ok(v.stats.shown === 6 && v.stats.drawCalls <= 150, `the worst case is ${v.stats.drawCalls} draw calls (<= 150), ${v.stats.triangles} triangles`);
  ok(v.stats.drawCalls === 6 * 6 + 6 + 1 && v.stats.sphereShown, 'six ushers in 6 draws each, six shells, one line');
  frames(v, [], 60, 0.05);
}

// ---------------------------------------------------------------------------------------------------------------------
// 8. No allocation, dispose
// ---------------------------------------------------------------------------------------------------------------------
{
  const list = [];
  for (let i = 0; i < 5; i++) list.push(st({ id: 'p' + i, x: i * 2 - 4, z: 3 + i * 9, clip: i % 2 ? 'Walk' : 'Listen', t: 0, sphere: i === 2 ? { x: 1, y: 1, z: 12, r: 2.5, stage: 'coil' } : null }));
  list.push(st({ id: 'PH', head: true, z: 25, stretch: 3, clip: 'Lunge', t: 0, sphere: { x: 0, y: 2, z: 40, r: 3, stage: 'commit' } }));
  let gc = null;
  try {
    v8.setFlagsFromString('--expose_gc');
    gc = vm.runInNewContext('gc');
  } catch {
    gc = null;
  }
  const frame = (i) => {
    for (let k = 0; k < list.length; k++) list[k].t = i * 0.016;
    v.setStates(list);
    v.update(0.016, camera);
    void v.stats;
  };
  for (let i = 0; i < 200; i++) frame(i); // warm up (the first frames build the shader-free caches, the JIT)
  if (gc) gc();
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < 3000; i++) frame(i);
  if (gc) gc();
  const grew = (process.memoryUsage().heapUsed - before) / 1e6;
  ok(grew < (gc ? 1.5 : 12), `no allocation per frame (${grew.toFixed(2)} MB over 3000 frames of six ushers)`);
  const t0 = performance.now();
  for (let i = 0; i < 1000; i++) frame(i);
  const ms = (performance.now() - t0) / 1000;
  ok(ms < 4, `CPU: ${ms.toFixed(2)} ms per frame for six ushers posed (desktop Node; Quest has the budget)`);
  frames(v, [], 60);
}
{
  const { v: d, renderer: r } = await make();
  frames(d, [st({ id: 'x', sphere: { x: 0, y: 1, z: 5, r: 2, stage: 'listen' } })], 3);
  let disposed = 0;
  const geo = d.members[0].lod0[2].geometry;
  geo.addEventListener('dispose', () => disposed++);
  d.spheres[0].geometry.addEventListener('dispose', () => disposed++);
  d.members[0].body1.geometry.addEventListener('dispose', () => disposed++);
  d.members[0].lod0[0].material.addEventListener('dispose', () => disposed++);
  d.glints.material.addEventListener('dispose', () => disposed++);
  d.dispose();
  ok(disposed === 5, 'dispose frees the shared and the cloned geometries and the materials');
  ok(r.scene.children.length === 0 && d.stats.poolSize === 0 && d.stats.shown === 0 && !d.ready, 'dispose empties the scene and the stats');
  d.setStates([st({})]);
  d.update(0.016, camera);
  d.dispose();
  ok(d.stats.shown === 0, 'and the view is inert afterwards (a second dispose is fine)');
  ok(v.members.length === 6, '(the other view is untouched)');
  v.dispose();
  ok(renderer.scene.children.length === 0, 'the main view disposed');
}

console.log(`${fail ? 'FAILED' : 'ok'}: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
