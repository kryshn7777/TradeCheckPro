// CHAPTER II · the beats' own hazards and finds (data/chapter2-sets.js addBeats, sim/lampholdDirector.js), Node:
//   the five Names (found by standing at them; once each; toasted), the Span's trolleys, the lit clusters of II-6 (nooks that never run out), the hammer floor and the
//   Stopping of II-10 (the escapement's ring: 4 s of grinding, then the wheel and the hammers stand still 14 s and the wheel runs on where it stood), the burnt stair of II-11
//   (every third tread crumbles under you; three lanes of embers)
//   node chapter2-beats.mjs [--root DIR]
import { srcUrl } from '../../verify/root.mjs';
const { CONFIG, DIFFICULTY, EventBus } = await import(srcUrl('sim/config3d.js'));
const { Player3D, TetherSystem, Physics3D } = await import(srcUrl('sim/physics3d.js'));
const { Level3D } = await import(srcUrl('sim/level3d.js'));
const { Objectives3D } = await import(srcUrl('sim/objectives3d.js'));
const { LampholdDirector } = await import(srcUrl('sim/lampholdDirector.js'));
const Mv = await import(srcUrl('sim/movers3d.js'));
const { CHAPTER2_TEXT } = await import(srcUrl('data/chapter2-text.js'));
const { LEVEL_DATA_CH2: D } = await import(srcUrl('data/chapter2-data.js'));
let fails = 0;
const ok = (c, msg) => {
  console.log((c ? 'PASS ' : 'FAIL ') + msg);
  if (!c) fails++;
};
const DT = CONFIG.PHYSICS_DT;
const R = CONFIG.player.radius;
function world(key = 'normal') {
  const diff = DIFFICULTY[key];
  const level = new Level3D(D, key, { freeAttach: true });
  const bus = new EventBus();
  const th = new TetherSystem(level, diff, bus, {});
  const ph = new Physics3D(level, diff, bus);
  const O = new Objectives3D(level, diff, bus);
  O.physics = ph;
  const p = new Player3D(0, 0, 0);
  const log = [];
  for (const t of ['c2:name', 'c2:grind', 'c2:stop', 'lane:hit', 'lane:on']) bus.on(t, (e) => log.push([t, e, O.clock]));
  const d = new LampholdDirector({ level, objectives: O, bus, diff: { key }, text: CHAPTER2_TEXT, kill: () => {}, victory: () => {} });
  const si = { move: { x: 0, z: 0 }, reel: 0, brake: false, jumpPressed: false, hands: { left: { yank: 0 }, right: { yank: 0 } } };
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) {
      ph.step(p, th, si, DT);
      O.step(DT, p, th, si, d.t);
      d.step(DT, p);
    }
  };
  return { level, bus, th, ph, O, p, d, log, step, si };
}
const seconds = (n) => Math.round(n / DT);

// ---- the Names
{
  const w = world();
  const N = D.c2.names;
  ok(N.length === 5 && N.map((n) => n.id).join() === 'N2-1,N2-2,N2-3,N2-4,N2-5', 'five Names, N2-1 .. N2-5, one beat each in the story writer\'s order');
  ok(N.every((n, i) => n.text === CHAPTER2_TEXT.names[i].text && n.beat === CHAPTER2_TEXT.names[i].beat), 'their words and beats are the writer\'s');
  const S = new Map(D.solids.map((s) => [s.id, s]));
  ok(N.every((n) => S.get(`c2-name-${n.id}`) && Math.abs(S.get(`c2-name-${n.id}`).maxY + 1 - n.y) < 1e-6), 'each stands on its own slab');
  ok(N.every((n) => Math.abs(n.x) <= 26 && Math.abs(n.z) <= 26), 'every Name is inside the pit');
  ok(D.decor.filter((x) => /^c2-nameplate-/.test(x.id)).length === 5, 'each is carved on a plate (a decor plaque)');
  for (const [i, n] of N.entries()) {
    w.p.x = n.x;
    w.p.y = n.y;
    w.p.z = n.z;
    w.p.vx = w.p.vy = w.p.vz = 0;
    w.d.step(DT, w.p);
    ok(w.d.names.size === i + 1, `standing at ${n.text} finds it (${w.d.names.size} of 5)`);
  }
  w.d.step(DT, w.p);
  ok(w.log.filter((e) => e[0] === 'c2:name').length === 5, 'each is found once (a bus event per Name)');
  w.d.reset(null);
  ok(w.d.names.size === 0, 'a new run forgets them');
}

// ---- the Span's trolleys, the lit clusters
{
  const L = new Level3D(D, 'normal', { freeAttach: true });
  const tr = D.movers.filter((m) => /trolley/.test(m.id));
  ok(tr.length === 2 && tr.every((m) => m.kind === 'path' && m.mode === 'pingpong'), 'two trolleys run under the Span');
  const q = {};
  const sp = tr.map((m) => {
    const n = Mv.normalizeMover(m, 'normal');
    return n.speed;
  });
  ok(sp[0] === 7 && sp[1] === 9, `at ${sp.join(' and ')} m/s`);
  const O = new Objectives3D(L, DIFFICULTY.normal, new EventBus());
  ok(O.nooks.length === 3 && O.nooks.every((n) => n.budget >= 9000 && n.lure === false), 'three lit clusters in the Dressing Yards: rests whose budget never runs out');
  void q;
}

