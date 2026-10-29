// Node tests for THE BOARDS beyond the plaques (data/board-writing-3d.js, render/boardWriting.js, render/textAtlasGroups.js;
// story bible docs/abyssal-tether-3d/plans/DARK_STORY_BIBLE.md). No GPU, no browser: a recording 2D context stands in.
//   - the data: 4-8 boards per section (the chamber's included in S8), 40+ in all, unique ids, ALL CAPS from the charset, at
//     most BOARD_MAX_CHARS seen, each in the section it names, close to where the player passes;
//   - the placement: every corner (and the centre and edge midpoints) of every board lies on a static level solid's face
//     (a wall's inner face, a floor's top, a ceiling's underside: just inside is stone, just outside is air), never on a
//     crumbling ledge, never across a climb zone, a plaque, a lamp, a statue, the Still Lamp, the grate, an anchor, a blood
//     writing or another board;
//   - not level decor: no 'board' decor, the decor count unchanged (no bake / lightmap / GI hash / dressing / collider input);
//   - the canon: every plaque line the docs and tests rely on is still carved, word for word;
//   - the renderer: the markup (~struck~ #gouged# {n}), every board fits its cell at a legible size; one mesh per group, 2
//     triangles per board, uvs inside its atlas, each group's atlas <= 10 MB with mips (<= 20 MB resident); nothing is built before the head comes
//     near (the spawn's group at once when asked), a cell per frame, dropped when far, dispose frees everything.
//   node test-board-writing.mjs [--root DIR]
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
const THREE = await import('three');
const { Level3D } = await import(srcUrl('sim/level3d.js'));
const { LEVEL_DATA_3D } = await import(srcUrl('data/level-data-3d.js'));
const BD = await import(srcUrl('data/board-writing-3d.js'));
const BW = await import(srcUrl('render/boardWriting.js'));
const BLD = await import(srcUrl('render/bloodWriting.js'));

let fails = 0;
let n = 0;
const ok = (c, msg) => {
  n++;
  if (!c) {
    fails++;
    console.log('FAIL ' + msg);
  } else console.log('  ok ' + msg);
};

/** A recording stand-in for a canvas 2D context. */
function stubCanvas(w, h) {
  const calls = { fillText: [], strokeText: [], fill: 0, stroke: 0 };
  let px = 10;
  const noop = () => {};
  const ctx = {
    canvas: null,
    calls,
    globalAlpha: 1,
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    shadowColor: '',
    shadowBlur: 0,
    get font() {
      return `${px}px x`;
    },
    set font(f) {
      const m = /(\d+(?:\.\d+)?)px/.exec(String(f));
      if (m) px = +m[1];
    },
    measureText: (s) => ({ width: [...String(s)].length * px * 0.62 }),
    fillText: (s) => void calls.fillText.push(String(s)),
    strokeText: (s) => void calls.strokeText.push(String(s)),
    clearRect: noop,
    fillRect: noop,
    strokeRect: noop,
    save: noop,
    restore: noop,
    translate: noop,
    rotate: noop,
    scale: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    quadraticCurveTo: noop,
    ellipse: noop,
    rect: noop,
    arc: noop,
    setLineDash: noop,
    fill: () => void calls.fill++,
    stroke: () => void calls.stroke++,
  };
  const canvas = { width: w, height: h, getContext: (k) => (k === '2d' ? ctx : null) };
  ctx.canvas = canvas;
  return canvas;
}

const L = new Level3D(undefined, 'normal');
const T = BD.BOARD_TEXTS;

