// Node tests for WP-SHADOWS (no GPU): the tier table and the governor / reducedEffects reduction, the cone fit, the cache-refresh
// decision (thresholds, rate limit, forced refresh), the axis smoothing, the receiver shader chunks (installed into the stock lights
// chunks, present in the lit-surface program and in an attached foreign material), and the static box proxy (selection, cap, dead
// solids, same-set detection, no allocation on the steady path).
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
const L = await import(`${SRC}/render/lanternShadowLogic.js`);
const M = await import(`${SRC}/render/materials.js`);
const { LanternShadow, SHADOW_LAYER_STATIC, SHADOW_LAYER_DYNAMIC } = await import(`${SRC}/render/lanternShadow.js`);

let n = 0;
const ok = (name, fn) => {
  fn();
  n++;
  console.log('  ok', name);
};

ok('tier table: low off, quest 1024 / 512 / <= 24 caster calls, high 2048 / 1024', () => {
  assert.equal(L.SHADOW_TIERS.low.enabled, false);
  assert.equal(L.SHADOW_TIERS.quest.staticSize, 1024);
  assert.equal(L.SHADOW_TIERS.quest.dynSize, 512);
  assert.ok(L.SHADOW_TIERS.quest.maxCasterCalls <= 24);
  assert.equal(L.SHADOW_TIERS.high.staticSize, 2048);
  assert.equal(L.SHADOW_TIERS.quest.radius, 14);
  assert.ok(Object.isFrozen(L.SHADOW_TIERS.quest));
  assert.equal(L.shadowTierName('Quest'), 'quest');
  assert.equal(L.shadowTierName('reduced'), 'low');
  assert.equal(L.shadowTierName('nope'), null);
});

ok('plan: low = off, governor 2 / reducedEffects halve maps + rate, governor 3 and the API switch turn it off', () => {
  assert.equal(L.shadowPlan('low').enabled, false);
  const q = L.shadowPlan('quest');
  assert.equal(q.enabled, true);
  assert.equal(q.staticSize, 1024);
  assert.equal(q.dynEvery, 1);
  const g1 = L.shadowPlan('quest', { govLevel: 1 });
  assert.equal(g1.staticSize, 1024, 'level 1 keeps the shadow');
  const g2 = L.shadowPlan('quest', { govLevel: 2 });
  assert.equal(g2.staticSize, 512);
  assert.equal(g2.dynSize, 256);
  assert.equal(g2.dynEvery, 2);
  assert.ok(g2.minInterval >= q.minInterval * 2 - 1e-9);
  assert.ok(g2.posThresh > q.posThresh && g2.turnDeg > q.turnDeg);
  assert.ok(g2.maxCasterCalls <= q.maxCasterCalls);
  const red = L.shadowPlan('quest', { reduced: true });
  assert.equal(red.staticSize, 512);
  assert.equal(L.shadowPlan('quest', { govLevel: 3 }).enabled, false);
  assert.equal(L.shadowPlan('high', { enabled: false }).enabled, false);
  assert.equal(L.shadowPlan('high').staticSize, 2048);
  assert.equal(L.shadowPlan('high', { govLevel: 2 }).staticSize, 1024);
});

ok('cone fit: 120 degrees, texel size = 2 tan(fov/2) / size, near clips the lantern cage, far covers the radius', () => {
  const f = L.coneFit(120, 1024, 14);
  assert.ok(Math.abs(f.tanHalf - Math.sqrt(3)) < 1e-9);
  assert.ok(Math.abs(f.texel - (2 * Math.sqrt(3)) / 1024) < 1e-9);
  assert.ok(f.near >= 0.15 && f.near <= 0.3);
  assert.ok(f.far > 14 && f.far <= 16);
  // at 14 m a quest texel is a few centimetres
  assert.ok(f.texel * 14 < 0.06, `texel at 14 m ${f.texel * 14}`);
  assert.ok(L.coneFit(120, 2048, 16).texel < f.texel);
});

const unit = (x, y, z) => {
  const l = Math.hypot(x, y, z);
  return { ax: x / l, ay: y / l, az: z / l };
};

