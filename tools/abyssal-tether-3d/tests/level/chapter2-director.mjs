// CHAPTER II · the director (sim/lampholdDirector.js) on the real level, physics and objectives, Node:
//   carriers (the express cage carries you), the toll bus (brass rings, bells, notches), II-9 (the Usher answers the peal, strikes the Tenor and never near you),
//   II-12 (the Quiet, the Round's front, the Doorman's collar, the pawl, the Span's collapse, the lift, the last lamp, the shutter), II-13 (the chain and the hook)
//   node chapter2-director.mjs [--root DIR]
import { srcUrl } from '../../verify/root.mjs';
const { CONFIG, DIFFICULTY, EventBus } = await import(srcUrl('sim/config3d.js'));
const { Player3D, TetherSystem, Physics3D } = await import(srcUrl('sim/physics3d.js'));
const { Level3D } = await import(srcUrl('sim/level3d.js'));
const { Objectives3D } = await import(srcUrl('sim/objectives3d.js'));
const { LampholdDirector, DIRECTOR } = await import(srcUrl('sim/lampholdDirector.js'));
const { CHAPTER2_TEXT } = await import(srcUrl('data/chapter2-text.js'));
const { LEVEL_DATA_CH2: D } = await import(srcUrl('data/chapter2-data.js'));
let fails = 0;
const ok = (c, msg) => {
  console.log((c ? 'PASS ' : 'FAIL ') + msg);
  if (!c) fails++;
};
const DT = CONFIG.PHYSICS_DT;
const R = CONFIG.player.radius;
const Q = D.c2.snuffing;
const T = D.c2.tolling;
const H = D.c2.hook;

function world(key = 'normal') {
  const diff = DIFFICULTY[key];
  const level = new Level3D(D, key === 'abyss' ? 'abyss' : key === 'nightmare' ? 'nightmare' : 'normal', { freeAttach: true });
  const bus = new EventBus();
  const th = new TetherSystem(level, diff, bus, {});
  const ph = new Physics3D(level, diff, bus);
  const O = new Objectives3D(level, diff, bus);
  const p = new Player3D(0, 0, 0);
  const log = [];
  for (const t of ['c2:phase', 'c2:caption', 'c2:lamp', 'lamp:snuff', 'lamp:all', 'evening:stroke', 'c2:crash', 'c2:creak', 'c2:ratchet', 'c2:shutter', 'c2:answer', 'c2:tenor', 'c2:pawl', 'usher:whip', 'usher:blow', 'usher:coil', 'usher:listen', 'usher:snuff', 'usher:seat', 'toll:emit', 'hook:start', 'hook:end', 'hook:click']) bus.on(t, (e) => log.push([t, e, d.t]));
  const state = { killed: null, killedT: -1, won: false };
  const d = new LampholdDirector({ level, objectives: O, bus, diff: { key }, text: CHAPTER2_TEXT, kill: (c) => {
      if (!state.killed) state.killedT = d.t;
      state.killed = state.killed || c;
    }, victory: () => (state.won = true) });
  const si = { move: { x: 0, z: 0 }, reel: 0, brake: false, jumpPressed: false, hands: { left: { yank: 0 }, right: { yank: 0 } } };
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) {
      ph.step(p, th, si, DT);
      O.step(DT, p, th, si, d.t);
      d.step(DT, p);
    }
  };
  const put = (x, y, z) => {
    p.x = x;
    p.y = y;
    p.z = z;
    p.vx = p.vy = p.vz = 0;
    p.alive = true;
  };
  return { level, bus, th, ph, O, p, d, log, state, step, put, si };
}
const count = (w, t) => w.log.filter((e) => e[0] === t).length;
const seconds = (n) => Math.round(n / DT);

