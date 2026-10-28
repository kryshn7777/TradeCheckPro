// LEVEL_FUN_PLAN P4 "machines" on the real level (Node): the movers (sim/movers3d.js: the S3 cage pendulum and the winch
// gear; dynamic anchors out of the Y index, the speed cap per difficulty, the reported velocity against the motion, the
// closed form against the run clock, snapshot / restore), the hook flying at a moving ring (it homes: attaches where the ring
// is on arrival), a ring in its housing (not targetable, a hook arriving falls off, a line on it is pulled off), the rope's
// pull relative to a moving anchor, the S3 winch's state machine (notches, slip, ratchet through a release / the housing /
// a save, done opens the seal, knobs per difficulty), a seal never opening under the feet over a deep drop, the rockfall
// lane (telegraph, drop, damage once per drop per difficulty, death when low, god mode, clear time, snapshot), the Sandbox
// warp, the lane probe (a bot that ignores the lane is struck, one that waits never is), captions and the view's parts.
//   node machines.mjs [--root DIR]   (PASS/FAIL per check, exit 1 on a failure)
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
const { Player3D, TetherSystem, Physics3D, Rope3D } = await import(srcUrl('sim/physics3d.js'));
const { Level3D } = await import(srcUrl('sim/level3d.js'));
const { Objectives3D } = await import(srcUrl('sim/objectives3d.js'));
const MV = await import(srcUrl('sim/movers3d.js'));
const { captionForEvent, statusForEvent } = await import(srcUrl('ui/captions.js'));
const { laneProbe } = await import('../../verify/machines.mjs');
const R = await import('../../verify/routes.mjs');

let fails = 0;
const ok = (c, msg) => {
  console.log((c ? 'PASS ' : 'FAIL ') + msg);
  if (!c) fails++;
};
const DT = CONFIG.PHYSICS_DT;
const EVENTS = ['objective:progress', 'objective:done', 'seal:open', 'lane:warn', 'lane:on', 'lane:off', 'lane:hit', 'grapple:attach', 'grapple:miss', 'grapple:release', 'player:death'];

function rig(v = 'normal', key) {
  const L = new Level3D(undefined, v);
  const bus = new EventBus();
  const ev = [];
  const O = new Objectives3D(L, DIFFICULTY[key || v], bus);
  for (const t of EVENTS) bus.on(t, (e) => ev.push([t, +O.clock.toFixed(3), e]));
  const T = new TetherSystem(L, DIFFICULTY[key || v], bus, {});
  const ph = new Physics3D(L, DIFFICULTY[key || v], bus);
  O.physics = ph;
  const p = new Player3D(0, 0, 0);
  return { L, bus, ev, O, T, ph, p };
}
const aimAt = (p, a) => {
  const dx = a.x - p.x;
  const dy = a.y - p.y;
  const dz = a.z - p.z;
  const l = Math.hypot(dx, dy, dz);
  return { ox: p.x, oy: p.y, oz: p.z, dx: dx / l, dy: dy / l, dz: dz / l };
};
/** Sets the run clock (the movers and lanes follow it). */
const at = (O, t) => {
  O.clock = t;
  O.reapply();
};

// 1. The movers in the level: the S3 cage and the winch gear carry their rings, which are dynamic (out of the Y index, still
//    found by anchorsNear), and the knobs per difficulty keep every carried ring at or under 1.5 m/s.
{
  const L = new Level3D(undefined, 'normal');
  const dyn = L.dynAnchors.map((a) => a.id).join();
  const cage = L.byId['s3-cage'];
  const inIndex = L._anchorIndex.items.indexOf(cage) >= 0;
  const near = L.anchorsNear(cage.x, cage.y, cage.z, 2, []).indexOf(cage) >= 0;
  ok(L.movers.length === 2 && dyn === 's3-cage,s3-winch' && !inIndex && near && cage.mount === 'mover', `2 movers carry ${dyn}: dynamic, kept out of the Y index, found by anchorsNear at their pose`);
  const want = { normal: [1.067, 0.838], nightmare: [1.185, 0.931], abyss: [1.333, 1.047], sandbox: [1.067, 0.838] };
  let good = true;
  const rows = [];
  for (const k of Object.keys(want)) {
    const lv = new Level3D(undefined, k === 'sandbox' ? 'normal' : k);
    const M = new MV.Movers3D(lv, DIFFICULTY[k]);
    const sp = M.list.map((e) => +MV.pointMaxSpeed(e.m, ...e.offs[0]).toFixed(3));
    rows.push(`${k} ${sp.join('/')}`);
    if (sp.join() !== want[k].join() || M.maxSpeed() > MV.MOVER_MAX_SPEED) good = false;
  }
  ok(good, `fastest carried ring per difficulty (cage / gear, m/s; period x 1 / 0.9 / 0.8, cap ${MV.MOVER_MAX_SPEED}): ${rows.join(' | ')}`);
}

