// LEVEL_FUN_PLAN P5 "the Mason" (sim/objectives3d.js, sim/creature3d.js) on the real level (Node): the S5 keystone (a fixture
// solid out of the bake and the hashes; broken by a Mason lunge: tests/creature/lure.mjs) and its haul fallback, available at
// once (loud notches, a ratchet through a release / a death / a Continue); the S7 survive floor (45 / 60 / 60 s in 4 stages,
// paused on the landing, kept through a death at the last stage boundary, the save, a new run, the Sandbox warp, never
// opening under the feet but under a body that hangs on a sound line); the escape override for the creature once the iris is
// open; the Masons' rests' budgets (warn, spent, refill); snapshot / restore; determinism of the bot lines; captions; view.
//   node mason.mjs [--root DIR]   (PASS/FAIL per check, exit 1 on a failure)
import { register } from 'node:module';
import { srcUrl, VENDOR_THREE_URL } from '../../verify/root.mjs';
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
const { LEVEL_DATA_3D } = await import(srcUrl('data/level-data-3d.js'));
const { Objectives3D, VERB_NOISE } = await import(srcUrl('sim/objectives3d.js'));
const { Creature3D, CREATURE_MODES } = await import(srcUrl('sim/creature3d.js'));
const { levelLmHash } = await import(srcUrl('render/lightmapFormat.js'));
const { levelGiHash } = await import(srcUrl('render/giFormat.js'));
const { captionForEvent, RULES } = await import(srcUrl('ui/captions.js'));
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
const EVENTS = ['objective:progress', 'objective:done', 'seal:open', 'breach:hit', 'breach:break', 'arena:pause', 'nook:enter', 'nook:exit', 'nook:warn', 'nook:spent'];

function rig(v = 'normal', key) {
  const L = new Level3D(undefined, v);
  const bus = new EventBus();
  const ev = [];
  for (const t of EVENTS) bus.on(t, (e) => ev.push([t, e.fixture || e.id, e.k, e.noise || 0, e.by || '']));
  const O = new Objectives3D(L, DIFFICULTY[key || v], bus);
  const T = new TetherSystem(L, DIFFICULTY[key || v], bus, {});
  const ph = new Physics3D(L, DIFFICULTY[key || v], bus);
  const p = new Player3D(0, 0, 0);
  return { L, bus, ev, O, T, ph, p };
}
const fx = (O, id) => O.fixtures[O.fixtureIndex(id)];
const intent = (yank = 0, hand = 'right') => ({ move: { x: 0, z: 0 }, reel: 0, hands: { left: { yank: hand === 'left' ? yank : 0 }, right: { yank: hand === 'right' ? yank : 0 } } });
const steps = (O, p, T, it, s, t0 = 0) => {
  for (let i = 0; i < Math.round(s / DT); i++) O.step(DT, p, T, it, t0 + i * DT);
};
/** A body standing on solid s at (x, z) (Objectives3D reads grounded / groundSolid). */
const stand = (p, s, x, z) => {
  p.reset(x, s.maxY + p.radius, z);
  p.grounded = true;
  p.groundSolid = s;
};

