// Node tests for the baked lighting (GI volume) and the render governor hook:
//  - the bake is deterministic and reads sensibly (corners darker than open air, the shaft key blocked under a ceiling,
//    a lit lamp pool brighter than a far voxel, voxels pushed out of solids)
//  - the shipped asset matches the current level (levelGiHash), is < 2 MB, and round-trips through the file format
//  - RenderGovernor: mirrors a platform governor, otherwise steps down fast / up slowly with hysteresis
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Level3D } from '../../../../public/abyssal-tether-3d/src/sim/level3d.js';
import { LEVEL_DATA_3D } from '../../../../public/abyssal-tether-3d/src/data/level-data-3d.js';
import { levelGiHash, readHeader, voxelIndex } from '../../../../public/abyssal-tether-3d/src/render/giFormat.js';
import { RenderGovernor } from '../../../../public/abyssal-tether-3d/src/render/renderGovernor.js';
import { bake, packBake, unpackBake, BAKE } from '../../bake/bake_gi.mjs';
import { bakeLightmaps, packPage } from '../../bake/bake_lightmaps.mjs';
import zlib from 'node:zlib';
import {
  LM_FACE_FLOATS,
  LM_FACES,
  LM_HEADER_BYTES,
  LM_INDEX_NAME,
  LM_PAGE,
  buildChartTable,
  isCoreSolid,
  levelLmHash,
  lmUndelta,
  readLmHeader,
} from '../../../../public/abyssal-tether-3d/src/render/lightmapFormat.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSET = path.resolve(HERE, '../../../../public/abyssal-tether-3d/assets/lighting/gi_ch1.bin');
let n = 0;
const ok = (name, fn) => {
  fn();
  n++;
  console.log('  ok', name);
};

const level = new Level3D(LEVEL_DATA_3D, 'normal');

