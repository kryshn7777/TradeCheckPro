// Node tests for the item models (src/render/itemModels.js; docs/abyssal-tether-3d/plans/ITEM_MODELS.md): the first aid case, the field
// dressing, the grenade and the revolver. Triangle / vertex caps per kind (48 pickups of the largest fit the Uint16 index), one merged
// geometry per kind, hand-sized and centred bounds, vertex colours, no NaN, deterministic (and no Math.random in the module), distinct
// silhouettes, the rest heights against the lying geometry, the pickups / dropped-props wiring, no allocation past the build.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register as reg } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VENDOR = pathToFileURL(path.resolve(HERE, '../../../../public/abyssal-tether-3d/vendor/three/')).href;
const SRC_DIR = path.resolve(HERE, '../../../../public/abyssal-tether-3d/src/');
const SRC = pathToFileURL(SRC_DIR).href;
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
const IM = await import(`${SRC}/render/itemModels.js`);
const { buildTemplates } = await import(`${SRC}/render/pickupsView.js`);
const { DroppedProps, dropRest } = await import(`${SRC}/render/droppedProps.js`);
const { ITEM } = await import(`${SRC}/sim/inventory3d.js`);

let n = 0;
const ok = (name, fn) => {
  fn();
  n++;
  console.log('  ok', name);
};

const KINDS = [
  ['FIRST_AID', IM.buildFirstAid],
  ['BANDAGE', IM.buildBandage],
  ['GRENADE', IM.buildGrenade],
  ['SIDEARM', IM.buildSidearm],
];
const bounds = (t, q = null) => {
  const mn = [Infinity, Infinity, Infinity];
  const mx = [-Infinity, -Infinity, -Infinity];
  const v = new THREE.Vector3();
  for (let i = 0; i < t.verts; i++) {
    v.set(t.pos[i * 3], t.pos[i * 3 + 1], t.pos[i * 3 + 2]);
    if (q) v.applyQuaternion(q);
    for (let a = 0; a < 3; a++) {
      mn[a] = Math.min(mn[a], v.getComponent(a));
      mx[a] = Math.max(mx[a], v.getComponent(a));
    }
  }
  return { mn, mx, size: mx.map((x, a) => x - mn[a]) };
};
const T = {};
for (const [name, b] of KINDS) T[name] = b(0);

ok('every kind is one merged, indexed, vertex-coloured template in the pickups format', () => {
  for (const [name] of KINDS) {
    const t = T[name];
    assert.ok(t.pos instanceof Float32Array && t.nor instanceof Float32Array && t.col instanceof Float32Array, name);
    assert.ok(t.idx instanceof Uint16Array, name);
    assert.equal(t.pos.length, t.verts * 3, name);
    assert.equal(t.nor.length, t.verts * 3, name);
    assert.equal(t.col.length, t.verts * 3, name);
    assert.equal(t.idx.length % 3, 0, name);
    for (let i = 0; i < t.idx.length; i++) assert.ok(t.idx[i] < t.verts, name + ' index in range');
  }
});

ok(`caps: <= ${IM.ITEM_MODEL_CAPS.tris} triangles and <= ${IM.ITEM_MODEL_CAPS.verts} vertices per kind; 48 pickups of the largest fit Uint16`, () => {
  let maxV = 0;
  for (const [name] of KINDS) {
    const t = T[name];
    const tris = t.idx.length / 3;
    assert.ok(tris >= 300 && tris <= IM.ITEM_MODEL_CAPS.tris, `${name} ${tris} triangles`);
    assert.ok(t.verts <= IM.ITEM_MODEL_CAPS.verts, `${name} ${t.verts} vertices`);
    maxV = Math.max(maxV, t.verts);
    console.log(`     ${name}: ${tris} triangles, ${t.verts} vertices`);
  }
  assert.ok(48 * Math.max(maxV, IM.ITEM_MODEL_CAPS.verts) <= 65535, 'MAX_ITEMS x cap fits a Uint16 index');
});

ok('no NaN, unit normals, colours in 0..1 (matte, dark-look palette: nothing near white)', () => {
  for (const [name] of KINDS) {
    const t = T[name];
    for (const a of [t.pos, t.nor, t.col]) for (let i = 0; i < a.length; i++) assert.ok(Number.isFinite(a[i]), name + ' finite');
    for (let i = 0; i < t.verts; i++) {
      const l = Math.hypot(t.nor[i * 3], t.nor[i * 3 + 1], t.nor[i * 3 + 2]);
      assert.ok(Math.abs(l - 1) < 1e-3, `${name} normal ${i} length ${l}`);
    }
    let hi = 0;
    for (let i = 0; i < t.col.length; i++) {
      assert.ok(t.col[i] >= 0 && t.col[i] <= 1, name + ' colour range');
      hi = Math.max(hi, t.col[i]);
    }
    assert.ok(hi < 0.85, `${name}: brightest channel ${hi.toFixed(2)} (linear) stays below paper white`);
  }
});

