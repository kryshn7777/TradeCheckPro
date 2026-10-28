// Section seals and objectives (LEVEL_FUN_PLAN P1, sim/objectives3d.js) on the real level (Node):
// the seal plates in Level3D, the objective state machine (closed at a new run, open on hooking the route ring (S5-S7;
// the P3 verbs of S1 / S2 / S4 are in verbs.mjs, the P4 winch of S3 in machines.mjs), sticky
// across a checkpoint, a death / respawn and the Nightmare alternate respawn, closed again by a new run), the Sandbox warp
// (every seal above the warp target opens, silently), a closed seal as floor and sight block, the seal:land cue,
// snapshot / restore and serialize / load round trips, determinism of a bot run, the save's run.objectives, the
// skitterling from below staying above a closed seal, and the view's bar layout.
//   node unit.mjs [--root DIR]   (prints PASS/FAIL per check, exit 1 on a failure)
import { register } from 'node:module';
import { srcUrl, VENDOR_THREE_URL } from '../../verify/root.mjs';
// three.js for the view module (as tests/render does): the bare 'three' specifier resolves to the vendored build
register(
  'data:text/javascript,' +
    encodeURIComponent(`export async function resolve(s, c, next) {
  if (s === 'three') return { url: '${VENDOR_THREE_URL}three.module.min.js', shortCircuit: true };
  return next(s, c);
}`),
);
globalThis.self = globalThis;
const { CONFIG, DIFFICULTY, EventBus } = await import(srcUrl('sim/config3d.js'));
const { Player3D, TetherSystem, Physics3D } = await import(srcUrl('sim/physics3d.js'));
const { Level3D } = await import(srcUrl('sim/level3d.js'));
const { Objectives3D } = await import(srcUrl('sim/objectives3d.js'));
const { SkitterGroup, SKITTER } = await import(srcUrl('sim/skitter3d.js'));
const { migrateProfile } = await import(srcUrl('meta/save.js'));
const { Sim } = await import('../../verify/sim.mjs');
const { Bot } = await import('../../verify/bot.mjs');
const R = await import('../../verify/routes.mjs');

let fails = 0;
const ok = (c, msg) => {
  console.log((c ? 'PASS ' : 'FAIL ') + msg);
  if (!c) fails++;
};
const VARIANTS = ['normal', 'nightmare', 'abyss'];
const DT = CONFIG.PHYSICS_DT;

/** A level + objectives + tethers with an event log. */
function rig(v = 'normal') {
  const L = new Level3D(undefined, v);
  const bus = new EventBus();
  const ev = [];
  for (const t of ['objective:progress', 'objective:done', 'seal:open', 'seal:land']) bus.on(t, (e) => ev.push([t, e.id]));
  const O = new Objectives3D(L, DIFFICULTY[v], bus);
  const T = new TetherSystem(L, DIFFICULTY[v], bus, {});
  const ph = new Physics3D(L, DIFFICULTY[v], bus);
  const p = new Player3D(0, 0, 0);
  return { L, bus, ev, O, T, ph, p };
}
const sealClosed = (O, id) => O.seals.find((s) => s.id === id).solids.every((s) => s.active === true);
const sealOpenAll = (O, id) => O.seals.find((s) => s.id === id).solids.every((s) => s.active === false);
const openIds = (O) => O.seals.filter((s) => O.sealOpen[s.index]).map((s) => s.id).join(',');

// 1. Level3D keeps the plates apart: not in solids (view, bakes, hashes), in every sight / collision query, built open.
{
  const L = new Level3D(undefined, 'normal');
  const plates = L.sealSolids;
  const inSolids = plates.some((s) => L.solids.indexOf(s) >= 0);
  const q = L.querySolids(-11, -9.2, -11, 11, -8.4, 11, []);
  const qs = L.querySolidsStatic(-11, -9.2, -11, 11, -8.4, 11, []);
  ok(plates.length === 10 && !inSolids && plates.every((s) => s.kind === 'grate' && typeof s.seal === 'string' && s.active === false), `10 seal plates, kept out of level.solids, kind grate, built open (${plates.length})`);
  ok(q.some((s) => s.seal === 'seal-s1') && !qs.some((s) => s.seal), 'querySolids sees the S1 plate, querySolidsStatic (the view planner) does not');
  ok(L.byId['seal-s3-floor'] && L.byId['seal-s3-floor'].seal === 'seal-s3', 'plates resolve by id');
  plates[0].active = true;
  L.reset();
  ok(plates[0].active === true, 'level.reset() leaves the plates to Objectives3D');
}