ok('refresh: first frame, tiny motion reuses the cache, position / turn thresholds, rate limit, stamp and size changes', () => {
  const plan = L.shadowPlan('quest');
  const cache = L.makeStaticCache();
  const pose = { x: 1, y: -10, z: 2, ...unit(0, 0, -1) };
  assert.equal(L.staticNeedsRefresh(cache, pose, plan, 0, 1), true, 'empty cache');
  L.markStaticRefreshed(cache, pose, plan, 0, 1);
  assert.equal(L.staticNeedsRefresh(cache, pose, plan, 1, 1), false, 'standing still = free');
  assert.equal(L.staticNeedsRefresh(cache, { ...pose, x: pose.x + 0.02 }, plan, 1, 1), false, '2 cm: reuse');
  assert.equal(L.staticNeedsRefresh(cache, { ...pose, x: pose.x + 0.2 }, plan, 1, 1), true, '20 cm: refresh');
  assert.equal(L.staticNeedsRefresh(cache, { ...pose, x: pose.x + 0.2 }, plan, 0.01, 1), false, 'rate limited (36 Hz)');
  assert.equal(L.staticNeedsRefresh(cache, { ...pose, ...unit(0.03, 0, -1) }, plan, 1, 1), false, '1.7 degrees: reuse');
  assert.equal(L.staticNeedsRefresh(cache, { ...pose, ...unit(0.3, 0, -1) }, plan, 1, 1), true, '17 degrees: refresh');
  assert.equal(L.staticNeedsRefresh(cache, pose, plan, 1, 2), true, 'stamp (casters changed)');
  assert.equal(L.staticNeedsRefresh(cache, pose, L.shadowPlan('quest', { govLevel: 2 }), 1, 1), true, 'map size changed');
  // high refreshes sooner than quest, the governor later
  const hi = L.shadowPlan('high');
  assert.ok(hi.posThresh < plan.posThresh && hi.turnDeg < plan.turnDeg);
  const gov = L.shadowPlan('quest', { govLevel: 2 });
  assert.ok(gov.minInterval > plan.minInterval);
});

ok('dynamic cadence: every frame on quest, every 2nd at governor 2, never when off', () => {
  const q = L.shadowPlan('quest');
  for (let f = 0; f < 6; f++) assert.equal(L.dynamicDue(f, q), true);
  const g = L.shadowPlan('quest', { govLevel: 2 });
  assert.deepEqual([0, 1, 2, 3].map((f) => L.dynamicDue(f, g)), [true, false, true, false]);
  assert.equal(L.dynamicDue(0, L.shadowPlan('low')), false);
});

ok('axis smoothing: follows the head, stays unit length, ignores a tremor', () => {
  const a = { x: 0, y: 0, z: -1 };
  L.smoothAxis(a, 1, 0, 0, 0.5);
  assert.ok(Math.abs(Math.hypot(a.x, a.y, a.z) - 1) < 1e-9);
  assert.ok(a.x > 0.6 && a.z < -0.6);
  const b = { x: 0, y: 0, z: -1 };
  const t = unit(0.01, 0.01, -1);
  L.smoothAxis(b, t.ax, t.ay, t.az, 0.1);
  assert.ok(L.angleBetween(b.x, b.y, b.z, 0, 0, -1) < 0.002);
  const c = { x: 0, y: 0, z: -1 };
  for (let i = 0; i < 80; i++) L.smoothAxis(c, 0, 1, 0, 0.2);
  assert.ok(c.y > 0.999);
});

ok('cone test: in front in range yes, behind or far no, a big box beside the axis yes', () => {
  const t = Math.sqrt(3);
  assert.equal(L.sphereInCone(0, 0, -5, 0.5, 0, 0, 0, 0, 0, -1, t, 14), true);
  assert.equal(L.sphereInCone(0, 0, 5, 0.5, 0, 0, 0, 0, 0, -1, t, 14), false, 'behind');
  assert.equal(L.sphereInCone(0, 0, -40, 0.5, 0, 0, 0, 0, 0, -1, t, 14), false, 'beyond the range');
  assert.equal(L.sphereInCone(60, 0, -5, 20, 0, 0, 0, 0, 0, -1, t, 14), false, 'a big sphere still out of reach');
  assert.equal(L.sphereInCone(0, 0, 0.1, 1, 0, 0, 0, 0, 0, -1, t, 14), true, 'the apex is inside a sphere around it');
});