// 2. The velocity a carried ring reports (what the rope uses) is the derivative of its pose: integrated at 240 Hz over a
//    whole cycle it lands on the closed-form pose within 1 mm; the pose is a pure function of the clock.
{
  const L = new Level3D(undefined, 'normal');
  const M = new MV.Movers3D(L, DIFFICULTY.normal);
  let worst = 0;
  const q = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, hidden: false };
  for (const e of M.list) {
    const o = e.offs[0];
    const n = Math.round(e.m.period / DT);
    MV.posePoint(e.m, o[0], o[1], o[2], 0, q);
    let x = q.x;
    let y = q.y;
    let z = q.z;
    let pvx = q.vx;
    let pvy = q.vy;
    let pvz = q.vz;
    for (let i = 1; i <= n; i++) {
      MV.posePoint(e.m, o[0], o[1], o[2], i * DT, q);
      x += ((pvx + q.vx) / 2) * DT;
      y += ((pvy + q.vy) / 2) * DT;
      z += ((pvz + q.vz) / 2) * DT;
      pvx = q.vx;
      pvy = q.vy;
      pvz = q.vz;
      worst = Math.max(worst, Math.hypot(x - q.x, y - q.y, z - q.z));
    }
  }
  ok(worst < 0.001, `integrated velocity vs closed-form pose over a cycle: worst ${(worst * 1000).toFixed(3)} mm (< 1 mm)`);
  // stepping the objectives 2400 fixed steps = the closed form at that clock; snapshot / restore rewinds the rings exactly
  const { O, T, p, L: L2 } = rig();
  p.reset(7, -65.6, 0);
  for (let i = 0; i < 2400; i++) O.step(DT, p, T, null, 0);
  const cage = L2.byId['s3-cage'];
  const e = O.movers.entryOf(cage);
  MV.posePoint(e.m, ...e.offs[0], O.clock, q);
  const exact = cage.x === q.x && cage.y === q.y && cage.z === q.z;
  const snap = O.snapshot();
  const before = [cage.x, cage.y, cage.z, L2.byId['s3-winch'].x, L2.byId['s3-winch'].hidden].join();
  for (let i = 0; i < 700; i++) O.step(DT, p, T, null, 0);
  const moved = [cage.x, cage.y, cage.z, L2.byId['s3-winch'].x, L2.byId['s3-winch'].hidden].join() !== before;
  O.restore(snap);
  const back = [cage.x, cage.y, cage.z, L2.byId['s3-winch'].x, L2.byId['s3-winch'].hidden].join() === before;
  ok(exact && moved && back && Math.abs(O.clock - 10) < 1e-9, 'stepped 10 s = the closed form at the clock (bit for bit); a look-ahead moves them, restore() puts them back');
  // exposedFor / hiddenFor agree with the pose
  const w = L2.byId['s3-winch'];
  at(O, 0.3);
  const ex = O.exposedFor(w);
  at(O, 0.3 + ex - 0.01);
  const still = !w.hidden;
  at(O, 0.3 + ex + 0.01);
  const gone = w.hidden;
  const hid = O.movers.hiddenFor(w, O.clock);
  at(O, 0.3 + ex + 0.01 + hid + 0.01);
  const back2 = !w.hidden && O.exposedFor(w) > 4;
  ok(still && gone && back2 && ex > 2 && ex < 2.4 && hid > 6.5 && hid < 7, `the winch ring: out ${ex.toFixed(2)} s more from t 0.3, then in the wall ${hid.toFixed(2)} s, then out again (44 % of a 12 s turn)`);
}