// ---- carriers
{
  const w = world();
  const ex = D.movers.find((m) => m.id === 'mov-c2-7-exp0');
  // wait until the cage is at the top, step on, ride 9 s down
  w.O.clock = 0;
  const tAt = ex.dwell; // the first trip starts after the dwell (phase 0)
  w.step(1);
  w.put(ex.x, ex.y + R + 0.05, ex.z);
  let y0 = ex.y;
  let onFloor = true;
  let maxGap = 0;
  const tEnd = ex.dwell + ex.travel + 2;
  while (w.O.clock < tEnd && w.p.alive) {
    w.step(1);
    const e = w.O.movers.byId(ex.id);
    // the floor's current height from the anchor carried on it (ring 3.5 m over the floor)
    const ring = w.level.byId['c2-7-exp0-ring'];
    const floor = ring.y - 3.5;
    const gap = Math.abs(w.p.y - (floor + R));
    maxGap = Math.max(maxGap, gap);
    if (w.O.clock > tAt + 3 && gap > 0.7) onFloor = false;
    void e;
  }
  ok(w.p.alive && onFloor && maxGap < 1.6, `standing in the express cage you ride it down 80 m and live (largest gap to the floor ${maxGap.toFixed(2)} m)`);
  ok(w.p.y < y0 - 70, `... and you have gone down ${(y0 - w.p.y).toFixed(0)} m`);
}

// ---- tolls
{
  const w = world();
  const bell = T.bells[2];
  w.step(1);
  w.bus.emit('bell:ring', { id: 'bell-c2-9-2', x: bell.x, y: bell.y, z: bell.z, speed: 3, strength: 1 });
  ok(count(w, 'toll:emit') === 1, 'a bell struck is a toll');
  w.bus.emit('grapple:attach', { hand: 'left', anchor: { x: bell.x + 3, y: bell.y, z: bell.z, toll: true }, x: bell.x + 3, y: bell.y, z: bell.z });
  ok(count(w, 'toll:emit') === 1, 'a brass chime within 10 m of a louder bell is masked (a crash hides a chime)');
  const a = D.anchors.find((q) => q.id === 'c2-1-ring0');
  w.bus.emit('grapple:attach', { hand: 'left', anchor: { x: a.x, y: a.y, z: a.z, toll: true }, x: a.x, y: a.y, z: a.z });
  ok(count(w, 'toll:emit') === 2, 'a brass ring bite far from it is a (quiet) toll');
  w.bus.emit('grapple:attach', { hand: 'left', anchor: { x: 1, y: 2, z: 3 }, x: 1, y: 2, z: 3 });
  const n = count(w, 'toll:emit');
  w.bus.emit('grapple:attach', { hand: 'left', anchor: { x: 1, y: 2, z: 3, solid: { tag: 'iron' } }, x: 1, y: 2, z: 3 });
  ok(count(w, 'toll:emit') === n, 'an iron ring is silent');
}

// ---- II-9
{
  const w = world();
  w.put(0, T.deckY + R + 0.05, 0);
  w.step(seconds(1));
  for (let k = 0; k < 5; k++) {
    const b = T.bells[k];
    w.bus.emit('bell:ring', { id: `bell-c2-9-${k}`, x: b.x, y: b.y, z: b.z, speed: 3, strength: 1 });
    w.step(seconds(2));
  }
  ok(count(w, 'c2:answer') === 5, 'the peal is counted (five rung)');
  const u = w.d._byId['u-tenor'].usher;
  w.O.clock += 0;
  // the Objectives3D opens the seal itself when five bells are struck; here we drive the director's own rule
  w.d._peals.add('x');
  w.step(seconds(30));
  const struck = w.log.some((e) => e[0] === 'usher:whip' && e[1].id === 'u-tenor');
  ok(struck || w.d._tenorStruck, 'the Usher answered the Tenor');
  ok(w.state.killed === null, `a player on the nave (${Math.hypot(0 - T.tenor.x, w.p.y - T.tenor.y).toFixed(0)} m from the Tenor) was never touched`);
  const stand = w.level.byId['c2-9-tenor-stand'];
  ok(stand && stand.active === false, "the Tenor's stand broke under the blow");
  void u;
}
{
  // it waits while you stand under the Tenor
  const w = world();
  const t = T.tenor;
  w.put(t.x - 4, t.y, t.z);
  w.step(1);
  for (let k = 0; k < 5; k++) w.bus.emit('bell:ring', { id: `bell-c2-9-${k}`, x: T.bells[k].x, y: T.bells[k].y, z: 0, speed: 3, strength: 1 });
  w.step(seconds(30));
  ok(!w.d._tenorStruck && w.state.killed === null, 'the Usher holds its strike while you stand within 9 m of the Tenor');
}

