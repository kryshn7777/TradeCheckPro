// Node test of the rigged Mason (WP-CREATURE-RIG): the shipped mason_rig.glb has the skeleton, skin, LODs, attributes and clips the
// view reads, and the pure clip graph / IK maths behave (phase lock, state -> clip mapping, no NaN, 2-bone reach).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODELS = path.resolve(HERE, '../../../../public/abyssal-tether-3d/assets/models');
const RENDER = pathToFileURL(path.resolve(HERE, '../../../../public/abyssal-tether-3d/src/render/mason/')).href;
let n = 0;
const ok = (name, fn) => {
  fn();
  n++;
  console.log('  ok', name);
};

// ---- GLB reader --------------------------------------------------------------------------------------------------------
const buf = fs.readFileSync(path.join(MODELS, 'mason_rig.glb'));
let js = null;
let bin = null;
for (let off = 12; off < buf.length; ) {
  const len = buf.readUInt32LE(off);
  const type = buf.readUInt32LE(off + 4);
  const data = buf.subarray(off + 8, off + 8 + len);
  if (type === 0x4e4f534a) js = JSON.parse(data.toString('utf8'));
  else if (type === 0x004e4942) bin = data;
  off += 8 + len;
}
const NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const CT = { 5126: Float32Array, 5123: Uint16Array, 5125: Uint32Array, 5121: Uint8Array, 5120: Int8Array };
function acc(i) {
  const a = js.accessors[i];
  const bv = js.bufferViews[a.bufferView];
  const T = CT[a.componentType];
  const nc = NC[a.type];
  const stride = bv.byteStride || nc * T.BYTES_PER_ELEMENT;
  const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const out = new T(a.count * nc);
  const dv = new DataView(bin.buffer, bin.byteOffset + base);
  for (let k = 0; k < a.count; k++) {
    for (let c = 0; c < nc; c++) {
      const o = k * stride + c * T.BYTES_PER_ELEMENT;
      out[k * nc + c] = T === Float32Array ? dv.getFloat32(o, true) : T === Uint16Array ? dv.getUint16(o, true) : T === Uint32Array ? dv.getUint32(o, true) : T === Uint8Array ? dv.getUint8(o) : dv.getInt8(o);
    }
  }
  return out;
}

const meta = js.extras.mason;
const skin = js.skins[0];
const boneNames = skin.joints.map((j) => js.nodes[j].name);

ok('file size <= 8 MB, JSON asset ok', () => {
  assert.ok(buf.length <= 8 * 1024 * 1024, 'size ' + buf.length);
  assert.equal(js.asset.version, '2.0');
  assert.ok(!(js.extensionsUsed || []).some((e) => /clearcoat|transmission|sheen|iridescence/i.test(e)));
});