// 2. A new run: every seal closed, its rings marked; the same on every variant.
for (const v of VARIANTS) {
  const { O } = rig(v);
  ok(O.seals.length === 7 && O.objectives.length === 7 && O.seals.every((s) => sealClosed(O, s.id)) && O.doneCount === 0, `${v}: 7 seals, 7 objectives, all closed at a new run`);
  const rings = O.fixtures.filter((f) => f.anchor);
  const keys = rings.filter((f) => f.anchor.sealKey === 1).map((f) => f.anchor.id);
  ok(keys.length === rings.length && keys.includes('s2-cw') && keys.includes('s6-ra3') && keys.includes('s7-sp1') && !keys.includes('t1'), `${v}: the rings that open them (hook and haul) carry the cue (${keys.join(' ')})`);
}

// 3. Open on hook: hooking s5-h4 opens the S5 seal (only), with the events; hooking any other ring does nothing (t1, the S1
//    ring of P1, is no key any more: the bell is; nor s3-a2, the S3 ring of P1-P3: the winch is).
{
  const { L, ev, O, T, p } = rig();
  p.reset(-6, -151.6, 0);
  T.attach(p, 'right', L.byId['s5-h1']);
  T.attach(p, 'left', L.byId.t1);
  O.step(DT, p, T, 1);
  T.attach(p, 'left', L.byId['s3-a2']);
  O.step(DT, p, T, 1);
  ok(O.doneCount === 0 && sealClosed(O, 'seal-s5') && sealClosed(O, 'seal-s1') && sealClosed(O, 'seal-s3'), 'hooking a ring that is no key opens nothing (t1 and s3-a2 included)');
  T.attach(p, 'left', L.byId['s5-h4']);
  O.step(DT, p, T, 2);
  ok(O.isDone('obj-s5') && O.isOpen('seal-s5') && sealOpenAll(O, 'seal-s5') && openIds(O) === 'seal-s5', 'hooking s5-h4 opens seal-s5 and nothing else');
  ok(ev.map((e) => e.join(':')).join(' ') === 'objective:progress:obj-s5 objective:done:obj-s5 seal:open:seal-s5', `events: ${ev.map((e) => e.join(':')).join(' ')}`);
  ok(L.byId['s5-h4'].sealKey === 0 && L.byId['s5-f1'].sealKey === 0 && L.byId['s6-sa3'].sealKey === 1, 'the cue leaves the rings of the done objective, stays on the next');
  O.step(DT, p, T, 3);
  ok(ev.length === 3, 'no repeat while still hooked');
}

// 4. Either line opens a forked section's seal; `hold` > 0 needs the rope held that long.
{
  const { L, O, T, p } = rig();
  p.reset(0, -230, 0);
  T.attach(p, 'right', L.byId['s6-ra3']);
  O.step(DT, p, T, 0);
  ok(O.isOpen('seal-s6') && O.progressOf('obj-s6') === 1, 'S6: the throat line ring (s6-ra3) opens it');
  const b = rig();
  b.p.reset(0, -340, 0);
  b.T.attach(b.p, 'right', b.L.byId['s7-sp1']);
  b.O.step(DT, b.p, b.T, 0);
  ok(b.O.isOpen('seal-s7'), 'S7: the spire face ring (alternate line) opens it');
  const c = rig();
  c.O.fixtures[c.O.fixtureIndex('fx-s5')].hold = 0.5;
  c.p.reset(-6, -151.6, 0);
  c.T.attach(c.p, 'right', c.L.byId['s5-h4']);
  for (let i = 0; i < Math.round(0.4 / DT); i++) c.O.step(DT, c.p, c.T, 0);
  const early = c.O.isOpen('seal-s5');
  c.T.release(c.p, 'right', 'input');
  c.O.step(DT, c.p, c.T, 0);
  c.T.attach(c.p, 'right', c.L.byId['s5-h4']);
  for (let i = 0; i < Math.round(0.4 / DT); i++) c.O.step(DT, c.p, c.T, 0);
  const reset = c.O.isOpen('seal-s5');
  for (let i = 0; i < Math.round(0.15 / DT); i++) c.O.step(DT, c.p, c.T, 0);
  ok(!early && !reset && c.O.isOpen('seal-s5'), 'hold 0.5 s: 0.4 s is not enough, letting go restarts it, 0.55 s held opens');
}