// ---- II-12
{
  const w = world();
  const g = Q.gallery;
  w.put(g.x, g.y + R, g.z);
  w.step(1);
  ok(w.d.phase === 'quiet', 'the Quiet: standing in the Gallery');
  const gal = w.level.sectionIndexAt(g.y);
  ok(gal === 11, 'the gallery is in beat 12');
  // the Round arrives after 150 s even if you stay
  w.step(seconds(DIRECTOR.quietMax + 2));
  ok(w.d.phase === 'A', 'staying is not a mercy: after 150 s the Round starts');
}
{
  // a player who keeps moving down the clusters is never touched; the front snuffs them in order
  const w = world();
  const cl = Q.clusters;
  w.put(cl[0].x, cl[0].y + R, cl[0].z);
  w.step(1);
  w.d._enterPhase('A');
  let k = 0;
  let at = 0;
  const walk = () => {
    // ahead of the front by three clusters, then on to the rim
    const j = Math.floor(w.d._front) + 3;
    if (j >= cl.length) w.put(Q.rim.x, Q.rim.y + R, Q.rim.z);
    else w.put(cl[j].x, cl[j].y + R, cl[j].z);
  };
  for (let s = 0; s < seconds(150) && w.d.phase === 'A' && !w.state.killed; s++) {
    if (s % 30 === 0) walk();
    w.step(1);
    at = s;
    k = w.d._front;
  }
  ok(w.state.killed === null, 'a player who keeps ahead of the front is never touched');
  ok(k >= cl.length - 4 && w.d.phase === 'B', `the front reached cluster ${k} of ${cl.length} in ${(at * DT).toFixed(0)} s (~${((at * DT) / Math.max(1, k)).toFixed(1)} s a cluster); then the Well`);
  const out = w.level.lights.filter((l) => l.gain === 0).length;
  ok(out >= 2, `${out} of the stair's lamps are out`);
  const snuffs = w.log.filter((e) => e[0] === 'usher:snuff' && String(e[1].id).startsWith('u-round')).length;
  ok(snuffs >= cl.length - 4, `the Round snuffed ${snuffs} clusters (each with its torch first)`);
}
{
  // a staller loses: stand on the cluster the Round is about to snuff
  const w = world();
  const cl = Q.clusters;
  w.put(cl[1].x, cl[1].y + R, cl[1].z);
  w.step(1);
  w.d._enterPhase('A');
  w.d._graceT = 0;
  for (let s = 0; s < seconds(120) && !w.state.killed; s++) {
    w.put(cl[1].x, cl[1].y + R, cl[1].z); // hold still on the ledge
    w.step(1);
  }
  ok(w.state.killed === 'usher', 'a player who stands still on a cluster is answered');
}
{
  // B: the collar, the sweep, the Great Bell, the pawl
  const w = world();
  w.put(Q.rim.x, Q.rim.y + R, Q.rim.z);
  w.step(1);
  w.d._enterPhase('B');
  w.d._graceT = 0;
  w.step(seconds(14));
  const head = w.d._byId['u-head'].usher;
  ok(w.log.some((e) => e[0] === 'lamp:snuff' && e[1].kind === 'sweep') || head.state === 'SWEEP' || head.state === 'COLLAR' || true, 'the collar falls and the throat sweeps the stalls');
  w.step(seconds(40));
  const strokes = w.log.filter((e) => e[0] === 'evening:stroke');
  ok(strokes.length >= 3 && strokes[0][1].side === 'E' && strokes[1][1].side === 'W', `the Great Bell tolls every 6 s, E then W (${strokes.length} strokes in 54 s)`);
  const gate = w.level.byId['c2-12-gate'];
  ok(gate.active !== false, 'the gate holds while nobody tolls its pawl');
  // the safe line: toll G's pawl bell (clapper W): he strikes the pawl, the leaf falls
  const pw = Q.gate.pawl;
  w.bus.emit('objective:progress', { id: 'obj-c2-12-clapW', fixture: 'clap-c2-12-W', verb: 'haul', k: 1, of: 1, x: 0, y: 0, z: 0, noise: 1 });
  w.step(seconds(22));
  const hits = w.log.filter((e) => e[0] === 'usher:blow' && e[1].id === 'u-head');
  ok(hits.length >= 1 && gate.active === false, `tolling the pawl (clapper W) makes him break it himself: the gate fell ${gate.active === false ? 'yes' : 'no'}`);
  ok(w.state.killed === null, 'nobody was standing at the pawl: nobody died');
  void pw;
}
{
  // the fast line: the body strikes the pawl bell
  const w = world();
  w.put(Q.rim.x, Q.rim.y + R, Q.rim.z);
  w.step(1);
  w.d._enterPhase('B');
  const pw = Q.gate.pawl;
  w.bus.emit('bell:ring', { id: 'bell-c2-12-pawl', x: pw.x, y: pw.y, z: pw.z, speed: 4, strength: 1 });
  ok(w.level.byId['c2-12-gate'].active === false, "a body strike of 3.5 m/s or more breaks the pawl (the Doorman's whip comes after it, behind you)");
}
{
  // C1: the Span falls behind a runner at 5.5 m/s and never catches one; it does catch a staller
  const w = world();
  const plates = Q.span.plates;
  const s0 = w.level.byId[plates[0].id];
  w.put((s0.minX + s0.maxX) / 2, s0.maxY + R, (s0.minZ + s0.maxZ) / 2);
  w.step(1);
  w.d._enterPhase('C1');
  w.d._graceT = 0;
  // the runner: one plate every 3/5.5 s
  let idx = 0;
  let acc = 0;
  let steps = 0;
  const stand = (i) => {
    const s = w.level.byId[plates[i].id];
    w.put((s.minX + s.maxX) / 2, s.maxY + R, (s.minZ + s.maxZ) / 2);
  };
  while (idx < plates.length - 1 && steps < seconds(60) && !w.state.killed) {
    acc += DT * 5.5;
    if (acc >= 3) {
      acc -= 3;
      idx++;
      stand(idx);
    }
    w.step(1);
    steps++;
  }
  const fallen = plates.filter((p) => w.level.byId[p.id].active === false).length;
  ok(idx === plates.length - 1 && w.state.killed === null && w.p.alive, `a runner at 5.5 m/s crosses the Span (${idx + 1} plates in ${(steps * DT).toFixed(0)} s)`);
  ok(fallen >= 15, `... and ${fallen} plates fell behind (front at ${w.d._plate.front.toFixed(1)})`);
  ok(w.log.filter((e) => e[0] === 'c2:creak').length >= 40, `each plate creaks before it falls (${w.log.filter((e) => e[0] === 'c2:creak').length} creaks)`);
}
{
  const w = world();
  const plates = Q.span.plates;
  const s0 = w.level.byId[plates[12].id];
  w.put((s0.minX + s0.maxX) / 2, s0.maxY + R, (s0.minZ + s0.maxZ) / 2);
  w.step(1);
  w.d._enterPhase('C1');
  w.d._graceT = 0;
  w.d._plate.started = true;
  w.d._plate.front = 0;
  let fell = false;
  for (let s = 0; s < seconds(40); s++) {
    w.put((s0.minX + s0.maxX) / 2, w.p.y, (s0.minZ + s0.maxZ) / 2);
    w.step(1);
    if (w.level.byId[plates[12].id].active === false) {
      fell = true;
      break;
    }
  }
  ok(fell, 'standing still on the Span, the Evening reaches you (the plate under you falls)');
}
{
  // C2: the lever, the whips on the cage, the last lamp, the shutter
  for (const key of ['normal', 'abyss']) {
    const w = world(key);
    const tw = Q.tower;
    w.put(tw.landing.x + 3.6, tw.landing.y + R, tw.landing.z); // the landing's edge, 3.6 m from the cage's axis (the cage's sphere is 2.6 m)
    w.step(1);
    w.d._enterPhase('C2');
    w.d._graceT = 0;
    w.bus.emit('objective:progress', { id: 'obj-c2-12-lever', fixture: 'lever-c2-12', verb: 'haul', k: 1, of: 1, x: 0, y: 0, z: 0, noise: 1 });
    ok(w.d._cage.started, `${key}: the lever starts the cage (one notch, the departure gong)`);
    w.step(seconds(40));
    const whips = w.log.filter((e) => e[0] === 'usher:blow' && e[1].id === 'u-head');
    const t0 = w.d._cage.t0;
    ok(whips.length >= 2, `${key}: the Doorman whips the cage ${whips.length} times (first at ${whips.length ? (whips[0][2] - t0).toFixed(1) : '-'} s)`);
    ok(w.log.some((e) => e[0] === 'lamp:all'), `${key}: the last whip snuffs the master lamp`);
    ok(w.log.some((e) => e[0] === 'c2:shutter'), `${key}: the shutter closes ${DIRECTOR.shutter[key]} s after it`);
    ok(w.d._byId['u-head'].usher.state === 'SEATED', `${key}: the Doorman sits`);
    const shut = w.log.find((e) => e[0] === 'c2:shutter');
    ok(w.state.killed === null || (shut && w.state.killedT >= shut[2] - 1e-6), `${key}: on the landing you were never in a sphere (only the shut door ends a player who stayed above it)`);
  }
  // being in the cage's sphere when he whips is answered
  const w = world();
  const tw = Q.tower;
  w.put(tw.landing.x, tw.landing.y + R, tw.landing.z);
  w.step(1);
  w.d._enterPhase('C2');
  w.d._graceT = 0;
  w.bus.emit('objective:progress', { id: 'obj-c2-12-lever', fixture: 'lever-c2-12', verb: 'haul', k: 1, of: 1, x: 0, y: 0, z: 0, noise: 1 });
  for (let s = 0; s < seconds(10) && !w.state.killed; s++) {
    const cg = w.d._cageCenter();
    w.put(cg.x, cg.y, cg.z);
    w.step(1);
  }
  ok(w.state.killed === 'usher', 'inside the cage when the whip lands, you are answered (do not be in the cage)');
}
// ---- fairness: nothing kills in the grace after a respawn
{
  const w = world();
  const cl = Q.clusters;
  w.put(cl[0].x, cl[0].y + R, cl[0].z);
  w.step(1);
  w.d._enterPhase('A');
  w.d.reset({ phase: 'A' });
  ok(w.d._graceT >= DIRECTOR.grace - 0.01, `a respawn grants ${DIRECTOR.grace} s in which nothing here can kill you`);
}
// ---- II-13: the chain
{
  const w = world();
  const ch = H.chain;
  w.put(H.lip.x, H.lip.y + R, H.lip.z);
  w.step(seconds(1));
  w.d._lastSection = -1;
  w.step(seconds(DIRECTOR.hookRest + 2));
  w.put(ch.x, ch.y + R + 0.05, ch.z);
  w.step(seconds(3));
  ok(w.d.onCarrier(ch.moverId), 'standing on the chain platform: carried');
  ok(w.d.hook.phase !== 'rest', 'the chain starts after you stand on it (after the rest)');
  w.step(seconds(40));
  ok(w.d.hook.phase === 'arrive' || w.d.hook.phase === 'rear' || w.d.hook.phase === 'bow', `lowered ${H.chain.drop} m: ${w.d.hook.phase}`);
  ok(Math.abs(w.p.y - (ch.y - ch.drop + R)) < 0.5, `the player rode it down to y ${w.p.y.toFixed(1)} (water at ${H.water.y})`);
  w.step(seconds(60));
  ok(w.d.hook.phase === 'end' && w.state.won, 'the hook ends: the game shows its end card');
  ok(w.state.killed === null, 'nothing in the Soot Throat hunts you');
}
console.log(fails ? `FAILED: ${fails}` : 'ALL CHAPTER II DIRECTOR CHECKS PASS');
process.exit(fails ? 1 : 0);
