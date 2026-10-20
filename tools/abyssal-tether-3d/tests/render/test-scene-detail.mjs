// Node tests for WP-SCENE-DETAIL (src/render/sceneDetail*.js): the render-only scene-dressing scatter.
//  - the procedural kit: every template is sound (finite, indexed in range, unit normals, uvs inside the atlas, windings agree with
//    the normals), small (<= 300 triangles) and the whole kit is small
//  - the placement: deterministic for a seed (and different for another), authored mixes (wet sections get puddles, deep ones bones,
//    sinew), 5-6 vignettes, nothing that dangles near a grapple anchor, nothing near a checkpoint, per-section caps
//  - the quest budget: <= 3 draw calls, the worst window over a sweep of the whole descent stays inside the tier caps and the
//    stereo triangle total (props + decals + puddles, both eyes) inside 15 k; a lower tier is a subset of a higher one
//  - the view (SceneDetail) on a fake game: re-packs at three heights without allocating a new geometry, respects the draw range,
//    shaders carry their patches, dispose removes everything
import assert from 'node:assert/strict';
import path from 'node:path';
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
const { Level3D } = await import(`${SRC}/sim/level3d.js`);
const { buildKit } = await import(`${SRC}/render/sceneDetailKit.js`);
const plan_ = await import(`${SRC}/render/sceneDetailPlan.js`);
const { planSceneDetail, selectItems, selectRecords, ITEM_STRIDE, DECAL_STRIDE, PUDDLE_STRIDE, PLAN_CAPS, SECTION_MIX } = plan_;
const view = await import(`${SRC}/render/sceneDetail.js`);
const { SceneDetail, DETAIL_TIERS, DRAW_CALLS } = view;

let n = 0;
const ok = (name, fn) => {
  fn();
  n++;
  console.log('  ok', name);
};

const level = new Level3D();
const kit = buildKit();

ok('kit: sound templates, small', () => {
  assert.ok(kit.templates.length >= 50, `${kit.templates.length} templates`);
  assert.ok(kit.tris < 4500, `kit ${kit.tris} triangles`);
  assert.ok(kit.verts < 20000, `kit ${kit.verts} vertices`);
  const names = new Set(kit.templates.map((t) => t.name));
  assert.equal(names.size, kit.templates.length, 'unique names');
  for (const need of ['femur', 'skull', 'rib', 'chipA', 'plankA', 'crateSmash', 'barrel', 'pickaxe', 'chain4', 'ropeHang', 'banner', 'tag', 'webCorner', 'rootHang', 'sinewHang', 'stalA', 'candleLit', 'fungus', 'paperA', 'satchel', 'bedroll']) assert.ok(names.has(need), `template ${need}`);
  for (const t of kit.templates) {
    assert.ok(t.tris > 0 && t.tris <= 300, `${t.name}: ${t.tris} triangles`);
    let flipped = 0;
    for (let i = 0; i < t.inn; i++) assert.ok(kit.idx[t.i0 + i] < t.vn, `${t.name}: index in range`);
    for (let v = t.v0; v < t.v0 + t.vn; v++) {
      for (let k = 0; k < 3; k++) assert.ok(Number.isFinite(kit.pos[v * 3 + k]) && Number.isFinite(kit.nrm[v * 3 + k]) && Number.isFinite(kit.col[v * 3 + k]) && Number.isFinite(kit.fx[v * 3 + k]), `${t.name}: finite`);
      const l = Math.hypot(kit.nrm[v * 3], kit.nrm[v * 3 + 1], kit.nrm[v * 3 + 2]);
      assert.ok(Math.abs(l - 1) < 1e-3, `${t.name}: unit normal (${l})`);
      assert.ok(kit.uv[v * 2] >= 0 && kit.uv[v * 2] <= 1 && kit.uv[v * 2 + 1] >= 0 && kit.uv[v * 2 + 1] <= 1, `${t.name}: uv inside the atlas`);
    }
    for (let i = 0; i < t.inn; i += 3) {
      const a = t.v0 + kit.idx[t.i0 + i];
      const b = t.v0 + kit.idx[t.i0 + i + 1];
      const c = t.v0 + kit.idx[t.i0 + i + 2];
      const e1 = [0, 1, 2].map((k) => kit.pos[b * 3 + k] - kit.pos[a * 3 + k]);
      const e2 = [0, 1, 2].map((k) => kit.pos[c * 3 + k] - kit.pos[a * 3 + k]);
      const g = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      if (Math.hypot(...g) < 1e-12) continue;
      const vn = [0, 1, 2].map((k) => kit.nrm[a * 3 + k] + kit.nrm[b * 3 + k] + kit.nrm[c * 3 + k]);
      if (g[0] * vn[0] + g[1] * vn[1] + g[2] * vn[2] < 0) flipped++;
    }
    // a few tight closed loops (chain links) fold on their inside; everything else must agree
    assert.ok(flipped <= (t.name.startsWith('chain') ? t.tris * 0.2 : 0), `${t.name}: ${flipped} triangles wound against their normals`);
  }
});

