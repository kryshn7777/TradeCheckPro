/* ABYSSAL TETHER 3D — data/chapter2-data.js
 * CHAPTER II · LAMPHOLD: the level description, a GRAYBOX (no art, no machinery beyond a few swinging rings), generated from the beat table below.
 *
 * Owner, 2026-11-04: "the level 2 must be long and end with a hook for the full version", "make it 1250 instead of 580". The design (13 beats, 1,250 m,
 * 600 -> 1,850 m of depth, about 60-70 minutes, the Usher hook at the end) is docs/abyssal-tether-3d/plans/CHAPTER_II_PLAN.md; the bible's version of the
 * chapter is docs/abyssal-tether-3d/CHAPTERS.md section 6.
 *
 * WHAT THIS FILE IS: a deterministic generator (no Math.random) of the same data shape as data/level-data-3d.js: per beat a section (theme, checkpoint, creature
 * mode, a hint), four walls round a 52 m shaft, and a SPIRAL STAIR of overlapping stone ledges that steps down 6 m at a time (a drop of 6 m is about 0.6 of the
 * lethal fall: it hurts, it does not kill, and every ledge is also a rope target with free attach). Beats 1, 3, 8 and 11 carry swinging rings (pendulum movers,
 * the new rule: LIVE ANCHORS) that are optional shortcuts across the stair's gaps. It is the SKELETON the beats grow on: no lifts, cranes, express drops,
 * the Stopping or the Snuffing yet (see the plan's work packages C2-1 .. C2-5). It is playable end to end and measurable (tests/level/chapter2.mjs).
 *
 * Chapter-local coordinates: the spawn is near y = 0 and the chapter descends to y = -1250; the depth readout adds CHAPTER2_DEPTH_OFFSET (600).
 * DOM-free, three.js-free: importable from Node.
 */

export const CHAPTER2_DEPTH_OFFSET = 600; // m: Chapter I ends at ~600 m (the hook of the demo), Chapter II continues the readout
export const CHAPTER2_DEPTH = 1250; // m (the owner's number; the bible had 580)