// 1. The data and its knobs per difficulty (Sandbox = Normal); the keystone stays out of the bake and both hashes.
{
  const want = { normal: [8, 45, 25], nightmare: [10, 60, 15], abyss: [12, 60, 8], sandbox: [8, 45, 25] };
  let good = true;
  const rows = [];
  for (const k of Object.keys(want)) {
    const v = k === 'sandbox' ? 'normal' : k;
    const { O } = rig(v, k);
    const key = fx(O, 'key-s5');
    const arena = fx(O, 'arena-s7');
    const got = [key.time, arena.time, O.nooks[O.nookIndex('nook-s6')].budget];
    rows.push(`${k} ${got.join('/')}`);
    if (got.join() !== want[k].join() || key.notches !== 4 || key.hp !== 1 || key.r !== 2.5 || arena.notches !== 4 || !arena.pause || arena.pause.id !== 's7-landing') good = false;
    if (O.nooks.length !== 3 || !O.nooks[O.nookIndex('nook-s5')].lure || O.nooks[O.nookIndex('nook-s5')].fixture !== O.fixtureIndex('key-s5')) good = false;
    if (key.anchor.haul !== true || key.anchor.id !== 'key-s5-ring') good = false;
  }
  ok(good, `knobs: keystone haul / survive time / rest budget (s) ${rows.join(' | ')}; 4 notches, 4 stages, hp 1, r 2.5 m; 3 rests, S5 the lure`);
  const L = new Level3D(undefined, 'normal');
  const stone = L.byId['key-s5-stone'];
  const data = Object.assign({}, LEVEL_DATA_3D, { solids: LEVEL_DATA_3D.solids.filter((s) => s.id !== 'key-s5-stone') });
  const L0 = new Level3D(data, 'normal');
  ok(stone && stone.kind === 'breach' && L.fixtureSolids.includes(stone) && !L.solids.includes(stone) && stone.active === false, 'the keystone is a fixture solid: out of level.solids, built inactive (no Objectives3D: no keystone)');
  ok(levelLmHash(L) === levelLmHash(L0) && levelGiHash(L) === levelGiHash(L0), `lightmap and GI hashes unchanged by the keystone (${levelLmHash(L)})`);
  const q = L.querySolids(-19.4, -199, -1.5, -19.2, -198, -1.3, []);
  ok(q.includes(stone) && !L.querySolidsStatic(-19.4, -199, -1.5, -19.2, -198, -1.3, []).includes(stone), 'collision / sight queries see it, the view planner does not');
}

// 2. The haul fallback, available at once: the ring targetable and cued at a new run; 4 loud notches over haulTime (no reel
//    toward the ring); done = breach:break by 'haul', the plug drops, the stone and its ring are gone (a line on it lets go).
{
  const { L, ev, O, T, ph, p } = rig();
  const ring = L.byId['key-s5-ring'];
  const step6 = L.byId['s5-step6'];
  O.markDoneThrough(4);
  stand(p, step6, -18.5, 3);
  const aim = { ox: p.x, oy: p.y, oz: p.z, dx: ring.x - p.x, dy: ring.y - p.y, dz: ring.z - p.z };
  const l = Math.hypot(aim.dx, aim.dy, aim.dz);
  aim.dx /= l;
  aim.dy /= l;
  aim.dz /= l;
  const tgt = T.findTarget(p, aim, 'right');
  ok(tgt && tgt.anchor === ring && ring.sealKey === 1 && !ring.hidden && L.byId['key-s5-stone'].active, `at a new run the keystone stands and its ring is targetable from the last step (${l.toFixed(1)} m) and cued`);
  T.attach(p, 'right', ring);
  const x0 = p.x;
  const z0 = p.z;
  const it = intent(1);
  let notchT = [];
  for (let i = 0; i < Math.round(8.1 / DT); i++) {
    ph.step(p, T, it, DT);
    const n0 = ev.length;
    O.step(DT, p, T, it, i * DT);
    for (let j = n0; j < ev.length; j++) if (ev[j][0] === 'objective:progress') notchT.push(+(i * DT).toFixed(2));
  }
  const notches = ev.filter((e) => e[0] === 'objective:progress');
  ok(notches.length === 4 && notches.every((e) => e[3] === VERB_NOISE) && Math.abs(notchT[3] - 8) < 0.05, `4 notches over 8 s, each loud for the Mason (noise ${VERB_NOISE}): at ${notchT.join(' / ')} s`);
  ok(Math.hypot(p.x - x0, p.z - z0) < 0.05, 'hauling never moves the player (a haul ring is never reeled toward)');
  const brk = ev.find((e) => e[0] === 'breach:break');
  ok(brk && brk[4] === 'haul' && O.isDone('obj-s5') && O.isOpen('seal-s5') && !L.byId['key-s5-stone'].active && ring.hidden && ring.sealKey === 0, 'done: breach:break (by the haul), seal-s5 open (the player is on the step, not the plug), the stone inactive, the ring gone');
  T.step(p, DT);
  ok(!T.hands.right.rope.attached, 'the line on the ring lets go as the ring falls with the stone');
}

