// Node tests for the opt-in BLOOD WRITING (Settings › Display › Blood writing; data/blood-writing-3d.js, render/bloodWriting.js)
// and the board texts it sits beside (no GPU, no browser: a recording 2D context stands in for the canvas):
//   - the data: 2-3 writings per section (about 20), at most 3 lines of at most 24 characters each, only the characters the
//     scrawl draws, unique ids, each in the section it names, close to where the player passes;
//   - the placement: every corner of every writing lies on a static level solid (a wall's inner face or a floor's top: just
//     inside is stone, just outside is air), never on a crumbling ledge, never across a climb zone or a plaque;
//   - not level decor: no 'blood' decor, the decor count unchanged (no bake / lightmap / GI hash / dressing / collider input);
//   - the setting: OFF by default, strict boolean, survives Storage and the save profile round trips;
//   - the renderer: the scrawl fits its cell at a legible size with drips, draws only charset glyphs; one mesh, 2 triangles per
//     writing, uvs inside the atlas; dispose frees geometry, material and atlas; LevelView: with the setting OFF no blood mesh
//     exists, ON builds exactly one, OFF again removes it (and clear() leaves none).
//   node test-blood-writing.mjs [--root DIR]
import { register } from 'node:module';
import { srcUrl, VENDOR_THREE_URL } from '../../verify/root.mjs';
register(
  'data:text/javascript,' +
    encodeURIComponent(`export async function resolve(s, c, next) {
  if (s === 'three') return { url: '${VENDOR_THREE_URL}three.module.min.js', shortCircuit: true };
  if (s.startsWith('three/addons/')) return { url: '${VENDOR_THREE_URL}addons/' + s.slice(13), shortCircuit: true };
  return next(s, c);
}`),
);
globalThis.self = globalThis;
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => void mem.set(k, String(v)),
  removeItem: (k) => void mem.delete(k),
  key: (i) => [...mem.keys()][i] ?? null,
  get length() {
    return mem.size;
  },
};
const THREE = await import('three');
const C = await import(srcUrl('sim/config3d.js'));
const SAVE = await import(srcUrl('meta/save.js'));
const { Level3D } = await import(srcUrl('sim/level3d.js'));
const { LEVEL_DATA_3D } = await import(srcUrl('data/level-data-3d.js'));
const BD = await import(srcUrl('data/blood-writing-3d.js'));
const BW = await import(srcUrl('render/bloodWriting.js'));
const { LevelView } = await import(srcUrl('render/levelView.js'));

let fails = 0;
let n = 0;
const ok = (c, msg) => {
  n++;
  if (!c) {
    fails++;
    console.log('FAIL ' + msg);
  } else console.log('  ok ' + msg);
};

/** A recording stand-in for a canvas 2D context (every method the scrawl may call; a missing one throws). */
function stubCanvas(w, h) {
  const calls = { fillText: [], strokeText: 0, arc: 0, fill: 0, stroke: 0 };
  let px = 10;
  const ctx = {
    canvas: null,
    calls,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    get font() {
      return `${px}px x`;
    },
    set font(f) {
      const m = /(\d+(?:\.\d+)?)px/.exec(String(f));
      if (m) px = +m[1];
    },
    measureText: (s) => ({ width: [...String(s)].length * px * 0.62 }),
    fillText: (s) => void calls.fillText.push(String(s)),
    strokeText: () => void calls.strokeText++,
    clearRect() {},
    save() {},
    restore() {},
    translate() {},
    rotate() {},
    scale() {},
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    quadraticCurveTo() {},
    arc: () => void calls.arc++,
    fill: () => void calls.fill++,
    stroke: () => void calls.stroke++,
  };
  const canvas = { width: w, height: h, getContext: (k) => (k === '2d' ? ctx : null) };
  ctx.canvas = canvas;
  return canvas;
}

const L = new Level3D(undefined, 'normal');
const T = BD.BLOOD_TEXTS;

