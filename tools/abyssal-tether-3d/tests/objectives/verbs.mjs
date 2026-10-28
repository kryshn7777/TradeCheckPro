// LEVEL_FUN_PLAN P3 "first verbs" (sim/objectives3d.js) on the real level (Node): the S1 bell, the S2 counterweight haul and
// the S4 lamps as the objectives that open their seals (the other sections keep the route ring), each verb's state machine
// (thresholds per difficulty, the bell's bounce and cooldown, haul notches and their slip, the reel-free haul ring, the lamp
// probe, its lantern cost and the never-block rule), the ratchet through a death / respawn, a Continue (serialize / load, the
// save's cleaning) and the Sandbox warp, a new run clearing it, determinism of the bot routes with the verbs (re-run and
// an input-log replay with the lantern probe), the noises the Mason hears, the fallback probe (no creature / creature live /
// empty lantern), the captions, the lamp light multiplier and the view parts.
//   node verbs.mjs [--root DIR]   (PASS/FAIL per check, exit 1 on a failure)
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
const { Objectives3D, BELL_E, BELL_GAP, VERB_NOISE } = await import(srcUrl('sim/objectives3d.js'));
const { Inventory3D } = await import(srcUrl('sim/inventory3d.js'));
const { migrateProfile } = await import(srcUrl('meta/save.js'));
const { captionForEvent, RULES } = await import(srcUrl('ui/captions.js'));
const { Sim, loadCreatureModules } = await import('../../verify/sim.mjs');
const { Bot } = await import('../../verify/bot.mjs');
const { verbProbe } = await import('../../verify/seals.mjs');
const R = await import('../../verify/routes.mjs');

let fails = 0;
const ok = (c, msg) => {
  console.log((c ? 'PASS ' : 'FAIL ') + msg);
  if (!c) fails++;
};
const VARIANTS = ['normal', 'nightmare', 'abyss'];
const DT = CONFIG.PHYSICS_DT;
const EVENTS = ['objective:progress', 'objective:done', 'seal:open', 'bell:ring'];

function rig(v = 'normal', key) {
  const L = new Level3D(undefined, v);
  const bus = new EventBus();
  const ev = [];
  for (const t of EVENTS) bus.on(t, (e) => ev.push([t, e.fixture || e.id, e.k, e.noise || e.strength || 0]));
  const O = new Objectives3D(L, DIFFICULTY[key || v], bus);
  const T = new TetherSystem(L, DIFFICULTY[key || v], bus, {});
  const ph = new Physics3D(L, DIFFICULTY[key || v], bus);
  const p = new Player3D(0, 0, 0);
  return { L, bus, ev, O, T, ph, p };
}
const fx = (O, id) => O.fixtures[O.fixtureIndex(id)];
const intent = (yank = 0, reel = 0, hand = 'right') => ({ move: { x: 0, z: 0 }, reel, hands: { left: { yank: hand === 'left' ? yank : 0 }, right: { yank: hand === 'right' ? yank : 0 } } });
/** Steps the objectives `n` fixed steps (no physics). */
const run = (O, p, T, it, s, t0 = 0) => {
  for (let i = 0; i < Math.round(s / DT); i++) O.step(DT, p, T, it, t0 + i * DT);
};

// 1. The data: S1 bell, S2 haul, S4 three lamps; the other sections keep the hook; the knobs per difficulty (Sandbox = Normal).
{
  const want = { normal: [2.5, 1.5, 0.06], nightmare: [3, 1.8, 0.08], abyss: [3.5, 2.2, 0.1], sandbox: [2.5, 1.5, 0.06] };
  let good = true;
  const rows = [];
  for (const k of Object.keys(want)) {
    const v = k === 'sandbox' ? 'normal' : k;
    const { O } = rig(v, k);
    const verbs = O.objectives.map((o) => `${o.id.slice(4)}:${o.verb}/${o.need}`).join(' ');
    const got = [fx(O, 'bell-s1').minSpeed, fx(O, 'cw-s2').time, fx(O, 'lamp-s4a').charge];
    rows.push(`${k} ${got.join('/')}`);
    if (verbs !== 's1:bell/1 s2:haul/1 s3:hook/1 s4:lamp/3 s5:hook/1 s6:hook/1 s7:hook/1' || got.join() !== want[k].join()) good = false;
    if (fx(O, 'cw-s2').notches !== 4 || fx(O, 'cw-s2').anchor.haul !== true || fx(O, 'lamp-s4c').time !== 1.5) good = false;
  }
  ok(good, `objectives S1 bell, S2 haul, S4 lamps (need 3), the rest hook; minSpeed / haul time / lamp charge ${rows.join(' | ')}`);
}