const SEED = 20260514;
const plan = planSceneDetail(level, SEED, kit);

ok('plan: deterministic by seed, different for another seed', () => {
  const again = planSceneDetail(level, SEED, kit);
  assert.equal(again.checksum, plan.checksum);
  assert.deepEqual(Array.from(again.items.subarray(0, 600)), Array.from(plan.items.subarray(0, 600)));
  assert.equal(again.nDecals, plan.nDecals);
  assert.equal(again.nPuddles, plan.nPuddles);
  const other = planSceneDetail(level, SEED + 1, kit);
  assert.notEqual(other.checksum, plan.checksum);
  // a fresh Level3D (another run) with the same seed gives the same layout
  const fresh = planSceneDetail(new Level3D(), SEED, kit);
  assert.equal(fresh.checksum, plan.checksum);
});

ok('plan: counts, caps, finite, inside the level', () => {
  const s = plan.stats;
  assert.ok(s.items > 1500 && s.items <= PLAN_CAPS.items * level.sections.length, `${s.items} items`);
  assert.ok(s.decals > 300 && s.decals <= PLAN_CAPS.decals * level.sections.length, `${s.decals} decals`);
  assert.ok(s.puddles > 40 && s.puddles <= PLAN_CAPS.puddles * level.sections.length, `${s.puddles} puddles`);
  for (let i = 0; i < level.sections.length; i++) {
    assert.ok(s.perSectionItems[i] <= PLAN_CAPS.items + 60, `section ${i + 1}: ${s.perSectionItems[i]} items (vignettes may exceed the cap)`);
    assert.ok(s.perSectionItems[i] > 60, `section ${i + 1} has dressing (${s.perSectionItems[i]})`);
  }
  const b = level.bounds;
  for (let i = 0; i < plan.nItems; i++) {
    const o = i * ITEM_STRIDE;
    for (let k = 0; k < ITEM_STRIDE; k++) assert.ok(Number.isFinite(plan.items[o + k]), 'finite item field');
    assert.ok(plan.items[o] >= b.minX - 2 && plan.items[o] <= b.maxX + 2 && plan.items[o + 1] >= b.minY - 2 && plan.items[o + 1] <= b.maxY + 2 && plan.items[o + 2] >= b.minZ - 2 && plan.items[o + 2] <= b.maxZ + 2, 'inside the level');
    assert.ok(plan.items[o + 6] > 0.3 && plan.items[o + 6] < 3, 'scale');
    assert.ok(plan.items[o + 11] >= 0 && plan.items[o + 11] < 1, 'rank');
  }
  for (let i = 0; i < plan.nDecals; i++) for (let k = 0; k < DECAL_STRIDE; k++) assert.ok(Number.isFinite(plan.decals[i * DECAL_STRIDE + k]), 'finite decal field');
  for (let i = 0; i < plan.nPuddles; i++) for (let k = 0; k < PUDDLE_STRIDE; k++) assert.ok(Number.isFinite(plan.puddles[i * PUDDLE_STRIDE + k]), 'finite puddle field');
});