// ---- bake (reduced resolution: fast) -----------------------------------------------------------------------------
const small = { dims: [56, 128, 62] };
const a = bake(level, { config: small });
const b = bake(level, { config: small });
ok('bake is deterministic', () => assert.deepEqual(Buffer.from(a.raw), Buffer.from(b.raw)));
const at = (res, x, y, z) => {
  const d = res.dims;
  const ix = Math.floor(((x - res.min[0]) / res.size[0]) * d[0]);
  const iy = Math.floor(((y - res.min[1]) / res.size[1]) * d[1]);
  const iz = Math.floor(((z - res.min[2]) / res.size[2]) * d[2]);
  const o = voxelIndex(d, ix, iy, iz);
  return { lum: (res.raw[o] / 255) ** 2 * 2, warm: res.raw[o + 1] / 255, key: res.raw[o + 2] / 255, ao: res.raw[o + 3] / 255 };
};
ok('open air at the top of the S1 tube is bright (AO ≈ 1)', () => assert.ok(at(a, 0, 52, 0).ao > 0.88, JSON.stringify(at(a, 0, 52, 0))));
ok('crevices darken: AO varies across the S1 chamber', () => {
  let lo = 1;
  let hi = 0;
  for (const x of [-10, -5, 0, 5, 10]) for (const z of [-10, -5, 0, 5, 10]) for (const y of [-6.5, 0, 10, 30]) {
    const v = at(a, x, y, z).ao;
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  assert.ok(hi - lo > 0.12, `${lo} .. ${hi}`);
});
ok('the shaft key is blocked under the S2 ceiling', () => {
  const under = at(a, -22, -14, 0); // S2 ceiling slab spans x −34..−11 at y −11..−8
  const open = at(a, 0, 52, 0); // top of the S1 tube: nothing above
  assert.ok(under.key < 0.5 && open.key > 0.9, `${under.key} ${open.key}`);
});
ok('a lit lamp pool is brighter than a far voxel and warm', () => {
  const L = level.lights.find((l) => l.id === 'lit0');
  const pool = at(a, L.x + 1.5, L.y, L.z - 1.5);
  const far = at(a, 0, -300, 0);
  assert.ok(pool.lum > far.lum + 0.05, `${pool.lum} vs ${far.lum}`);
  assert.ok(pool.warm > 0.5, `warm ${pool.warm}`);
});
ok('values stay in range everywhere', () => {
  let min = 255;
  for (let i = 3; i < a.raw.length; i += 4) if (a.raw[i] < min) min = a.raw[i];
  assert.ok(min >= 50, 'AO never near black: ' + min); // trilinear sampling of a surface must not black out
});

// ---- the shipped asset -------------------------------------------------------------------------------------------
ok('shipped GI asset: < 2 MB, header ok, matches the level', () => {
  const buf = fs.readFileSync(ASSET);
  assert.ok(buf.length < 2 * 1024 * 1024, `size ${buf.length}`);
  const h = readHeader(buf);
  assert.ok(h, 'header');
  assert.equal(h.hash, levelGiHash(level), 'stale bake: re-run tools/abyssal-tether-3d/bake/bake_gi.mjs');
  assert.deepEqual(h.dims, BAKE.dims);
});
ok('file format round trip', () => {
  const buf = packBake(a);
  const u = unpackBake(buf);
  assert.deepEqual(Buffer.from(u.raw), Buffer.from(a.raw));
});
ok('the hash ignores crumbling ledges but not walls', () => {
  const l2 = new Level3D(LEVEL_DATA_3D, 'normal');
  const h0 = levelGiHash(l2);
  l2.solids.find((s) => s.kind === 'crumble').minX += 5;
  assert.equal(levelGiHash(l2), h0);
  l2.solids.find((s) => s.kind === 'wall').minX += 1;
  assert.notEqual(levelGiHash(l2), h0);
});


// ---- lightmaps ---------------------------------------------------------------------------------------------------
const LM_DIR = path.resolve(HERE, '../../../../public/abyssal-tether-3d/assets/lighting');
const lmIndex = JSON.parse(fs.readFileSync(path.join(LM_DIR, LM_INDEX_NAME), 'utf8'));
const rawById = new Map(LEVEL_DATA_3D.solids.map((s) => [s.id, s]));
const coreExpected = level.solids.filter((s) => isCoreSolid(s, rawById)).map((s) => s.id);

ok('shipped lightmaps: index matches the level (a stale bake fails here: re-run tools/abyssal-tether-3d/bake/bake_lightmaps.mjs)', () => {
  assert.equal(lmIndex.format, 'AT3DLM01');
  assert.deepEqual(Object.keys(lmIndex.solids).sort(), coreExpected.slice().sort(), 'the set of baked solids changed');
  assert.equal(lmIndex.hash, levelLmHash(level, Object.keys(lmIndex.solids)), 'stale lightmaps');
  for (const s of level.solids) {
    const b = lmIndex.boxes[s.id];
    if (!b) continue;
    assert.deepEqual(b, [s.minX, s.minY, s.minZ, s.maxX, s.maxY, s.maxZ].map((v) => Math.round(v * 100)), 'box moved: ' + s.id);
  }
});
ok('lightmap hash: ignores crumbling ledges and variant-only solids, notices walls and lamps', () => {
  const ids = Object.keys(lmIndex.solids);
  const base = levelLmHash(level, ids);
  const nm = new Level3D(LEVEL_DATA_3D, 'nightmare');
  const ab = new Level3D(LEVEL_DATA_3D, 'abyss');
  assert.equal(levelLmHash(nm, ids), base, 'nightmare variant');
  assert.equal(levelLmHash(ab, ids), base, 'abyss variant');
  const l2 = new Level3D(LEVEL_DATA_3D, 'normal');
  l2.solids.find((s) => s.kind === 'crumble').minX += 5;
  assert.equal(levelLmHash(l2, ids), base);
  l2.solids.find((s) => s.id === ids[0]).maxY += 1;
  assert.notEqual(levelLmHash(l2, ids), base);
  const l3 = new Level3D(LEVEL_DATA_3D, 'normal');
  l3.lights[0].x += 1;
  assert.notEqual(levelLmHash(l3, ids), base);
});
ok('shipped lightmaps: pages decode, GPU budget <= 32 MB, charts index real pages, rects inside the page', () => {
  const [W, H] = lmIndex.page;
  assert.deepEqual([W, H], LM_PAGE);
  assert.ok(lmIndex.layers === lmIndex.pages.length && lmIndex.layers >= 1);
  const gpu = W * H * 4 * lmIndex.layers;
  assert.ok(gpu <= 32 * 1048576, `GPU bytes ${gpu}`);
  let disk = 0;
  lmIndex.pages.forEach((pg) => {
    const buf = fs.readFileSync(path.join(LM_DIR, pg.file));
    disk += buf.length;
    const h = readLmHeader(buf);
    assert.ok(h && h.w === W && h.h === H && h.pages === 1, 'header ' + pg.file);
    const raw = zlib.inflateSync(buf.subarray(LM_HEADER_BYTES));
    assert.equal(raw.length, h.rawLength);
    lmUndelta(raw);
    let lit = 0;
    for (let i = 0; i < raw.length; i += 4) if (raw[i] + raw[i + 1] + raw[i + 2] > 0) lit++;
    assert.ok(lit > raw.length / 4 / 20, 'page holds charts: ' + pg.file);
  });
  assert.ok(disk < 14 * 1048576, `disk ${disk}`);
  assert.equal(lmIndex.rows.length, Object.keys(lmIndex.solids).length);
  let charts = 0;
  for (const row of lmIndex.rows) {
    assert.equal(row.length, LM_FACES * LM_FACE_FLOATS);
    for (let f = 0; f < LM_FACES; f++) {
      const q = row.slice(f * LM_FACE_FLOATS, (f + 1) * LM_FACE_FLOATS);
      if (q[0] < 0) continue;
      charts++;
      assert.ok(q[0] < lmIndex.layers);
      assert.ok(q[1] >= 0 && q[2] >= 0 && q[3] <= 1 && q[4] <= 1 && q[1] < q[3] && q[2] < q[4], 'atlas rect');
      assert.ok(q[5] >= 0 && q[6] >= 0 && q[7] <= 1.000001 && q[8] <= 1.000001 && q[5] < q[7] && q[6] < q[8], 'crop');
    }
  }
  assert.ok(charts > 200, 'charts ' + charts);
  const t = buildChartTable(lmIndex.rows);
  assert.equal(t.data.length, t.width * t.height * 4);
});
const q1 = await bakeLightmaps(level, { draft: true, budget: 260000, workers: 2 });
const q2 = await bakeLightmaps(level, { draft: true, budget: 260000, workers: 3 });
ok('lightmap bake: identical pages for different worker counts', () => {
  assert.equal(q1.pages.length, q2.pages.length);
  for (let i = 0; i < q1.pages.length; i++) assert.ok(Buffer.from(q1.pages[i]).equals(Buffer.from(q2.pages[i])), 'page ' + i);
  assert.equal(q1.index.hash, q2.index.hash);
  assert.ok(packPage(q1.pages[0]).length > 1000);
});

// ---- governor hook -----------------------------------------------------------------------------------------------
ok('governor: degrades fast on misses, recovers slowly, emits events', () => {
  const r3d = { settings: {}, _game: null, _bus: null };
  const g = new RenderGovernor(r3d);
  const events = [];
  g.on((e) => events.push(e));
  for (let i = 0; i < 200; i++) g.update(13.9); // on target
  assert.equal(g.level, 0);
  for (let i = 0; i < 90; i++) g.update(30); // far over target
  assert.ok(g.level >= 1, 'degraded ' + g.level);
  const down = g.level;
  for (let i = 0; i < 72 * 3; i++) g.update(13.9); // 3 s calm: not yet
  assert.equal(g.level, down);
  for (let i = 0; i < 72 * 12; i++) g.update(13.9); // 12 s calm: one step up
  assert.ok(g.level < down, 'recovered ' + g.level);
  assert.ok(events.some((e) => e.why === 'degrade') && events.some((e) => e.why === 'recover'));
});
ok('governor: mirrors an active platform governor and never steps itself', () => {
  const plat = { active: true, level: 2 };
  const r3d = { settings: {}, _game: { governor: plat }, _bus: null };
  const g = new RenderGovernor(r3d);
  const events = [];
  g.update(14);
  g.on((e) => events.push(e));
  for (let i = 0; i < 100; i++) g.update(40);
  assert.equal(g.level, 2);
  assert.equal(g.mode, 'platform');
  plat.level = 3;
  g.update(14);
  assert.equal(g.level, 3);
  assert.equal(events.length, 1);
});
ok('governor: hitches are ignored, reduced effects hold the floor', () => {
  const g = new RenderGovernor({ settings: { reducedEffects: true }, _game: null, _bus: null });
  for (let i = 0; i < 100; i++) g.update(900);
  assert.equal(g.level, 0);
  g.setLevel(3);
  for (let i = 0; i < 72 * 40; i++) g.update(13.9);
  assert.equal(g.level, 3);
});

console.log(`${n} lighting checks passed`);