// 3. A hook fired at a moving ring homes on it: it attaches where the ring is on arrival (drift > 0, ≤ max speed x flight).
{
  const { ev, O, T, p, L } = rig();
  at(O, 0.5);
  p.reset(8, -76, 0); // under the landing, the cage ring 18 m away across the gallery (the body is not stepped: it stays put)
  const cage = L.byId['s3-cage'];
  const f = T.findTarget(p, aimAt(p, cage), 'right');
  const x0 = [cage.x, cage.y, cage.z];
  T.fire(p, 'right', aimAt(p, cage));
  const dur = T.hands.right.flightObj.dur;
  let att = null;
  for (let i = 0; i < 240 && !att; i++) {
    O.step(DT, p, T, null, 0);
    T.step(p, DT);
    att = ev.find((e) => e[0] === 'grapple:attach');
  }
  const a = att && att[2];
  const drift = a ? Math.hypot(a.x - x0[0], a.y - x0[1], a.z - x0[2]) : -1;
  const same = a && a.x === cage.x && a.y === cage.y && a.z === cage.z && T.hands.right.rope.anchor === cage;
  ok(f && f.anchor === cage && same && drift > 0.01 && drift <= MV.MOVER_MAX_SPEED * CONFIG.rope.flightMax + 1e-9, `hook flight ${dur.toFixed(2)} s at the cage ring: bites where it is on arrival (drift ${drift.toFixed(3)} m)`);
}

// 4. The winch ring in its housing: not targetable; a hook arriving after it slid in falls off; a line on it is pulled off.
{
  const { ev, O, T, p, L } = rig();
  const w = L.byId['s3-winch'];
  p.reset(-20, -88, 6); // over the grating, 18 m from the north wall
  at(O, 1);
  const visible = T.findTarget(p, aimAt(p, w), 'right');
  const leftOut = O.exposedFor(w);
  at(O, 1 + leftOut + 0.5);
  const hiddenT = T.findTarget(p, aimAt(p, w), 'right');
  ok(visible && visible.anchor === w && (!hiddenT || hiddenT.anchor !== w), 'targetable while out of the wall, never while in its housing');
  // fire just before it slides in: the flight (0.2 s) outlasts its time out
  at(O, 1 + leftOut - 0.05);
  T.fire(p, 'right', aimAt(p, w));
  for (let i = 0; i < 120 && T.hands.right.flying; i++) {
    O.step(DT, p, T, null, 0);
    T.step(p, DT);
  }
  const miss = ev.find((e) => e[0] === 'grapple:miss' && e[2].fell);
  ok(!!miss && !T.hands.right.rope.attached && !ev.some((e) => e[0] === 'grapple:attach'), 'a hook arriving after the ring slid in falls off (grapple:miss, fell)');
  // a line on it is pulled off as it turns in
  at(O, 1);
  T.attach(p, 'left', w);
  for (let i = 0; i < Math.round((leftOut + 0.1) / DT); i++) {
    O.step(DT, p, T, null, 0);
    T.step(p, DT);
  }
  const rel = ev.find((e) => e[0] === 'grapple:release' && e[2].reason === 'housing');
  ok(!!rel && !T.hands.left.rope.attached, `a line on it is pulled off as it turns into the wall (grapple:release 'housing' at clock ${rel ? rel[1] : '?'})`);
}

// 5. The rope pulls by the velocity RELATIVE to its anchor: a body moving with a moving anchor feels exactly what a still
//    body under a still anchor feels (E15); a static anchor gives the old numbers.
{
  const run = (anchorV, bodyV) => {
    const rope = new Rope3D('right');
    const an = { x: 0, y: 10, z: 0, vx: anchorV[0], vy: anchorV[1], vz: anchorV[2] };
    const p = new Player3D(0.3, 0, 0.2);
    p.vx = bodyV[0];
    p.vy = bodyV[1];
    p.vz = bodyV[2];
    rope.attach(an, 9.7, 40);
    rope.rampT = 1; // fully gripping
    rope.measure(p);
    rope.reel(p, 0, 0, DT, 40, true);
    rope.pull(p, DT);
    return [p.vx - bodyV[0], p.vy - bodyV[1], p.vz - bodyV[2], rope.tension];
  };
  const a = run([0, 0, 0], [0, -1, 0]);
  const b = run([1.2, 0.4, -0.5], [1.2, -0.6, -0.5]);
  const plainAnchor = (() => {
    const rope = new Rope3D('right');
    const p = new Player3D(0.3, 0, 0.2);
    p.vy = -1;
    rope.attach({ x: 0, y: 10, z: 0 }, 9.7, 40); // an anchor made by hand: no velocity fields
    rope.rampT = 1;
    rope.measure(p);
    rope.reel(p, 0, 0, DT, 40, true);
    rope.pull(p, DT);
    return [p.vx, p.vy + 1, p.vz, rope.tension];
  })();
  const same = a.every((v, i) => Math.abs(v - b[i]) < 1e-12) && a.every((v, i) => Math.abs(v - plainAnchor[i]) < 1e-12);
  ok(same && a[3] > 0, `same relative motion, same pull (tension ${a[3].toFixed(2)} / ${b[3].toFixed(2)} m/s², a hand-made anchor without velocity too)`);
}