ok('hand-sized bounds, centred on the prop centre (the spin axis)', () => {
  const lim = { FIRST_AID: [0.2, 0.36], BANDAGE: [0.15, 0.32], GRENADE: [0.08, 0.14], SIDEARM: [0.18, 0.28] };
  for (const [name] of KINDS) {
    const b = bounds(T[name]);
    const big = Math.max(...b.size);
    assert.ok(big >= lim[name][0] && big <= lim[name][1], `${name} longest side ${big.toFixed(3)} m`);
    for (const a of [0, 2]) assert.ok(Math.abs((b.mn[a] + b.mx[a]) / 2) < 0.05, `${name} centred on axis ${a}`);
    assert.ok(Math.abs((b.mn[1] + b.mx[1]) / 2) < 0.04, `${name} centred in height`);
  }
});

ok('silhouettes differ: the dressing is flat and long (not a drum), the case boxy, the grenade compact and upright, the revolver thin', () => {
  const s = {};
  for (const [name] of KINDS) {
    const b = bounds(T[name]);
    const [x, y, z] = b.size;
    s[name] = { x, y, z, vol: x * y * z, flat: Math.min(x, y, z) / Math.max(x, y, z) };
  }
  // the dressing: thin in Y against its length (a roll is as tall as it is long)
  assert.ok(s.BANDAGE.y / s.BANDAGE.x < 0.25, `bandage height/length ${(s.BANDAGE.y / s.BANDAGE.x).toFixed(2)}`);
  // the case: tall and deep, by far the biggest volume
  assert.ok(s.FIRST_AID.vol > 2.5 * s.BANDAGE.vol && s.FIRST_AID.vol > 2.5 * s.SIDEARM.vol && s.FIRST_AID.vol > 5 * s.GRENADE.vol, 'case volume');
  assert.ok(s.FIRST_AID.y / s.FIRST_AID.x > 0.6, 'the case stands');
  // the grenade: taller than wide, the smallest
  assert.ok(s.GRENADE.y > s.GRENADE.x && s.GRENADE.vol < s.SIDEARM.vol, 'grenade');
  // the revolver: thin in Z
  assert.ok(s.SIDEARM.z / s.SIDEARM.x < 0.25, 'revolver profile');
  // pairwise: no two kinds share their (sorted) proportions within 15 %
  const prop = (k) => [k.x, k.y, k.z].sort((a, b) => b - a).map((v, i, arr) => v / arr[0]);
  const names = Object.keys(s);
  for (let i = 0; i < names.length; i++)
    for (let j = i + 1; j < names.length; j++) {
      const a = prop(s[names[i]]);
      const b = prop(s[names[j]]);
      const d = Math.max(Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]), Math.abs(Math.log(s[names[i]].vol / s[names[j]].vol)) / 3);
      assert.ok(d > 0.15, `${names[i]} vs ${names[j]} proportions too alike (${d.toFixed(2)})`);
    }
});

ok('the old bandage drum is gone: no cylinder-shaped bulk (the dressing\'s mass is flat)', () => {
  // a roll lying on its side has as much height as length; the dressing's vertices sit within 3 cm of the floor plane
  const t = T.BANDAGE;
  const b = bounds(t);
  let high = 0;
  for (let i = 0; i < t.verts; i++) if (t.pos[i * 3 + 1] - b.mn[1] > 0.05) high++;
  assert.equal(high, 0);
});

ok('rest heights: MODEL_REST h = the lowest point of the lying model (within 2 mm), the lying poses are rotations', () => {
  for (const [name] of KINDS) {
    const R = IM.MODEL_REST[name];
    const q = IM.restQuaternion(name);
    assert.ok(Math.abs(q.length() - 1) < 1e-6);
    const b = bounds(T[name], q);
    assert.ok(Math.abs(-b.mn[1] - R.h) < 0.002, `${name} rest h ${R.h} vs geometry ${(-b.mn[1]).toFixed(4)}`);
    // lying: the height above the floor is the smallest or middle extent (it does not stand on end)
    const sz = b.size;
    assert.ok(sz[1] <= Math.max(sz[0], sz[2]), `${name} lies down`);
    assert.ok(R.body.e >= 0 && R.body.e < 0.6 && R.body.mu > 0 && R.body.mu <= 1 && R.body.spin > 0 && R.body.spin <= 1, name + ' body');
  }
  assert.ok(IM.MODEL_REST.BANDAGE.body.e < IM.MODEL_REST.FIRST_AID.body.e, 'the cloth thuds, the case bounces a little');
});