ok('plan: section mixes (wet middle: puddles; deep: bone + sinew; top: cloth)', () => {
  const cnt = (si, tests) => {
    let c = 0;
    for (let i = 0; i < plan.nItems; i++) {
      const o = i * ITEM_STRIDE;
      if (level.sectionIndexAt(plan.items[o + 1]) !== si) continue;
      if (tests.includes(kit.templates[plan.items[o + 12]].cat)) c++;
    }
    return c;
  };
  const pud = (si) => plan.stats.perSectionPuddles[si];
  assert.ok(pud(4) + pud(5) > pud(0) + pud(1), 'S5-S6 are wetter than S1-S2');
  assert.ok(SECTION_MIX[5].puddle > SECTION_MIX[0].puddle && SECTION_MIX[7].sinew > SECTION_MIX[0].sinew && SECTION_MIX[7].bone > SECTION_MIX[0].bone && SECTION_MIX[0].cloth > SECTION_MIX[7].cloth);
  assert.ok(cnt(7, ['sinew', 'root']) > cnt(0, ['sinew', 'root']), 'sinew and roots grow deep');
  assert.ok(cnt(0, ['cloth']) + cnt(1, ['cloth']) > cnt(7, ['cloth']) + cnt(6, ['cloth']), 'cloth hangs at the top');
});

ok('plan: vignettes (5-6 of 7, authored, apart, off the anchors and checkpoints)', () => {
  const counts = new Set();
  for (let sd = 1; sd <= 12; sd++) {
    const p = planSceneDetail(level, sd * 7919, kit);
    counts.add(p.vignettes.length);
    assert.ok(p.vignettes.length >= 4 && p.vignettes.length <= 6, `seed ${sd}: ${p.vignettes.length} vignettes`);
    const ids = p.vignettes.map((v) => v.id);
    assert.equal(new Set(ids).size, ids.length, 'distinct');
    assert.ok(ids.includes('camp'), 'the camp is never dropped');
    for (const v of p.vignettes) {
      for (const a of level.anchors) assert.ok(Math.hypot(a.x - v.x, a.y - v.y, a.z - v.z) > 2.4, `${v.id} keeps clear of anchor ${a.id}`);
      for (const s of level.sections) assert.ok(Math.hypot(s.checkpoint.x - v.x, s.checkpoint.y - v.y, s.checkpoint.z - v.z) > 2.9, `${v.id} keeps clear of the checkpoint of ${s.id}`);
    }
  }
  assert.ok(plan.vignettes.length >= 4, 'the main seed has vignettes');
});

ok('plan: nothing that dangles or glows near a grapple anchor, nothing near a checkpoint', () => {
  let hang = 0;
  for (let i = 0; i < plan.nItems; i++) {
    const o = i * ITEM_STRIDE;
    if (plan.items[o + 11] === 0) continue; // authored vignette items are placed by hand, checked above
    const t = kit.templates[plan.items[o + 12]];
    const x = plan.items[o];
    const y = plan.items[o + 1];
    const z = plan.items[o + 2];
    let dmin = Infinity;
    for (const a of level.anchors) dmin = Math.min(dmin, Math.hypot(a.x - x, a.y - y, a.z - z));
    assert.ok(dmin >= 1.0, `${t.name} ${dmin.toFixed(2)} m from an anchor`);
    if (t.hang) {
      hang++;
      assert.ok(dmin >= (t.web ? 2.2 : t.cat === 'stal' ? 2.4 : 3.2) - 1e-6, `${t.name} hangs ${dmin.toFixed(2)} m from an anchor`);
    }
    if (t.lit) assert.ok(dmin >= 5.5 - 1e-6, `lit ${t.name} ${dmin.toFixed(2)} m from an anchor`);
    if (!t.hang) {
      for (const sct of level.sections) assert.ok(Math.hypot(sct.checkpoint.x - x, sct.checkpoint.y - y, sct.checkpoint.z - z) >= 1.0, `${t.name} on the checkpoint of ${sct.id}`);
    }
  }
  assert.ok(hang > 200, `${hang} hanging items`);
});