ok('receiver chunks: installed once in the stock chunks (function, visibility variable, lantern-only multiply)', () => {
  const sc = THREE.ShaderChunk;
  assert.ok(sc.lights_pars_begin.includes('float atLanternShadow('));
  assert.equal(sc.lights_pars_begin.split('float atLanternShadow(').length, 2, 'declared once');
  assert.ok(sc.lights_fragment_begin.startsWith('float atLsVis = 1.0;'));
  assert.ok(/pointLight\.decay < 1\.8[^\n]*atLanternShadow\(/.test(sc.lights_fragment_begin), 'lantern only (the pooled lamps have decay 2)');
  assert.ok(sc.lights_pars_begin.includes('sampler2DShadow uLSMapS') && sc.lights_pars_begin.includes('sampler2DShadow uLSMapD'));
  assert.ok(sc.lights_pars_begin.includes('#ifdef AT_LSHADOW'), 'inert in every program that does not define it');
  // the stock chunk text is otherwise unchanged
  assert.ok(sc.lights_fragment_begin.includes('getPointLightInfo( pointLight, geometryPosition, directLight );'));
});

ok('uniform holders: two maps, two matrices, strength off by default', () => {
  assert.equal(M.LSHADOW.uLSK.value.x, 0);
  assert.ok(M.LSHADOW.uLSMS.value.isMatrix4 && M.LSHADOW.uLSMD.value.isMatrix4);
  assert.equal(M.LSHADOW.uLSMapS.value, null);
});

ok('patchMaterial lit programs and attach()ed foreign materials get the define + the shared uniforms; others stay stock', () => {
  const lit = M.patchMaterial(new THREE.MeshStandardMaterial(), { lit: true, grade: true });
  let sh = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  lit.onBeforeCompile(sh, null);
  assert.ok(sh.fragmentShader.startsWith('#define AT_LSHADOW'));
  assert.equal(sh.uniforms.uLSMapS, M.LSHADOW.uLSMapS);
  assert.equal(sh.uniforms.uLSMD, M.LSHADOW.uLSMD);
  assert.ok(lit.customProgramCacheKey().includes('|ls:1'));
  assert.equal(M.attachLanternShadow(lit), false, 'a lit patch already receives it');

  const stock = new THREE.MeshStandardMaterial();
  let prevRan = 0;
  stock.onBeforeCompile = (s) => {
    prevRan++;
    s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uMine;');
  };
  stock.customProgramCacheKey = () => 'mine';
  assert.equal(M.attachLanternShadow(stock), true);
  assert.equal(M.attachLanternShadow(stock), false, 'idempotent');
  sh = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  stock.onBeforeCompile(sh, null);
  assert.equal(prevRan, 1, 'the earlier patch still runs');
  assert.ok(sh.fragmentShader.includes('uniform float uMine;') && sh.fragmentShader.startsWith('#define AT_LSHADOW'));
  assert.equal(stock.customProgramCacheKey(), 'mine|at3d-ls');

  const plain = new THREE.MeshStandardMaterial();
  const keyBefore = plain.customProgramCacheKey();
  plain.userData.noShadowRecv = true;
  assert.equal(M.attachLanternShadow(plain), false, 'opt-out');
  assert.equal(plain.customProgramCacheKey(), keyBefore);
  assert.equal(M.attachLanternShadow(new THREE.MeshBasicMaterial()), false, 'unlit materials are skipped');
});

ok('static proxy: nearest solids within reach, dead / far ones skipped, cap respected, same set = no refresh, no allocation when idle', () => {
  const solids = [];
  for (let i = 0; i < 300; i++) solids.push({ minX: i * 2, maxX: i * 2 + 1, minY: -1, maxY: 0, minZ: -1, maxZ: 1, active: true });
  solids[3].active = false;
  const scene = new THREE.Scene();
  const r3d = { scene, lighting: { tier: 'quest' }, levelView: { _solidSets: [{ mesh: { name: 'solids_rock' }, list: solids }, { mesh: { name: 'solids_grate' }, list: [{ minX: 0, maxX: 1, minY: 0, maxY: 1, minZ: 0, maxZ: 1 }] }] } };
  const ls = new LanternShadow(r3d);
  ls.setLevel({});
  assert.equal(ls._refs.length, 300, 'grates never cast');
  const changed = ls._pack(0, 0, 0, 14, 640, true);
  assert.equal(changed, true);
  // within 17 m (R + 3): solids 0..8 (x up to 17), minus the inactive #3
  assert.equal(ls._proxy.count, 8);
  assert.equal(ls._proxy.layers.test(new THREE.Layers()), false, 'the head camera never draws the proxy');
  const arr = ls._proxy.instanceMatrix.array;
  assert.ok(Math.abs(arr[0] - 1) < 1e-6 && Math.abs(arr[5] - 1) < 1e-6 && Math.abs(arr[10] - 2) < 1e-6, 'unit box scaled to the solid');
  assert.ok(Math.abs(arr[12] - 0.5) < 1e-6 && Math.abs(arr[13] + 0.5) < 1e-6);
  // capped to the nearest
  ls._packHash = -1;
  ls._pack(0, 0, 0, 14, 4, true);
  assert.equal(ls._proxy.count, 4);
  // same inputs again: the casters did not change, so the cached map is still valid (returns false, stamp unchanged)
  const stamp = ls._stamp;
  ls._pack(0, 0, 0, 14, 4, true);
  assert.equal(ls._stamp, stamp);
  // a solid switched off changes the set
  solids[1].active = false;
  assert.equal(ls._pack(0, 0, 0, 14, 4, true), true);
  assert.ok(ls._stamp > stamp);
  // idle frames (no move, inside the repack interval) do nothing
  ls._time = ls._packT + 0.01;
  const packs = ls.stats.packs;
  ls._pack(0, 0, 0, 14, 4, false);
  assert.equal(ls.stats.packs, packs);
});

ok('casters: addCaster flags the dynamic layer once, userData.noShadowCast opts out; tier/API switches', () => {
  const scene = new THREE.Scene();
  const r3d = { scene, lighting: { tier: 'quest' }, governor: { level: 0 }, settings: {}, levelView: { _solidSets: [] } };
  const ls = new LanternShadow(r3d);
  const g = new THREE.Group();
  const a = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  const b = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  b.userData.noShadowCast = true;
  g.add(a, b);
  ls.addCaster(g);
  ls.addCaster(g);
  assert.equal(ls._dynObjs.length, 1);
  assert.ok(a.layers.isEnabled(SHADOW_LAYER_DYNAMIC) && a.layers.isEnabled(0), 'still drawn by the head camera');
  assert.ok(!b.layers.isEnabled(SHADOW_LAYER_DYNAMIC));
  assert.ok(![1, 2].includes(SHADOW_LAYER_STATIC) && ![1, 2].includes(SHADOW_LAYER_DYNAMIC), 'layers 1 and 2 belong to the XR eye cameras');
  assert.equal(ls.tier, 'quest');
  ls.setTier('high');
  assert.equal(ls.tier, 'high');
  ls.setTier(null);
  assert.equal(ls.tier, 'quest');
  ls.setEnabled(false);
  ls.setLevel({});
  ls.update(0.016, { settings: {} });
  assert.equal(ls.plan.enabled, false);
  ls.setEnabled(true);
  ls.update(0.016, { settings: {} });
  assert.equal(ls.plan.enabled, true);
  r3d.governor.level = 3;
  ls.update(0.016, { settings: {} });
  assert.equal(ls.plan.enabled, true, 'the frame governor never switches the shadow off');
  r3d.lighting.tier = 'low';
  r3d.governor.level = 0;
  ls.update(0.016, { settings: {} });
  assert.equal(ls.plan.enabled, false, 'low tier = off (the contact blobs remain)');
});

console.log(`${n} checks passed`);