// 3. Partial progress persists: a release keeps the notches, a death (level.reset + reapply) keeps them, a Continue
//    (serialize / load) brings them back; a new run clears them.
{
  const { L, O, T, p } = rig('nightmare');
  O.markDoneThrough(4);
  const ring = L.byId['key-s5-ring'];
  stand(p, L.byId['s5-step6'], -18.5, 3);
  T.attach(p, 'right', ring);
  steps(O, p, T, intent(1), 5.4); // nightmare: 10 s, a notch per 2.5 s: 2 notches + a part
  const k = fx(O, 'key-s5');
  const i = O.fixtureIndex('key-s5');
  const two = O.fxN[i] === 2;
  T.release(p, 'right', 'input');
  steps(O, p, T, intent(0), 0.5);
  const kept = O.fxN[i] === 2 && Math.abs(O.fxT[i] - 5) < 1e-6;
  L.reset();
  O.reapply();
  const death = O.fxN[i] === 2 && !O.isDone('obj-s5') && L.byId['key-s5-stone'].active;
  const saved = O.serialize();
  const b = rig('nightmare');
  b.O.load(saved);
  const bi = b.O.fixtureIndex('key-s5');
  ok(two && kept && death && saved.includes('key-s5#2') && b.O.fxN[bi] === 2 && Math.abs(b.O.progressOf('obj-s5') - 0.5) < 1e-6, `a release, a death and a Continue keep the notches (${saved.join(' ')}; progress ${b.O.progressOf('obj-s5')})`);
  O.reset();
  ok(O.fxN[i] === 0 && L.byId['key-s5-stone'].active && !ring.hidden && k.time === 10, 'a new run: the keystone whole again, no notches');
}

// 4. The survive floor (S7): runs in the nave off the landing (hanging, the perch, the closed iris), pauses on the landing
//    (arena:pause once), stages are ratchets (a death restarts at the last boundary), done opens the iris.
for (const v of VARIANTS) {
  const { L, ev, O, T, p } = rig(v);
  O.markDoneThrough(6);
  const a = fx(O, 'arena-s7');
  const i = O.fixtureIndex('arena-s7');
  const per = a.time / 4;
  stand(p, L.byId['s7-landing'], -12, 0);
  steps(O, p, T, null, 5);
  const idle = O.fxT[i] === 0 && !ev.some((e) => e[0] === 'arena:pause'); // not started: no pause cue either
  // hanging in the nave
  p.reset(0, -340, 22);
  p.grounded = false;
  steps(O, p, T, null, per * 1.5);
  const s1 = O.fxN[i] === 1 && ev.filter((e) => e[0] === 'objective:progress' && e[1] === 'arena-s7').length === 1;
  // climbs back to the landing: the clock stops (once)
  stand(p, L.byId['s7-landing'], -12, 0);
  const tStop = O.fxT[i];
  steps(O, p, T, null, 10);
  const paused = O.fxT[i] === tStop && ev.filter((e) => e[0] === 'arena:pause').length === 1;
  // the perch counts; dies at 2.6 stages
  stand(p, L.byId['s7-perch'], -20, 26);
  steps(O, p, T, null, per * 1.1);
  const n2 = O.fxN[i];
  L.reset();
  O.reapply();
  const back = Math.abs(O.fxT[i] - 2 * per) < 1e-4 && O.fxN[i] === 2;
  // standing on the closed iris counts too; done at 4 stages: the iris waits while the player stands on it ...
  stand(p, L.byId['seal-s7-ne'], 8, -12);
  steps(O, p, T, null, per * 2 - 0.05);
  const notYet = !O.isDone('obj-s7');
  steps(O, p, T, null, 0.1);
  const waits = O.isDone('obj-s7') && !O.isOpen('seal-s7') && O.sealWait[O.seals.find((s) => s.id === 'seal-s7').index] === 1;
  // ... and opens under a body that hangs on a sound ring just above it
  p.reset(8, -423.5, -12);
  p.grounded = false;
  T.attach(p, 'right', L.byId['s7-f7']);
  steps(O, p, T, null, DT);
  const opened = O.isOpen('seal-s7');
  ok(idle && s1 && paused && n2 === 2 && back && notYet && waits && opened, `${v}: survive ${a.time} s in 4 stages of ${per} s: idle on the landing, stage 1 hanging, paused back on the landing (arena:pause once), the perch counts, a death keeps 2 stages (clock back to ${2 * per} s), done on the iris: waits under the feet, opens under a body hanging on s7-f7`);
}