// ---- the data ------------------------------------------------------------------------------------------------------------
{
  ok(L.data.boards === T && LEVEL_DATA_3D.boards === T, 'the level data carries the list (level.data.boards), nothing else does');
  const per = {};
  for (const e of T) per[e.section] = (per[e.section] || 0) + 1;
  const counts = L.sections.map((s) => per[s.id] || 0);
  ok(counts.every((c) => c >= 4 && c <= 12) && T.length >= 40, `4-12 boards per section, 40+ in all: ${counts.join('/')} = ${T.length}`);
  ok(new Set(T.map((e) => e.id)).size === T.length, 'unique ids');
  const bad = T.filter((e) => !BD.BOARD_CHARSET.test(e.text) || BW.boardPlain(e.text).length > BD.BOARD_MAX_CHARS || e.text !== e.text.toUpperCase());
  ok(!bad.length, `ALL CAPS from the charset, <= ${BD.BOARD_MAX_CHARS} characters seen${bad.length ? ': ' + bad.map((e) => e.id).join(', ') : ''}`);
  const words = T.map((e) => BW.boardPlain(e.text).split(/\s+/).filter(Boolean).length);
  ok(Math.max(...words) <= 18, `3-8 s of reading: at most 18 words a board (longest ${Math.max(...words)})`);
  const inSec = T.filter((e) => {
    const i = L.sectionIndexAt(e.y);
    return !(L.sections[i] && L.sections[i].id === e.section);
  });
  ok(!inSec.length, `each board lies in the section it names${inSec.length ? ': ' + inSec.map((e) => e.id).join(', ') : ''}`);
  ok(T.every((e) => ['wall', 'floor', 'ceil'].includes(e.face) && e.w >= 1 && e.w <= 4.2 && isFinite(e.yaw)), 'a face, a facing and a width 1-4.2 m for each');
  // where the player passes: within 8 m of a checkpoint, a supply spot, a route / recovery anchor (12 m: the nave's rings),
  // a route ledge, a rest, the grate or the chamber
  const stops = new Set(L.data.routes.flatMap((r) => r.stops));
  const boxes = L.solids.filter((s) => stops.has(s.id)).map((s) => Object.assign({}, s, { minY: s.maxY }));
  boxes.push(L.data.gate, L.data.goal, ...L.data.nooks.map((k) => k.box));
  const boxDist = (b, e) => Math.hypot(Math.max(b.minX - e.x, 0, e.x - b.maxX), Math.max(b.minY - e.y, 0, e.y - b.maxY), Math.max(b.minZ - e.z, 0, e.z - b.maxZ));
  const far = T.filter((e) => {
    const sec = L.sections.find((s) => s.id === e.section);
    const pts = [sec.checkpoint, ...L.data.supplies];
    const anchors = L.anchors.filter((a) => a.tag !== 'objective');
    return !pts.some((p) => p && Math.hypot(p.x - e.x, p.y - e.y, p.z - e.z) < 8) && !anchors.some((a) => Math.hypot(a.x - e.x, a.y - e.y, a.z - e.z) < 12) && !boxes.some((b) => boxDist(b, e) < 8);
  });
  ok(!far.length, `every board is near where the player passes${far.length ? ': ' + far.map((e) => e.id).join(', ') : ''}`);
}

// ---- the placement -------------------------------------------------------------------------------------------------------
{
  const solids = L.solids.filter((s) => s.kind !== 'crumble');
  const inside = (p) => solids.find((s) => p[0] > s.minX && p[0] < s.maxX && p[1] > s.minY && p[1] < s.maxY && p[2] > s.minZ && p[2] < s.maxZ);
  const off = { wall: BW.BOARD_OFF.wall, floor: BW.BOARD_OFF.floor, ceil: BW.BOARD_OFF.ceil };
  const AV = ['plaque', 'tablet', 'sign', 'inscription', 'lamp', 'statue', 'still-lamp', 'grate', 'glyphs'];
  const avoid = L.decor.filter((d) => AV.includes(d.type)).map((d) => ({ t: d.type, minX: d.x - d.sx / 2, maxX: d.x + d.sx / 2, minY: d.y - d.sy / 2, maxY: d.y + d.sy / 2, minZ: d.z - d.sz / 2, maxZ: d.z + d.sz / 2 }));
  const rect = (q, o) => {
    const box = { minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity };
    let good = true;
    for (const [sr, su] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0], [0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const p = [0, 1, 2].map((k) => q.c[k] + q.r[k] * q.hw * sr * 0.98 + q.u[k] * q.hh * su * 0.98 - q.n[k] * o);
      if (o != null && (!inside(p.map((v, k) => v - q.n[k] * 0.05)) || inside(p.map((v, k) => v + q.n[k] * 0.05)))) good = false;
      box.minX = Math.min(box.minX, p[0]);
      box.minY = Math.min(box.minY, p[1]);
      box.minZ = Math.min(box.minZ, p[2]);
      box.maxX = Math.max(box.maxX, p[0]);
      box.maxY = Math.max(box.maxY, p[1]);
      box.maxZ = Math.max(box.maxZ, p[2]);
    }
    return { box, good };
  };
  const hit = (a, b, pad) => a.maxX > b.minX - pad && a.minX < b.maxX + pad && a.maxY > b.minY - pad && a.minY < b.maxY + pad && a.maxZ > b.minZ - pad && a.minZ < b.maxZ + pad;
  const bloodBoxes = (L.data.blood || []).map((e) => ({ id: e.id, box: rect(BLD.bloodQuad(e), null).box }));
  const mine = T.map((e) => ({ e, ...rect(BW.boardQuad(e), off[e.face]) }));
  const notOn = mine.filter((m) => !m.good).map((m) => m.e.id);
  ok(!notOn.length, `every corner sits on a static solid's face (stone behind, air in front)${notOn.length ? ': ' + notOn.join(', ') : ''}`);
  const crossing = [];
  for (const m of mine) {
    if (L.climb.some((z) => hit(m.box, z, 0.05))) crossing.push(`${m.e.id} (climb zone)`);
    const d = avoid.find((z) => hit(m.box, z, 0.1));
    if (d) crossing.push(`${m.e.id} (${d.t})`);
    const b = bloodBoxes.find((z) => hit(m.box, z.box, 0.15));
    if (b) crossing.push(`${m.e.id} (${b.id})`);
    const a = L.anchors.find((a) => !a.hidden && hit(m.box, { minX: a.x, maxX: a.x, minY: a.y, maxY: a.y, minZ: a.z, maxZ: a.z }, 0.5));
    if (a) crossing.push(`${m.e.id} (anchor ${a.id})`);
    const o = mine.find((k) => k !== m && hit(m.box, k.box, 0.1));
    if (o) crossing.push(`${m.e.id} (${o.e.id})`);
  }
  ok(!crossing.length, `no board crosses a climb zone, a plaque, a lamp, a statue, an anchor, a blood writing or another board${crossing.length ? ': ' + crossing.join(', ') : ''}`);
}