ok('skeleton: bone count, canonical names, flat spine, crown subtree, legs', () => {
  assert.ok(boneNames.length <= 255 && boneNames.length >= 100, 'bones ' + boneNames.length);
  assert.equal(new Set(boneNames).size, boneNames.length);
  const need = ['root', 'neck', 'crown', 'tail_0', 'tail_1'];
  for (let k = 0; k < 18; k++) need.push('spine_' + String(k).padStart(2, '0'));
  for (let j = 0; j < 3; j++) need.push('portal_arch_' + j, 'gullet_' + j);
  for (const c of ['L0', 'L1', 'R0', 'R1']) need.push('portal_comb_' + c);
  for (let j = 0; j < 2; j++) need.push('portal_hinge_' + j);
  for (let j = 0; j < 7; j++) need.push('pit_' + j);
  for (let a = 0; a < 5; a++) need.push('arm_' + a + '_0', 'arm_' + a + '_1');
  for (const nm of need) assert.ok(boneNames.includes(nm), 'missing bone ' + nm);
  assert.equal(meta.legs.length, 36);
  assert.equal(meta.legs.filter((l) => l.kind === 'lead').length, 10);
  const simLimbs = meta.legs.filter((l) => l.simLimb >= 0).map((l) => l.simLimb).sort((a, b) => a - b);
  assert.deepEqual(simLimbs, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  for (const l of meta.legs) for (const b of l.bones) assert.ok(boneNames.includes(b), b);
  // the spine is flat under the root (world frames are written directly) and the crown hangs off the neck
  const parent = {};
  js.nodes.forEach((nd, i) => (nd.children || []).forEach((c) => (parent[c] = i)));
  const pname = (nm) => js.nodes[parent[skin.joints[boneNames.indexOf(nm)]]].name;
  assert.equal(pname('spine_05'), 'root');
  assert.equal(pname('crown'), 'neck');
  assert.equal(pname('portal_comb_L0'), 'crown');
  assert.equal(pname('arm_2_1'), 'arm_2_0');
  assert.equal(meta.spine.length, 20);
  assert.equal(meta.simPoints, 20);
});

ok('skinned meshes: LOD0 <= 60 k, LOD1 <= 25 k, <= 6 draw calls, shared skin, attributes', () => {
  const tris = [0, 0];
  const prims = [0, 0];
  for (const nd of js.nodes) {
    if (nd.mesh === undefined) continue;
    const lod = /LOD1/.test(nd.name) ? 1 : 0;
    assert.equal(nd.skin, 0, nd.name + ' shares the one skin');
    for (const p of js.meshes[nd.mesh].primitives) {
      prims[lod]++;
      tris[lod] += js.accessors[p.indices].count / 3;
      for (const a of ['POSITION', 'NORMAL', 'TEXCOORD_0', 'JOINTS_0', 'WEIGHTS_0', '_MASK']) assert.ok(p.attributes[a] !== undefined, a);
      // joints in range, weights sum to 1, <= 4 influences by construction, rigid parts carry weight 1 on one bone
      const J = acc(p.attributes.JOINTS_0);
      const W = acc(p.attributes.WEIGHTS_0);
      let rigid = 0;
      const count = J.length / 4;
      const step = Math.max(1, Math.floor(count / 4000));
      for (let v = 0; v < count; v += step) {
        let s = 0;
        for (let c = 0; c < 4; c++) {
          s += W[v * 4 + c];
          if (W[v * 4 + c] > 0) assert.ok(J[v * 4 + c] < boneNames.length);
        }
        assert.ok(Math.abs(s - 255) <= 1, 'weights sum ' + s);
        if (W[v * 4] === 255) rigid++;
      }
      assert.ok(rigid > 0, 'rigid vertices exist');
    }
  }
  assert.ok(tris[0] <= 60000 && tris[0] > 30000, 'LOD0 tris ' + tris[0]);
  assert.ok(tris[1] <= 25000 && tris[1] > 8000, 'LOD1 tris ' + tris[1]);
  assert.ok(prims[0] <= 6 && prims[1] <= 6, 'draw calls ' + prims);
  assert.deepEqual(meta.lodTris.map(Math.round), tris.map(Math.round));
});

ok('clips: names, 30 fps, in place (no root tracks), only existing bones, event times inside the clip', () => {
  const need = ['crown_idle', 'listen', 'notice_snap', 'rear_windup', 'strike', 'recoil', 'roar_display', 'linger_breathe', 'take_close', 'plate_shiver', 'breathe_seams', 'arms_flare', 'pit_dilate', 'portal_open', 'portal_snap', 'flinch', 'retreat_fold', 'leg_probe'];
  const names = js.animations.map((a) => a.name);
  for (const c of need) assert.ok(names.includes(c), 'missing clip ' + c);
  for (const a of js.animations) {
    const mi = meta.clips[a.name];
    assert.ok(mi, 'meta for ' + a.name);
    for (const ch of a.channels) {
      const nm = js.nodes[ch.target.node].name;
      assert.notEqual(nm, 'root', a.name + ' keys the root');
      assert.ok(boneNames.includes(nm), a.name + ' targets ' + nm);
    }
    const t = acc(a.samplers[0].input);
    assert.ok(Math.abs(t[1] - 1 / 30) < 1e-4, 'fps');
    assert.ok(Math.abs(t[t.length - 1] - mi.duration) < 0.04, a.name + ' duration');
    for (const e of mi.events) assert.ok(e.u >= 0 && e.u <= 1, a.name + ' event ' + e.name);
  }
  assert.ok(Math.abs(meta.clips.rear_windup.duration - 0.75) < 1e-6);
  assert.ok(Math.abs(meta.clips.strike.duration - 0.4) < 1e-6);
  assert.equal(meta.clips.rear_windup.phase, 'windup');
  assert.equal(meta.clips.strike.phase, 'strike');
  assert.ok(Math.abs(meta.clips.strike.events.find((e) => e.name === 'contact').u * 0.4 - 0.16) < 1e-6, 'contact == the sim strike time (0.16 s)');
  for (const k of ['recoil', 'plate_shiver', 'breathe_seams']) assert.equal(meta.clips[k].kind, 'additive');
  for (const k of ['arms_flare', 'pit_dilate', 'portal_open']) assert.equal(meta.clips[k].kind, 'parametric');
});

// ---- the clip graph (pure) ---------------------------------------------------------------------------------------------------
const { ClipGraph, STRIKE_CONTACT, WINDUP_CLIP } = await import(RENDER + '/masonClipGraph.js');
const { solve2, computeFrames, sectionHeadScale } = await import(RENDER + '/masonPose.js');
const { HeadFit } = await import(RENDER + '/masonFit.js');
const { castBox } = await import(RENDER + '/masonLegs.js');

function run(setup, steps = 30, dt = 1 / 60) {
  const g = new ClipGraph();
  setup(g.snapshot);
  let out;
  for (let i = 0; i < steps; i++) out = g.update(dt);
  return { g, out };
}
function finite(o) {
  for (const k in o.w) assert.ok(Number.isFinite(o.w[k]), 'NaN weight ' + k);
  for (const k in o.param) assert.ok(Number.isFinite(o.param[k]), 'NaN param ' + k);
}

ok('clip graph: calm states play crown_idle + breathing; listening plays listen with breathing off', () => {
  let { out } = run((s) => Object.assign(s, { state: 'DISTANT' }));
  finite(out);
  assert.ok(out.w.crown_idle > 0.95 && out.w.breathe_seams > 0.5);
  ({ out } = run((s) => Object.assign(s, { state: 'OBSERVING', listening: true, distance: 10 }), 90));
  finite(out);
  assert.ok(out.w.listen > 0.9, 'listen ' + out.w.listen);
  assert.ok(out.w.breathe_seams < 0.05);
  assert.equal(out.freeze, true, 'a true freeze while listening');
});

ok('clip graph: the wind-up is phase-locked to the sim timer at every difficulty (0.75 / 0.65 / 0.5 s)', () => {
  for (const windup of [0.75, 0.65, 0.5]) {
    const g = new ClipGraph();
    Object.assign(g.snapshot, { state: 'ATTACK', phase: 'windup', atkWindup: windup, distance: 6 });
    for (const k of [0, 0.25, 0.5, 0.9, 1]) {
      g.snapshot.atkT = k * windup;
      const o = g.update(1 / 60);
      assert.ok(Math.abs(o.windupTime - k * WINDUP_CLIP) < 1e-9, `windup ${windup} k ${k}: ${o.windupTime}`);
    }
    for (let i = 0; i < 20; i++) g.update(1 / 60);
    assert.ok(g.out.w.rear_windup > 0.9, 'rear weight ' + g.out.w.rear_windup);
  }
});

ok('clip graph: strike scrubs to contact (0.16 s), portal slam + recoil + miss/hit one-shots on the phase edges', () => {
  const g = new ClipGraph();
  Object.assign(g.snapshot, { state: 'ATTACK', phase: 'strike', atkT: 0.08, hit: false });
  let o = g.update(1 / 60);
  assert.ok(Math.abs(o.strikeTime - 0.08) < 1e-9);
  g.snapshot.atkT = 0.16;
  o = g.update(1 / 60);
  assert.ok(Math.abs(o.strikeTime - STRIKE_CONTACT) < 1e-9);
  Object.assign(g.snapshot, { phase: 'recoil', atkT: 0.02 });
  o = g.update(1 / 60);
  assert.ok(o.triggers.includes('recoil') && o.triggers.includes('portal_snap'), 'miss: ' + o.triggers);
  assert.ok(!o.triggers.includes('take_close'));
  assert.ok(Math.abs(o.strikeTime - (STRIKE_CONTACT + 0.02)) < 1e-9, 'settle tail plays on');
  const h = new ClipGraph();
  Object.assign(h.snapshot, { state: 'ATTACK', phase: 'strike', atkT: 0.16, hit: true });
  h.update(1 / 60);
  Object.assign(h.snapshot, { phase: 'recoil', atkT: 0.01 });
  const oh = h.update(1 / 60);
  assert.ok(oh.triggers.includes('take_close'), 'hit: ' + oh.triggers);
  finite(oh);
});

ok('clip graph: gate slam / sighting roar, retreat fold, burst notice snap, parametric values from the body scalars', () => {
  const g = new ClipGraph();
  Object.assign(g.snapshot, { state: 'ATTACK', victory: 'slam' });
  assert.ok(g.update(1 / 60).triggers.includes('roar_display'));
  const b = new ClipGraph();
  Object.assign(b.snapshot, { state: 'PURSUING' });
  b.update(1 / 60);
  b.snapshot.state = 'BURST';
  assert.ok(b.update(1 / 60).triggers.includes('notice_snap'));
  const { out } = run((s) => Object.assign(s, { state: 'RECOVERING' }), 120);
  assert.ok(out.w.retreat_fold > 0.9);
  const p = run((s) => Object.assign(s, { state: 'PURSUING', frondOpen: 0.7, glow: 0.5, jitter: 0.8, lunge: 0 }), 5);
  assert.ok(Math.abs(p.out.param.arms_flare - 0.7) < 1e-9);
  assert.ok(p.out.w.plate_shiver > 0.5);
  finite(p.out);
});

ok('clip graph: weights never NaN across a random walk of states, base weights sum to <= 1', () => {
  const g = new ClipGraph();
  const states = ['DORMANT', 'DISTANT', 'OBSERVING', 'APPROACHING', 'PURSUING', 'BURST', 'ATTACK', 'RECOVERING'];
  const phases = [null, 'windup', 'strike', 'recoil'];
  let seed = 7;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 4000; i++) {
    const s = g.snapshot;
    s.state = states[(rnd() * states.length) | 0];
    s.phase = s.state === 'ATTACK' ? phases[(rnd() * 4) | 0] : null;
    s.atkT = rnd() * 0.8;
    s.atkWindup = 0.5 + rnd() * 0.25;
    s.hit = rnd() < 0.3;
    s.listening = rnd() < 0.3;
    s.creeping = rnd() < 0.2;
    s.jitter = rnd();
    s.lunge = rnd();
    s.frondOpen = rnd();
    s.glow = rnd();
    s.distance = rnd() * 60;
    s.victory = rnd() < 0.05 ? 'slam' : '';
    const o = g.update(1 / 60);
    finite(o);
    const sum = ['crown_idle', 'listen', 'linger_breathe', 'roar_display', 'rear_windup', 'strike', 'take_close', 'notice_snap'].reduce((a, k) => a + o.w[k], 0);
    assert.ok(sum <= 1.0001, 'base weights ' + sum);
  }
});