// 5. The save, a Continue and a new run; the Sandbox warp opens every seal above (S5's keystone gone, silently).
{
  const { L, O, T, p, ev } = rig();
  O.markDoneThrough(6);
  p.reset(0, -340, 22);
  steps(O, p, T, null, 25); // 2 stages of 11.25 s
  const saved = O.serialize();
  const b = rig();
  b.O.load(saved);
  const bi = b.O.fixtureIndex('arena-s7');
  ok(saved.includes('arena-s7#2') && b.O.fxN[bi] === 2 && Math.abs(b.O.fxT[bi] - 22.5) < 1e-6 && Math.abs(b.O.progressOf('obj-s7') - 0.5) < 1e-6, `Continue: ${saved.filter((s) => s.startsWith('arena')).join(' ')} restores 2 stages (the clock at 22.5 s)`);
  O.reset();
  ok(O.fxT[O.fixtureIndex('arena-s7')] === 0 && O.fxN[O.fixtureIndex('arena-s7')] === 0, 'a new run (Abyss: every death) starts the clock from 0');
  const c = rig();
  c.O.markDoneThrough(6);
  const warped = c.O.isOpen('seal-s5') && !c.L.byId['key-s5-stone'].active && c.L.byId['key-s5-ring'].hidden && !c.O.isOpen('seal-s7') && c.ev.length === 0;
  c.O.markDoneThrough(7);
  ok(warped && c.O.isOpen('seal-s7') && c.ev.length === 0, 'Sandbox warp: to S7 the seals above are open and the keystone gone, the iris shut; to S8 it is open too; no events');
  void L;
  void ev;
}

// 6. The creature override: done, the objective's `after` (escape) for S7; Creature3D.setOverride lays it over frenzy, a
//    section change forgets it, setOverride(null) restores the data's mode.
{
  const { L, O } = rig('nightmare');
  O.markDoneThrough(6);
  const before = O.creatureOverrideFor(6);
  O.markDoneThrough(7);
  const after = O.creatureOverrideFor(6);
  ok(before === null && after && after.mode === 'escape' && O.creatureOverrideFor(5) === null, 'creatureOverrideFor(S7): null until the iris is open, then { mode: escape }');
  const bus = new EventBus();
  const c = new Creature3D(L, DIFFICULTY.nightmare, bus, { seed: 3 });
  const pl = { x: -12, y: -300, z: 0, vx: 0, vy: 0, vz: 0, alive: true };
  c.reset(pl);
  const frenzy = c.mode === 'frenzy' && c.inPlay && c.lethal;
  c.setOverride(after, 6);
  const escape = c.mode === 'escape' && c.profile === CREATURE_MODES.escape && c.profile.holdOnRecover === true && c.lethal && c.inPlay;
  c.onRespawn(pl); // a death in S7 after the iris opened: the game re-applies it (game._applyCreatureOverride), the creature keeps it
  const kept = c.mode === 'escape';
  c.setSection(7, L.sections[7], { x: -2, y: -440, z: 0, vx: 0, vy: 0, vz: 0, alive: true });
  const cleared = c._override === null && c.mode === 'escape'; // S8 is escape anyway
  c.setSection(6, L.sections[6], pl);
  const backToData = c.mode === 'frenzy';
  c.setOverride(after, 6);
  c.setOverride(null, 6);
  ok(frenzy && escape && kept && cleared && backToData && c.mode === 'frenzy', 'Creature3D.setOverride: S7 frenzy -> escape (holdOnRecover) once the iris is open, kept through a respawn, forgotten on another section, null restores frenzy');
}