// 2. The bell: solid (a slow touch bounces, no toll), a strike at minSpeed tolls once (cooldown), completes S1 alone, keeps
//    tolling after; restitution BELL_E; Nightmare needs 3 m/s.
{
  const { ev, O, T, p } = rig();
  const b = fx(O, 'bell-s1');
  const reach = b.r + p.radius;
  p.reset(b.x + reach - 0.05, b.y, b.z);
  p.vx = -2;
  O.step(DT, p, T, null, 0);
  const out = Math.abs(Math.hypot(p.x - b.x, p.y - b.y, p.z - b.z) - reach) < 1e-6;
  ok(out && Math.abs(p.vx - 2 * BELL_E) < 1e-9 && ev.length === 0 && !O.isOpen('seal-s1'), `a slow touch (2 m/s) bounces off (pushed out, v ${p.vx.toFixed(2)} = ${BELL_E} x 2 back), no toll`);
  p.reset(b.x + reach - 0.05, b.y, b.z);
  p.vx = -4;
  O.step(DT, p, T, null, 1);
  const types = ev.map((e) => e[0]).join(' ');
  ok(types === 'bell:ring objective:progress objective:done seal:open' && O.isOpen('seal-s1') && openIdsOf(O) === 'seal-s1' && ev[0][3] === VERB_NOISE, `a 4 m/s strike tolls (noise ${ev[0][3]}) and opens seal-s1 alone: ${types}`);
  p.reset(b.x + reach - 0.05, b.y, b.z);
  p.vx = -4;
  O.step(DT, p, T, null, 1.1);
  const n1 = ev.length;
  run(O, p, T, null, BELL_GAP + 0.05, 1.2);
  p.reset(b.x + reach - 0.05, b.y, b.z);
  p.vx = -4;
  O.step(DT, p, T, null, 2);
  ok(n1 === 4 && ev.length === 5 && ev[4][0] === 'bell:ring', `no second toll within ${BELL_GAP} s; after it the bell tolls again (no objective event: done once)`);
  const n = rig('nightmare');
  const nb = fx(n.O, 'bell-s1');
  n.p.reset(nb.x + nb.r + n.p.radius - 0.05, nb.y, nb.z);
  n.p.vx = -2.8;
  n.O.step(DT, n.p, n.T, null, 0);
  ok(!n.O.isOpen('seal-s1') && n.ev.length === 0, 'Nightmare: a 2.8 m/s strike is under minSpeed 3: no toll');
}
function openIdsOf(O) {
  return O.seals.filter((s) => O.sealOpen[s.index]).map((s) => s.id).join(',');
}

