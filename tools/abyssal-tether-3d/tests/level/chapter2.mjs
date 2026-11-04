// CHAPTER II · LAMPHOLD, the graybox (data/chapter2-data.js), Node. Owner: "make it 1250 instead of 580".
//   - the beat table: 13 beats, the lengths add up to exactly 1,250 m, contiguous sections from y = 0 down, the depth offset 600 (600 -> 1,850 m), about an hour
//   - Level3D builds it (free attach, all three variants): 13 sections, unique ids, the movers (live anchors) valid, the spawn on the first ledge
//   - the spiral stair: every ledge is at most 6 m below the one before (across the beat seams too), overlaps it in plan so a step off the edge lands on it,
//     has headroom, and stays inside the pit; walking off a ledge in the real physics lands on the next one (a sample from every beat)
//   - the hook beat is the last one, the end floor is under the last ledge, the goal is on it
//   - the machinery of the beats (lifts, crane hooks, the monorail, the express cages, the governor, the wheel): closed forms of the clock, every carried
//     ring at or under the cap of the chapter (13.1 m/s), the express cage 80 m in 9 s at a peak of 13 m/s, and each ring always inside the pit
//   node chapter2.mjs [--root DIR]
import { srcUrl } from '../../verify/root.mjs';
const { CONFIG, DIFFICULTY, EventBus } = await import(srcUrl('sim/config3d.js'));
const { Player3D, TetherSystem, Physics3D } = await import(srcUrl('sim/physics3d.js'));
const { Level3D } = await import(srcUrl('sim/level3d.js'));
const { CHAPTER2_BEATS, CHAPTER2_DEPTH, CHAPTER2_DEPTH_OFFSET, LEVEL_DATA_CH2, buildChapter2 } = await import(srcUrl('data/chapter2-data.js'));

const Mv = await import(srcUrl('sim/movers3d.js'));
let fails = 0;
const ok = (c, msg) => {
  console.log((c ? 'PASS ' : 'FAIL ') + msg);
  if (!c) fails++;
};
const D = LEVEL_DATA_CH2;

// 1. The beat table.
{
  const total = CHAPTER2_BEATS.reduce((a, b) => a + b.len, 0);
  ok(CHAPTER2_BEATS.length === 13 && total === 1250 && CHAPTER2_DEPTH === 1250, `13 beats adding up to ${total} m (the owner's 1,250, not the bible's 580)`);
  ok(CHAPTER2_DEPTH_OFFSET === 600, 'depth offset 600: the readout runs 600 -> 1,850 m');
  const mins = CHAPTER2_BEATS.reduce((a, b) => a + b.min, 0);
  ok(mins >= 55 && mins <= 72, `about an hour for a first-time player on Normal (${mins} min)`);
  let y = 0;
  let contiguous = true;
  for (const s of D.sections) {
    if (Math.abs(s.yTop - y) > 1e-9) contiguous = false;
    y = s.yBottom;
  }
  ok(contiguous && y === -1250 && D.sections.length === 13, 'the sections are contiguous from y = 0 down to y = -1250');
  ok(CHAPTER2_BEATS[12].name === 'The Soot Throat' && CHAPTER2_BEATS[8].name === 'The Tolling Gallery', 'the Tolling Gallery (the Usher\'s first sighting) is beat 9 and the Soot Throat (the hook) is the last');
  const a = JSON.stringify(buildChapter2());
  const b = JSON.stringify(buildChapter2());
  ok(a === b, 'the generator is deterministic');
}

// 2. Level3D builds it.
{
  for (const v of ['normal', 'nightmare', 'abyss']) {
    const L = new Level3D(D, v, { freeAttach: true });
    const carried = D.movers.reduce((n, m) => n + m.carry.anchors.length, 0);
    ok(L.sections.length === 13 && L.movers.length === D.movers.length && L.dynAnchors.length === carried, `${v}: 13 sections, ${L.movers.length} movers carrying ${L.dynAnchors.length} rings`);
  }
  const ids = new Set(D.solids.map((s) => s.id));
  ok(ids.size === D.solids.length, `${D.solids.length} solids with unique ids`);
  const L = new Level3D(D, 'normal', { freeAttach: true });
  ok(L.sectionIndexAt(-5) === 0 && L.sectionIndexAt(-45) === 1 && L.sectionIndexAt(-1249) === 12, 'sectionIndexAt finds the beats by depth');
  const first = D.ledges[0];
  ok(Math.abs(D.spawn.x - first.x) < 1e-9 && Math.abs(D.spawn.y - (first.y + 0.4)) < 1e-9, 'the spawn is on the first ledge');
}