// 5. Sticky: a checkpoint, a death + respawn (level.reset + reapply) and the Nightmare alternate respawn keep seals open;
//    a new run (reset) closes them all.
{
  const { L, O, T, p } = rig('nightmare');
  for (const id of ['s5-h4', 's6-sa3']) {
    T.attach(p, 'right', L.byId[id]);
    O.step(DT, p, T, 0);
  }
  const before = openIds(O);
  L.reset(); // game.respawn()
  O.reapply();
  O.markDoneThrough(4); // the alternate checkpoint is S5 (index 4): an earlier section
  ok(before === 'seal-s5,seal-s6' && before.split(',').every((id) => O.isOpen(id)) && sealOpenAll(O, 'seal-s5') && sealOpenAll(O, 'seal-s6'), 'death, respawn and an earlier (alternate) checkpoint keep every opened seal open');
  O.reset();
  ok(O.doneCount === 0 && O.seals.every((s) => sealClosed(O, s.id)) && L.byId['s5-h4'].sealKey === 1, 'a new run closes every seal again');
}

// 6. Sandbox warp: markDoneThrough(i) opens the seals of the sections above i, silently; deeper ones stay closed.
{
  let good = true;
  for (let i = 0; i <= 7; i++) {
    const { O, ev } = rig();
    O.markDoneThrough(i);
    const want = O.seals.filter((s) => s.section < i).map((s) => s.id).join(',');
    if (openIds(O) !== want || ev.length) good = false;
  }
  ok(good, 'warp to section i: exactly the seals of sections < i open, no events');
  const { O } = rig();
  O.openAll();
  ok(O.seals.every((s) => sealOpenAll(O, s.id)), 'the menu attract camera: every seal open');
}

// 7. A closed seal is a floor, a sight block and says so once; open, the body falls through and the line is clear.
{
  const { L, ev, O, T, ph, p } = rig();
  p.reset(7, -4, 0); // in the S1 well, over the seal
  let landed = false;
  for (let i = 0; i < 240 * 2; i++) {
    ph.step(p, T, {}, DT);
    O.step(DT, p, T, 0);
    if (p.grounded && p.groundSolid && p.groundSolid.seal === 'seal-s1') landed = true;
  }
  ok(landed && p.alive && Math.abs(p.y - (-8.5 + p.radius)) < 0.05, `the body stands on the closed S1 grating (y ${p.y.toFixed(2)})`);
  ok(ev.filter((e) => e[0] === 'seal:land').length === 1, 'seal:land once per approach');
  const aim = (an) => {
    const dx = an.x - p.x;
    const dy = an.y - p.y;
    const dz = an.z - p.z;
    const l = Math.hypot(dx, dy, dz);
    return { ox: p.x, oy: p.y, oz: p.z, dx: dx / l, dy: dy / l, dz: dz / l };
  };
  const t2 = L.byId.t2;
  ok(!!T.findTarget(p, aim(t2), 'right'), 'from the grating a ring above is in sight (a way back up)');
  p.reset(6, -2, -2);
  const land = L.sections[1].checkpoint; // the S2 landing, straight down the well
  const blocked = L.segmentBlocked(p.x, p.y, p.z, land.x, land.y, land.z, 0.6);
  O.markDoneThrough(1);
  const clear = !L.segmentBlocked(p.x, p.y, p.z, land.x, land.y, land.z, 0.6);
  ok(blocked && clear, 'the S1 grating blocks the sight line down the well while closed, not once open');
  p.reset(7, -4, 0);
  for (let i = 0; i < 240 * 1.5; i++) ph.step(p, T, {}, DT);
  ok(p.y < -12, `open, the body falls through (y ${p.y.toFixed(1)})`);
}