// 3. The haul: hooked on the counterweight ring, the grip (or the reel) hauls 4 loud notches; letting go slips to the last
//    notch; done at 1.5 s of hauling; the ring never reels the player in (comfort), letting rope out still works.
{
  const { L, ev, O, T, p } = rig();
  const cw = L.byId['s2-cw'];
  p.reset(-28, -24.62, -5);
  T.attach(p, 'right', cw);
  run(O, p, T, intent(1), 0.4);
  ok(O.fxN[O.fixtureIndex('cw-s2')] === 1 && ev.length === 1 && ev[0][0] === 'objective:progress' && ev[0][3] === VERB_NOISE && Math.abs(O.progressOf('obj-s2') - 0.25) < 1e-9, `0.4 s of grip: notch 1 of 4 (loud: ${ev[0][3]}), progress 0.25`);
  run(O, p, T, intent(1), 0.2);
  const mid = O.fxT[O.fixtureIndex('cw-s2')];
  run(O, p, T, intent(0), DT * 2);
  const slipped = O.fxT[O.fixtureIndex('cw-s2')];
  ok(mid > 0.5 && Math.abs(slipped - 0.375) < 1e-6 && O.fxN[O.fixtureIndex('cw-s2')] === 1, `let go between notches: slips back to notch 1 (${mid.toFixed(3)} -> ${slipped.toFixed(3)} s)`);
  run(O, p, T, intent(0, 1), 1.2); // the reel-in hauls too
  ok(O.isOpen('seal-s2') && ev.filter((e) => e[0] === 'objective:progress').length === 4 && ev.some((e) => e[0] === 'seal:open'), 'reeling in hauls as well: 4 notches, seal-s2 opens');
  // physics: a body hanging from the haul ring keeps its place under yank / reel-in; a plain ring reels it up
  const hang = (anchor, yank, reel) => {
    const r = rig();
    const a = r.L.byId[anchor];
    r.p.reset(a.x, a.y - 6, a.z);
    r.T.attach(r.p, 'right', a);
    const it = intent(yank, reel);
    for (let i = 0; i < 240; i++) r.ph.step(r.p, r.T, it, DT);
    const st = r.T.hands.right.rope;
    return { y: r.p.y, len: st.length };
  };
  const still = hang('s2-cw', 1, 0);
  const reelIn = hang('s2-cw', 0, 1);
  const plain = hang('s2-hook', 1, 0);
  const out = hang('s2-cw', 0, -1);
  ok(Math.abs(still.len - 6) < 0.05 && Math.abs(reelIn.len - 6) < 0.05 && plain.len < 4 && out.len > 6.5, `the haul ring never reels you in (rope ${still.len.toFixed(2)} / ${reelIn.len.toFixed(2)} m under grip / reel; a plain ring: ${plain.len.toFixed(2)} m), letting out works (${out.len.toFixed(2)} m)`);
}

// 4. The lamps: the probe within r of the wick for 1.5 s lights it and spends the charge; out of reach / probe off resets;
//    three lamps open seal-s4 (progress 1/3, 2/3); an empty lantern still lights, in twice the time, and stays at 0.
{
  const { ev, O, T, p, bus } = rig();
  const bag = new Inventory3D(bus);
  bag.reset();
  O.lantern = bag;
  const a = fx(O, 'lamp-s4a');
  O.setProbe(a.x + a.r + 0.05, a.y, a.z, true);
  run(O, p, T, null, 2);
  const far = O.fixtureDone(O.fixtureIndex('lamp-s4a'));
  O.setProbe(a.x + 0.3, a.y, a.z, true);
  run(O, p, T, null, 1.0);
  O.setProbe(0, 0, 0, false);
  O.step(DT, p, T, null, 0);
  O.setProbe(a.x + 0.3, a.y, a.z, true);
  run(O, p, T, null, 1.0);
  const reset = O.fixtureDone(O.fixtureIndex('lamp-s4a'));
  run(O, p, T, null, 0.55);
  ok(!far && !reset && O.fixtureDone(O.fixtureIndex('lamp-s4a')) && Math.abs(bag.lanternCharge - 0.94) < 1e-9 && Math.abs(O.progressOf('obj-s4') - 1 / 3) < 1e-9, `a lamp: out of reach nothing, 1.0 s then away restarts, 1.5 s held lights it (charge 1 -> ${bag.lanternCharge.toFixed(2)}, progress 1/3)`);
  bag.lanternCharge = 0.03;
  const b = fx(O, 'lamp-s4b');
  O.setProbe(b.x, b.y, b.z, true);
  run(O, p, T, null, 1.6);
  const notYet = O.fixtureDone(O.fixtureIndex('lamp-s4b'));
  run(O, p, T, null, 1.45);
  ok(!notYet && O.fixtureDone(O.fixtureIndex('lamp-s4b')) && bag.lanternCharge === 0 && bag.lanternFactor > 0, `less charge than the lamp costs: twice as long (3 s), the lantern empties (${bag.lanternCharge}) and stays lit (factor ${bag.lanternFactor.toFixed(2)})`);
  const c = fx(O, 'lamp-s4c');
  O.setProbe(c.x, c.y, c.z, true);
  run(O, p, T, null, 3.05);
  const lit = ev.filter((e) => e[0] === 'objective:progress').map((e) => e[2]).join(',');
  ok(O.isOpen('seal-s4') && lit === '1,2,3' && !O.wantsProbe && bag.lanternCharge === 0, `an empty lantern never blocks: the third lamp lights, seal-s4 opens (lamps ${lit}); no lamp left to probe`);
}