// 6. The S3 winch: a line on the ring lets the gear wind 3 notches (0.3 s each on Normal); let go between notches it slips to
//    the last one; notches survive a release and a save; done opens the S3 seal; knobs per difficulty.
{
  const times = ['normal', 'nightmare', 'abyss', 'sandbox'].map((k) => {
    const { O } = rig(k === 'sandbox' ? 'normal' : k, k);
    const f = O.fixtures[O.fixtureIndex('winch-s3')];
    return `${k} ${f.time}/${f.notches}${f.anchor.haul ? ' HAUL' : ''}`;
  });
  ok(times.join(' | ') === 'normal 0.9/3 | nightmare 1.2/3 | abyss 1.5/3 | sandbox 0.9/3', `winch knobs (time / notches, no haul flag: the gear does the work): ${times.join(' | ')}`);
  const { ev, O, T, p, L } = rig();
  const w = L.byId['s3-winch'];
  p.reset(-29, -95.62, -8); // on the shelf
  at(O, 0);
  T.attach(p, 'right', w);
  for (let i = 0; i < Math.round(0.4 / DT); i++) O.step(DT, p, T, null, 0);
  const one = O.fxN[O.fixtureIndex('winch-s3')];
  T.release(p, 'right', 'input');
  for (let i = 0; i < Math.round(1 / DT); i++) O.step(DT, p, T, null, 0);
  const kept = O.fxN[O.fixtureIndex('winch-s3')];
  const saved = O.serialize();
  const part = O.progressOf('obj-s3');
  const b = rig();
  b.O.load(saved);
  const loaded = b.O.fxN[b.O.fixtureIndex('winch-s3')] === 1 && !b.O.isOpen('seal-s3');
  T.attach(p, 'right', w);
  for (let i = 0; i < Math.round(0.62 / DT); i++) O.step(DT, p, T, null, 0);
  const notes = ev.filter((e) => e[0] === 'objective:progress').map((e) => `${e[2].verb}:${e[2].k}/${e[2].of}`).join(' ');
  ok(one === 1 && kept === 1 && JSON.stringify(saved) === '["winch-s3#1"]' && Math.abs(part - 1 / 3) < 1e-9 && loaded, `one notch in 0.4 s, kept through a release (slip to the notch) and a save ('winch-s3#1', progress 1/3)`);
  ok(O.isDone('obj-s3') && O.isOpen('seal-s3') && w.sealKey === 0 && notes === 'winch:1/3 winch:2/3 winch:3/3' && ev.some((e) => e[0] === 'seal:open'), `the gear winds the last two notches: the S3 seal opens (${notes})`);
  // the housing pulls the line off between notches: the notches stay (Abyss: 0.5 s a notch)
  const c = rig('abyss');
  const wc = c.L.byId['s3-winch'];
  c.p.reset(-29, -95.62, -8);
  const out = (() => {
    at(c.O, 0);
    return c.O.exposedFor(wc);
  })();
  at(c.O, out - 0.7);
  c.T.attach(c.p, 'right', wc);
  for (let i = 0; i < Math.round(1.2 / DT); i++) {
    c.O.step(DT, c.p, c.T, null, 0);
    c.T.step(c.p, DT);
  }
  const fi = c.O.fixtureIndex('winch-s3');
  ok(!c.T.hands.right.rope.attached && c.O.fxN[fi] === 1 && !c.O.isOpen('seal-s3') && c.ev.some((e) => e[0] === 'grapple:release' && e[2].reason === 'housing'), `Abyss: hooked 0.7 s before the ring turns in: 1 notch, pulled off, the notch kept (fxN ${c.O.fxN[fi]})`);
}