// 8. Snapshot / restore and serialize / load round trips.
{
  const { L, O, T, p, ev } = rig();
  T.attach(p, 'right', L.byId['s5-h4']);
  O.step(DT, p, T, 0);
  const snap = O.snapshot();
  T.attach(p, 'left', L.byId['s6-sa3']);
  O.step(DT, p, T, 0);
  const n = ev.length;
  O.restore(snap);
  ok(openIds(O) === 'seal-s5' && sealClosed(O, 'seal-s6') && L.byId['s6-sa3'].sealKey === 1 && ev.length === n, 'restore() rewinds a look-ahead (the S6 seal it opened is closed again, cue back)');
  const saved = O.serialize();
  const b = rig();
  const k = b.O.load(saved.concat(['obj-unknown', 7]));
  ok(JSON.stringify(saved) === '["obj-s5"]' && k === 1 && openIds(b.O) === 'seal-s5', 'serialize() / load(): the done ids, unknown entries ignored');
}

// 9. Determinism: the S1 + S2 routes from the spawn, twice: the same objective events on the same frames and the same path.
{
  const runs = [];
  for (let k = 0; k < 2; k++) {
    const L = new Level3D(undefined, 'normal');
    const sim = new Sim(L, 'normal');
    sim.spawn(L.spawn.x, L.spawn.y, L.spawn.z);
    const r = new Bot(sim, R.ROUTES.s1.concat(R.ROUTES.s2), {}).runRoute();
    runs.push({ ok: r.ok, h: sim.hash.hex, o: sim.objHash, ev: JSON.stringify(sim.objEvents) });
  }
  ok(runs[0].ok && runs[1].ok && runs[0].h === runs[1].h && runs[0].o === runs[1].o && runs[0].ev === runs[1].ev && runs[0].ev.includes('obj-s2'), `bot S1+S2 from the spawn opens seal-s1 then seal-s2, identical twice (${runs[0].ev})`);
  // From the sill, the rest of the S1 route (t2, lower down the well): without the bell the grating stops it; with it, it lands.
  const down = R.ROUTES.s1.slice(R.ROUTES.s1.findIndex((st) => st.a === 't2'));
  const res = [0, 1].map((done) => {
    const L = new Level3D(undefined, 'normal');
    const sim = new Sim(L, 'normal');
    sim.spawn(-4, -4.62, -7.5, done);
    const r = new Bot(sim, down, { maxFrames: 60 * 30 }).runRoute();
    return { ok: r.ok, y: sim.player.y, open: sim.objectives.isOpen('seal-s1') };
  });
  ok(!res[0].ok && res[0].y > -8.6 && !res[0].open && res[1].ok && res[1].y < -21, `the rest of the S1 route stops on the grating without the bell (y ${res[0].y.toFixed(1)}), lands in S2 with it (y ${res[1].y.toFixed(1)})`);
}

// 10. The save keeps run.objectives (cleaned: strings, no duplicates).
{
  const raw = { schema: 2, run: { chapter: 'ch1', difficulty: 'normal', checkpoint: { x: 1, y: -20, z: 2, index: 1 }, objectives: ['obj-s1', 5, 'obj-s1', 'obj-s2', ''] } };
  const prof = migrateProfile(raw).profile;
  const none = migrateProfile({ schema: 2, run: { chapter: 'ch1', difficulty: 'normal', checkpoint: { x: 1, y: -20, z: 2 } } }).profile;
  ok(JSON.stringify(prof.run.objectives) === '["obj-s1","obj-s2"]' && none.run && !('objectives' in none.run), 'save: run.objectives kept and cleaned, absent when none');
}

// 11. The skitterling from below (Nightmare / Abyss) enters above a closed seal, or waits when there is no room.
{
  const L = new Level3D(undefined, 'nightmare');
  const O = new Objectives3D(L, DIFFICULTY.nightmare, null);
  O.markDoneThrough(4); // S1-S4 open, the S5 seal (y -202) closed
  const bus = new EventBus();
  const top = L.closedSealBelow(NaN, -160, NaN);
  let good = top === -202;
  let spawned = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const g = new SkitterGroup(L, DIFFICULTY.nightmare, bus, { seed });
    const p = new Player3D(-12, -160, 0);
    const c = g.slots[SKITTER.dataSlots];
    if (g._spawnBelow(p, 4) !== true || !c.on || !(c.y > top)) good = false;
    else spawned++;
    const g2 = new SkitterGroup(L, DIFFICULTY.nightmare, bus, { seed });
    if (g2._spawnBelow(new Player3D(-12, -185, 0), 4) !== false || g2.slots[SKITTER.dataSlots].on) good = false;
  }
  ok(good && spawned === 12, `below-spawn: above the closed S5 grating (y ${top}) from 42 m up; none from 17 m up (no room)`);
}