// ---- not level decor; the canon kept -------------------------------------------------------------------------------------
{
  const types = new Set(LEVEL_DATA_3D.decor.map((d) => d.type));
  ok(!types.has('board') && !types.has('board-writing'), 'no board decor type (bake, lightmap / GI hash, dressing, colliders and verify counts never see it)');
  ok(L.decor.length === 178, `the decor count is unchanged (${L.decor.length} = the verify baseline's 178)`);
  ok(!L.anchors.some((a) => /^bd-/.test(String(a.id))) && !L.climb.some((z) => /^bd-/.test(String(z.id))), 'no anchor or climb zone from it');
  const plaques = L.decor.filter((d) => d.type === 'plaque' || d.type === 'tablet').map((d) => d.text).join(' | ');
  const canon = ['TRUST THE RING, NOT THE FLOOR', 'THE FLOOR KEEPS', 'THE LAMP DOES NOT RISE TO MEET US. WE GO DOWN TO IT.', 'NINTH GALLERY', 'THE STONE HAS BEEN LISTENING', 'DO NOT ANSWER WHAT KNOCKS FROM INSIDE THE WALL', 'THE MASONS WENT DOWN TO MEND THE DEEP COURSE. THE WALL MENDED ITSELF.', 'LET IT KNOCK. DO NOT KNOCK BACK.', 'THE LONG STAIR', 'THE THROAT', 'THE NAVE OPENS FOR THOSE WHO HANG', 'IT WEARS OUR WORK', 'BELOW THIS MARK NO LAMPS. ONLY THE STILL ONE', "THE MASONS' REST"];
  const lost = canon.filter((c) => !plaques.includes(c));
  ok(!lost.length, `every canon plaque line is still carved word for word${lost.length ? ': lost ' + lost.join(' / ') : ''}`);
}

// ---- the markup and the fit ----------------------------------------------------------------------------------------------
{
  const p = BW.parseBoard('~WE FED IT.~ NO. #DID TO THEM# {7}\nXLI:');
  const k = p[0].map((t) => t.k).join('');
  ok(p.length === 2 && k === 'sssngggt' && p[0][7].n === 7 && BW.boardPlain('~WE FED IT.~ NO. #DID# {7}') === 'WE FED IT. NO.', `markup: struck, gouged, tally, lines (${k}); a gouge is never read`);
  let minFs = Infinity;
  let worst = '';
  let stray = 0;
  for (const e of T) {
    if (e.style === 'outline') continue;
    const [w, h] = BW.boardCellSize(e);
    const cv = stubCanvas(w, h);
    const ctx = cv.getContext('2d');
    const r = BW.drawBoardCell(ctx, e, 0, 0, w, h);
    const rel = r.fs / h;
    if (r.fs < minFs) {
      minFs = r.fs;
      worst = e.id;
    }
    if (!(rel > 0)) stray++;
  }
  for (const style of ['plate', 'cut', 'scratch', 'fresh']) {
    const cv = stubCanvas(1024, 256);
    const ctx = cv.getContext('2d');
    BW.drawBoardCell(ctx, { id: 'x', style, text: 'WE #SECRET WORD# IT ~WITH~ LOVE {5}' }, 0, 0, 1024, 256);
    const drawn = [...ctx.calls.fillText, ...ctx.calls.strokeText];
    if (drawn.some((s) => /SECRET|WORD/.test(s)) || !drawn.includes('LOVE') || !drawn.includes('WITH')) stray++;
  }
  ok(minFs >= 30, `every board fits its cell at >= 30 px of a 256 px cell (smallest ${minFs.toFixed(1)} px: ${worst})`);
  ok(!stray, 'a gouged word is never drawn (every style); a struck one is');
  const fig = T.find((e) => e.style === 'outline');
  if (fig) {
    const [w, h] = BW.boardCellSize(fig);
    const cv = stubCanvas(w, h);
    BW.drawBoardCell(cv.getContext('2d'), fig, 0, 0, w, h);
    const names = cv.getContext('2d').calls.fillText;
    ok(w === 384 && h === 768 && fig.marks.every((m) => names.includes(m[0]) && m[1] < 1), `the figure: a 384 x 768 cell, every name measured short of its head (${fig.marks.map((m) => m[0]).join(', ')})`);
  }
}