ok('IK: the two-bone solve reaches a target inside the chain, falls short beyond the stretch limit, keeps lengths', () => {
  const out = new Float64Array(7);
  solve2(out, 0, 0, 0, 3, -4, 1, 4, 5, 0, 1, 0, 1.18);
  const tip = Math.hypot(out[4] - 3, out[5] + 4, out[6] - 1);
  assert.ok(tip < 0.05, 'tip ' + tip);
  assert.ok(Math.abs(Math.hypot(out[0], out[1], out[2]) - 4) < 1e-6);
  solve2(out, 0, 0, 0, 30, 0, 0, 4, 5, 0, 1, 0, 1.18);
  assert.ok(out[3] <= 1.18 + 1e-9 && Math.hypot(out[4], out[5], out[6]) < 30);
});

ok('pose maths: spine frames orthonormal, head fit shrinks in a tight gap and lifts off the wall, ray vs box', () => {
  const SEG = 20;
  const B = { spine: new Float32Array(SEG * 3), up: new Float32Array(SEG * 3), head: { x: 0, y: 0, z: 0, fx: 0, fy: 0, fz: -1, ux: 0, uy: 1, uz: 0 } };
  for (let i = 0; i < SEG; i++) {
    B.spine[i * 3 + 2] = i * 1.5;
    B.up[i * 3 + 1] = 1;
  }
  const F = new Float32Array(SEG * 12);
  computeFrames(B, SEG, F);
  for (let i = 0; i < SEG; i++) {
    const o = i * 12;
    const dot = (a, b) => F[o + a] * F[o + b] + F[o + a + 1] * F[o + b + 1] + F[o + a + 2] * F[o + b + 2];
    assert.ok(Math.abs(dot(3, 3) - 1) < 1e-5 && Math.abs(dot(3, 6)) < 1e-5 && Math.abs(dot(6, 9)) < 1e-5);
  }
  assert.ok(castBox(0, 0, 0, 1, 0, 0, { minX: 3, maxX: 5, minY: -1, maxY: 1, minZ: -1, maxZ: 1 }, 20) === 3);
  assert.ok(castBox(0, 5, 0, 1, 0, 0, { minX: 3, maxX: 5, minY: -1, maxY: 1, minZ: -1, maxZ: 1 }, 20) < 0);
  // a head 1.45 m above a floor in a 4 m wide gap: smaller than in the open, lifted off the floor
  const lv = {
    querySolids: (a, b, c, d, e, f, out) => {
      out.length = 0;
      out.push({ minX: -50, maxX: 50, minY: -10, maxY: -1.45, minZ: -50, maxZ: 50, kind: 'wall' });
      out.push({ minX: -12, maxX: -2, minY: -10, maxY: 30, minZ: -50, maxZ: 50, kind: 'wall' });
      out.push({ minX: 2, maxX: 12, minY: -10, maxY: 30, minZ: -50, maxZ: 50, kind: 'wall' });
      return out;
    },
  };
  const fit = new HeadFit();
  fit.update(0.016, lv, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0.9);
  assert.ok(fit.scale < 0.9 && fit.scale >= fit.minScale, 'scale ' + fit.scale);
  assert.ok(fit.lift > 0.5, 'lift ' + fit.lift);
  const open = new HeadFit();
  open.update(0.016, { querySolids: (a, b, c, d, e, f, out) => ((out.length = 0), out) }, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0.9);
  assert.ok(Math.abs(open.scale - 0.9) < 1e-9 && open.lift === 0);
  assert.ok(sectionHeadScale({ level: { sections: [{ shaft: { minX: -9, maxX: 9, minZ: -9, maxZ: 9 } }] }, sectionIndex: 0 }) < 0.7);
});

console.log(`${n} tests passed`);