ok('budget: window sweep over the whole descent stays inside every tier cap; <= 3 draw calls; <= 15 k stereo triangles', () => {
  assert.equal(DRAW_CALLS, 3);
  assert.ok(DRAW_CALLS <= 6);
  const outI = new Int32Array(plan.nItems);
  const outD = new Int32Array(plan.nDecals + 1);
  const outP = new Int32Array(plan.nPuddles + 1);
  const win = {};
  for (const tier of Object.values(DETAIL_TIERS)) {
    let worst = 0;
    let worstSet = 0;
    for (let y = 36; y > -560; y -= 5) {
      for (const [x, z] of [[-4, 0], [-20, 0], [0, 6], [-12, -8], [-30, 0], [6, 12]]) {
        const tris = selectItems(plan, x, y, z, tier.radius, tier.rank, tier.tris, outI, win);
        const nd = selectRecords(plan.decals, DECAL_STRIDE, 14, plan.nDecals, x, y, z, tier.radius + 4, tier.rank, tier.decals, outD);
        const np = selectRecords(plan.puddles, PUDDLE_STRIDE, 9, plan.nPuddles, x, y, z, tier.radius + 4, tier.rank, tier.puddles, outP);
        let real = 0;
        for (let s = 0; s < win.n; s++) real += kit.templates[plan.items[outI[s] * ITEM_STRIDE + 12]].tris;
        assert.equal(real, tris, 'accounted triangles match');
        assert.ok(tris <= tier.tris || win.radius <= tier.radius / 16 + 1e-6, `${tier.name}: ${tris} > ${tier.tris}`);
        assert.ok(nd <= tier.decals && np <= tier.puddles);
        worst = Math.max(worst, tris);
        worstSet = Math.max(worstSet, tris + nd * 2 + np * 6);
      }
    }
    assert.ok(worstSet * 2 <= 15000, `${tier.name}: worst window ${worstSet} unique triangles = ${worstSet * 2} stereo`);
    console.log(`      tier ${tier.name}: worst prop window ${worst} triangles, with decals + puddles ${worstSet} (${worstSet * 2} stereo)`);
  }
});

ok('tiers: a lower tier is a subset of a higher one', () => {
  const hi = new Set();
  const lo = new Set();
  const outA = new Int32Array(plan.nItems);
  const outB = new Int32Array(plan.nItems);
  const win = {};
  const a = selectItems(plan, -4, -105, 0, 40, 1.0, 1e9, outA, win);
  const na = win.n;
  const b = selectItems(plan, -4, -105, 0, 40, 0.4, 1e9, outB, win);
  const nb = win.n;
  for (let i = 0; i < na; i++) hi.add(outA[i]);
  for (let i = 0; i < nb; i++) lo.add(outB[i]);
  assert.ok(nb < na && nb > 0 && b < a);
  for (const i of lo) assert.ok(hi.has(i));
});

