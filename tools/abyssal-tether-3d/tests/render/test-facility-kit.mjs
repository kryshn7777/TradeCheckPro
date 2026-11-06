// THE COLLAR kit (src/render/facilityKit.js, plans/COLLAR_KIT.md): the contract the opening film codes against.
//   the API and its named nodes; triangle / draw-call / LOD caps; sane bounds (a ~1.2 m drone, a cradle a 1.7 m person stands in, the
//   collar's iris over the 22 m chimney); finite geometry; deterministic builds; the iris covers / uncovers the opening monotonically;
//   dispose frees every geometry and material; no allocation in the per-frame helpers (heap sampled); no new sampler on a lit material.
//   node test-facility-kit.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import inspector from 'node:inspector/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VENDOR = pathToFileURL(path.resolve(HERE, '../../../../public/abyssal-tether-3d/vendor/three/')).href;
register(
  'data:text/javascript,' +
    encodeURIComponent(`export async function resolve(s, c, next) {
  if (s === 'three') return { url: '${VENDOR}/three.module.min.js', shortCircuit: true };
  if (s.startsWith('three/addons/')) return { url: '${VENDOR}/addons/' + s.slice(13), shortCircuit: true };
  return next(s, c);
}`),
);
const SRC = '../../../../public/abyssal-tether-3d/src';
const THREE = await import('three');
const K = await import(`${SRC}/render/facilityKit.js`);
const { patchMaterial } = await import(`${SRC}/render/materials.js`);
const { FACILITY, buildDrone, buildCradle, buildCollar, kitStats, irisCovers } = K;

let n = 0;
const ok = (name, fn) => {
  fn();
  n++;
  console.log('  ok', name);
};

function meshes(root) {
  const out = [];
  root.traverse((o) => o.isMesh && out.push(o));
  return out;
}
function geoHash(root) {
  let h = 2166136261 >>> 0;
  for (const m of meshes(root)) {
    for (const k of ['position', 'normal', 'color', 'aRM']) {
      const a = m.geometry.attributes[k];
      if (!a) continue;
      for (let i = 0; i < a.array.length; i++) h = Math.imul(h ^ Math.round(a.array[i] * 1e5), 16777619) >>> 0;
    }
  }
  return h;
}
function allFinite(root) {
  for (const m of meshes(root))
    for (const k of Object.keys(m.geometry.attributes)) {
      const a = m.geometry.attributes[k].array;
      for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) return `${m.name}.${k}[${i}]`;
    }
  return null;
}
function boundsOf(list) {
  const b = new THREE.Box3();
  for (const o of list) {
    o.updateWorldMatrix(true, false);
    b.union(new THREE.Box3().setFromObject(o));
  }
  return b;
}

// ---- 1. the API ----------------------------------------------------------------------------------------------------------------
ok('FACILITY: the documented constants (the shaft, the collar, the iris, the deck, the descent column, the cradle, the drone)', () => {
  assert.equal(FACILITY.shaftHalf, 11);
  assert.equal(FACILITY.collarY, 60);
  for (const k of ['irisRadius', 'irisTravel', 'irisLeaves', 'irisTopY', 'deckY', 'hallRadius', 'hallHeight', 'gantryY', 'controlFloorY'])
    assert.ok(Number.isFinite(FACILITY[k]), k);
  assert.ok(FACILITY.irisRadius >= FACILITY.shaftHalf * Math.SQRT2 && FACILITY.irisRadius <= 17, 'the aperture covers the 22 m square and no more than a margin');
  assert.ok(FACILITY.irisTopY > FACILITY.stoneCapY && FACILITY.deckY > FACILITY.irisTopY, 'stone < iris < deck');
  assert.equal(FACILITY.cradle.eye, 1.65);
  assert.ok(Object.isFrozen(FACILITY) && Object.isFrozen(FACILITY.cradle) && Object.isFrozen(FACILITY.drone));
});