// 5. The ratchet: a death (level.reset + reapply) keeps lamps and notches, a Continue restores them (serialize -> the save
//    -> load), a new run (Abyss restart) clears them; the Sandbox warp opens the seals above, silently.
{
  const { L, O, T, p } = rig('nightmare');
  const cw = L.byId['s2-cw'];
  T.attach(p, 'right', cw);
  run(O, p, T, intent(1), 0.95); // nightmare: 1.8 s, 4 notches of 0.45 s -> 2 notches
  const a = fx(O, 'lamp-s4a');
  O.setProbe(a.x, a.y, a.z, true);
  run(O, p, T, null, 1.55);
  O.setProbe(0, 0, 0, false);
  L.reset(); // game.respawn()
  O.reapply();
  const iH = O.fixtureIndex('cw-s2');
  const kept = O.fxN[iH] === 2 && Math.abs(O.fxT[iH] - 0.9) < 1e-6 && O.fixtureDone(O.fixtureIndex('lamp-s4a'));
  const saved = O.serialize();
  ok(kept && JSON.stringify(saved) === '["cw-s2#2","lamp-s4a"]', `a death keeps 2 haul notches and the lit lamp; the save: ${JSON.stringify(saved)}`);
  const prof = migrateProfile({ schema: 3, run: { chapter: 'ch1', difficulty: 'nightmare', checkpoint: { x: 1, y: -20, z: 2, index: 1 }, objectives: ['obj-s1'].concat(saved) } }).profile;
  const b = rig('nightmare');
  const k = b.O.load(prof.run.objectives);
  const ib = b.O.fixtureIndex('cw-s2');
  ok(k === 3 && b.O.isDone('obj-s1') && b.O.fxN[ib] === 2 && b.O.fixtureDone(b.O.fixtureIndex('lamp-s4a')) && b.ev.length === 0 && Math.abs(b.O.progressOf('obj-s2') - 0.5) < 1e-9, 'Continue: the save keeps the ratchet strings; load() restores notches and the lit lamp, silently');
  b.T.attach(b.p, 'right', b.L.byId['s2-cw']);
  run(b.O, b.p, b.T, intent(1), 0.95);
  ok(b.O.isOpen('seal-s2'), 'after the Continue the haul goes on from notch 2 (two notches left)');
  b.O.load(['cw-s2#9', 'lamp-s4b', 'lamp-s4c']); // a full haul string, and two more lamps: S4 completes silently
  ok(b.O.isOpen('seal-s4') && b.ev.filter((e) => e[0] === 'seal:open').length === 1, 'load() completes an objective whose last fixture it restores, without events');
  O.reset();
  ok(O.serialize().length === 0 && O.fxN[iH] === 0 && !O.fixtureDone(O.fixtureIndex('lamp-s4a')) && O.wantsProbe, 'a new run (Abyss restart) clears the ratchet');
  let good = true;
  for (let i = 0; i <= 7; i++) {
    const r = rig();
    r.O.markDoneThrough(i);
    const want = r.O.seals.filter((s) => s.section < i).map((s) => s.id).join(',');
    if (openIdsOf(r.O) !== want || r.ev.length) good = false;
    if (i >= 4 && (r.O.wantsProbe || !r.O.fixtureDone(r.O.fixtureIndex('lamp-s4b')))) good = false; // warped past S4: its lamps show lit
  }
  ok(good, 'Sandbox warp: the seals of the sections above open silently, their verbs count as done (lamps lit)');
}