// 7. The rests' budgets: nook:enter, nook:warn at 5 s left, nook:spent at 0 (the refuge ends), refill after 20 s outside; the
//    lure spends nothing while the keystone stands; snapshot / restore carries them.
{
  const { L, ev, O, T, p } = rig('nightmare');
  O.markDoneThrough(5);
  const n = O.nooks[O.nookIndex('nook-s6')];
  stand(p, L.byId['s6-safe3'], (n.minX + n.maxX) / 2, (n.minZ + n.maxZ) / 2);
  steps(O, p, T, null, 1);
  const inside = O.refugeKind === 1 && O.refugeBlock === n.block && ev.some((e) => e[0] === 'nook:enter');
  const snap = O.snapshot();
  steps(O, p, T, null, 9.2);
  const warned = ev.some((e) => e[0] === 'nook:warn') && !ev.some((e) => e[0] === 'nook:spent');
  steps(O, p, T, null, 5);
  const spent = ev.some((e) => e[0] === 'nook:spent') && O.refugeKind === 0;
  O.restore(snap);
  const restored = O.refugeKind === 1 && Math.abs(O.nookLeft[n.index] - 14) < 0.05;
  steps(O, p, T, null, 15);
  stand(p, L.byId['s6-safe3'], -20, -6); // out of it
  steps(O, p, T, null, 19);
  const notYet = O.nookLeft[n.index] === 0;
  steps(O, p, T, null, 1.2);
  const refilled = O.nookLeft[n.index] === n.budget && ev.some((e) => e[0] === 'nook:exit');
  ok(inside && warned && spent && restored && notYet && refilled, `rest budget (Nightmare ${n.budget} s): refuge inside, warn at 5 s left, spent at 0 (no refuge), restore() rewinds it, refilled after 20 s outside`);
  const b = rig('abyss');
  b.O.markDoneThrough(4);
  const ln = b.O.nooks[b.O.nookIndex('nook-s5')];
  stand(b.p, b.L.byId['s5-step6'], -20.3, -1.4);
  steps(b.O, b.p, b.T, null, 20);
  const lure = b.O.refugeKind === 2 && b.O.nookLeft[ln.index] === ln.budget;
  b.O.onStrike({ x: -19.3, y: -197, z: -1.4, hit: false, stop: 'key-s5-stone' });
  steps(b.O, b.p, b.T, null, 1);
  ok(lure && b.O.refugeKind === 1 && b.O.nookLeft[ln.index] < ln.budget, 'the lure niche: refuge kind 2 and no budget spent while the keystone stands; broken, a plain rest (kind 1, its budget runs)');
}