// 7. A seal never opens under your feet over a deep drop: the winch done from the S3 grating (nothing within 3 m below there)
//    waits until the player is off it; over the Vault hall's landing (1.6 m below) it opens at once.
{
  for (const [x, z, deep] of [
    [-20, 5, true],
    [-2, 5, false],
  ]) {
    const { ev, O, T, ph, p, L } = rig();
    p.reset(x, -97.5, z);
    for (let i = 0; i < 60; i++) ph.step(p, T, {}, DT);
    const onGrate = p.grounded && p.groundSolid && p.groundSolid.seal === 'seal-s3';
    at(O, 0);
    T.attach(p, 'right', L.byId['s3-winch']);
    for (let i = 0; i < Math.round(1 / DT); i++) O.step(DT, p, T, null, 0);
    const done = O.isDone('obj-s3');
    const waits = ev.find((e) => e[0] === 'objective:done');
    const openNow = O.isOpen('seal-s3');
    if (deep) {
      // lifted off it (a rope, 3 m up): it opens
      p.y = -95;
      p.grounded = false;
      p.groundSolid = null;
      O.step(DT, p, T, null, 0);
      ok(onGrate && done && waits && waits[2].waits === true && !openNow && O.isOpen('seal-s3') && ev.filter((e) => e[0] === 'seal:open').length === 1, 'on the grating over a deep drop: done, the seal waits; lifted off it, it opens (once)');
    } else ok(onGrate && done && openNow && !waits[2].waits, 'on the grating over the landing (a 1.6 m drop): it opens at once');
  }
}

// 8. The rockfall lane: cue `lead` s before each drop, the drop for `on` s, a body inside struck once per drop (0.3 / 0.4 / 0.5
//    of its health by difficulty, cause 'rockfall'), dead when that is all it had left; god mode takes nothing; events only
//    within hearing; clear time; snapshot.
{
  const dmg = {};
  for (const v of ['normal', 'nightmare', 'abyss']) {
    const { ev, O, T, ph, p } = rig(v);
    p.reset(-26.25, -70, 0); // in the lane, under s3-a3
    for (let i = 0; i < Math.round(30 / DT) && p.alive; i++) O.step(DT, p, T, null, 0);
    const L = O.lanes[0];
    const hits = ev.filter((e) => e[0] === 'lane:hit');
    const death = ev.find((e) => e[0] === 'player:death');
    dmg[v] = `${L.damage}x${hits.length}${death ? ' dead@' + death[1] + ' (' + death[2].cause + ')' : ''}`;
    if (v === 'normal') {
      const seq = ev.filter((e) => e[0].startsWith('lane:')).slice(0, 5).map((e) => `${e[0].slice(5)}@${+e[1].toFixed(2)}`).join(' ');
      const want = 'warn@2 on@3.5 hit@3.5 off@5.1 warn@9';
      ok(seq === want, `Normal (period 7, on 1.6, lead 1.5): ${seq}`);
      ok(hits.length === 4 && death && death[2].cause === 'rockfall' && ph.health.hp === 0, `four drops on a body that stays: 0.3 each, the fourth kills (cause rockfall)`);
    }
  }
  ok(dmg.nightmare.startsWith('0.4x3') && dmg.abyss.startsWith('0.5x2'), `damage per difficulty: ${JSON.stringify(dmg)}`);
  const { ev, O, T, ph, p } = rig();
  ph.health.god = true;
  p.reset(-26.25, -70, 0);
  for (let i = 0; i < Math.round(8 / DT); i++) O.step(DT, p, T, null, 0);
  ok(ph.health.hp === 1 && ev.some((e) => e[0] === 'lane:hit'), 'god mode: struck (the event) but no damage');
  const far = rig();
  far.p.reset(7, -65.6, 0); // on the S3 landing, 32 m away
  for (let i = 0; i < Math.round(8 / DT); i++) far.O.step(DT, far.p, far.T, null, 0);
  const near = rig();
  near.p.reset(-20, -73.6, 0); // on span 2, 5 m away
  for (let i = 0; i < Math.round(8 / DT); i++) near.O.step(DT, near.p, near.T, null, 0);
  ok(!far.ev.some((e) => e[0].startsWith('lane:')) && near.ev.filter((e) => e[0] === 'lane:on').length === 1 && !near.ev.some((e) => e[0] === 'lane:hit'), 'events only within hearing (30 m); the span beside it is never struck');
  // clear time and snapshot
  const c = rig();
  at(c.O, 3.6);
  const during = c.O.laneClearFor(0);
  at(c.O, 5.2);
  const after = c.O.laneClearFor(0);
  c.p.reset(-26.25, -70, 0);
  at(c.O, 3.4);
  const snap = c.O.snapshot();
  for (let i = 0; i < Math.round(0.5 / DT); i++) c.O.step(DT, c.p, c.T, null, 0);
  const hitOnce = c.O.laneHit[0];
  c.O.restore(snap);
  const rewound = c.O.laneHit[0] === -1 && Math.abs(c.O.clock - 3.4) < 1e-9 && c.O.laneOn[0] === 0;
  ok(during === 0 && Math.abs(after - 5.3) < 1e-9 && hitOnce >= 0 && rewound, `clear for: 0 while the stones fall, 5.3 s right after a drop; snapshot / restore rewinds the clock and the drop struck`);
  const cap = captionForEvent('lane:warn', {});
  ok(cap && cap.text === '[Rocks rattle above]' && captionForEvent('lane:on', {}).text === '[Rubble falling]' && captionForEvent('objective:progress', { verb: 'winch' }).text === '[A ratchet clacks]' && statusForEvent('health:damage', { cause: 'rockfall' }), 'captions: [Rocks rattle above] / [Rubble falling] / the winch ratchet; a rockfall hit is a HAZARD HIT status cue');
}