// 6. Determinism: S1 (bell) + S2 (haul) from the spawn and S4 (lamps) from its checkpoint, twice and as a replay of the
//    recorded input (lantern probe included): the same path and the same objective events on the same frames.
{
  const play = (key, start, route, record, replay) => {
    const L = new Level3D(undefined, 'normal');
    const sim = new Sim(L, 'normal', record ? { record: true } : {});
    sim.spawn(start.x, start.y, start.z);
    if (replay) sim.replay(replay.log, replay.logFrames);
    else new Bot(sim, route, {}).runRoute();
    return { sim, h: sim.hash.hex, o: sim.objHash, ev: JSON.stringify(sim.objEvents) };
  };
  const L = new Level3D(undefined, 'normal');
  const s12 = R.ROUTES.s1.concat(R.ROUTES.s2);
  const a = play('s12', L.spawn, s12, true);
  const b = play('s12', L.spawn, s12, false);
  const c = play('s12', L.spawn, null, false, a.sim);
  ok(a.h === b.h && a.h === c.h && a.o === b.o && a.o === c.o && a.ev.includes('obj-s1') && a.ev.includes('obj-s2') && a.ev.includes('bell'), `S1 bell + S2 haul: run = re-run = replay (hash ${a.h}, objective events ${a.o.toString(16)})`);
  const cp = L.sections[3].checkpoint;
  const d = play('s4', cp, R.ROUTES.s4, true);
  const e = play('s4', cp, null, false, d.sim);
  ok(d.h === e.h && d.o === e.o && d.ev.includes('obj-s4') && (d.ev.match(/progress:lamp/g) || []).length === 3, `S4 lamps: run = replay of the input log with the lantern probe (${(d.ev.match(/progress:lamp/g) || []).length} lamps)`);
}

// 7. The Mason hears the verbs: a bell toll and each haul notch reach Creature3D._onNoise('wall', VERB_NOISE).
{
  const { Creature3D } = await loadCreatureModules();
  const L = new Level3D(undefined, 'normal');
  const bus = new EventBus();
  const c = new Creature3D(L, DIFFICULTY.normal, bus, { seed: 7 });
  const heard = [];
  c._onNoise = (kind, v) => heard.push(`${kind}:${v}`);
  const O = new Objectives3D(L, DIFFICULTY.normal, bus);
  const T = new TetherSystem(L, DIFFICULTY.normal, bus, {});
  const p = new Player3D(0, 0, 0);
  const b = fx(O, 'bell-s1');
  p.reset(b.x + b.r + p.radius - 0.05, b.y, b.z);
  p.vx = -4;
  O.step(DT, p, T, null, 0);
  T.attach(p, 'right', L.byId['s2-cw']);
  run(O, p, T, intent(1), 1.6);
  const a = fx(O, 'lamp-s4a');
  O.setProbe(a.x, a.y, a.z, true);
  run(O, p, T, null, 1.6);
  ok(heard.length === 5 && heard.every((h) => h === `wall:${VERB_NOISE}`), `the Mason hears the toll and the 4 haul notches, not the lamp (${heard.join(' ')}; noiseWall <= 9 on every difficulty)`);
}

// 8. The fallback probe: each verb on its main line without the creature, with it live, and the lamps with an empty lantern.
{
  for (const v of VARIANTS) {
    const problems = [];
    const res = await verbProbe((x) => new Level3D(undefined, x), v, R, (m) => problems.push(m));
    const row = Object.entries(res).map(([id, o]) => `${id} ${o.plain.at}/${o.creature.at}${o.emptyLantern ? '/' + o.emptyLantern.at : ''}s`);
    ok(problems.length === 0 && Object.keys(res).join() === 'obj-s1,obj-s2,obj-s4' && res['obj-s4'].emptyLantern.at > res['obj-s4'].plain.at, `${v}: the verbs done by the bot with no creature, with it live, an empty lantern (${row.join(' | ')}) ${problems.join('; ')}`);
  }
}