// ---- the data ------------------------------------------------------------------------------------------------------------
{
  ok(L.data.blood === T && LEVEL_DATA_3D.blood === T, 'the level data carries the list (level.data.blood), nothing else does');
  const per = {};
  for (const e of T) per[e.section] = (per[e.section] || 0) + 1;
  const counts = L.sections.map((s) => per[s.id] || 0);
  ok(counts.every((c) => c >= 2 && c <= 3) && T.length >= 18 && T.length <= 24, `2-3 writings per section, about 20 in all: ${counts.join('/')} = ${T.length}`);
  ok(new Set(T.map((e) => e.id)).size === T.length, 'unique ids');
  const lineBad = T.filter((e) => {
    const lines = e.text.split('\n');
    return lines.length < 1 || lines.length > BD.BLOOD_MAX_LINES || lines.some((l) => !l.trim() || l.length > BD.BLOOD_MAX_CHARS || !BD.BLOOD_CHARSET.test(l));
  });
  ok(!lineBad.length, `1-${BD.BLOOD_MAX_LINES} lines of <= ${BD.BLOOD_MAX_CHARS} characters from the drawn charset${lineBad.length ? ': ' + lineBad.map((e) => e.id).join(', ') : ''}`);
  const longest = Math.max(...T.flatMap((e) => e.text.split('\n').map((l) => l.length)));
  ok(longest <= BD.BLOOD_MAX_CHARS, `longest line ${longest} characters`);
  const inSec = T.filter((e) => {
    const i = L.sectionIndexAt(e.y);
    return !(L.sections[i] && L.sections[i].id === e.section);
  });
  ok(!inSec.length, `each writing lies in the section it names${inSec.length ? ': ' + inSec.map((e) => e.id).join(', ') : ''}`);
  ok(T.every((e) => e.w >= 1.4 && e.w <= 2.4 && isFinite(e.yaw)), 'sizes 1.4-2.4 m wide, a facing for each');
  // where the player passes: within 6 m of a checkpoint, a supply spot, a route / recovery anchor, a ledge a route stops on
  // (its top face) or the grate before the goal
  const stops = new Set(L.data.routes.flatMap((r) => r.stops));
  const boxes = L.solids.filter((s) => stops.has(s.id)).map((s) => Object.assign({}, s, { minY: s.maxY }));
  if (L.data.gate) boxes.push(L.data.gate);
  const boxDist = (b, e) => Math.hypot(Math.max(b.minX - e.x, 0, e.x - b.maxX), Math.max(b.minY - e.y, 0, e.y - b.maxY), Math.max(b.minZ - e.z, 0, e.z - b.maxZ));
  const far = T.filter((e) => {
    const sec = L.sections.find((s) => s.id === e.section);
    const pts = [sec.checkpoint, ...L.data.supplies, ...L.anchors.filter((a) => a.tag !== 'objective')];
    return !pts.some((p) => p && Math.hypot(p.x - e.x, p.y - e.y, p.z - e.z) < 6) && !boxes.some((b) => boxDist(b, e) < 6);
  });
  ok(!far.length, `every writing is within 6 m of a checkpoint, supply spot, anchor, route ledge or the grate${far.length ? ': ' + far.map((e) => e.id).join(', ') : ''}`);
}

// ---- the placement -------------------------------------------------------------------------------------------------------
{
  const solids = L.solids.filter((s) => s.kind !== 'crumble');
  const inside = (p) => solids.find((s) => p[0] > s.minX && p[0] < s.maxX && p[1] > s.minY && p[1] < s.maxY && p[2] > s.minZ && p[2] < s.maxZ);
  const bad = [];
  const crossing = [];
  const plaques = L.decor.filter((d) => ['plaque', 'tablet', 'sign', 'inscription'].includes(d.type));
  for (const e of T) {
    const q = BW.bloodQuad(e);
    const off = e.floor ? BW.BLOOD_OFF.floor : BW.BLOOD_OFF.wall;
    let good = true;
    const box = { minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity };
    for (const [sr, su] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
      [0, 0],
    ]) {
      const p = [0, 1, 2].map((k) => q.c[k] + q.r[k] * q.hw * sr * 0.98 + q.u[k] * q.hh * su * 0.98 - q.n[k] * off);
      const inP = p.map((v, k) => v - q.n[k] * 0.05);
      const outP = p.map((v, k) => v + q.n[k] * 0.05);
      if (!inside(inP) || inside(outP)) good = false;
      box.minX = Math.min(box.minX, p[0]);
      box.minY = Math.min(box.minY, p[1]);
      box.minZ = Math.min(box.minZ, p[2]);
      box.maxX = Math.max(box.maxX, p[0]);
      box.maxY = Math.max(box.maxY, p[1]);
      box.maxZ = Math.max(box.maxZ, p[2]);
    }
    if (!good) bad.push(e.id);
    const hit = (b, pad = 0.05) => box.maxX > b.minX - pad && box.minX < b.maxX + pad && box.maxY > b.minY - pad && box.minY < b.maxY + pad && box.maxZ > b.minZ - pad && box.minZ < b.maxZ + pad;
    if (L.climb.some((z) => hit(z))) crossing.push(`${e.id} (climb zone)`);
    for (const d of plaques) if (hit({ minX: d.x - d.sx / 2, maxX: d.x + d.sx / 2, minY: d.y - d.sy / 2, maxY: d.y + d.sy / 2, minZ: d.z - d.sz / 2, maxZ: d.z + d.sz / 2 })) crossing.push(`${e.id} (plaque)`);
  }
  ok(!bad.length, `every corner sits on a static solid's face (stone behind, air in front)${bad.length ? ': ' + bad.join(', ') : ''}`);
  ok(!crossing.length, `no writing crosses a climb zone or a plaque${crossing.length ? ': ' + crossing.join(', ') : ''}`);
}