// id, name, subtitle (the card line), length (m), min (first-time minutes, for the doc), theme key, creature mode
// the lengths add up to 1,250 (tests/level/chapter2.mjs checks it)
export const CHAPTER2_BEATS = [
  { id: 'c2-1', name: 'The Lowering', sub: 'The first warm place. It is a lie.', len: 40, min: 2.5, theme: 'lit', creature: 'dormant' },
  { id: 'c2-2', name: 'The Street of Doors', sub: 'KNOCK, AND BE KNOWN.', len: 80, min: 4.5, theme: 'lit', creature: 'dormant' },
  { id: 'c2-3', name: 'The Chandeliers', sub: 'Five rings swing across the dark.', len: 110, min: 5, theme: 'lit', creature: 'dormant' },
  { id: 'c2-4', name: 'The Waking Hall', sub: 'Every lamp a bed.', len: 60, min: 3, theme: 'lit', creature: 'dormant' },
  { id: 'c2-5', name: 'The Stone Yards', sub: 'The cranes still run.', len: 120, min: 5, theme: 'lit', creature: 'sighting' },
  { id: 'c2-6', name: 'The Dressing Yards', sub: 'Stay in the light.', len: 120, min: 6, theme: 'lit', creature: 'sighting' },
  { id: 'c2-7', name: 'The Counterweight Shafts', sub: 'Eighty metres in nine seconds.', len: 130, min: 5.5, theme: 'lit', creature: 'dormant' },
  { id: 'c2-8', name: 'The Hung Quarter', sub: 'The houses swing.', len: 100, min: 4.5, theme: 'lit', creature: 'sighting' },
  { id: 'c2-9', name: 'The Tolling Gallery', sub: 'Ring it. Something answers.', len: 100, min: 4, theme: 'lit', creature: 'dormant' },
  { id: 'c2-10', name: 'The Winding Floor', sub: 'The din is the room.', len: 100, min: 5.5, theme: 'engine', creature: 'stalk' },
  { id: 'c2-11', name: 'The Cinder Stairs', sub: 'The first lamps are failing.', len: 80, min: 3.5, theme: 'engine', creature: 'sighting' },
  { id: 'c2-12', name: 'The Snuffing', sub: 'One tier at a time.', len: 150, min: 8, theme: 'snuffed', creature: 'stalk' },
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
  const ledges = []; // { id, k, x, y (top), z, section }

  // the stair is ONE sequence for the whole chapter (a ledge every STEP metres, the angle turning TURN per ledge), so the step is the same across
  // the beat seams; a beat owns the ledges whose tops lie in its range
  const total = CHAPTER2_BEATS.reduce((a, b) => a + b.len, 0);
  const tops = [];
  for (let kk = 0; -0.6 - kk * STEP - 1 >= -total; kk++) tops.push(r2(-0.6 - kk * STEP));
  let top = 0;
  CHAPTER2_BEATS.forEach((b, i) => {
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
      const a = kk * TURN;
      const cx = r2(RADIUS * Math.cos(a));
      const cz = r2(RADIUS * Math.sin(a));
      const id = `${sid}-l${j}`;
      solids.push({ id, minX: r2(cx - LEDGE / 2), maxX: r2(cx + LEDGE / 2), minY: r2(topY - 1), maxY: topY, minZ: r2(cz - LEDGE / 2), maxZ: r2(cz + LEDGE / 2), kind: 'stone' });
      ledges.push({ id, k: kk, x: cx, y: topY, z: cz, section: sid });
      // a lamp on every fourth ledge (the town is lit)
      if (j % 4 === 0 && b.theme !== 'snuffed') lights.push({ x: cx, y: r2(topY + 1.6), z: cz, color: b.theme === 'engine' ? '#d08a3c' : '#ffcf80', intensity: 1.2, range: 14, flicker: 0.15 });
      j++;
    }
    // swinging rings (the new rule): a pendulum chandelier over the gap between two ledges, in beats 1, 3, 8 and 11
    if ([0, 2, 7, 10].includes(i)) {
      const count = i === 2 ? 5 : 2;
      for (let c = 0; c < count; c++) {
        const L = ledges[first + Math.min(ledges.length - first - 1, 1 + c * 2)];
        const pivotY = r2(L.y + 22);
        const len = 20 + (c % 3) * 6;
        const mid = { x: r2(L.x * 0.55), z: r2(L.z * 0.55) };
        const id = `${sid}-ring${c}`;
        anchors.push({ id, x: mid.x, y: r2(pivotY - len), z: mid.z, kind: 'ring', tag: 'route', normal: { x: 0, y: -1, z: 0 }, mount: 'mover' });
        movers.push({ id: `mov-${id}`, kind: 'pendulum', section: sid, x: mid.x, y: pivotY, z: mid.z, dir: { x: 1, z: 0 }, length: len, amp: 0.2, period: 9 + c, phase: c * 0.37, carry: { anchors: [id], decor: [] } });
      }
    }
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
      hints: i === 0 ? [{ y: -2, duration: 8, text: 'Lamphold. Every lamp a bed. Some rings swing: fire as one comes toward you.', desktop: 'Lamphold. Every lamp a bed. Some rings swing: aim at one as it comes toward you.' }] : [],
    });
    top += b.len;
  });

  const last = ledges[ledges.length - 1];
  const bottom = -top;
  // the end: a wide floor under the last ledge (the black water of the hook is the next chapter), the goal on it
  solids.push({ id: 'c2-end-floor', minX: -SHAFT, maxX: SHAFT, minY: bottom - 2, maxY: bottom, minZ: -SHAFT, maxZ: SHAFT, kind: 'stone' });
  const first = ledges[0];
  return {
    name: 'Lamphold',
    chapter: 2,
    depthOffset: CHAPTER2_DEPTH_OFFSET,
    spawn: { x: first.x, y: r2(first.y + 0.4), z: first.z, yaw: 0 },
    goal: { minX: -8, maxX: 8, minY: bottom, maxY: bottom + 6, minZ: -8, maxZ: 8 },
    gate: { minX: -3, maxX: 3, minY: bottom, maxY: bottom + 8, minZ: 10, maxZ: 10.5 },
    stillLamp: { x: 0, y: bottom + 2, z: 0 },
    sections,
    solids,
    hazards,
    anchors,
    decor,
    lights,
    movers,
    ledges: ledges.map((l) => ({ id: l.id, x: l.x, y: l.y, z: l.z, section: l.section })), // for the tests and the bots (not read by Level3D)
  };
}

export const LEVEL_DATA_CH2 = buildChapter2();