ok('deterministic: two builds are bit-identical; the tilt only rotates; no Math.random in the module', () => {
  for (const [name, b] of KINDS) {
    const a = b(0);
    const c = b(0);
    assert.deepEqual(Buffer.from(a.pos.buffer), Buffer.from(c.pos.buffer), name);
    assert.deepEqual(Buffer.from(a.col.buffer), Buffer.from(c.col.buffer), name);
    assert.deepEqual(Buffer.from(a.idx.buffer), Buffer.from(c.idx.buffer), name);
    const t = b(0.28);
    assert.equal(t.verts, a.verts);
    const ct = Math.cos(0.28);
    const st = Math.sin(0.28);
    for (let i = 0; i < a.verts; i += 17) {
      const y = a.pos[i * 3 + 1];
      const z = a.pos[i * 3 + 2];
      assert.ok(Math.abs(t.pos[i * 3 + 1] - (ct * y - st * z)) < 1e-5 && Math.abs(t.pos[i * 3 + 2] - (st * y + ct * z)) < 1e-5, name + ' tilt');
    }
  }
  const src = fs.readFileSync(path.join(SRC_DIR, 'render/itemModels.js'), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  assert.ok(!/Math\.random/.test(src), 'no Math.random');
});

ok('the pickups and the dropped props use the new first aid case and dressing (same vertex count), the other kinds untouched', () => {
  const t = buildTemplates(0);
  assert.equal(t[ITEM.FIRST_AID].verts, T.FIRST_AID.verts);
  assert.equal(t[ITEM.BANDAGE].verts, T.BANDAGE.verts);
  assert.deepEqual(Buffer.from(t[ITEM.BANDAGE].pos.buffer), Buffer.from(T.BANDAGE.pos.buffer));
  for (const k of [ITEM.ADRENALINE, ITEM.BATTERY, ITEM.KNOCKER]) assert.ok(t[k] && t[k].verts > 0 && t[k].verts < 600);
  for (const [k, name] of [
    [ITEM.FIRST_AID, 'FIRST_AID'],
    [ITEM.BANDAGE, 'BANDAGE'],
  ]) {
    const r = dropRest(k);
    assert.equal(r.h, IM.MODEL_REST[name].h);
    assert.equal(r.body, IM.MODEL_REST[name].body);
    assert.ok(r.rest.angleTo(IM.restQuaternion(name)) < 1e-6);
  }
});

ok('a dropped dressing and case land and rest at their rest height on a floor; dispose frees the mesh', () => {
  const scene = new THREE.Scene();
  const dp = new DroppedProps(scene);
  // a floor at y = 0: the props cast their step against it (level.raycast, as in the game)
  const level = {
    raycast(ox, oy, oz, dx, dy, dz, maxDist, out) {
      const dl = Math.hypot(dx, dy, dz);
      const uy = dy / dl;
      if (uy >= 0 || oy < 0) return null;
      const t = -oy / uy;
      if (t > maxDist) return null;
      const r = out || {};
      r.t = t;
      r.solid = { minX: -50, maxX: 50, minY: -2, maxY: 0, minZ: -50, maxZ: 50, active: true };
      r.x = ox + (dx / dl) * t;
      r.y = 0;
      r.z = oz + (dz / dl) * t;
      return r;
    },
  };
  const game = { level, input: null, xrActive: false };
  dp.spawn(ITEM.BANDAGE, 0, 0.5, 0, 0, 0, 0, 1);
  dp.spawn(ITEM.FIRST_AID, 1, 0.5, 0, 0, 0, 0, 1);
  let seen = 0;
  for (let i = 0; i < 300; i++) {
    dp.update(1 / 60, game);
    for (const it of dp.items) {
      if (!it.active || !it.rested || it.fade < 1) continue;
      seen |= 1 << it.kind;
      const want = dropRest(it.kind).h;
      assert.ok(Math.abs(it.y - want) < 0.01, `kind ${it.kind} rests at ${it.y.toFixed(3)} (want ${want})`);
    }
  }
  assert.equal(seen, (1 << ITEM.BANDAGE) | (1 << ITEM.FIRST_AID), 'both came to rest');
  assert.ok(dp.mesh.geometry.index.array.length >= 6 * Math.max(T.FIRST_AID.idx.length, T.BANDAGE.idx.length), 'dropped mesh capacity');
  dp.dispose();
  assert.ok(!dp.mesh.parent);
});

console.log(`item models: ${n} checks passed`);