// ---- 2. the drone --------------------------------------------------------------------------------------------------------------
const d0 = buildDrone({ lod: 0 });
const d1 = buildDrone({ lod: 1 });
ok('drone: a Group with rotors[4] (blades + blur), clamp (+ 2 jaws), lights.beam / lights.status, scan, clampPoint, the helpers', () => {
  for (const d of [d0, d1]) {
    assert.ok(d.isGroup && d.name === 'AT3D-hoist-drone');
    assert.equal(d.rotors.length, 4);
    for (let i = 0; i < 4; i++) {
      assert.equal(d.rotors[i].name, 'rotor' + i);
      assert.ok(d.rotors[i].blades.isMesh && d.rotors[i].blur.isMesh && d.rotors[i].parent === d);
    }
    assert.ok(d.clamp.isObject3D && d.clamp.name === 'clamp' && d.clamp.jaws.length === 2);
    assert.ok(d.lights.beam.isMesh && d.lights.beam.name === 'beam' && d.lights.beam.material.blending === THREE.AdditiveBlending);
    assert.ok(d.lights.status.isMesh && d.lights.status.material.isMeshBasicMaterial);
    assert.ok(d.scan.isMesh && d.scan.name === 'scan' && d.scan.material.blending === THREE.AdditiveBlending);
    assert.ok(!d.lights.beam.visible && !d.scan.visible, 'the beam and the scan fan start hidden');
    assert.equal(d.getObjectByName('clamp'), d.clamp);
    for (const f of ['setClamp', 'setLights', 'setBeam', 'setScan', 'setStatus', 'setSpin', 'update', 'dispose']) assert.equal(typeof d[f], 'function', f);
    assert.ok(Math.abs(d.clampPoint.y - FACILITY.drone.clampY) < 1e-9);
    let lights = 0;
    d.traverse((o) => o.isLight && lights++);
    assert.equal(lights, 0, 'no Light objects (the film drives the real lights)');
  }
});
ok('drone: LOD0 <= 4000 and LOD1 <= 900 triangles even counting every mesh (blades AND blur, beam, scan); <= 9 calls at rest, 1 per part group', () => {
  const a = kitStats(d0, true);
  const b = kitStats(d1, true);
  assert.ok(a.tris <= 4000, `LOD0 ${a.tris}`);
  assert.ok(b.tris <= 900, `LOD1 ${b.tris}`);
  assert.ok(b.tris < a.tris / 3, 'LOD1 is a real reduction');
  for (const d of [d0, d1]) {
    const r = kitStats(d);
    assert.ok(r.calls <= 9, `${r.calls} calls at rest`);
    // the hull is ONE mesh, the LEDs ONE mesh: merged by material
    assert.equal(meshes(d).filter((m) => m.name === 'drone-hull').length, 1);
    assert.equal(meshes(d).filter((m) => m.material.isMeshBasicMaterial && !m.material.transparent).length, 1);
    const mats = new Set(meshes(d).map((m) => m.material));
    assert.ok(mats.size <= 5, `${mats.size} materials`);
  }
  console.log(`     drone LOD0 ${a.tris} / LOD1 ${b.tris} triangles (all meshes)`);
});
ok('drone: ~1.2 m across the duct rims, flat (< 0.55 m tall with the clamp hanging), the clamp point under the centre', () => {
  for (const d of [d0, d1]) {
    const b = boundsOf(meshes(d).filter((m) => m !== d.lights.beam && m !== d.scan));
    const sx = b.max.x - b.min.x;
    const sz = b.max.z - b.min.z;
    assert.ok(sx > 1.15 && sx < 1.3 && sz > 1.15 && sz < 1.3, `${sx.toFixed(3)} x ${sz.toFixed(3)}`);
    assert.ok(b.max.y - b.min.y < 0.55, `height ${(b.max.y - b.min.y).toFixed(3)}`);
    assert.ok(Math.abs(d.clampPoint.x) < 0.05 && Math.abs(d.clampPoint.z) < 0.05 && d.clampPoint.y < b.min.y + 0.05);
  }
});
ok('drone: update spins the rotors (diagonal pairs counter-rotate) and swaps blades for the blur disc above 0.55; setClamp opens the jaws', () => {
  const d = buildDrone({ index: 2 });
  const r0 = d.rotors[0].rotation.y;
  const r1 = d.rotors[1].rotation.y;
  d.update(0.01, { spin: 0.3 });
  const a0 = d.rotors[0].rotation.y - r0;
  const a1 = d.rotors[1].rotation.y - r1;
  assert.ok(a0 > 0 && a1 < 0 && Math.abs(a0 + a1) < 1e-9, 'counter-rotating');
  assert.ok(d.rotors[0].blades.visible && !d.rotors[0].blur.visible);
  d.update(0.01, { spin: 1 });
  assert.ok(!d.rotors[3].blades.visible && d.rotors[3].blur.visible);
  const tip = () => {
    d.updateMatrixWorld(true);
    return new THREE.Box3().setFromObject(d.clamp.jaws[0]).max.z;
  };
  d.setClamp(0);
  const z0 = tip();
  d.setClamp(1);
  assert.ok(tip() > z0 + 0.03, 'the jaw swings out');
  d.setBeam(0.5);
  d.setScan(1, 0.3);
  assert.ok(d.lights.beam.visible && d.scan.visible && d.scan.rotation.x === 0.3);
  d.setStatus(0xff0000);
  d.setLights(0);
  assert.ok(!d.lights.status.visible, 'falling dark');
  d.dispose();
});