// 9. Inventory3D.spend: never below 0, low / empty events once, the lantern never dark.
{
  const bus = new EventBus();
  const evs = [];
  bus.on('lantern:low', () => evs.push('low'));
  bus.on('lantern:empty', () => evs.push('empty'));
  const bag = new Inventory3D(bus);
  bag.reset();
  const s1 = bag.spend(0.5);
  const s2 = bag.spend(0.9);
  const s3 = bag.spend(0.1);
  ok(s1 === 0.5 && Math.abs(s2 - 0.5) < 1e-12 && s3 === 0 && bag.lanternCharge === 0 && evs.join() === 'low,empty' && bag.lanternFactor > 0, `spend(): 0.5 + 0.5 (asked 0.9) + 0, events ${evs.join(', ')}, light factor ${bag.lanternFactor}`);
}

// 10. Captions, the S4 lamp light multiplier, the view parts.
{
  const cap = [captionForEvent('bell:ring', { id: 'bell-s1' }), captionForEvent('objective:progress', { verb: 'haul' }), captionForEvent('objective:progress', { verb: 'lamp' }), captionForEvent('objective:progress', { verb: 'hook' })];
  ok(cap[0] === RULES.bell && cap[1] === RULES.ratchet && cap[2] === RULES.lampCatch && cap[3] === null, `captions: ${cap.map((c) => (c ? c.text : 'none')).join(' ')}`);
  const { Lighting } = await import(srcUrl('render/lighting.js'));
  const { O, T, p } = rig();
  const game = { objectives: O };
  const cold = Lighting.prototype._coldLamps.call(null, game, { ia: 3, ib: 3, w: 0 });
  const a = fx(O, 'lamp-s4a');
  O.setProbe(a.x, a.y, a.z, true);
  run(O, p, T, null, 1.55);
  const one = Lighting.prototype._coldLamps.call(null, game, { ia: 3, ib: 4, w: 0.5 });
  const other = Lighting.prototype._coldLamps.call(null, game, { ia: 1, ib: 1, w: 0 });
  O.markDoneThrough(4);
  const lit = Lighting.prototype._coldLamps.call(null, game, { ia: 3, ib: 3, w: 0 });
  ok(Math.abs(cold - 0.2) < 1e-9 && Math.abs(one - (1 - 0.5 * 0.8 * (2 / 3))) < 1e-9 && other === 1 && lit === 1, `the S4 baked lamp light: ${cold} cold, ${one.toFixed(3)} with 1 of 3 at a half S4 / S5 blend, ${other} elsewhere, ${lit} relit`);
  const THREE = await import('three');
  const { SealView, fixtureParts, counterweightBoxes, FIX } = await import(srcUrl('render/objectivesView.js'));
  const L = new Level3D(undefined, 'normal');
  const parts = fixtureParts(L);
  const cw = parts.find((f) => f.kind === 'haul');
  const low = counterweightBoxes(cw, 0)[0][1];
  const high = counterweightBoxes(cw, 4)[0][1];
  ok(parts.map((f) => f.kind).join() === 'bell,haul,lamp,lamp,lamp' && Math.abs(high - low - 4 * FIX.notchRise) < 1e-9 && high + 0.55 < cw.pulleyY, `view parts: bell, counterweight (rises ${(high - low).toFixed(1)} m over 4 notches, under its pulley at y ${cw.pulleyY.toFixed(1)}), 3 lamps`);
  const root = new THREE.Group();
  const view = new SealView(L, new THREE.MeshStandardMaterial(), new THREE.BoxGeometry(1, 1, 1), root, new THREE.MeshBasicMaterial({ vertexColors: true }));
  const r = rig();
  const head = new THREE.Vector3(-16, -103, -15);
  view.update(1 / 72, r.O, head, 30);
  const before = view.stats.flames;
  const b = fx(r.O, 'lamp-s4b');
  r.O.setProbe(b.x, b.y, b.z, true);
  run(r.O, r.p, r.T, null, 1.55);
  view.update(1 / 72, r.O, head, 30);
  const after = view.stats.flames;
  ok(root.children.length === 2 && before === 0 && after === 1 && view.glow.visible && view.glow.count === 1, `view: the bars' mesh + one flame mesh; a relit lamp shows a flame (${before} -> ${after}), cold lamps none`);
}

console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exitCode = fails ? 1 : 0;