// ---- not level decor -----------------------------------------------------------------------------------------------------
{
  const types = new Set(LEVEL_DATA_3D.decor.map((d) => d.type));
  ok(!types.has('blood') && !types.has('blood-writing'), 'no blood decor type (bake, lightmap / GI hash, dressing, colliders and verify counts never see it)');
  ok(L.decor.length === 178, `the decor count is unchanged (${L.decor.length} = the verify baseline's 178)`);
  ok(!L.anchors.some((a) => /^bw-/.test(String(a.id))) && !L.climb.some((z) => /^bw-/.test(String(z.id))), 'no anchor or climb zone from it');
}

// ---- the setting ---------------------------------------------------------------------------------------------------------
{
  const D = C.SETTINGS_DEFAULTS;
  ok(D.bloodWriting === false, 'Blood writing is OFF by default');
  ok(C.sanitizeUxSettings({ bloodWriting: 'yes' }).bloodWriting === false && C.sanitizeUxSettings({ bloodWriting: 1 }).bloodWriting === false && C.sanitizeUxSettings({ bloodWriting: true }).bloodWriting === true, 'strict boolean: only true turns it on');
  mem.clear();
  ok(C.Storage.loadSettings().bloodWriting === false, 'empty storage loads it off');
  const s = C.Storage.loadSettings();
  s.bloodWriting = true;
  C.Storage.saveSettings(s);
  ok(C.Storage.loadSettings().bloodWriting === true, 'ON survives a save / load round trip');
  s.bloodWriting = false;
  C.Storage.saveSettings(s);
  ok(C.Storage.loadSettings().bloodWriting === false, 'and OFF again');
  const store = new SAVE.SaveStore({ primary: new SAVE.MemoryAdapter(), secondary: null, legacyGetItem: null, debounceMs: 5 });
  await store.load();
  store.recordSettings(Object.assign({}, D, { bloodWriting: true }));
  await store.flush();
  const again = new SAVE.SaveStore({ primary: store.primary, secondary: null, legacyGetItem: null, debounceMs: 5 });
  await again.load();
  ok(again.profile.settings && again.profile.settings.bloodWriting === true, 'it rides in the save profile (restored after a storage wipe)');
}