// ---- 3. the cradle --------------------------------------------------------------------------------------------------------------
const cr = buildCradle();
ok('cradle: <= 6000 triangles, the nodes (anchors[4], screen, screenSetText, spool, gate) and the helpers', () => {
  const s = kitStats(cr, true);
  assert.ok(s.tris <= 6000, `${s.tris} tris`);
  assert.ok(s.calls <= 6, `${s.calls} calls`);
  assert.equal(cr.anchors.length, 4);
  for (const a of cr.anchors) {
    assert.ok(Math.abs(Math.abs(a.x) - FACILITY.cradle.anchorXZ) < 1e-9 && Math.abs(Math.abs(a.z) - FACILITY.cradle.anchorXZ) < 1e-9);
    assert.equal(a.y, FACILITY.cradle.anchorY);
  }
  assert.ok(cr.screen.isMesh && cr.screen.name === 'screen' && cr.screen.material.isMeshBasicMaterial);
  for (const f of ['screenSetText', 'setLights', 'setGate', 'update', 'dispose']) assert.equal(typeof cr[f], 'function', f);
  assert.ok(cr.spool.isObject3D && cr.gate.isObject3D);
  assert.equal(cr.screenText, 'LINE 42 · PAYLOAD 1 · RETURN 0', 'the default replay text');
  console.log(`     cradle ${s.tris} triangles, ${s.calls} calls`);
});
ok('cradle: a 1.7 m person stands in it (1.6 m grating at y 0, 1.05 m waist rails, the spreader above the 1.65 m eye with headroom)', () => {
  const frame = cr.getObjectByName('cradle-frame');
  const b = new THREE.Box3().setFromObject(frame);
  assert.ok(Math.abs(b.min.y + FACILITY.cradle.skid) < 0.01, 'skids reach -0.12');
  assert.ok(b.max.x - b.min.x >= 1.6 && b.max.x - b.min.x <= 2.5, 'width');
  // nothing of the frame inside the standing volume: |x|,|z| < 0.7, y 0.02 .. 2.25 (a 1.7 m body, arms, a raised head)
  const p = frame.geometry.attributes.position;
  const idx = frame.geometry.index;
  let inside = 0;
  for (let t = 0; t < idx.count; t += 3) {
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let k = 0; k < 3; k++) {
      const v = idx.getX(t + k);
      cx += p.getX(v) / 3;
      cy += p.getY(v) / 3;
      cz += p.getZ(v) / 3;
    }
    if (Math.abs(cx) < 0.7 && Math.abs(cz) < 0.7 && cy > 0.02 && cy < 2.25) inside++;
  }
  assert.equal(inside, 0, `${inside} frame triangles inside the person's volume`);
  assert.ok(FACILITY.cradle.top - 0.05 > FACILITY.cradle.eye + 0.45, 'headroom over the eye');
  assert.equal(cr.eyeHeight, 1.65);
  assert.equal(cr.floorY, 0);
});
ok('cradle: screenSetText redraws the canvas texture (a document stub) and records the text', () => {
  const calls = [];
  const ctx = new Proxy(
    {},
    {
      get: (t, k) => (k in t ? t[k] : k === 'measureText' ? (s) => ({ width: String(s).length * 9 }) : (...a) => calls.push([k, ...a])),
      set: (t, k, v) => ((t[k] = v), true),
    },
  );
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };
  const c = buildCradle();
  delete globalThis.document;
  assert.ok(c.screen.material.map && c.screen.material.map.isCanvasTexture, 'a CanvasTexture on the unlit screen');
  const v0 = c.screen.material.map.version;
  calls.length = 0;
  assert.equal(c.screenSetText('LINE 42 · PAYLOAD 1 · RETURN 1'), true);
  assert.ok(c.screen.material.map.version > v0, 'texture flagged for upload');
  const text = calls.filter((x) => x[0] === 'fillText').map((x) => x[1]);
  assert.ok(text.includes('LINE 42') && text.includes('PAYLOAD 1') && text.includes('RETURN 1'), `broken at the middots: ${text.join(' | ')}`);
  assert.equal(c.screenText, 'LINE 42 · PAYLOAD 1 · RETURN 1');
  c.dispose();
});