// ---- the meshes: lazy groups ---------------------------------------------------------------------------------------------
{
  const parent = new THREE.Group();
  const w = new BW.BoardWriting(parent, { makeCanvas: stubCanvas });
  ok(w.build(T) && !parent.children.length && !w.mesh, 'nothing is drawn before the head comes near');
  const groups = w.groups.length;
  const mbMax = Math.max(...w.groups.map((g) => (g.pack.w * g.pack.h * 4 * 4) / 3 / (1 << 20)));
  ok(groups >= 8 && mbMax <= 10, `${groups} groups (a section each, the chamber its own), the largest atlas ${mbMax.toFixed(1)} MB with mips (<= 10 MB)`);
  const sp = L.spawn;
  let frames = 0;
  while (!w.mesh && frames < 40) {
    w.update(sp, 1);
    frames++;
  }
  const g0 = w.groups.find((g) => g.mesh);
  ok(!!g0 && g0.key === 's1' && frames === g0.list.length, `near the spawn: S1's atlas is drawn a board per frame (${frames} frames) and becomes one mesh`);
  const g = g0.mesh.geometry;
  ok(g.attributes.position.count === g0.list.length * 6 && !g.index && [...g.attributes.uv.array].every((v) => v >= 0 && v <= 1), `2 triangles per board, uvs inside the atlas (${g.attributes.position.count / 3} triangles)`);
  const m = g0.mesh.material;
  ok(m.transparent && !m.depthWrite && m.polygonOffset && m.polygonOffsetFactor < 0 && m.map && m.side === THREE.DoubleSide && m.forceSinglePass && g0.mesh.renderOrder === 5, 'the plaques\' material: alpha-blended, no depth write, polygon offset toward the viewer, double-sided (ceilings) in ONE pass (one draw call), with the plaques');
  w.update(sp, 1);
  ok(g0.mesh.visible, 'shown while a board is within reach of the eye');
  const deep = { x: -3, y: -553, z: 16 };
  for (let i = 0; i < 20; i++) w.update(deep, 1);
  ok(!g0.mesh && !g0.canvas && w.groups.find((x) => x.key === 'chamber').mesh && w.meshes.length <= 2, `far away its group is freed; at the bottom the chamber's is built (${w.meshes.map((x) => x.userData.group).join(', ')})`);
  ok(w.residentPixels * 4 * 4 / 3 / (1 << 20) <= 20, `resident atlases at the bottom ${(w.residentPixels * 4 * 4 / 3 / (1 << 20)).toFixed(1)} MB with mips (<= 20 MB)`);
  const now = new BW.BoardWriting(parent, { makeCanvas: stubCanvas });
  now.build(T, sp);
  ok(now.mesh && now.mesh.userData.group === 's1', 'build(entries, spawn) draws the spawn\'s group at once (the caller precompiles)');
  const freed = { geo: 0, mat: 0, tex: 0 };
  const mm = now.mesh;
  mm.geometry.addEventListener('dispose', () => freed.geo++);
  mm.material.addEventListener('dispose', () => freed.mat++);
  mm.material.map.addEventListener('dispose', () => freed.tex++);
  now.dispose();
  w.dispose();
  ok(!parent.children.length && freed.geo === 1 && freed.mat === 1 && freed.tex === 1, 'dispose removes them and frees geometry, material and atlas');
  const none = new BW.BoardWriting(parent);
  ok(!none.build(T) && !parent.children.length, 'no canvas (Node without a DOM): no mesh, no error');
}

console.log(fails ? `\n${fails} of ${n} FAILED` : `\nALL ${n} PASS`);
process.exitCode = fails ? 1 : 0;