// ---- the scrawl ----------------------------------------------------------------------------------------------------------
{
  const atlas = BW.bloodAtlasSize(T.length);
  const mb = (atlas.w * atlas.h * 4 * 4) / 3 / (1 << 20); // RGBA8 with its mip chain
  ok(atlas.w === BW.BLOOD_COLS * BW.BLOOD_CELL_W && atlas.h === atlas.rows * BW.BLOOD_CELL_H && mb <= 24, `one atlas ${atlas.w} x ${atlas.h}, ${mb.toFixed(1)} MB with mips (<= 24 MB; only while the setting is on)`);
  ok(Math.abs(BW.BLOOD_CELL_W / BW.BLOOD_CELL_H - BD.BLOOD_ASPECT) < 0.01, 'the cell has the writings\' shape (no stretching)');
  let minFs = Infinity;
  let drips = 0;
  let stray = 0;
  let glyphs = 0;
  for (const e of T) {
    const cv = stubCanvas(BW.BLOOD_CELL_W, BW.BLOOD_CELL_H);
    const ctx = cv.getContext('2d');
    const r = BW.drawBloodText(ctx, e.text, 0, 0, BW.BLOOD_CELL_W, BW.BLOOD_CELL_H, 7, 0.5);
    minFs = Math.min(minFs, r.fs);
    drips += r.drips;
    glyphs += r.glyphs;
    const want = e.text.replace(/[\s\n]/g, '').length;
    if (r.glyphs !== want) stray++;
    for (const s of ctx.calls.fillText) if (s.length !== 1 || !BD.BLOOD_CHARSET.test(s) || s === ' ') stray++;
  }
  ok(minFs >= 40, `every message fits its cell at >= 40 px (smallest ${minFs.toFixed(1)} px of a ${BW.BLOOD_CELL_H} px cell)`);
  ok(!stray, `one glyph drawn per character, only from the charset (${glyphs} glyphs)`);
  ok(drips >= T.length, `drips run from the letters (${drips} in all)`);
}

// ---- the mesh ------------------------------------------------------------------------------------------------------------
{
  const parent = new THREE.Group();
  const w = new BW.BloodWriting(parent, { makeCanvas: stubCanvas });
  ok(!parent.children.length && !w.mesh, 'nothing exists before a build');
  ok(w.build(T) && parent.children.length === 1 && w.mesh.name === 'bloodWriting', 'one mesh for the whole level');
  const g = w.mesh.geometry;
  const uv = g.attributes.uv.array;
  ok(g.attributes.position.count === T.length * 6 && !g.index, `2 triangles per writing (${g.attributes.position.count / 3} triangles)`);
  ok([...uv].every((v) => v >= 0 && v <= 1), 'uvs inside the atlas');
  const m = w.mesh.material;
  ok(m.transparent && !m.depthWrite && m.polygonOffset && m.polygonOffsetFactor < 0 && m.map && m.vertexColors, 'alpha-blended, no depth write, polygon offset toward the viewer, the atlas map (the decal recipe)');
  w.update({ x: 999, y: 999, z: 999 }, 1);
  const far = w.mesh.visible;
  const e0 = T[0];
  w.update({ x: e0.x + 1, y: e0.y, z: e0.z }, 1);
  ok(!far && w.mesh.visible, 'hidden unless a writing is near the head (no draw call elsewhere)');
  const freed = { geo: 0, mat: 0, tex: 0 };
  g.addEventListener('dispose', () => freed.geo++);
  m.addEventListener('dispose', () => freed.mat++);
  m.map.addEventListener('dispose', () => freed.tex++);
  w.dispose();
  ok(!parent.children.length && !w.mesh && freed.geo === 1 && freed.mat === 1 && freed.tex === 1, 'dispose removes it and frees geometry, material and atlas');
  const none = new BW.BloodWriting(parent);
  ok(!none.build(T) && !parent.children.length, 'no canvas (Node without a DOM): no mesh, no error');
}

// ---- LevelView: the setting decides --------------------------------------------------------------------------------------
{
  const scene = new THREE.Scene();
  const mats = { get: () => new THREE.MeshBasicMaterial() };
  const lv = new LevelView(scene, mats);
  lv._blood.makeCanvas = stubCanvas;
  lv.level = L; // the writings only need the level's data (the full build needs the browser)
  const blood = () => {
    let c = 0;
    lv.root.traverse((o) => {
      if (o.name === 'bloodWriting') c++;
    });
    return c;
  };
  ok(lv.setBlood(false) === false && blood() === 0, 'setting OFF: no blood mesh exists');
  ok(lv.setBlood(true) === true && blood() === 1, 'setting ON: exactly one blood mesh (Renderer3D precompiles on true)');
  ok(lv.setBlood(true) === false && blood() === 1, 'unchanged setting: nothing rebuilt');
  ok(lv.setBlood(false) === false && blood() === 0, 'OFF again: removed');
  lv.setBlood(true);
  lv.clear();
  ok(blood() === 0 && !lv._blood.mesh, 'clear() (a level rebuild) leaves none behind');
}

console.log(fails ? `\n${fails} of ${n} FAILED` : `\nALL ${n} PASS`);
process.exitCode = fails ? 1 : 0;