// 8. Determinism: the S5 lines (the keystone hauled) and the S7 lines (the survive floor) twice: same path, same events.
{
  let good = true;
  const rows = [];
  for (const key of ['s5', 's5fast', 's7', 's7fast']) {
    const runs = [];
    for (let k = 0; k < 2; k++) {
      const L = new Level3D(undefined, 'abyss');
      const sim = new Sim(L, 'abyss', { record: true });
      const cp = L.sections[R.ROUTE_START[key]].checkpoint;
      sim.spawn(cp.x, cp.y, cp.z);
      const r = new Bot(sim, R.ROUTES[key], {}).runRoute();
      runs.push({ ok: r.ok, h: sim.hash.hex, o: sim.objHash, t: r.time, sim });
    }
    const L = new Level3D(undefined, 'abyss');
    const rp = new Sim(L, 'abyss');
    const cp = L.sections[R.ROUTE_START[key]].checkpoint;
    rp.spawn(cp.x, cp.y, cp.z);
    rp.replay(runs[0].sim.log, runs[0].sim.logFrames);
    rows.push(`${key} ${runs[0].t.toFixed(1)} s`);
    if (!runs[0].ok || !runs[1].ok || runs[0].h !== runs[1].h || runs[0].o !== runs[1].o || rp.hash.hex !== runs[0].h || rp.objHash !== runs[0].o) good = false;
  }
  ok(good, `determinism (Abyss): bot run = re-run = input replay, objective events too (${rows.join(', ')})`);
}

// 9. Captions.
{
  const c = [
    captionForEvent('breach:hit', {}),
    captionForEvent('breach:break', {}),
    captionForEvent('nook:warn', {}),
    captionForEvent('objective:progress', { verb: 'survive', k: 1, of: 4 }),
    captionForEvent('objective:progress', { verb: 'breach', k: 2, of: 4 }),
    captionForEvent('objective:progress', { verb: 'breach', k: 4, of: 4 }),
    captionForEvent('arena:pause', {}),
  ];
  ok(c[0] === RULES.stoneCrack && c[1] === RULES.keystone && c[2].text === '[Stone scraping at the opening]' && c[3] === RULES.bolt && c[4] === RULES.ratchet && c[5] === null && c[6] === RULES.boltsHold, `captions: ${c.map((r) => (r ? r.text : '-')).join(' ')}`);
}

// 10. The view: the keystone (standing / broken) and the iris bolts are boxes of the one seal mesh (no new mesh).
{
  const { fixtureParts, SealView, FIX } = await import(srcUrl('render/objectivesView.js'));
  const L = new Level3D(undefined, 'normal');
  const parts = fixtureParts(L);
  const key = parts.find((f) => f.kind === 'breach');
  const arena = parts.find((f) => f.kind === 'survive');
  const stone = L.byId['key-s5-stone'];
  const lastBolt = arena.bolts[arena.bolts.length - 1];
  const ne = L.byId['seal-s7-ne'];
  ok(key && key.boxes.length === 4 && key.rubble.length === 3 && Math.abs(key.x - (stone.minX + stone.maxX) / 2) < 1e-9 && arena.bolts.length === 4 && lastBolt.boxes[0][2] === (ne.minZ + ne.maxZ) / 2 && lastBolt.dir === 1, 'view parts: the keystone (block, two bands, the ring plate; three slabs broken), 4 iris bolts, the one over the S8 landing (NE) last');
  const THREE = await import('three');
  const root = new THREE.Group();
  const view = new SealView(L, new THREE.MeshStandardMaterial(), new THREE.BoxGeometry(1, 1, 1), root, new THREE.MeshBasicMaterial());
  const { O, T, p } = rig();
  O.markDoneThrough(6);
  view.update(1 / 72, O, new THREE.Vector3(0, -415, 0), 30);
  const bolts0 = view.stats.drawn;
  p.reset(0, -400, 0);
  steps(O, p, T, null, 11.3); // a stage: one bolt withdraws
  for (let k = 0; k < 72; k++) view.update(1 / 72, O, new THREE.Vector3(0, -415, 0), 30);
  const j = view.fixtures.indexOf(view.fixtures.find((f) => f.kind === 'survive'));
  ok(root.children.length === 2 && bolts0 > 0 && Math.abs(view._fxState[j].k - 1) < 1e-6 && FIX.boltSlide > 0, `SealView: still one bar mesh (+ the lamp flames), the iris bolts drawn (${bolts0} boxes in view), a stage slides one back`);
}

console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exitCode = fails ? 1 : 0;
