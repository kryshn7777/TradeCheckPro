/* ABYSSAL TETHER 3D — data/chapter2-data.js
 * CHAPTER II · LAMPHOLD: the level description, generated from the beat table below.
 *
 * LAYOUT 2 (500 m, owner, 2026-11-04: "make the level just 500 meters"): the core arc of seven beats, 600 -> 1,100 m of depth, about 25-30 minutes. It replaced
 * LAYOUT 1 (13 beats, 1,250 m, the graybox of the plan docs/abyssal-tether-3d/plans/CHAPTER_II_PLAN.md, which the owner had asked for earlier as "make it 1250
 * instead of 580"). Kept: II-1 The Lowering (live anchors), II-2 The Street of Doors (the yank, the first two Names), II-3 The Chandeliers (the test, HEDDA),
 * II-4 The Waking Hall (the truth), II-9 The Tolling Gallery (the Usher's first sighting, BRASK), II-12 The Snuffing (the Doorman's exam) and II-13 The Soot
 * Throat (the hook). The section ids keep their old numbers (`c2-9` is still the Tolling Gallery) so the text, the director and the tests keep their keys; the HUD
 * numerals count the sections of the chapter (II·1 .. II·7). The cut beats' words are kept in data/chapter2-text.js (CHAPTER2_CUT).
 *
 * WHAT THIS FILE IS: a deterministic generator (no Math.random) of the same data shape as data/level-data-3d.js: per beat a section (theme, checkpoint, creature
 * mode, a hint), four walls round a 52 m shaft, and a SPIRAL STAIR of overlapping stone ledges that steps down 6 m at a time (a drop of 6 m is about 0.6 of the
 * lethal fall: it hurts, it does not kill, and every ledge is also a rope target with free attach). Beats 1, 3, 8 and 11 carry swinging rings (pendulum movers,
 * the new rule: LIVE ANCHORS) that are optional shortcuts across the stair's gaps. It is the SKELETON the beats grow on. It is playable end to end and measurable (tests/level/chapter2.mjs).
 *
 * Chapter-local coordinates: the spawn is near y = 0 and the chapter descends to y = -500; the depth readout adds CHAPTER2_DEPTH_OFFSET (600).
 * DOM-free, three.js-free: importable from Node.
 */

import { CHAPTER2_TEXT } from './chapter2-text.js';
import { addTollingGallery, addSnuffing, addSootThroat, addBeats, setNames } from './chapter2-sets.js';

export const CHAPTER2_DEPTH_OFFSET = 600; // m: Chapter I ends at ~600 m (the hook of the demo), Chapter II continues the readout
export const CHAPTER2_DEPTH = 500; // m (the owner's number: layout 2; layout 1 was 1,250)
export const CHAPTER2_LAYOUT = 2; // the layout of the chapter's data: a saved run / record of another layout is dropped (meta/save.js)

// id, name, subtitle (the card line), length (m), min (first-time minutes, for the doc), theme key, creature mode
// the lengths add up to 500 (tests/level/chapter2.mjs checks it)
export const CHAPTER2_BEATS = [
  { id: 'c2-1', name: 'The Lowering', sub: 'The first warm place. It is a lie.', len: 40, min: 2.5, theme: 'lit', creature: 'dormant' },
  { id: 'c2-2', name: 'The Street of Doors', sub: 'KNOCK, AND BE KNOWN.', len: 60, min: 3.5, theme: 'lit', creature: 'dormant' },
  { id: 'c2-3', name: 'The Chandeliers', sub: 'Five rings swing across the dark.', len: 80, min: 4, theme: 'lit', creature: 'dormant' },
  { id: 'c2-4', name: 'The Waking Hall', sub: 'Every lamp a bed.', len: 40, min: 2, theme: 'lit', creature: 'dormant' },
  { id: 'c2-9', name: 'The Tolling Gallery', sub: 'Ring it. Something answers.', len: 70, min: 3.5, theme: 'lit', creature: 'dormant' },
  { id: 'c2-12', name: 'The Snuffing', sub: 'One tier at a time.', len: 150, min: 8, theme: 'snuffed', creature: 'dormant' },
  { id: 'c2-13', name: 'The Soot Throat', sub: 'The true rest.', len: 60, min: 3, theme: 'snuffed', creature: 'dormant' },
];