// 12. The view's bars: inside each seal's plates, every plate covered, 'slide' halves part past the walls.
{
  const { sealBars, BAR, SealView } = await import(srcUrl('render/objectivesView.js'));
  {
    const L = new Level3D(undefined, 'normal');
    const seals = sealBars(L);
    let inside = true;
    for (const s of seals) {
      for (let j = 0; j < s.bars.length; j += 8) {
        const b = s.bars;
        if (b[j] - b[j + 3] / 2 < s.minX - 1e-3 || b[j] + b[j + 3] / 2 > s.maxX + 1e-3 || b[j + 2] - b[j + 5] / 2 < s.minZ - 1e-3 || b[j + 2] + b[j + 5] / 2 > s.maxZ + 1e-3) inside = false;
        if (b[j + 1] + b[j + 4] / 2 > s.maxY + 1e-3) inside = false;
      }
    }
    const total = seals.reduce((n, s) => n + s.n, 0);
    ok(seals.length === 7 && inside && total > 300 && total < 900, `7 seals, ${total} bars (one instanced mesh, metal material), all within their plates and under the walking surface`);
    const s3 = seals.find((s) => s.id === 'seal-s3');
    let parted = true;
    for (let j = 0; j < s3.bars.length; j += 8) {
      const z = s3.bars[j + 2] + s3.bars[j + 7];
      const hz = s3.bars[j + 5] / 2;
      if (z + hz > s3.minZ && z - hz < s3.maxZ) parted = false;
    }
    ok(parted && BAR.openTime > 0, 'opened, every bar of a sliding seal ends past its edge (inside the wall)');
    // SealView: one instanced mesh; draws only the closed seals in view; an opening animates, then the seal is gone
    const THREE = await import('three');
    const root = new THREE.Group();
    const view = new SealView(L, new THREE.MeshStandardMaterial(), new THREE.BoxGeometry(1, 1, 1), root);
    const O = new Objectives3D(L, DIFFICULTY.normal, null);
    const head = new THREE.Vector3(-4, 1.6, 8.5);
    view.update(1 / 72, O, head, 20);
    const s1 = seals.find((s) => s.id === 'seal-s1').n;
    const bell = view.fixtures.find((f) => f.kind === 'bell').boxes.length; // the S1 bell rides in the same mesh (P3)
    const first = view.stats.drawn;
    const packs = view.stats.packs;
    view.update(1 / 72, O, head, 20);
    const same = view.stats.packs === packs; // nothing changed: no re-pack, no upload
    // opened in play (the bell struck) it slides open, then it is gone; the bell stays
    const T2 = new TetherSystem(L, DIFFICULTY.normal, new EventBus(), {});
    const bf = O.fixtures[O.fixtureIndex('bell-s1')];
    const p2 = new Player3D(bf.x + 1.0, bf.y, bf.z);
    p2.vx = -4;
    O.step(DT, p2, T2, null, 0);
    view.update(1 / 72, O, head, 20);
    const anim = view.stats.drawn;
    for (let i = 0; i < 72 * 2; i++) view.update(1 / 72, O, head, 20);
    const animated = O.isOpen('seal-s1') && anim === s1 + bell && view.stats.drawn === bell && view.mesh.visible;
    // opened by a warp (a new run, then markDoneThrough) it is simply gone
    O.reset();
    view.update(1 / 72, O, head, 20);
    const closedAgain = view.stats.drawn === s1 + bell;
    O.markDoneThrough(1);
    view.update(1 / 72, O, head, 20);
    const warped = view.stats.drawn === bell;
    ok(root.children.length === 1 && root.children[0].isInstancedMesh && first === s1 + bell && same && animated && closedAgain && warped, `view: 1 instanced mesh, the S1 grating's ${s1} bars (+ the bell's ${bell} boxes) in view, re-packed only on change; struck open it slides then hides, warped open it is gone at once`);
  }
}

console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exitCode = fails ? 1 : 0;