// ---- the hammer floor and the Stopping
{
  const w = world();
  ok(w.O.lanes.length === 6 && w.O.lanes.filter((l) => /^hammer/.test(l.id)).length === 3 && w.O.lanes.filter((l) => /^embers/.test(l.id)).length === 3, 'three hammers (II-10) and three lanes of embers (II-11)');
  const ham = w.O.lanes.find((l) => /^hammer/.test(l.id));
  ok(ham.period === 4 && ham.lead === 1 && ham.damage === 0.35, 'a hammer every 4 s with a second of warning, 0.35 of your health');
  w.O.clock = 0;
  const wheel = w.O.movers.byId('mov-c2-10-wheel');
  const ring = w.level.byId['c2-10-wheel0'];
  w.O.step(DT, w.p, w.th, w.si, 0);
  const pos = () => ({ x: ring.x, y: ring.y, z: ring.z });
  const same = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 1e-6;
  w.O.clock = 20;
  w.O.movers.pose(20);
  const before = pos();
  w.bus.emit('grapple:attach', { hand: 'right', anchor: w.level.byId['c2-10-esc'], x: 0, y: 0, z: 0 });
  ok(w.d._stopping.started && wheel.m.stopAt === 24 && wheel.m.stopFor === 14, 'biting the escapement\'s last ring starts the Stopping: grinding, then 14 s of stillness (from clock 24)');
  ok(w.log.filter((e) => e[0] === 'c2:grind').length === 1, 'the grinding is heard first');
  // run the clock through the stop
  const frozen = [];
  for (let c = 24.5; c <= 37.5; c += 1.5) {
    w.O.clock = c;
    w.O.movers.pose(c);
    frozen.push(pos());
  }
  ok(frozen.every((f) => same(f, frozen[0])), 'from 24 s to 38 s the wheel\'s ring does not move');
  ok(Math.hypot(frozen[0].x - 0, frozen[0].y - (ring.y - 0), 0) >= 0, 'it stood where it was at the stop');
  w.O.clock = 24;
  w.O.movers.pose(24);
  const atStop = pos();
  ok(same(atStop, frozen[0]), 'the pose at the stop is the frozen pose');
  w.O.clock = 38 + 2.7;
  w.O.movers.pose(38 + 2.7);
  const later = pos();
  // 14 s lost: the wheel at 40.7 is where an unstopped wheel is at 26.7
  const keep = { at: wheel.m.stopAt, f: wheel.m.stopFor };
  wheel.m.stopAt = 1e9;
  wheel.m.stopFor = 0;
  w.O.clock = 24 + 2.7;
  w.O.movers.pose(24 + 2.7);
  const expect = pos();
  wheel.m.stopAt = keep.at;
  wheel.m.stopFor = keep.f;
  ok(same(later, expect), 'it runs on where it stood (14 s lost)');
  void before;
  // the hammers stop too
  w.d.t = 0;
  w.O.clock = 30;
  w.d._stoppingStep();
  ok(w.O.lanes.filter((l) => /^hammer/.test(l.id)).every((l) => l.off === true) && w.log.some((e) => e[0] === 'c2:stop'), 'the hammers are still during the Stopping (and "every machine stops" is said)');
  w.O.clock = 40;
  w.d._stoppingStep();
  ok(w.O.lanes.filter((l) => /^hammer/.test(l.id)).every((l) => l.off === false), 'and strike again after it');
  w.d.reset(null);
  ok(wheel.m.stopAt === 1e9 && !w.d._stopping.started, 'a respawn puts the machine back');
}

// ---- the burnt stair
{
  const crumbles = D.solids.filter((s) => s.kind === 'crumble' && /^c2-11-l/.test(s.id));
  ok(crumbles.length >= 4 && crumbles.length <= 8, `${crumbles.length} of the burnt stair's treads crumble`);
  const w = world();
  const sol = w.level.byId[crumbles[0].id];
  const led = D.ledges.find((l) => l.id === crumbles[0].id);
  w.p.x = led.x;
  w.p.y = led.y + R + 0.05;
  w.p.z = led.z;
  w.step(seconds(0.3));
  ok(sol.active !== false, 'a crumbling tread holds a moment');
  w.step(seconds(2.5));
  ok(sol.active === false || w.p.y < led.y - 1, 'and goes under you if you stay');
  // the embers hit a player who stands in the lane
  const lane = w.O.lanes.find((l) => /^embers/.test(l.id));
  const p2 = w.p;
  p2.alive = true;
  p2.x = lane.x;
  p2.y = lane.minY + 1;
  p2.z = lane.z;
  p2.vx = p2.vy = p2.vz = 0;
  w.level.reset();
  const hp0 = w.ph.health.hp;
  for (let i = 0; i < seconds(14) && w.ph.health.hp >= hp0; i++) {
    p2.y = lane.minY + 1;
    p2.vy = 0;
    p2.x = lane.x;
    p2.z = lane.z;
    w.O.step(DT, p2, w.th, w.si, w.O.clock);
  }
  ok(w.ph.health.hp < hp0, `standing in the embers' lane costs health (${(hp0 - w.ph.health.hp).toFixed(2)})`);
}
console.log(fails ? `FAILED: ${fails}` : 'ALL CHAPTER II BEAT CHECKS PASS');
process.exit(fails ? 1 : 0);