// ---- 4. the collar --------------------------------------------------------------------------------------------------------------
const co = buildCollar();
ok('collar: { group, dronePads[4], cageAnchor, irisCenter, irisLeaves, lights, setIris, setLights, update, dispose }', () => {
  assert.ok(co.group.isGroup && co.group.name === 'AT3D-collar');
  assert.equal(co.dronePads.length, 4);
  for (const k of ['setIris', 'setLights', 'update', 'dispose']) assert.equal(typeof co[k], 'function');
  assert.equal(co.irisLeaves.length, FACILITY.irisLeaves);
  assert.deepEqual(co.irisCenter, { x: 0, y: FACILITY.irisTopY, z: 0 });
  assert.ok(co.lights.length >= 4 && co.lights.every((l) => l.type && l.name));
  let lights = 0;
  co.group.traverse((o) => o.isLight && lights++);
  assert.equal(lights, 0, 'descriptors only');
});
ok('collar: <= 25 k triangles, <= 12 draw calls, vertex colours, no texture at all', () => {
  const s = kitStats(co.group, true);
  assert.ok(s.tris <= 25000, `${s.tris}`);
  assert.ok(s.calls <= 12, `${s.calls}`);
  assert.equal(s.tris, co.tris);
  for (const m of meshes(co.group)) {
    assert.ok(m.geometry.attributes.color, m.name + ' vertex colours');
    assert.equal(m.material.map, null, m.name);
  }
  console.log(`     collar ${s.tris} triangles, ${s.calls} calls`);
});
ok('collar: geometry matches the shaft (the iris over the 22 m opening, the stone rim from the square, the hall round it, the pads on the deck)', () => {
  const b = new THREE.Box3().setFromObject(co.group);
  assert.ok(b.min.x <= -FACILITY.hallRadius + 0.5 && b.max.x >= FACILITY.hallRadius - 0.5, 'the hall');
  assert.ok(b.min.y >= FACILITY.collarY - 0.05 && b.max.y <= FACILITY.deckY + FACILITY.hallHeight + 0.01, 'above the mouth');
  // the shell never intrudes into the shaft's open square below the iris
  const sh = co.meshes.shell.geometry.attributes.position;
  for (let i = 0; i < sh.count; i++) {
    if (Math.abs(sh.getX(i)) < FACILITY.shaftHalf - 0.06 && Math.abs(sh.getZ(i)) < FACILITY.shaftHalf - 0.06) assert.ok(sh.getY(i) > FACILITY.deckY + 8, 'only the gantry / ceiling over the opening');
  }
  for (const p of co.dronePads) {
    const r = Math.hypot(p.x, p.z);
    assert.ok(r > FACILITY.ringOuter + 1.3 && r < FACILITY.hallRadius - 3, `pad at r ${r.toFixed(1)}`);
    assert.ok(Math.abs(p.y - (FACILITY.deckY + FACILITY.drone.dockY)) < 1e-9 && Number.isFinite(p.yaw));
  }
  const c = co.cageAnchor;
  assert.ok(Math.abs(c.y - (FACILITY.irisTopY + FACILITY.cradle.skid)) < 1e-9, 'the cradle rests on the closed iris');
  // over the Threshold ledge (x -11..3, z 4..11): the whole cradle footprint with its drones (+-1.72 m) lands on it
  assert.ok(c.x - 1.72 > -11 && c.x + 1.72 < 3 && c.z - 1.72 > 4 - 0.01 && c.z + 1.72 < 11.5, 'over the ledge');
  assert.ok(Math.hypot(c.x, c.z) + 1.72 < FACILITY.irisRadius, 'inside the aperture');
});
ok('collar: the iris covers the opening closed, uncovers it monotonically, and no leaf is inside the aperture when open', () => {
  const G = 45;
  const cover = () => {
    let k = 0;
    for (let i = 0; i < G; i++)
      for (let j = 0; j < G; j++) if (irisCovers(co.irisLeaves, -11 + (22 * (i + 0.5)) / G, -11 + (22 * (j + 0.5)) / G)) k++;
    return k / (G * G);
  };
  let prev = 2;
  const seq = [];
  for (let s = 0; s <= 20; s++) {
    co.setIris(s / 20);
    const f = cover();
    seq.push(f.toFixed(2));
    assert.ok(f <= prev + 1e-12, `monotonic at ${s / 20}`);
    prev = f;
  }
  co.setIris(0);
  assert.ok(cover() >= 0.999, 'closed covers the square');
  co.setIris(1);
  assert.equal(cover(), 0, 'open uncovers it');
  // the real geometry agrees: at k = 1 every leaf vertex is outside the aperture, at k = 0 inside the leaf radius
  const pos = co.meshes.iris.geometry.attributes.position;
  const arr = pos.array;
  let minR = Infinity;
  for (let i = 0; i < pos.count; i++) minR = Math.min(minR, Math.hypot(pos.getX(i), pos.getZ(i)));
  assert.ok(minR >= FACILITY.irisRadius - 0.01, `open: nearest leaf vertex r ${minR.toFixed(2)}`);
  co.setIris(0);
  let maxR = 0;
  minR = Infinity;
  for (let i = 0; i < pos.count; i++) {
    const r = Math.hypot(pos.getX(i), pos.getZ(i));
    maxR = Math.max(maxR, r);
    minR = Math.min(minR, r);
  }
  assert.ok(maxR <= FACILITY.irisLeafRadius + 0.01 && minR < 0.1, 'closed: the leaves meet in the middle');
  assert.equal(co.meshes.iris.geometry.attributes.position.array, arr, 'rewritten in place');
  co.setIris(0.5);
  assert.equal(co.irisK, 0.5);
  console.log(`     coverage by k: ${seq.join(' ')}`);
});