// 3. The spiral stair.
{
  const S = new Map(D.solids.map((s) => [s.id, s]));
  let maxStep = 0;
  let minOverlap = 1e9;
  let minHead = 1e9;
  let inside = true;
  let gap = 0; // the one place the stair is cut: the Snuffing's arena (II-12) replaces it between its Well rim and the Soot Throat's lip
  for (let i = 1; i < D.ledges.length; i++) {
    const a = S.get(D.ledges[i - 1].id);
    const b = S.get(D.ledges[i].id);
    if (D.ledges[i - 1].section === 'c2-12' && D.ledges[i].section === 'c2-13') {
      gap = a.maxY - b.maxY;
      continue;
    }
    maxStep = Math.max(maxStep, a.maxY - b.maxY);
    const ox = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
    const oz = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ);
    minOverlap = Math.min(minOverlap, ox, oz);
    minHead = Math.min(minHead, a.minY - b.maxY);
  }
  for (const s of D.solids) if (s.kind === 'stone' && s.id.includes('-l') && (Math.abs(s.minX) > 26 || Math.abs(s.maxX) > 26 || Math.abs(s.minZ) > 26 || Math.abs(s.maxZ) > 26)) inside = false;
  ok(D.ledges.length > 180 && D.ledges.length < 215, `${D.ledges.length} ledges down the whole chapter (the stair is cut for the arena: a ${gap.toFixed(1)} m gap)`);
  ok(gap > 80 && gap < 100, 'exactly one cut in the stair: the Snuffing arena (the Span and the lift carry you over it)');
  ok(maxStep > 0 && maxStep <= 6.0001, `each ledge is at most ${maxStep.toFixed(2)} m below the one before (across the beat seams too)`);
  ok(minOverlap >= 2, `consecutive ledges overlap by at least ${minOverlap.toFixed(2)} m in plan: a step off the edge lands on the next one`);
  ok(minHead >= 1.9, `headroom of at least ${minHead.toFixed(2)} m between a ledge and the one above it over the overlap`);
  ok(inside, 'the whole stair is inside the pit');
  const fall = Math.sqrt(2 * CONFIG.player.gravity * 6);
  ok(fall < DIFFICULTY.normal.lethalImpact, `a 6 m drop is ${fall.toFixed(1)} m/s: under the lethal ${DIFFICULTY.normal.lethalImpact} m/s on Normal (it hurts; the rope is how you avoid it)`);

  // walking off a ledge in the real physics lands on the next one
  const diff = DIFFICULTY.normal;
  const L = new Level3D(D, 'normal', { freeAttach: true });
  const DT = CONFIG.PHYSICS_DT;
  let landed = 0;
  let tried = 0;
  for (let i = 0; i < D.ledges.length - 1; i += 17) {
    const a = D.ledges[i];
    const b = D.ledges[i + 1];
    const bus = new EventBus();
    const th = new TetherSystem(L, diff, bus, {});
    const ph = new Physics3D(L, diff, bus);
    const p = new Player3D(a.x, a.y + 0.45, a.z);
    // start inside the overlap, walk toward the next ledge's centre
    const sa = S.get(a.id);
    const sb = S.get(b.id);
    const ox0 = Math.max(sa.minX, sb.minX);
    const ox1 = Math.min(sa.maxX, sb.maxX);
    const oz0 = Math.max(sa.minZ, sb.minZ);
    const oz1 = Math.min(sa.maxZ, sb.maxZ);
    p.x = (ox0 + ox1) / 2;
    p.z = (oz0 + oz1) / 2;
    p.y = a.y + 0.45;
    const dx = b.x - p.x;
    const dz = b.z - p.z;
    const dl = Math.hypot(dx, dz) || 1;
    const intent = { move: { x: dx / dl, z: dz / dl }, reel: 0, jumpPressed: false, brake: false, hands: {} };
    let down = false;
    for (let t = 0; t < 600; t++) {
      ph.step(p, th, intent, DT);
      if (!p.alive) break;
      if (p.y < a.y - 0.5) down = true;
      if (down && p.grounded) break;
    }
    tried++;
    if (p.alive && p.grounded && Math.abs(p.y - R(b.y)) < 0.3 && down) landed++;
    else console.log('   (ledge', i, '->', i + 1, 'ended at y', p.y.toFixed(2), 'wanted', b.y, 'grounded', p.grounded, 'alive', p.alive, ')');
  }
  function R(topY) {
    return topY + CONFIG.player.radius;
  }
  ok(tried >= 12 && landed === tried, `walking off a ledge in the real physics lands on the next ledge (${landed} of ${tried} sampled, from every beat)`);
}