ok('view: SceneDetail re-packs inside its draw range; shaders carry the patches; dispose cleans up', () => {
  const scene = new THREE.Scene();
  const head = new THREE.Vector3(-4, 1.6, 8);
  const fake = {
    renderer: { scene, lighting: { tier: 'quest', applyLookTo() {} }, headPosition: (o) => o.copy(head), settings: {} },
    level,
    settings: {},
    state: 'playing',
    _runCount: 3,
    bus: { emit() {} },
  };
  const sd = new SceneDetail(fake);
  assert.ok(sd.enabled);
  sd.setSeed(SEED);
  let guard = 0;
  while (!sd.plan && guard++ < 2000) sd.update(1 / 72, fake);
  assert.ok(sd.plan, 'the plan finishes (time-sliced)');
  assert.equal(sd.plan.checksum, plan.checksum, 'the view plans the same layout as the pure planner');
  const geo = sd.geometry;
  const attr = geo.getAttribute('position');
  for (const y of [1.6, -70, -300, -520]) {
    head.set(-4, y, 2);
    sd.update(1 / 72, fake);
    const st = sd.stats();
    assert.equal(st.drawCalls, 3);
    assert.ok(sd.counts.tris <= DETAIL_TIERS.quest.tris, `${sd.counts.tris} tris at y ${y}`);
    assert.equal(geo.drawRange.count, sd.counts.tris * 3);
    assert.equal(geo.getAttribute('position'), attr, 'no new buffers');
    for (let i = 0; i < sd.counts.verts * 3; i++) assert.ok(Number.isFinite(attr.array[i]));
    const idx = geo.getIndex().array;
    for (let i = 0; i < sd.counts.tris * 3; i++) assert.ok(idx[i] < sd.counts.verts, 'index inside the packed vertices');
    assert.ok(sd.decalMesh.count <= DETAIL_TIERS.quest.decals && sd.puddleMesh.count <= DETAIL_TIERS.quest.puddles);
    assert.ok(st.uniqueTris * 2 <= 15000, `stereo ${st.uniqueTris * 2}`);
  }
  // tier switch
  fake.renderer.lighting.tier = 'low';
  head.set(-4, -105, 2);
  sd.update(1 / 72, fake);
  assert.ok(sd.counts.tris <= DETAIL_TIERS.low.tris);
  const lowTris = sd.counts.tris;
  fake.renderer.lighting.tier = 'high';
  head.set(-4, -104, 2);
  sd.update(1 / 72, fake);
  assert.ok(sd.counts.tris >= lowTris);
  fake.settings.reducedEffects = true;
  head.set(-4, -106, 2);
  sd.update(1 / 72, fake);
  assert.equal(sd._tier.name, 'low', 'reducedEffects -> low');
  assert.equal(sd.uniforms.wind.value.z, 0, 'reducedEffects stills the sway');
  fake.settings.reducedEffects = false;

  // the shaders: every patch landed on a real anchor of this three.js build
  const compile = (mat) => {
    const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader, defines: {} };
    mat.onBeforeCompile(shader, null);
    return shader;
  };
  const p = compile(sd.propsMat);
  for (const s of ['aFx', 'vSdGlow', 'uSdWind']) assert.ok(p.vertexShader.includes(s), `props vertex: ${s}`);
  for (const s of ['uSdFar', 'discard', 'vColor.rgb * vSdGlow', 'uGradeK']) assert.ok(p.fragmentShader.includes(s), `props fragment: ${s}`);
  assert.ok('uSdWind' in p.uniforms && 'uSdTime' in p.uniforms && 'uWet' in p.uniforms, 'props uniforms bound');
  const d = compile(sd.decalMat);
  for (const s of ['iCell', 'iTint', 'iAux', 'vMapUv = vMapUv * iCell.zw']) assert.ok(d.vertexShader.includes(s), `decal vertex: ${s}`);
  assert.ok(d.fragmentShader.includes('vSdTint.rgb') && d.fragmentShader.includes('uGradeK'), 'decal fragment');
  const w = compile(sd.puddleMat);
  for (const s of ['iPud', 'aPart', 'aDrip', 'instanceMatrix[ 0 ]']) assert.ok(w.vertexShader.includes(s), `puddle vertex: ${s}`);
  for (const s of ['atPG', 'vPudR', 'normal = normalize( normal + ( viewMatrix']) assert.ok(w.fragmentShader.includes(s), `puddle fragment: ${s}`);
  assert.notEqual(sd.propsMat.customProgramCacheKey(), sd.decalMat.customProgramCacheKey());

  sd.dispose();
  assert.equal(scene.children.length, 0, 'dispose removes every mesh');
});

console.log(`scene detail: ${n} checks passed`);