// ---- 5. sound geometry, determinism ----------------------------------------------------------------------------------------------
ok('every attribute of every mesh is finite (no NaN), every index in range', () => {
  for (const root of [d0, d1, cr, co.group]) {
    assert.equal(allFinite(root), null);
    for (const m of meshes(root)) {
      const g = m.geometry;
      if (!g.index) continue;
      const nv = g.attributes.position.count;
      for (let i = 0; i < g.index.count; i++) assert.ok(g.index.getX(i) < nv, m.name);
    }
  }
});
ok('deterministic: two builds are identical (seeded grime, no Math.random); a drone index changes its grime + serial', () => {
  const src = fs.readFileSync(fileURLToPath(new URL(`${SRC}/render/facilityKit.js`, import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  assert.ok(!/Math\.random|Date\.now|performance\.now/.test(src), 'no Math.random / clock in the kit');
  // three's uuids use Math.random: feed it a different stream per build, the geometry must not care
  const rnd = Math.random;
  let s = 1;
  Math.random = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  try {
    assert.equal(geoHash(buildDrone({ lod: 0 })), geoHash(d0));
    assert.equal(geoHash(buildDrone({ lod: 1 })), geoHash(d1));
    assert.equal(geoHash(buildCradle()), geoHash(cr));
    const c2 = buildCollar();
    co.setIris(0);
    assert.equal(geoHash(c2.group), geoHash(co.group));
    c2.dispose();
    assert.notEqual(geoHash(buildDrone({ index: 1 })), geoHash(d0));
  } finally {
    Math.random = rnd;
  }
});

// ---- 6. materials: no new sampler -------------------------------------------------------------------------------------------------
ok('materials: the lit kit material is the shared patched MeshStandard path + an ALU-only roughness / metalness attribute (no sampler, no map)', () => {
  const count = (s) => (s.match(/uniform\s+sampler2D/g) || []).length;
  const shaderOf = (mat) => {
    const sh = { vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader, uniforms: {} };
    mat.onBeforeCompile(sh, null);
    return sh;
  };
  const ref = new THREE.MeshStandardMaterial({ vertexColors: true });
  patchMaterial(ref, { lit: true, grade: true, wetK: 0 });
  const rs = shaderOf(ref);
  const lit = new Set();
  for (const root of [d0, d1, cr, co.group]) root.traverse((o) => o.isMesh && o.material.isMeshStandardMaterial && lit.add(o.material));
  assert.ok(lit.size >= 4);
  for (const m of lit) {
    for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap', 'lightMap', 'bumpMap', 'displacementMap', 'envMap'])
      assert.equal(m[k], null, `${m.name}.${k}`);
    const s = shaderOf(m);
    assert.equal(count(s.fragmentShader) + count(s.vertexShader), count(rs.fragmentShader) + count(rs.vertexShader), 'no sampler beyond the shared patch');
    assert.ok(s.fragmentShader.includes('roughnessFactor *= vFkRM.x') && s.vertexShader.includes('attribute vec2 aRM'), 'the aRM patch applied');
    assert.ok(String(m.customProgramCacheKey()).endsWith('|fk-rm'), 'its own program key');
  }
  // the only texture in the kit is the cradle screen's canvas, on an unlit material
  for (const root of [d0, d1, co.group]) root.traverse((o) => o.isMesh && assert.equal(o.material.map || null, null));
});

// ---- 7. no per-frame allocation (heap sampled) ------------------------------------------------------------------------------------
{
  const d = buildDrone({ index: 3 });
  const c = buildCradle();
  const col = buildCollar();
  const st = { spin: 0.8, clamp: 0.3, lights: 1, beam: 0.5, scan: 0.7, sweep: 0.1 };
  const cs = { spool: 2, lights: 0.8, gate: 0.2 };
  const ks = { iris: 0, lights: 1 };
  const frame = (i) => {
    st.spin = (i % 100) / 100;
    st.clamp = (i % 37) / 37;
    st.sweep = (i % 50) / 50;
    d.update(1 / 72, st);
    d.setStatus(i & 1 ? 0x5fe0ff : 0xffb040);
    cs.gate = (i % 20) / 20;
    c.update(1 / 72, cs);
    ks.iris = (i % 64) / 64;
    ks.lights = (i % 10) / 10;
    col.update(1 / 72, ks);
  };
  for (let i = 0; i < 20000; i++) frame(i);
  const N = 6000;
  const chunks = [];
  for (let k = 0; k < 5; k++) {
    const session = new inspector.Session();
    session.connect();
    await session.post('HeapProfiler.startSampling', { samplingInterval: 64 });
    for (let i = 0; i < N; i++) frame(i);
    const { profile } = await session.post('HeapProfiler.stopSampling');
    session.disconnect();
    let bytes = 0;
    (function walk(nd) {
      if (/facilityKit\.js/.test((nd.callFrame && nd.callFrame.url) || '')) bytes += nd.selfSize || 0;
      for (const ch of nd.children || []) walk(ch);
    })(profile.head);
    chunks.push(bytes / N);
  }
  const med = chunks.slice().sort((a, b) => a - b)[2];
  ok(`no allocation per frame: drone.update + setStatus, cradle.update, collar.update (iris + lights): median ${med.toFixed(2)} B / frame (chunks ${chunks.map((v) => v.toFixed(2)).join(' ')})`, () => {
    assert.ok(med < 0.5);
  });
  d.dispose();
  c.dispose();
  col.dispose();
}

// ---- 8. dispose -------------------------------------------------------------------------------------------------------------------
ok('dispose frees every geometry and material and detaches the group', () => {
  const parent = new THREE.Group();
  const d = buildDrone();
  const c = buildCradle();
  const col = buildCollar();
  parent.add(d, c, col.group);
  const geos = new Set();
  const mats = new Set();
  for (const r of [d, c, col.group])
    r.traverse((o) => {
      if (o.geometry) geos.add(o.geometry);
      if (o.material) mats.add(o.material);
    });
  let gd = 0;
  let md = 0;
  for (const g of geos) g.addEventListener('dispose', () => gd++);
  for (const m of mats) m.addEventListener('dispose', () => md++);
  d.dispose();
  c.dispose();
  col.dispose();
  assert.equal(gd, geos.size, 'geometries');
  assert.equal(md, mats.size, 'materials');
  assert.equal(parent.children.length, 0);
});

console.log(`PASS ${n} checks: the COLLAR kit (drone LOD0 / LOD1, cradle, collar + iris)`);