// 9. The Sandbox warp opens every seal above the target, the winch's too, silently; Sandbox plays Normal's movers.
{
  const { ev, O } = rig('normal', 'sandbox');
  O.markDoneThrough(3);
  const open = O.seals.filter((s) => O.sealOpen[s.index]).map((s) => s.id).join();
  ok(open === 'seal-s1,seal-s2,seal-s3' && O.fixtureDone(O.fixtureIndex('winch-s3')) && !ev.length && O.movers.list[1].m.period === 12 && O.movers.list[0].m.period === 8.6, `Sandbox warp to S4: ${open} open, the winch counts done, no events; movers at Normal's periods`);
}

// 10. The lane probe (verify V6): the S3 safe line without its wait is struck in some start phases; with it, never.
{
  const problems = [];
  const res = await laneProbe((v) => new Level3D(undefined, v), 'normal', R, (m) => problems.push(m));
  const r = res && res['rock-s3'];
  ok(r && r.blindHits > 0 && r.waitHits === 0 && !problems.length, `lane probe (Normal, 6 phases): blind struck in ${r ? r.blindHits : '?'}, with the wait ${r ? r.waitHits : '?'} hits ${problems.join('; ')}`);
}

// 11. The view: the cage (its chain and cage, the decor it carries) and the gear are instances of the seal bars' mesh, posed
//     from the run clock every frame while in view.
{
  const { moverParts, SealView } = await import(srcUrl('render/objectivesView.js'));
  const THREE = await import('three');
  const L = new Level3D(undefined, 'normal');
  const parts = moverParts(L);
  const cage = parts.find((m) => m.kind === 'cage');
  const gear = parts.find((m) => m.kind === 'gear');
  const decor = (L.movers[0].raw.carry.decor || []).join();
  ok(parts.length === 2 && cage.boxes.length > 25 && gear.boxes.length > 25 && decor === 'cage-s3,cage-s3-chain', `mover parts: cage ${cage.boxes.length} boxes (carries ${decor}), gear ${gear.boxes.length} boxes`);
  const root = new THREE.Group();
  const view = new SealView(L, new THREE.MeshStandardMaterial(), new THREE.BoxGeometry(1, 1, 1), root);
  const O = new Objectives3D(L, DIFFICULTY.normal, null);
  const head = new THREE.Vector3(-6, -70, 4); // span 1, by the cage
  view.update(1 / 72, O, head, 30);
  const n1 = view.stats.drawn;
  const m1 = new THREE.Matrix4();
  view.mesh.getMatrixAt(n1 - 1, m1);
  at(O, 2);
  view.update(1 / 72, O, head, 30);
  const m2 = new THREE.Matrix4();
  view.mesh.getMatrixAt(view.stats.drawn - 1, m2);
  const far = new THREE.Vector3(-4, 1.6, 8.5);
  view.update(1 / 72, O, far, 20);
  ok(root.children.length === 1 && n1 >= cage.boxes.length + gear.boxes.length && !m1.equals(m2) && view.stats.drawn < n1, `view: ${n1} instances near S3 (the seal's bars + the cage and the gear: one mesh), they move with the clock, gone out of view`);
}

console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exitCode = fails ? 1 : 0;