const THEMES = {
  // the bible's palettes (CHAPTERS.md section 6): lit Lamphold, the Winding Floor, the snuffed town
  lit: { fog: '#2a1f16', light: '#f0b060', accent: '#ffcf80', fogNear: 7, fogFar: 95, ambient: 0.36, rim: 0.7 },
  engine: { fog: '#1b1712', light: '#d08a3c', accent: '#6fbf9a', fogNear: 6, fogFar: 80, ambient: 0.26, rim: 0.7 },
  snuffed: { fog: '#110c09', light: '#7a2e1e', accent: '#f07a30', fogNear: 4, fogFar: 45, ambient: 0.1, rim: 0.6 },
};

const SHAFT = 26; // half width of the pit (m)
const WALL_T = 3;
const STEP = 6; // m between ledge tops
const RADIUS = 16; // the stair's radius
const TURN = 0.5; // rad per ledge
const LEDGE = 10; // m: a ledge is a LEDGE x LEDGE slab, 1 m thick

const r2 = (v) => Math.round(v * 100) / 100;

/** Builds the chapter's data. Pure and deterministic. */
export function buildChapter2() {
  const solids = [];
  const hazards = [];
  const anchors = [];
  const decor = [];
  const lights = [];
  const movers = [];
  const sections = [];
  const seals = [];
  const fixtures = [];
  const objectives = [];
  const lanes = [];
  const nooks = [];
  const c2 = {}; // what the director reads (the set-pieces' stations, bells, plates)
  const ledges = []; // { id, k, x, y (top), z, section }

  // the stair is ONE sequence for the whole chapter (a ledge every STEP metres, the angle turning TURN per ledge), so the step is the same across
  // the beat seams; a beat owns the ledges whose tops lie in its range
  const total = CHAPTER2_BEATS.reduce((a, b) => a + b.len, 0);
  const tops = [];
  for (let kk = 0; -0.6 - kk * STEP - 1 >= -total; kk++) tops.push(r2(-0.6 - kk * STEP));
  let top = 0;
  CHAPTER2_BEATS.forEach((b) => {
    const yTop = -top;
    const yBottom = -(top + b.len);
    const sid = b.id;
    // four walls round the pit
    const wall = (name, x0, x1, z0, z1) => solids.push({ id: `${sid}-${name}`, minX: x0, maxX: x1, minY: yBottom, maxY: yTop, minZ: z0, maxZ: z1, kind: 'wall' });
    wall('w', -SHAFT - WALL_T, -SHAFT, -SHAFT - WALL_T, SHAFT + WALL_T);
    wall('e', SHAFT, SHAFT + WALL_T, -SHAFT - WALL_T, SHAFT + WALL_T);
    wall('n', -SHAFT, SHAFT, -SHAFT - WALL_T, -SHAFT);
    wall('s', -SHAFT, SHAFT, SHAFT, SHAFT + WALL_T);
    const first = ledges.length;
    let j = 0;
    for (let kk = 0; kk < tops.length; kk++) {
      const topY = tops[kk];
      if (topY > yTop || topY <= yBottom) continue;
      if (b.id === 'c2-12' && topY < yTop - 66) continue; // the stair ends at the Well rim: the arena (data/chapter2-sets.js) takes over
      if (b.id === 'c2-13' && topY < yBottom + 26) continue; // ... and the Soot Throat's stair ends at its lip: the chain takes you down into the Mere
      const a = kk * TURN;
      const cx = r2(RADIUS * Math.cos(a));
      const cz = r2(RADIUS * Math.sin(a));
      const id = `${sid}-l${j}`;
      solids.push({ id, minX: r2(cx - LEDGE / 2), maxX: r2(cx + LEDGE / 2), minY: r2(topY - 1), maxY: topY, minZ: r2(cz - LEDGE / 2), maxZ: r2(cz + LEDGE / 2), kind: 'stone' });
      ledges.push({ id, k: kk, x: cx, y: topY, z: cz, section: sid });
      // a lamp on every fourth ledge (the town is lit)
      if ((j % 4 === 0 && b.theme !== 'snuffed') || b.id === 'c2-12') lights.push({ x: cx, y: r2(topY + 1.6), z: cz, color: b.theme === 'engine' ? '#d08a3c' : '#ffcf80', intensity: 1.2, range: 14, flicker: 0.15 });
      j++;
    }
    // swinging rings (the new rule): pendulum chandeliers over the stair's gaps, in beats II-1 and II-3 (the direction's numbers: II-1 one 36 m
    // chain at 7.5 m/s; II-3 five at 5.5 .. 10.9 m/s). Peak speed = length x amp x 2 pi / period.
    const PENDULA = {
      'c2-1': [{ len: 36, amp: 0.3, period: 9 }, { len: 30, amp: 0.25, period: 10 }],
      'c2-3': [{ len: 20, amp: 0.35, period: 8 }, { len: 24, amp: 0.4, period: 9 }, { len: 30, amp: 0.45, period: 10 }, { len: 36, amp: 0.5, period: 11 }, { len: 30, amp: 0.55, period: 9.5 }],
    };
    (PENDULA[b.id] || []).forEach((pd, c) => {
      const L = ledges[first + Math.min(ledges.length - first - 1, 1 + c * 2)];
      const pivotY = r2(L.y + 3 + pd.len); // the ring hangs 3 m over the ledge's top at rest
      const mid = { x: r2(L.x * 0.55), z: r2(L.z * 0.55) };
      const id = `${sid}-ring${c}`;
      anchors.push({ id, x: mid.x, y: r2(pivotY - pd.len), z: mid.z, kind: 'ring', tag: 'route', normal: { x: 0, y: -1, z: 0 }, mount: 'mover' });
      movers.push({ id: `mov-${id}`, kind: 'pendulum', section: sid, x: mid.x, y: pivotY, z: mid.z, dir: { x: 1, z: 0 }, length: pd.len, amp: pd.amp, period: pd.period, phase: r2(c * 0.37), parts: 'cage', carry: { anchors: [id], decor: [] } });
    });
    const firstLedge = ledges[first];
    sections.push({
      id: sid,
      name: b.name,
      subtitle: b.sub,
      yTop,
      yBottom,
      shaft: { minX: -SHAFT, maxX: SHAFT, minZ: -SHAFT, maxZ: SHAFT },
      checkpoint: { x: firstLedge.x, y: r2(firstLedge.y + 0.4), z: firstLedge.z, yaw: 0 },
      theme: THEMES[b.theme],
      creature: { mode: b.creature, lethal: b.creature === 'stalk', speedMul: 1, burstRate: 0, spawnOffsetY: 200 },
      // the hints are the story writer's (data/chapter2-text.js): `at` is the fraction of the beat from its top
      hints: (CHAPTER2_TEXT.hints[sid] || []).map((h) => ({ y: r2(yTop - h.at * b.len), duration: h.duration, text: h.text, desktop: h.desktop })),
      lamp: CHAPTER2_TEXT.lamps[sid] || null, // { id: 'L2-n', label } of this beat's waking lamp
    });
    top += b.len;
  });

  // ---- the machinery (CHAPTER_II_DIRECTION section 2: the beats' live anchors). Lifts CARRY RINGS (you hang from them; a cage floor you can stand
  // on is not built: the stair is the always-open way), all closed forms of the run clock (sim/movers3d.js). Layout 2 keeps the II-2 lift; the cranes,
  // the express cages, the governor and the wheel of layout 1 went with their beats.
  const sec = (id) => sections.find((q) => q.id === id);
  const ledgeNear = (y) => ledges.reduce((a, l) => (Math.abs(l.y - y) < Math.abs(a.y - y) ? l : a), ledges[0]);
  const ring = (id, x, y, z, tag = 'route') => anchors.push({ id, x: r2(x), y: r2(y), z: r2(z), kind: 'ring', tag, normal: { x: 0, y: -1, z: 0 }, mount: 'mover' });
  // II-2 THE STREET OF DOORS: the counterweight lift down the pit wall beside the street (30 m, 14 s each way, 4 s waiting)
  {
    const b = sec('c2-2');
    const L = ledgeNear(b.yTop - 30);
    const a = Math.atan2(L.z, L.x);
    const x = r2(23.4 * Math.cos(a));
    const z = r2(23.4 * Math.sin(a));
    const y0 = r2(L.y + 0.2);
    ring('c2-2-lift-ring', x, y0 + 3.5, z);
    movers.push({ id: 'mov-c2-2-lift', kind: 'lift', section: b.id, x, y: y0, z, to: { x, y: y0 - 30, z }, travel: 14, dwell: 4, ramp: 0.5, parts: 'lift', carrier: 1.4, carry: { anchors: ['c2-2-lift-ring'], decor: [] } });
  }

  // ---- the set-pieces (data/chapter2-sets.js): II-9 the Tolling Gallery, II-12 the Snuffing (the Doorman), II-13 the Soot Throat (the hook), the Names and the doors
  const ctx = { solids, anchors, movers, decor, lights, fixtures, objectives, seals, ledges, sections, c2, sec, ledgeNear, lanes, nooks };
  addTollingGallery(ctx);
  addSnuffing(ctx);
  addSootThroat(ctx);
  setNames(CHAPTER2_TEXT.names.map((n) => ({ id: n.id, text: n.text, codex: n.codex, beat: n.beat })));
  addBeats(ctx);

  // the plaques (the story writer's words), carved on the pit wall beside the stair at the depth they belong to; the wall they sit on faces into the pit
  const WALLS = {
    n: { z: -SHAFT + 0.1, yaw: Math.PI, sx: 3.6, sz: 0.15, along: 'x' },
    s: { z: SHAFT - 0.1, yaw: 0, sx: 3.6, sz: 0.15, along: 'x' },
    w: { x: -SHAFT + 0.1, yaw: -Math.PI / 2, sx: 0.15, sz: 3.6, along: 'z' },
    e: { x: SHAFT - 0.1, yaw: Math.PI / 2, sx: 0.15, sz: 3.6, along: 'z' },
  };
  for (const pl of CHAPTER2_TEXT.plaques) {
    const sec = sections.find((q) => q.id === pl.beat);
    const wall = WALLS[pl.side];
    if (!sec || !wall) continue;
    const y = r2(sec.yTop - pl.at * (sec.yTop - sec.yBottom));
    // beside the ledge nearest this depth, so the player passes it
    let near = ledges[0];
    for (const l of ledges) if (Math.abs(l.y - y) < Math.abs(near.y - y)) near = l;
    const a = Math.max(-17, Math.min(17, near[wall.along]));
    const lines = pl.text.split('\n').length;
    decor.push({
      type: 'plaque',
      x: wall.x != null ? wall.x : r2(a),
      y: r2(y + 2.2),
      z: wall.z != null ? wall.z : r2(a),
      sx: wall.sx,
      sy: r2(0.5 + 0.35 * lines),
      sz: wall.sz,
      yaw: wall.yaw,
      text: pl.text.replace(/\n/g, ' '),
      id: pl.id,
      beat: pl.beat,
    });
  }

  // the end: the black water of the Mere under the chain platform (data/chapter2-sets.js addSootThroat); the goal is the splash
  const water = c2.hook.water.y;
  const bottom = water;
  const first = ledges[0];
  return {
    name: 'Lamphold',
    chapter: 2,
    depthOffset: CHAPTER2_DEPTH_OFFSET,
    spawn: { x: first.x, y: r2(first.y + 0.4), z: first.z, yaw: 0 },
    goal: { minX: -60, maxX: 60, minY: water - 2, maxY: water + 1.2, minZ: -60, maxZ: 60 },
    gate: { minX: -3, maxX: 3, minY: bottom, maxY: bottom + 8, minZ: 10, maxZ: 10.5 },
    stillLamp: { x: 0, y: bottom + 2, z: 0 },
    sections,
    solids,
    hazards,
    anchors,
    decor,
    lights,
    movers,
    seals,
    fixtures,
    objectives,
    lanes,
    nooks,
    c2,
    ledges: ledges.map((l) => ({ id: l.id, x: l.x, y: l.y, z: l.z, section: l.section })), // for the tests and the bots (not read by Level3D)
  };
}

export const LEVEL_DATA_CH2 = buildChapter2();