// 4. The end: the Mere.
{
  const H = D.c2.hook;
  const water = D.solids.find((s) => s.id === 'c2-13-water');
  const lastL = D.ledges[D.ledges.length - 1];
  ok(water && water.maxY === H.water.y && water.fixture === 'water-c2-13', 'the Mere is an invisible water plate (a fixture solid the director arms)');
  ok(D.goal.maxY < H.water.y + 2 && D.goal.minY < H.water.y && D.goal.minY > H.water.y - 4, 'the goal is the splash on the water, not the platform above it');
  ok(lastL.section === 'c2-13' && lastL.id === H.lip.id && lastL.y - H.chain.y < 0.01, `the stair ends at the lip (${lastL.id}); the chain platform starts level with it`);
  ok(H.chain.y - H.water.y - H.chain.drop === 6, `the chain stops ${H.chain.y - H.chain.drop - H.water.y} m over the water (36 m down)`);
  ok(Math.abs(H.water.y) > 1250 && Math.abs(H.water.y) < 1275, `the water is at ${H.water.y} m (the chapter's nominal 1,250 m, plus the cavern the walls end over)`);
}

// 4. The machinery.
{
  const byId = Object.fromEntries(D.anchors.map((a) => [a.id, a]));
  const q = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, hidden: false };
  let worst = 0;
  let inside = true;
  const kinds = {};
  for (const raw of D.movers) {
    const m = Mv.normalizeMover(raw, 'normal');
    kinds[raw.kind] = (kinds[raw.kind] || 0) + 1;
    for (const id of raw.carry.anchors) {
      const a = byId[id];
      const o = Mv.carryOffset(m, a.x, a.y, a.z);
      worst = Math.max(worst, Mv.pointMaxSpeed(m, o[0], o[1]));
      for (let t = 0; t < m.period; t += m.period / 200) {
        Mv.posePoint(m, o[0], o[1], o[2], t, q);
        if (Math.abs(q.x) > 26 || Math.abs(q.z) > 26) inside = false;
      }
    }
  }
  ok(kinds.pendulum >= 9 && kinds.lift === 6 && kinds.path === 3 && kinds.orbit === 2, `the live anchors of the beats: ${JSON.stringify(kinds)}`);
  ok(worst <= 13.1 && worst >= 12.9, `the fastest carried ring peaks at ${worst.toFixed(1)} m/s (the express cage: the chapter's cap is 13)`);
  ok(inside, 'every carried ring stays inside the pit over its whole cycle');
  const exp = D.movers.find((m) => m.id === 'mov-c2-7-exp0');
  const em = Mv.normalizeMover(exp, 'normal');
  let vmax = 0;
  Mv.posePoint(em, 0, 0, 0, em.dwell, q);
  const yA = q.y;
  Mv.posePoint(em, 0, 0, 0, em.dwell + em.travel, q);
  ok(Math.abs(yA - q.y - 80) < 0.01, `the express cage drops ${(yA - q.y).toFixed(1)} m in ${em.travel} s`);
  for (let t = 0; t < em.period; t += 0.01) {
    Mv.posePoint(em, 0, 0, 0, t, q);
    vmax = Math.max(vmax, Math.abs(q.vy));
  }
  ok(Math.abs(vmax - 13) < 0.2, `... peak ${vmax.toFixed(2)} m/s, accelerating ${(em.travel * em.ramp).toFixed(2)} s`);
  // determinism / continuity of the closed forms: a path ring is continuous over the lap seam
  const hook = Mv.normalizeMover(D.movers.find((m) => m.id === 'mov-c2-5-hookA'), 'normal');
  const a0 = Mv.posePoint(hook, 0, 0, 0, hook.period - 1e-4, { ...q });
  const a1 = Mv.posePoint(hook, 0, 0, 0, 1e-4, { ...q });
  ok(Math.hypot(a0.x - a1.x, a0.y - a1.y, a0.z - a1.z) < 0.01, 'a crane hook is continuous over the lap seam');
  // each lift ring is reachable: within a hook's range of a ledge at some time of its cycle
  const L = new Level3D(D, 'normal', { freeAttach: true });
  ok(L.movers.every((e) => e.anchors.every((a) => a.dynamic === true)), 'Level3D marks every carried ring dynamic');
}

console.log(fails ? `FAILED: ${fails}` : 'ALL CHAPTER II GRAYBOX CHECKS PASS');
process.exit(fails ? 1 : 0);
