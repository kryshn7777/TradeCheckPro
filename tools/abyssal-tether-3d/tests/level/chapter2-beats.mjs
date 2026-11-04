// CHAPTER II · the beats' own hazards and finds (data/chapter2-sets.js addBeats, sim/lampholdDirector.js), Node:
//   the five Names (found by standing at them; once each; toasted; two behind knock doors) and the Span's trolleys. Layout 2 (500 m) dropped the lit clusters, the
//   hammer floor and the Stopping, the burnt stair and the Dresser with their beats; this test says they are gone.
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
  ok(N[0].needs === 'door-c2-2-0' && N[1].needs === 'door-c2-2-1' && N.slice(2).every((n) => !n.needs), 'the first two Names are behind doors (KNOCK, AND BE KNOWN)');
  // a Name behind a door is not found before the door is knocked; the knock is not a toll
  w.p.x = N[0].x;
  w.p.y = N[0].y;
  w.p.z = N[0].z;
  w.d.step(DT, w.p);
  ok(w.d.names.size === 0, 'standing at a Name whose door is shut finds nothing');
  const tolls0 = w.log.length;
  w.bus.emit('objective:progress', { id: 'obj-door-c2-2-0', fixture: 'door-c2-2-0', verb: 'hook', k: 1, of: 1, x: 0, y: 0, z: 0, noise: 0 });
  ok(w.d.knocked.has('door-c2-2-0') && w.d.tollBus._n === 0, 'hooking the knocker knocks (and the Usher hears nothing: knocks are for the dead)');
  void tolls0;
  w.bus.emit('objective:progress', { id: 'obj-door-c2-2-1', fixture: 'door-c2-2-1', verb: 'hook', k: 1, of: 1, x: 0, y: 0, z: 0, noise: 0 });
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

// ---- the Span's trolleys; the cut beats' machines are not in this layout
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
  ok(O.nooks.length === 0 && O.lanes.length === 0 && !D.c2.stopping, 'layout 2 has no lit clusters, lanes, hammers or Stopping: those beats are cut (CHAPTER2_CUT keeps their words)');
  ok(!D.sections.some((x) => x.creature && x.creature.dresser) && D.sections.every((x) => x.creature.mode === 'dormant'), 'no creature is hunting in this layout: every beat is dormant (the Usher is the chapter\'s only presence)');
  void q;
}

console.log(fails ? `FAILED: ${fails}` : 'ALL CHAPTER II BEAT CHECKS PASS');
process.exit(fails ? 1 : 0);
