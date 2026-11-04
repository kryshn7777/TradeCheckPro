// THE USHER (sim/usher3d.js; docs/abyssal-tether-3d/plans/CHAPTER_II_DIRECTION.md §3.2-3.8): the Chapter II villain that answers bells.
// Pure sim, no level, no three.js. Checks:
//   - tollHeard: the toll table's ranges (bell 60 / machine 42 / gong 48 / ring 18 / crash 36 m, the Great Bell everywhere), Nightmare
//     x1.1 and Abyss x1.2 (66 / 46 / 20 and 72 / 50 / 22), the Head Usher x1.5, 3D distance, unknown kinds, loudness 0;
//   - TollBus masking: a louder toll within 10 m hides a quieter one for 1.0 s (strictly louder, strictly inside the second,
//     masked tolls mask nothing, reset, fixed memory);
//   - the timeline LISTEN -> COIL -> COMMIT -> WHIP -> RECOIL -> STAND with exact timers on Normal / Nightmare / Abyss (2.5 / 2.0 /
//     0.35 / 3.0, 2.2 / 1.7 / 0.30 / 2.5, 2.0 / 1.5 / 0.25 / 2.0), at 100 Hz and 60 Hz, the Head Usher's radii (4.4 -> 2.6 m);
//     COIL never under 1.5 s; the aim frozen from COMMIT; the Lunge clip scrubbed 0 -> 0.525 -> 0.78 -> 1.5 s;
//   - the aim leads a mover by (Listen + Coil), is clamped to reach (sagShort); a newer toll re-aims in LISTEN (hold 0.6 s, cap 6 s);
//     a toll in COIL / WHIP / RECOIL is queued and answered after the recoil; RECOIL never COILs;
//   - a toll beyond reach: an ordinary Usher SEARCHes along its graph (never leaves it, COIL at reach - 1 m, gives up after 12 s), the
//     Head Usher's throat sags short and he does not move;
//   - lethalAt only in WHIP (a SNUFF dip, the sweep tip), only inside the sphere, never in the first 3 s (2 s Abyss) unless
//     'enter', never when harmless; the Phase B Evening clock of the Doorman (whips at 25.5 / 37.5 / 49.5 s, none on the west strokes);
//   - PARKED: 3 / 2 / 1 strikes on the same bell, one every 7.85 / 6.7 / 5.75 s, its own echo ignored, a toll elsewhere ends it;
//   - SNUFF (walk to the cluster, warn 1.6 / 1.5 / 1.5 s, the dip), the walk speeds, PULPIT / COLLAR / SWEEP / RELOCATE / REACH;
//   - determinism, snapshot / restore (JSON round trip), SEATED terminal, OFF / enter / leave, the rope telegraph, destroy.
//   node usher3d.mjs [--root DIR]
import { srcUrl } from '../../verify/root.mjs';

const { Usher3D, TollBus, tollHeard, TOLL_KINDS, USHER_TUNING: T, USHER_DIFF, USHER_STATES } = await import(srcUrl('sim/usher3d.js'));
const { EventBus } = await import(srcUrl('sim/config3d.js'));

let pass = 0;
let fail = 0;
const ok = (c, m) => {
  if (c) pass++;
  else {
    fail++;
    console.log('FAIL:', m);
  }
};
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
const TYPES = ['listen', 'coil', 'commit', 'whip', 'blow', 'park', 'recoil', 'seat', 'snuff', 'collar', 'relocate'];
const DIFFS = ['normal', 'nightmare', 'abyss'];
const EXPECT = {
  normal: { listen: 2.5, coil: 2.0, whip: 0.35, recoil: 3.0, warn: 1.6, walk: 1.2, strikes: 3, cycle: 7.85, hear: [60, 42, 18], reach: 4.5, headReach: [16, 24, 32] },
  nightmare: { listen: 2.2, coil: 1.7, whip: 0.3, recoil: 2.5, warn: 1.5, walk: 1.45, strikes: 2, cycle: 6.7, hear: [66, 46, 20], reach: 5.0, headReach: [18, 26, 34] },
  abyss: { listen: 2.0, coil: 1.5, whip: 0.25, recoil: 2.0, warn: 1.5, walk: 1.7, strikes: 1, cycle: 5.75, hear: [72, 50, 22], reach: 5.5, headReach: [20, 28, 36] },
};

/** A bus that logs the Usher's events, and an Usher on it. */
function rig(o = {}) {
  const bus = new EventBus();
  const ev = [];
  for (const t of TYPES) bus.on('usher:' + t, (p) => ev.push({ type: t, ...p }));
  const u = new Usher3D({ id: 'u1', bus, ...o });
  return { bus, ev, u };
}
const of = (r, type) => r.ev.filter((e) => e.type === type);
const toll = (r, x, y, z, kind = 'gong', extra = {}) => r.bus.emit('toll:emit', { x, y, z, kind, loud: TOLL_KINDS[kind] ? TOLL_KINDS[kind].loud : 1, src: 'test', ...extra });
function run(r, secs, dt = 0.01, each) {
  const n = Math.round(secs / dt);
  for (let i = 0; i < n; i++) {
    r.u.step(dt);
    if (each) each(r.u, i);
  }
}
const finite = (u) => {
  const a = u.aim;
  const s = u.sphere;
  const p = u.pos;
  return [p.x, p.y, p.z, u.yaw, u.stretch, u.time, ...(a ? [a.x, a.y, a.z] : []), ...(s ? [s.x, s.y, s.z, s.r] : [])].every(Number.isFinite);
};

// ---- the API surface -------------------------------------------------------------------------------------------------------------
{
  ok(['OFF', 'STAND', 'WALK', 'SNUFF', 'LISTEN', 'SEARCH', 'COIL', 'WHIP', 'RECOIL', 'PARKED', 'SEATED', 'PULPIT', 'COLLAR', 'SWEEP', 'RELOCATE'].every((k) => USHER_STATES[k] === k), 'USHER_STATES has the states of 3.7');
  ok(TOLL_KINDS.bell.loud === 1 && TOLL_KINDS.bell.range === 60 && TOLL_KINDS.machine.loud === 0.7 && TOLL_KINDS.machine.range === 42, 'TOLL_KINDS bell / machine');
  ok(TOLL_KINDS.gong.loud === 0.8 && TOLL_KINDS.gong.range === 48 && TOLL_KINDS.great.loud === 1 && TOLL_KINDS.great.range === Infinity, 'TOLL_KINDS gong / great');
  ok(TOLL_KINDS.ring.loud === 0.35 && TOLL_KINDS.ring.range === 18 && TOLL_KINDS.crash.loud === 0.6 && TOLL_KINDS.crash.range === 36, 'TOLL_KINDS ring / crash');
  ok(T.listenR === 3.0 && T.headListenR === 4.4 && T.lethalR === 1.8 && T.headLethalR === 2.6, 'USHER_TUNING radii 3.0 / 4.4 listen, 1.8 / 2.6 lethal');
  for (const d of DIFFS) {
    const e = EXPECT[d];
    const k = USHER_DIFF[d];
    ok(k.listen === e.listen && k.coil === e.coil && k.whip === e.whip && k.recoil === e.recoil, `${d}: USHER_DIFF timers`);
    ok(T.listen[d] === e.listen && T.coil[d] === e.coil && T.whip[d] === e.whip && T.recoil[d] === e.recoil && T.walk[d] === e.walk, `${d}: USHER_TUNING per-difficulty timers + walk`);
    ok(k.reach === e.reach && T.reach.common[d] === e.reach && k.headReach.B === e.headReach[0] && k.headReach.C1 === e.headReach[1] && k.headReach.C2 === e.headReach[2], `${d}: reach (ordinary and Head per phase)`);
    ok(k.parkStrikes === e.strikes && T.parkStrikes[d] === e.strikes && k.snuffWarn === e.warn, `${d}: parked strikes and SNUFF warning`);
    ok(k.coil >= 1.5, `${d}: COIL >= 1.5 s in the table`);
    ok(near(k.recoil + k.listen + k.coil + k.whip, e.cycle), `${d}: Recoil + Listen + Coil + Whip = ${e.cycle}`);
  }
  const u = new Usher3D({ x: 1, y: 2, z: 3, yaw: 0.5 });
  ok(u.state === 'STAND' && u.head === false && u.reach === 4.5 && u.stretch === 1 && u.aim === null && u.sphere === null, 'a new Usher stands, reach 4.5, no sphere');
  ok(new Usher3D({ head: true }).reach === 16 && new Usher3D({ reach: 9 }).reach === 9, 'the Head Usher reaches 16 m, an explicit reach wins');
  ok(!Object.keys(u).some((k) => /player/i.test(k)) && typeof u.step === 'function' && u.step.length === 1, 'it has no notion of the player: step(dt) only');
  const nb = new Usher3D({ x: 5, y: 0, z: 0 });
  ok(nb.pos.x === 5 && nb.anim.clip === 'Idle', 'pos / anim readable without a bus');
}

// ---- tollHeard -------------------------------------------------------------------------------------------------------------------
{
  const at = (kind, d, head, diff, extra) => tollHeard({ x: d, y: 0, z: 0, kind, loud: TOLL_KINDS[kind].loud, ...extra }, 0, 0, 0, head, diff);
  const edge = (kind, range, head, diff, label) => {
    ok(at(kind, range - 0.1, head, diff), `${label}: heard at ${range - 0.1} m`);
    ok(at(kind, range, head, diff), `${label}: heard at exactly ${range} m`);
    ok(!at(kind, range + 0.1, head, diff), `${label}: not heard at ${range + 0.1} m`);
  };
  edge('bell', 60, false, 'normal', 'bell Normal');
  edge('machine', 42, false, 'normal', 'machine Normal');
  edge('gong', 48, false, 'normal', 'gong Normal');
  edge('ring', 18, false, 'normal', 'ring Normal');
  edge('crash', 36, false, 'normal', 'crash Normal');
  edge('bell', 66, false, 'nightmare', 'bell Nightmare');
  edge('machine', 46, false, 'nightmare', 'machine Nightmare');
  edge('ring', 20, false, 'nightmare', 'ring Nightmare');
  edge('bell', 72, false, 'abyss', 'bell Abyss');
  edge('machine', 50, false, 'abyss', 'machine Abyss');
  edge('ring', 22, false, 'abyss', 'ring Abyss');
  edge('bell', 90, true, 'normal', 'Head bell Normal (x1.5)');
  edge('machine', 63, true, 'normal', 'Head machine Normal (x1.5)');
  edge('ring', 27, true, 'normal', 'Head ring Normal (x1.5)');
  edge('crash', 54, true, 'normal', 'Head crash Normal (x1.5)');
  edge('bell', 99, true, 'nightmare', 'Head bell Nightmare');
  ok(at('great', 1e6, false, 'normal') && at('great', 1e6, true, 'abyss'), 'the Great Bell is heard everywhere');
  ok(at('bell', 56.6, false, 'normal', { x: 40, y: 40, z: 0 }) === true, '3D distance: (40, 40, 0) is 56.6 m');
  ok(tollHeard({ x: 45, y: 45, z: 0, kind: 'bell', loud: 1 }, 0, 0, 0, false, 'normal') === false, '3D distance: (45, 45, 0) is 63.6 m, too far');
  ok(tollHeard({ x: 59, y: 0, z: 0, kind: 'bell', loud: 1 }, 1, 0, 0, false, 'normal') === true && tollHeard({ x: 59, y: 0, z: 0, kind: 'bell', loud: 1 }, -2, 0, 0, false, 'normal') === false, 'measured from the Usher, not the origin');
  ok(!tollHeard({ x: 1, y: 0, z: 0, kind: 'bell', loud: 0 }, 0, 0, 0, false, 'normal'), 'loudness 0 is not a toll');
  ok(!tollHeard({ x: 1, y: 0, z: 0 }, 0, 0, 0, false, 'normal'), 'no kind and no loudness: not a toll');
  ok(tollHeard({ x: 9.9, y: 0, z: 0, kind: 'weird', loud: 0.5, range: 10 }, 0, 0, 0, false, 'normal') && !tollHeard({ x: 10.1, y: 0, z: 0, kind: 'weird', loud: 0.5, range: 10 }, 0, 0, 0, false, 'normal'), 'an unknown kind uses its own range');
  ok(tollHeard({ x: 29, y: 0, z: 0, kind: 'bell', loud: 1 }, 0, 0, 0, false, 'normal', 0.5) && !tollHeard({ x: 31, y: 0, z: 0, kind: 'bell', loud: 1 }, 0, 0, 0, false, 'normal', 0.5), 'the hearing multiplier scales the range');
  ok(tollHeard({ x: 50, y: 0, z: 0, kind: 'bell', loud: 1 }, 0, 0, 0, false, 'sandbox'), 'Sandbox hears as Normal');
  ok(!tollHeard(null, 0, 0, 0, false, 'normal'), 'null is not a toll');
}

// ---- TollBus ---------------------------------------------------------------------------------------------------------------------
{
  const mk = (kind, x, y = 0, z = 0) => ({ x, y, z, kind, loud: TOLL_KINDS[kind].loud });
  let b = new TollBus();
  ok(b.emit(mk('crash', 0), 10) === true, 'the first toll is audible');
  ok(b.emit(mk('ring', 5), 10.3) === false, 'a chime 5 m from a crash 0.3 s earlier is hidden');
  ok(b.emit(mk('ring', 5), 10.99) === false, 'still hidden at 0.99 s');
  ok(b.emit(mk('ring', 5), 11.0) === true, 'audible again at 1.0 s');
  b = new TollBus();
  b.emit(mk('crash', 0), 0);
  ok(b.emit(mk('ring', 10), 0.1) === false, 'hidden at exactly 10 m');
  ok(b.emit(mk('ring', 10.1), 0.1) === true, 'audible at 10.1 m');
  b = new TollBus();
  b.emit(mk('crash', 0, 8, 0), 0);
  ok(b.emit(mk('ring', 0, 0, 5), 0.2) === false && b.emit(mk('ring', 0, 0, 7), 0.2) === true, 'the 10 m is 3D (8 up and 5 across is 9.4 m: hidden; 8 up and 7 across is 10.6 m: audible)');
  b = new TollBus();
  b.emit(mk('bell', 0), 0);
  ok(b.emit(mk('bell', 1), 0.1) === true, 'an equally loud toll is not hidden');
  b = new TollBus();
  ok(b.emit(mk('ring', 0), 0) === true && b.emit(mk('crash', 1), 0.1) === true, 'a quieter toll first is audible, so is the louder one after it');
  b = new TollBus();
  b.emit(mk('crash', 0), 0);
  ok(b.emit(mk('ring', 2), 0.5) === false, 'the chime is masked');
  ok(b.emit({ x: 2, y: 0, z: 0, kind: 'ring', loud: 0.2 }, 1.2) === true, 'a masked toll mask nothing (a quieter one 1.2 s later is audible)');
  b = new TollBus();
  b.emit(mk('crash', 0), 0);
  ok(b.isMasked(mk('ring', 1), 0.5) === true && b.isMasked(mk('ring', 1), 0.5) === true && b.emit(mk('crash', 1), 0.5) === true, 'isMasked has no side effects');
  b.reset();
  ok(b.emit(mk('ring', 1), 0.2) === true, 'reset forgets');
  b = new TollBus();
  let bad = 0;
  for (let i = 0; i < 60; i++) if (typeof b.emit(mk('bell', i * 100), i * 0.01) !== 'boolean') bad++;
  ok(bad === 0, 'fixed memory: 60 tolls into a 16-slot bus');
  b = new TollBus();
  b.emit(mk('crash', 0), 5);
  ok(b.emit(mk('ring', 1), 3) === true, 'a clock that goes back is not masked by the future');
  ok(b.emit(null, 0) === false, 'null toll');
}

// ---- the timeline, exact timers, all three difficulties, ordinary and Head ------------------------------------------------------
for (const head of [false, true]) {
  for (const dk of DIFFS) {
    for (const dt of [0.01, 1 / 60]) {
      const e = EXPECT[dk];
      const lab = `${head ? 'Head ' : ''}${dk} dt=${dt.toFixed(4)}`;
      const r = rig({ difficulty: dk, head });
      toll(r, 0, 0, head ? 10 : 3, 'gong');
      const u = r.u;
      ok(u.state === 'LISTEN' && u.sphere.stage === 'listen' && u.anim.clip === 'Listen', `${lab}: a gong -> LISTEN, pale sphere, Listen clip`);
      ok(u.sphere.r === (head ? 4.4 : 3.0), `${lab}: LISTEN radius ${head ? 4.4 : 3.0}`);
      const visited = [];
      let lethalStates = new Set();
      let aimAtCommit = null;
      let aimAtWhip = null;
      let allFinite = true;
      const total = e.listen + e.coil + e.whip + e.recoil;
      run(r, total + 1.5, dt, (x) => {
        if (visited[visited.length - 1] !== x.state) visited.push(x.state);
        const a = x.aim || { x: 0, y: 0, z: 10 };
        if (x.lethalAt(a.x, a.y, a.z)) lethalStates.add(x.state);
        if (!finite(x)) allFinite = false;
        const s = x.sphere;
        if (s && s.stage === 'commit' && !aimAtCommit) aimAtCommit = { x: s.x, y: s.y, z: s.z };
        if (s && s.stage === 'whip' && !aimAtWhip) aimAtWhip = { x: s.x, y: s.y, z: s.z };
      });
      ok(visited.join('>') === 'LISTEN>COIL>WHIP>RECOIL>STAND', `${lab}: states ${visited.join('>')}`);
      const lis = of(r, 'listen');
      const coil = of(r, 'coil');
      const com = of(r, 'commit');
      const wh = of(r, 'whip');
      const blow = of(r, 'blow');
      const rec = of(r, 'recoil');
      ok(lis.length === 1 && near(lis[0].at, 0), `${lab}: listen at 0`);
      ok(coil.length === 1 && near(coil[0].at, e.listen), `${lab}: coil starts after ${e.listen} s (${coil[0] && coil[0].at})`);
      ok(coil[0] && near(coil[0].t, e.coil) && coil[0].r === (head ? 2.6 : 1.8), `${lab}: coil event carries t = ${e.coil} and r = lethal radius`);
      ok(com.length === 1 && near(com[0].at, e.listen + e.coil - 0.4), `${lab}: COMMIT is the last 0.4 s of the coil`);
      ok(wh.length === 1 && near(wh[0].at, e.listen + e.coil), `${lab}: whip at toll + ${e.listen + e.coil}`);
      ok(blow.length === 1 && near(blow[0].at, wh[0].at) && blow[0].r === wh[0].r && blow[0].x === wh[0].x, `${lab}: usher:blow with the whip's sphere`);
      ok(rec.length === 1 && near(rec[0].at, e.listen + e.coil + e.whip), `${lab}: recoil after a ${e.whip} s whip`);
      ok(near(rec[0].at - wh[0].at, e.whip) && near(coil[0].at + e.coil - 0.4, com[0].at), `${lab}: whip length ${e.whip} s`);
      ok(near(wh[0].at, e.listen + e.coil) && e.coil >= 1.5 && near(com[0].at - coil[0].at, e.coil - 0.4), `${lab}: COIL ${e.coil} s >= 1.5, telegraph from sphere-on to whip >= 1.5 s`);
      ok(aimAtCommit && aimAtWhip && aimAtCommit.x === aimAtWhip.x && aimAtCommit.z === aimAtWhip.z, `${lab}: aim frozen from COMMIT to the whip`);
      ok([...lethalStates].join() === 'WHIP', `${lab}: lethalAt true only in WHIP (${[...lethalStates].join()})`);
      ok(u.state === 'STAND' && u.sphere === null && u.aim === null, `${lab}: back to STAND with no sphere`);
      ok(allFinite, `${lab}: every output finite`);
      ok(wh[0].x === 0 && wh[0].z === (head ? 10 : 3) && wh[0].r === (head ? 2.6 : 1.8), `${lab}: the whip's sphere is on the toll at the lethal radius`);
    }
  }
}

// sphere radius / stage / clip scrubbing through one cycle (Normal)
{
  const r = rig({ difficulty: 'normal' });
  const u = r.u;
  toll(r, 0, 0, 3);
  const samples = {};
  let prevT = -1;
  let monotone = true;
  run(r, 8.3, 0.005, (x) => {
    const k = x.state;
    const a = x.anim;
    const s = x.sphere;
    if (k === 'COIL') {
      if (!samples.coil0) samples.coil0 = { r: s.r, t: a.t, clip: a.clip };
      samples.coilLast = { r: s.r, t: a.t, stage: s.stage };
      if (a.t < prevT - 1e-9) monotone = false;
      prevT = a.t;
    }
    if (k === 'WHIP') samples.whip = { ...(samples.whip || {}), last: a.t, first: samples.whip ? samples.whip.first : a.t };
    if (k === 'RECOIL') samples.recoil = { last: a.t, first: samples.recoil ? samples.recoil.first : a.t };
  });
  ok(samples.coil0.clip === 'Lunge' && samples.coil0.t < 0.01 && samples.coil0.r <= 3.0 && samples.coil0.r > 2.9, 'COIL starts at 3.0 m, Lunge at 0');
  ok(near(samples.coilLast.t, 0.525, 0.01) && samples.coilLast.r === 1.8 && samples.coilLast.stage === 'commit', 'COIL ends at Lunge 0.525, 1.8 m, gold (commit)');
  ok(monotone, 'the Lunge scrub only goes forward through COIL');
  ok(near(samples.whip.first, 0.525, 0.02) && near(samples.whip.last, 0.78, 0.04), 'WHIP scrubs Lunge 0.525 -> 0.78');
  ok(near(samples.recoil.first, 0.78, 0.02) && near(samples.recoil.last, 1.5, 0.02), 'RECOIL scrubs Lunge 0.78 -> 1.5 (the settle, slowed to the timer)');
  ok(u.sphere === null, 'no sphere after the recoil');
}

// ---- aim, lead, clamp (the Head Usher: reach 16 / 18 / 20) -----------------------------------------------------------------------
{
  for (const dk of DIFFS) {
    const e = EXPECT[dk];
    const r = rig({ difficulty: dk, head: true });
    toll(r, 0, 0, 10, 'gong', { vx: 2 });
    const lead = e.listen + e.coil;
    const a = r.u.aim;
    ok(near(a.x, 2 * lead) && near(a.z, 10) && near(a.y, 0), `${dk}: aim = source + velocity x (Listen + Coil) = ${2 * lead} (${a.x})`);
    ok(r.u.sagShort === false, `${dk}: in reach: no sag`);
    run(r, e.listen + 0.01);
    ok(r.u.state === 'COIL' && near(r.u.aim.x, 2 * lead), `${dk}: the COIL aims at the led point`);
    ok(near(of(r, 'coil')[0].x, 2 * lead), `${dk}: usher:coil carries the led aim`);
  }
  // a vertical mover (the cage): the lead follows velocity on y
  const r = rig({ head: true });
  toll(r, 0, -2, 5, 'gong', { vy: -2 });
  ok(near(r.u.aim.y, -2 - 2 * 4.5) && near(r.u.aim.z, 5), 'the cage: aim y = y + vy x 4.5');
  // beyond reach: clamped
  const q = rig({ head: true });
  toll(q, 0, 0, 40, 'great');
  ok(near(q.u.aim.z, 16) && near(q.u.aim.x, 0) && q.u.sagShort === true, 'beyond reach the aim is clamped to 16 m along the line and the throat sags short');
  ok(q.u.sphere.r === 4.4 && q.u.sphere.stage === 'listen', 'the sagging torch is the pale one');
  run(q, 2.6);
  ok(q.u.state === 'SEARCH' && q.u.sagShort === true && q.u.sphere.stage === 'listen' && !of(q, 'coil').length, 'Head: hold ends beyond reach -> SEARCH, sags short, no coil');
  ok(q.u.pos.x === 0 && q.u.pos.z === 0, 'the Head Usher does not walk');
  ok(near(q.u.stretch, 16 / 6.75, 0.02), `the throat paid out to reach / 6.75 = ${(16 / 6.75).toFixed(2)} (${q.u.stretch.toFixed(3)})`);
  ok(!q.u.lethalAt(0, 0, 16), 'a sagging throat kills nothing');
  run(q, 12);
  ok(q.u.state === 'STAND' && q.u.sagShort === false && q.u.sphere === null, 'SEARCH gives up after 12 s without progress');
  // ordinary clamp
  const o = rig({});
  toll(o, 0, 0, 20, 'great', { vx: 0 });
  ok(near(Math.hypot(o.u.aim.x, o.u.aim.y, o.u.aim.z), 4.5) && o.u.sagShort, 'ordinary Usher: aim clamped to 4.5 m');
}

// ---- hearing in the Usher ------------------------------------------------------------------------------------------------------------
{
  let r = rig({});
  toll(r, 0, 0, 61, 'bell');
  ok(r.u.state === 'STAND' && !r.ev.length, 'a bell at 61 m is not heard');
  toll(r, 0, 0, 59, 'bell');
  ok(r.u.state === 'LISTEN', 'a bell at 59 m is');
  r = rig({ head: true });
  toll(r, 0, 0, 80, 'bell');
  ok(r.u.state === 'LISTEN', 'the Head Usher hears a bell at 80 m');
  r = rig({ hearing: 0.5 });
  toll(r, 0, 0, 40, 'bell');
  ok(r.u.state === 'STAND', 'hearing 0.5 halves the range');
  r = rig({});
  r.bus.emit('toll:emit', { x: 0, y: 0, z: 3, kind: 'gong', loud: 0.8, src: 'u1' });
  ok(r.u.state === 'STAND', 'its own tolls are not answered');
  ok(r.u.hear({ x: 0, y: 0, z: 3, kind: 'gong', loud: 0.8 }) === true && r.u.state === 'LISTEN', 'hear() answers directly');
}

// ---- re-aim, cap, queue ---------------------------------------------------------------------------------------------------------------
{
  // Phase B's fast line: the Listen is cut to 0.6 s more, the whip lands at 1.5 + 0.6 + 2.0 = 4.1 s
  let r = rig({});
  toll(r, 0, 0, 3);
  run(r, 1.5);
  toll(r, 3, 0, 0, 'bell', { park: false });
  ok(of(r, 'listen').length === 2 && near(of(r, 'listen')[1].at, 1.5), 're-aim emits usher:listen again');
  ok(near(r.u.aim.x, 3) && near(r.u.aim.z, 0), 'a newer toll re-aims the sphere');
  run(r, 4);
  ok(near(of(r, 'coil')[0].at, 2.1) && near(of(r, 'whip')[0].at, 4.1), `Listen cut to 0.6 s: coil at 2.1, whip at 4.1 (${of(r, 'whip')[0] && of(r, 'whip')[0].at})`);
  ok(near(of(r, 'whip')[0].x, 3) && of(r, 'whip').length === 1, 'the whip is on the newer toll, once');
  // a hold shorter than 0.6 s is extended to 0.6 s
  r = rig({});
  toll(r, 0, 0, 3);
  run(r, 2.2);
  toll(r, 2, 0, 0);
  run(r, 1);
  ok(near(of(r, 'coil')[0].at, 2.8), `hold 0.3 s -> reset to 0.6 s: coil at 2.8 (${of(r, 'coil')[0] && of(r, 'coil')[0].at})`);
  // the cap: a toll every 0.5 s cannot hold the LISTEN past 6 s
  r = rig({ head: true });
  for (let i = 0; i < 40; i++) {
    toll(r, 0, 0, 6 + (i % 3));
    run(r, 0.5);
  }
  const c0 = of(r, 'coil')[0];
  ok(c0 && c0.at <= 6.0 + 1e-6 && c0.at > 5.4, `the LISTEN is capped at 6 s (coil at ${c0 && c0.at})`);
  // a toll in COIL is queued, the telegraph never moves
  r = rig({});
  toll(r, 0, 0, 3);
  run(r, 3.0);
  const aimBefore = { ...r.u.aim };
  toll(r, 1, 0, 1);
  ok(r.u.state === 'COIL' && r.u.aim.x === aimBefore.x && r.u.aim.z === aimBefore.z && of(r, 'listen').length === 1, 'a toll in COIL is queued: the sphere does not move');
  run(r, 1.6);
  ok(of(r, 'whip').length === 1 && of(r, 'whip')[0].z === 3, 'the whip lands on the first toll');
  // RECOIL: no coil, answered after
  r = rig({});
  toll(r, 0, 0, 3);
  run(r, 5.0);
  ok(r.u.state === 'RECOIL', 'in RECOIL at 5.0 s');
  toll(r, 2, 0, 0);
  run(r, 2.8);
  ok(r.u.state === 'RECOIL' && of(r, 'coil').length === 1 && of(r, 'listen').length === 1, 'RECOIL cannot COIL and does not LISTEN yet');
  run(r, 0.1);
  ok(of(r, 'listen').length === 2 && near(of(r, 'listen')[1].at, 7.85), 'the queued toll is answered when the recoil ends (a full LISTEN)');
  run(r, 5);
  ok(of(r, 'coil').length === 2 && near(of(r, 'coil')[1].at, 10.35) && near(of(r, 'whip')[1].at, 12.35), 'then COIL at 10.35, whip at 12.35');
  // only the newest queued toll is answered
  r = rig({});
  toll(r, 0, 0, 3);
  run(r, 5.0);
  toll(r, 2, 0, 0);
  run(r, 0.5);
  toll(r, 0, 0, -2);
  run(r, 20);
  ok(of(r, 'whip').length === 2 && near(of(r, 'whip')[1].z, -2) && near(of(r, 'whip')[1].x, 0), 'only the newest queued toll is answered');
}

// ---- SEARCH: an ordinary Usher walks the graph ----------------------------------------------------------------------------------------
{
  const path = [
    { x: 0, y: 0, z: 0 },
    { x: 30, y: 0, z: 0 },
  ];
  let r = rig({});
  r.u.setPath(path);
  toll(r, 20, 0, 0);
  ok(r.u.sagShort === true, 'a toll 20 m away: the aim is clamped (sags short)');
  let off = 0;
  let maxX = 0;
  let sawSearch = false;
  let xAtCoil = null;
  run(r, 25, 0.01, (u) => {
    const p = u.pos;
    off = Math.max(off, Math.abs(p.y) + Math.abs(p.z));
    maxX = Math.max(maxX, p.x);
    if (u.state === 'SEARCH') sawSearch = true;
    if (u.state === 'COIL' && xAtCoil === null) xAtCoil = p.x;
  });
  ok(sawSearch && of(r, 'listen').length === 1, 'beyond reach -> SEARCH');
  ok(off === 0, 'it never leaves the graph');
  ok(xAtCoil !== null && near(xAtCoil, 16.5, 0.05), `COIL once the toll is within reach - 1 m (x = ${xAtCoil})`);
  ok(near(of(r, 'coil')[0].at, 2.5 + 16.5 / 1.2, 0.02), `after Listen + 16.5 m at 1.2 m/s (coil at ${of(r, 'coil')[0].at})`);
  ok(of(r, 'whip').length === 1 && near(of(r, 'whip')[0].x, 20), 'the whip is on the toll');
  ok(of(r, 'listen').length === 1, 'SEARCH does not re-listen');
  // a toll the graph does not get near: it walks to the nearest point and gives up
  r = rig({});
  r.u.setPath(path);
  toll(r, 20, 0, 30, 'great');
  let off2 = 0;
  run(r, 40, 0.01, (u) => {
    off2 = Math.max(off2, Math.abs(u.pos.y) + Math.abs(u.pos.z));
  });
  ok(r.u.state === 'STAND' && near(r.u.pos.x, 20, 0.02) && off2 === 0 && !of(r, 'coil').length, `a toll off the graph: walks to its nearest point (x = ${r.u.pos.x.toFixed(2)}), never coils, gives up`);
  // never climbs: a toll high above a flat graph
  r = rig({});
  r.u.setPath(path);
  toll(r, 10, 30, 0, 'great');
  run(r, 30);
  ok(r.u.pos.y === 0, 'it never climbs');
  // a newer toll in SEARCH -> LISTEN
  r = rig({});
  r.u.setPath(path);
  toll(r, 25, 0, 0);
  run(r, 5);
  ok(r.u.state === 'SEARCH', 'searching');
  toll(r, 5, 0, 0);
  ok(r.u.state === 'LISTEN' && of(r, 'listen').length === 2, 'a newer toll in SEARCH -> LISTEN');
  // no graph at all: stays put and gives up
  r = rig({});
  toll(r, 20, 0, 0);
  run(r, 20);
  ok(r.u.state === 'STAND' && r.u.pos.x === 0, 'without a graph SEARCH stands and gives up');
  // walk speeds
  for (const dk of DIFFS) {
    const w = rig({ difficulty: dk });
    w.u.setPath([{ x: 0, y: 0, z: 0 }, { x: 100, y: 0, z: 0 }]);
    toll(w, 100, 0, 0, 'great');
    run(w, EXPECT[dk].listen + 5);
    ok(near(w.u.pos.x, 5 * EXPECT[dk].walk, 0.05) && w.u.anim.clip === 'Walk', `${dk}: walks ${EXPECT[dk].walk} m/s (x = ${w.u.pos.x.toFixed(2)})`);
  }
  ok(new Usher3D({}).setPath(new Array(60).fill({ x: 0, y: 0, z: 0 }).map((p, i) => ({ x: i, y: 0, z: 0 }))) === 40, 'a graph holds at most 40 nodes');
}

// ---- lethalAt, the grace, harmless ---------------------------------------------------------------------------------------------------
{
  const r = rig({});
  toll(r, 0, 0, 3);
  let during = null;
  run(r, 4.6, 0.01, (u) => {
    if (u.state === 'WHIP' && !during) {
      during = {
        centre: u.lethalAt(0, 0, 3),
        edge: u.lethalAt(1.8, 0, 3),
        out: u.lethalAt(1.9, 0, 3),
        far: u.lethalAt(0, 0, 0),
        s: { ...u.sphere },
      };
    }
  });
  ok(during && during.centre && during.edge && !during.out && !during.far, 'WHIP: lethal at the centre and the edge (1.8), not at 1.9 m or at the Usher');
  ok(during.s.stage === 'whip' && during.s.lethal === true && during.s.r === 1.8, 'sphere.stage whip, lethal flag set');
  run(r, 0.4);
  ok(r.u.state === 'RECOIL' && !r.u.lethalAt(0, 0, 3) && !r.u.lethalAt(0, 0, 3.5), 'RECOIL: nothing is lethal');
  // Head radii
  const h = rig({ head: true });
  toll(h, 0, 0, 10);
  let hh = null;
  run(h, 4.6, 0.01, (u) => {
    if (u.state === 'WHIP' && !hh) hh = { edge: u.lethalAt(2.6, 0, 10), out: u.lethalAt(2.7, 0, 10) };
  });
  ok(hh && hh.edge && !hh.out, 'Head WHIP: lethal to 2.6 m');
  // the grace: two quick tolls -> a whip at 0.1 + ... < 3 s
  const g = rig({});
  toll(g, 0, 0, 3);
  run(g, 0.1);
  toll(g, 0, 0, 2);
  let lethalInGrace = false;
  run(g, 2.9, 0.01, (u) => {
    if (u.lethalAt(0, 0, 2)) lethalInGrace = true;
  });
  ok(near(of(g, 'whip')[0].at, 2.7) && of(g, 'whip')[0].lethal === false && !lethalInGrace, 'inside the first 3.0 s after reset() nothing is lethal (whip at 2.7 s, lethal flag false)');
  run(g, 3);
  const g2 = rig({});
  toll(g2, 0, 0, 3);
  run(g2, 0.1);
  toll(g2, 0, 0, 2);
  g2.u.command('enter');
  let lethalEntered = false;
  run(g2, 2.9, 0.01, (u) => {
    if (u.lethalAt(0, 0, 2)) lethalEntered = true;
  });
  ok(lethalEntered && of(g2, 'whip')[0].lethal === true, "command('enter') lifts the grace: the same whip is lethal");
  // a whip after the grace is lethal
  const g3 = rig({});
  g3.u.step(3.01);
  toll(g3, 0, 0, 3);
  let late = false;
  run(g3, 4.6, 0.01, (u) => {
    if (u.lethalAt(0, 0, 3)) late = true;
  });
  ok(late, 'after the grace a whip is lethal');
  // Abyss: 2 s
  const ga = rig({ difficulty: 'abyss' });
  ga.u.step(0.1);
  toll(ga, 0, 0, 3);
  run(ga, 0.4);
  toll(ga, 0, 0, 2.5);
  run(ga, 2.6);
  ok(of(ga, 'whip').length >= 1 && near(of(ga, 'whip')[0].at, 0.5 + 0.6 + 1.5) && of(ga, 'whip')[0].lethal === true, 'Abyss grace is 2 s: a whip at 2.6 s is lethal');
  // reset() starts the grace again
  g3.u.reset();
  ok(g3.u.time === 0 && g3.u.state === 'STAND', 'reset() clears');
  toll(g3, 0, 0, 3);
  g3.u.reset();
  ok(g3.u.state === 'STAND' && g3.u.sphere === null && g3.u.aim === null, 'reset() drops the sphere and the queue');
  // harmless / sandbox
  const sb = rig({ difficulty: 'sandbox' });
  toll(sb, 0, 0, 3);
  let sbl = false;
  let sbDrawn = false;
  run(sb, 5, 0.01, (u) => {
    if (u.lethalAt(0, 0, 3)) sbl = true;
    if (u.sphere && u.sphere.stage === 'whip') sbDrawn = true;
  });
  ok(!sbl && sbDrawn && of(sb, 'whip').length === 1 && of(sb, 'whip')[0].lethal === false, 'Sandbox: the whole thing plays out, nothing is lethal');
  sb.u.setDifficulty('normal');
  ok(sb.u.harmless === false, 'setDifficulty back to Normal is lethal again');
}

// ---- the Phase B Evening clock of the Doorman (3.7) ---------------------------------------------------------------------------------
{
  const r = rig({ head: true, x: 0, y: 0, z: 0 });
  const u = r.u;
  u.command('pulpit');
  ok(u.state === 'PULPIT' && u.stretch === 1 && u.sphere === null, 'PULPIT: throat coiled, no sphere');
  toll(r, 0, 0, 3, 'bell');
  toll(r, 1, 0, 1, 'great');
  ok(u.state === 'PULPIT' && !r.ev.length, 'PULPIT hears nothing (never lethal in Phase A)');
  run(r, 5);
  ok(u.state === 'PULPIT' && u.stretch === 1, 'PULPIT holds');
  // t = 0 at the rim
  r.ev.length = 0;
  u.reset();
  u.command('pulpit');
  u.command('collar');
  ok(u.state === 'COLLAR' && of(r, 'collar').length === 1, 'COLLAR on the rim trigger');
  let stretchAt3 = 0;
  let t = 0;
  const W = { x: -28, y: 0, z: 0 };
  const E = { x: 10, y: 0, z: 0 };
  const strokes = [
    [15, W],
    [21, E],
    [27, W],
    [33, E],
    [39, W],
    [45, E],
  ];
  const states = {};
  const dt = 0.01;
  for (let i = 0; i < 5600; i++) {
    for (const [ts, p] of strokes) if (Math.abs(t - ts) < dt / 2) toll(r, p.x, p.y, p.z, 'great');
    u.step(dt);
    t += dt;
    if (Math.abs(t - 2.99) < dt / 2) stretchAt3 = u.stretch;
    if (Math.abs(t - 2.5) < dt / 2) states.t25 = u.state;
    if (Math.abs(t - 3.5) < dt / 2) states.t35 = u.state;
    if (Math.abs(t - 14.9) < dt / 2) states.t149 = u.state;
    if (Math.abs(t - 15.05) < dt / 2) states.t1505 = u.state;
    if (Math.abs(t - 16) < dt / 2) states.t16 = u.state + (u.sagShort ? '+sag' : '');
    if (Math.abs(t - 20) < dt / 2) states.t20 = u.state + (u.sagShort ? '+sag' : '');
    if (Math.abs(t - 24) < dt / 2) states.t24 = u.state + (u.sagShort ? '+sag' : '');
    if (Math.abs(t - 27.5) < dt / 2) states.t275 = u.state;
    if (Math.abs(t - 31.5) < dt / 2) states.t315 = u.state;
    if (Math.abs(t - 30) < dt / 2) states.t30 = u.state;
  }
  ok(states.t25 === 'COLLAR' && states.t35 === 'SWEEP' && states.t149 === 'SWEEP' && states.t1505 === 'LISTEN', 'COLLAR 0-3 s, SWEEP 3-15 s, then it listens (the first stroke at 15 s)');
  ok(near(stretchAt3, 2.4, 0.1), `COLLAR: stretch 1 -> ~2.4 (${stretchAt3.toFixed(3)})`);
  const whips = of(r, 'whip').map((e) => +e.at.toFixed(2));
  ok(JSON.stringify(whips) === JSON.stringify([25.5, 37.5, 49.5]), `whips at 25.5, 37.5, 49.5 s (${JSON.stringify(whips)})`);
  ok(of(r, 'whip').every((e) => e.x === 10), 'every whip lands on the east apex');
  ok(states.t16 === 'LISTEN+sag' && states.t20 === 'SEARCH+sag', 'a west stroke: LISTEN, then the throat sags short');
  ok(states.t24 === 'COIL' && states.t275 === 'RECOIL', 'an east stroke: COIL at 23.5, RECOIL after the whip (the west stroke at 27 s is queued)');
  ok(states.t315 === 'LISTEN' || states.t315 === 'SEARCH', 'the queued west stroke is answered after the recoil (28.85 s)');
  ok(of(r, 'coil').length === 3, 'the west strokes never coil');
  // REACH per phase
  for (const dk of DIFFS) {
    const p = new Usher3D({ head: true, difficulty: dk });
    const e = EXPECT[dk];
    ok(p.reach === e.headReach[0], `${dk}: Head phase B reach ${e.headReach[0]}`);
    p.command('phase', 'C1');
    ok(p.reach === e.headReach[1], `${dk}: C1 reach ${e.headReach[1]}`);
    p.command('phase', 'C2');
    ok(p.reach === e.headReach[2], `${dk}: C2 reach ${e.headReach[2]}`);
    for (let i = 0; i < 400; i++) p.step(0.02);
    ok(near(p.stretch, e.headReach[2] / 6.75, 0.02), `${dk}: stretch = reach / 6.75 (${p.stretch.toFixed(2)})`);
  }
  const big = new Usher3D({ head: true });
  big.setReach(100);
  for (let i = 0; i < 400; i++) big.step(0.02);
  ok(near(big.stretch, 5.5, 0.01), 'stretch is at most 5.5');
  const nd = new Usher3D({ head: true, difficulty: 'normal' });
  nd.setDifficulty('abyss');
  ok(nd.reach === 20, 'setDifficulty updates a default reach');
  const nr = new Usher3D({ head: true, reach: 12 });
  nr.setDifficulty('abyss');
  ok(nr.reach === 12 && new Usher3D({}).command('phase', 'B') === false, 'an explicit reach survives a difficulty change; phase is Head only');
}

// ---- SWEEP -----------------------------------------------------------------------------------------------------------------------------
{
  const r = rig({ head: true });
  const u = r.u;
  u.command('enter');
  u.command('sweep', { x: 0, y: 0, z: 0, r: 14, a0: 0 });
  ok(u.state === 'SWEEP' && u.sphere.stage === 'snuff' && u.sphere.r === 2.0 && u.anim.clip === 'Listen', 'SWEEP: the tip is a 2.0 m snuff sphere');
  let prev = { ...u.aim };
  let speeds = [];
  let tipLethal = 0;
  run(r, 12.5, 0.01, (x) => {
    const a = x.aim;
    if (a && x.state === 'SWEEP') {
      speeds.push(Math.hypot(a.x - prev.x, a.z - prev.z) / 0.01);
      if (x.lethalAt(a.x, a.y, a.z)) tipLethal++;
      prev = { ...a };
    }
  });
  const arc1 = speeds.slice(5, 500);
  const arc2 = speeds.slice(700, 1190);
  ok(arc1.every((s) => near(s, 6, 0.1)) && arc2.every((s) => near(s, 6, 0.1)), 'the tip moves at 6 m/s on both arcs');
  ok(tipLethal > 1100, 'the tip is lethal');
  ok(of(r, 'snuff').length === 48, `usher:snuff along the tip every 0.25 s (${of(r, 'snuff').length})`);
  ok(u.state === 'STAND' && u.sphere === null, 'SWEEP -> STAND after 12 s');
  const q = rig({ head: true });
  q.u.command('collar');
  run(q, 3.0 + 12 - 0.02);
  ok(q.u.state === 'SWEEP', 'COLLAR 3.0 + SWEEP 12 s');
  toll(q, 0, 0, 3, 'bell');
  ok(of(q, 'listen').length === 0, 'SWEEP hears nothing');
  run(q, 0.04);
  ok(q.u.state === 'STAND', 'STAND at 15 s');
  ok(new Usher3D({}).command('collar') === false && new Usher3D({}).command('sweep') === false, 'collar and sweep are Head only');
}

// ---- PARKED --------------------------------------------------------------------------------------------------------------------------
for (const dk of DIFFS) {
  const e = EXPECT[dk];
  for (const echo of [false, true]) {
    const r = rig({ difficulty: dk });
    if (echo) r.bus.on('usher:blow', (p) => r.bus.emit('toll:emit', { x: p.x, y: p.y, z: p.z, kind: 'bell', loud: 1, src: 'bell' }));
    toll(r, 0, 0, 3, 'bell');
    const states = new Set();
    let parkedAtRecoilAfterFirst = false;
    run(r, 40, 0.01, (u) => {
      states.add(u.state);
      if (u.state === 'PARKED' && u.phase === 'RECOIL') parkedAtRecoilAfterFirst = true;
    });
    const w = of(r, 'whip');
    const lab = `${dk}${echo ? ' (with the blow echoing as a bell toll)' : ''}`;
    ok(w.length === e.strikes, `${lab}: ${e.strikes} strike(s) on the same bell (${w.length})`);
    ok(w.every((x) => x.z === 3 && x.x === 0), `${lab}: every strike on the bell`);
    ok(w.every((x, i) => i === 0 || near(x.at - w[i - 1].at, e.cycle)), `${lab}: one strike every ${e.cycle} s`);
    ok(of(r, 'park').length === 1 && of(r, 'park')[0].z === 3, `${lab}: usher:park once, at the bell`);
    ok(states.has('PARKED') && parkedAtRecoilAfterFirst, `${lab}: state reads PARKED between strikes`);
    ok(r.u.state === 'STAND' && r.u.sphere === null, `${lab}: the Round resumes (STAND)`);
    const resume = (e.listen + e.coil + e.whip + e.recoil) + (e.strikes - 1) * e.cycle;
    const rec = of(r, 'recoil');
    ok(rec.length === e.strikes && near(rec[rec.length - 1].at + e.recoil, resume), `${lab}: the last recoil ends at ${resume.toFixed(2)} s`);
    ok(of(r, 'listen').length === e.strikes, `${lab}: a Listen per strike`);
  }
}
{
  // a toll elsewhere ends the parking (after the recoil), a Head Usher does not park, a non-bell does not park
  let r = rig({});
  toll(r, 0, 0, 3, 'bell');
  run(r, 5.0);
  ok(r.u.state === 'PARKED' && r.u.phase === 'RECOIL', 'parked in the first recoil');
  toll(r, 3, 0, 0, 'gong');
  run(r, 20);
  const w = of(r, 'whip');
  ok(w.length === 2 && w[1].x === 3 && near(w[1].at, 7.85 + 2.5 + 2.0), 'a toll elsewhere: answered after the recoil, the parking is over');
  ok(r.u.state === 'STAND', '...and then it stands');
  r = rig({ head: true });
  toll(r, 0, 0, 10, 'bell');
  run(r, 40);
  ok(of(r, 'whip').length === 1 && of(r, 'park').length === 0, 'the Head Usher does not park (one cycle, a decoy window of 7.85 s)');
  r = rig({});
  toll(r, 0, 0, 3, 'gong');
  run(r, 40);
  ok(of(r, 'whip').length === 1 && of(r, 'park').length === 0, 'only a bell parks it');
  r = rig({});
  toll(r, 0, 0, 3, 'bell', { park: false });
  run(r, 40);
  ok(of(r, 'whip').length === 1 && of(r, 'park').length === 0, 'toll.park === false opts out');
  // a parked Usher is lethal at its bell during the later strikes too
  r = rig({});
  toll(r, 0, 0, 3, 'bell');
  let lethalAt2 = false;
  run(r, 14, 0.01, (u) => {
    if (u.lethalAt(0, 0, 3) && u.time > 12) lethalAt2 = true;
  });
  ok(lethalAt2 && r.u.state === 'PARKED', 'a later strike is lethal at the bell (PARKED, phase WHIP)');
}

// ---- SNUFF and the Round's walk -------------------------------------------------------------------------------------------------------
for (const dk of DIFFS) {
  const e = EXPECT[dk];
  const r = rig({ difficulty: dk });
  r.u.setPath([{ x: 0, y: 0, z: 0 }, { x: 40, y: 0, z: 0 }]);
  ok(r.u.command('snuffAt', { x: 10, y: 0, z: 2 }) === true && r.u.state === 'WALK', `${dk}: snuffAt starts a WALK`);
  const arrive = 10 / e.walk;
  let sn = null;
  let lethalWarn = false;
  let lethalDip = false;
  let lethalOut = false;
  let sawSnuff = false;
  run(r, arrive + e.warn + 0.35 + 1, 0.005, (u) => {
    if (u.state === 'SNUFF') {
      sawSnuff = true;
      sn = sn || { ...u.sphere };
      if (u.phase === 'SNUFF' && u.sphere.stage === 'snuff') {
        if (u.time < arrive + e.warn - 0.01 && u.lethalAt(10, 0, 2)) lethalWarn = true;
        if (u.time > arrive + e.warn + 0.01 && u.time < arrive + e.warn + 0.34) {
          if (u.lethalAt(10, 0, 2)) lethalDip = true;
          if (u.lethalAt(12.05, 0, 2)) lethalOut = true;
        }
      }
    }
  });
  ok(sawSnuff && sn.r === 2.0 && sn.x === 10 && sn.z === 2 && sn.stage === 'snuff', `${dk}: the cluster is marked with a 2.0 m sphere`);
  ok(near(r.u.pos.x, 10, 0.01) && r.u.pos.z === 0, `${dk}: it stopped at the graph's nearest point to the cluster`);
  ok(!lethalWarn, `${dk}: the warning sphere kills nothing`);
  ok(lethalDip && !lethalOut, `${dk}: the dip is lethal inside the sphere (2.0 m) only`);
  const s = of(r, 'snuff');
  ok(s.length === 1 && near(s[0].at, arrive + e.warn, 0.01) && s[0].r === 2.0 && s[0].x === 10, `${dk}: usher:snuff ${e.warn} s after it arrives (${s[0] && s[0].at.toFixed(3)})`);
  ok(r.u.state === 'STAND' && r.u.snuffCount === 1, `${dk}: back to STAND after the dip`);
}
{
  // a toll during SNUFF is queued; a walk order resumes after a LISTEN
  const r = rig({});
  r.u.setPath([{ x: 0, y: 0, z: 0 }, { x: 40, y: 0, z: 0 }]);
  r.u.command('snuffAt', { x: 6, y: 0, z: 1 });
  run(r, 5 + 0.5);
  ok(r.u.state === 'SNUFF', 'SNUFF at the cluster');
  toll(r, 6, 0, 4, 'gong');
  ok(r.u.state === 'SNUFF' && of(r, 'listen').length === 0, 'a toll during SNUFF is queued');
  run(r, 1.6);
  ok(of(r, 'listen').length === 1, 'answered after the dip');
  r.u.command('walk', { x: 30, y: 0, z: 0 });
  run(r, 40);
  ok(near(r.u.pos.x, 30, 0.02) && r.u.state === 'STAND', 'a walk order is obeyed (after the queued toll was answered)');
  const w = rig({});
  w.u.setPath([{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, { x: 10, y: 0, z: 10 }]);
  w.u.command('walk', 2);
  run(w, 3);
  toll(w, 10, 0, 18, 'great');
  ok(w.u.state === 'LISTEN', 'a toll interrupts a WALK');
  run(w, 60);
  ok(w.u.state === 'STAND' && near(w.u.pos.x, 10, 0.02) && near(w.u.pos.z, 10, 0.02), 'the walk order resumes after the interruption and reaches its node');
  const q = rig({});
  ok(q.u.command('walk', { x: 5, y: 0, z: 0 }) === true && q.u.state === 'STAND', 'walk without a graph just stands');
}

// ---- RELOCATE, OFF, SEATED -----------------------------------------------------------------------------------------------------------
{
  const r = rig({ head: true, x: 0, y: 0, z: 0 });
  r.u.setSeen(true);
  ok(r.u.command('relocate', { x: 50, y: -30, z: 4, yaw: 1 }) === true && r.u.state === 'RELOCATE', 'RELOCATE');
  run(r, 10);
  ok(r.u.state === 'RELOCATE' && r.u.pos.x === 0, 'he waits while he is seen');
  toll(r, 0, 0, 3, 'bell');
  ok(r.u.state === 'RELOCATE', 'and hears nothing');
  r.u.setSeen(false);
  run(r, 0.02);
  ok(r.u.state === 'STAND' && r.u.pos.x === 50 && r.u.pos.y === -30 && near(r.u.yaw, 1) && of(r, 'relocate').length === 1, 'unseen: he is at the next door (station 2)');
  r.u.reset();
  ok(r.u.pos.x === 50, 'reset() returns to the new station');
}
{
  const r = rig({ x: 3, y: 4, z: 5 });
  r.u.command('leave');
  toll(r, 3, 4, 6, 'bell');
  ok(r.u.state === 'OFF' && r.u.sphere === null && !r.ev.length, 'OFF: not in play, hears nothing');
  r.u.step(5);
  ok(r.u.state === 'OFF' && r.u.anim.clip === 'Idle', 'OFF stays OFF');
  r.u.command('enter');
  ok(r.u.state === 'STAND' && r.u.pos.x === 3 && r.u.pos.y === 4, "command('enter'): in play at its station");
  toll(r, 3, 4, 6, 'bell');
  ok(r.u.state === 'LISTEN', 'and hears');
}
{
  const r = rig({});
  toll(r, 0, 0, 3);
  run(r, 1);
  ok(r.u.command('seat') === true && r.u.state === 'SEATED' && r.u.sphere === null && r.u.aim === null, 'SEATED: ring dark');
  ok(of(r, 'seat').length === 1, 'usher:seat');
  ok(r.u.anim.clip === 'Sit', 'Sit clip');
  toll(r, 0, 0, 2, 'bell');
  run(r, 60);
  ok(r.u.state === 'SEATED' && of(r, 'whip').length === 0 && r.u.anim.t === 3.0, 'SEATED is terminal: tolls and time change nothing (Sit clip held at 3 s)');
  ok(r.u.command('walk', 0) === false && r.u.command('enter') === false && r.u.command('leave') === false && r.u.command('stand') === false, 'no command leaves SEATED');
  ok(!r.u.lethalAt(0, 0, 3) && r.u.hear({ x: 0, y: 0, z: 1, kind: 'bell', loud: 1 }) === false, 'SEATED: nothing lethal, nothing heard');
  r.u.reset();
  ok(r.u.state === 'STAND', 'reset() ends SEATED');
}

// ---- the rope telegraph ---------------------------------------------------------------------------------------------------------------
{
  const r = rig({});
  ok(r.u.telegraph(0, 0, 3) === 0, 'no sphere: no buzz');
  toll(r, 0, 0, 3);
  const vals = [];
  const stages = [];
  const far = [];
  run(r, 5, 0.01, (u) => {
    if (u.sphere) {
      vals.push(u.telegraph(0, 0, 3));
      stages.push(u.sphere.stage);
      far.push(u.telegraph(0, 0, 3 + u.sphere.r + 4.01));
    }
  });
  let mono = true;
  for (let i = 1; i < vals.length; i++) if (vals[i] < vals[i - 1] - 1e-12) mono = false;
  ok(mono && vals[0] === 0.2, 'the buzz rises from LISTEN (0.2) to the whip and never falls');
  const iCoilMid = stages.indexOf('coil') + 100;
  ok(vals[iCoilMid] > 0.35 && vals[iCoilMid] < 0.95, 'and rises through COIL');
  ok(vals[stages.indexOf('commit') + 1] === 1 && vals[stages.indexOf('whip') + 1] === 1, '1.0 at COMMIT and in the WHIP');
  ok(far.every((v) => v === 0), 'an anchor farther than the sphere + 4 m feels nothing');
  r.u.reset();
  toll(r, 0, 0, 3);
  const inner = r.u.telegraph(0, 0, 3 + 3.0 + 2);
  ok(inner > 0 && inner < r.u.telegraph(0, 0, 3), 'between the sphere and +4 m the buzz falls off');
  run(r, 5.2);
  ok(r.u.state === 'RECOIL' && r.u.telegraph(0, 0, 3) === 0, 'RECOIL: the hand is quiet');
}

// ---- determinism and snapshot / restore -----------------------------------------------------------------------------------------------
function script(r, from = 0, to = 60) {
  // a fixed schedule of tolls and orders; returns nothing (events are in r.ev)
  const dt = 0.01;
  const tolls = [
    [1.0, 0, 0, 3, 'bell', {}],
    [9.0, 20, 0, 0, 'gong', { vx: 1 }],
    [10.2, 3, 0, 0, 'machine', {}],
    [20.0, 28, 0, 0, 'great', {}],
    [24.0, 4, 0, 0, 'bell', {}],
    [36.0, 6, 0, 0, 'crash', {}],
    [41.0, 2, 0, 1, 'ring', {}],
  ];
  const cmds = [[14.5, 'snuffAt', { x: 3, y: 0, z: 1 }], [30, 'walk', 0], [50, 'walk', 1]];
  const n0 = Math.round(from / dt);
  const n1 = Math.round(to / dt);
  for (let i = n0; i < n1; i++) {
    const t = i * dt;
    for (const [ts, x, y, z, kind, ex] of tolls) if (Math.abs(t - ts) < dt / 2) toll(r, x, y, z, kind, ex);
    for (const [ts, name, arg] of cmds) if (Math.abs(t - ts) < dt / 2) r.u.command(name, arg);
    r.u.step(dt);
    if (!finite(r.u)) throw new Error('non finite at ' + t);
  }
}
const mkScript = () => {
  const r = rig({ difficulty: 'nightmare' });
  r.u.setPath([{ x: 0, y: 0, z: 0 }, { x: 15, y: 0, z: 0 }, { x: 15, y: 2, z: 20 }]);
  return r;
};
{
  const a = mkScript();
  script(a);
  const b = mkScript();
  script(b);
  const ja = JSON.stringify([a.ev, a.u.snapshot()]);
  const jb = JSON.stringify([b.ev, b.u.snapshot()]);
  ok(a.ev.length > 20, `the script produces events (${a.ev.length})`);
  ok(ja === jb, 'determinism: two runs, identical events and state');
  ok(a.ev.some((e) => e.type === 'snuff') && a.ev.some((e) => e.type === 'whip') && a.ev.some((e) => e.type === 'listen'), 'the script covers listen / whip / snuff');
  // snapshot / restore round trip at several moments
  for (const cut of [1.5, 3.7, 10.0, 14.5, 17.3, 33.0]) {
    const c = mkScript();
    script(c, 0, cut);
    const snap = JSON.parse(JSON.stringify(c.u.snapshot()));
    const mark = c.ev.length;
    script(c, cut, 60);
    const d = mkScript();
    d.u.reset();
    d.u.restore(snap);
    script(d, cut, 60);
    const tail = JSON.stringify(c.ev.slice(mark));
    ok(tail === JSON.stringify(d.ev) && JSON.stringify(c.u.snapshot()) === JSON.stringify(d.u.snapshot()), `snapshot at ${cut} s restores exactly (events after: ${d.ev.length})`);
  }
  const snap = a.u.snapshot();
  ok(JSON.stringify(JSON.parse(JSON.stringify(snap))) === JSON.stringify(snap), 'snapshot() is plain JSON');
  const fresh = new Usher3D({ id: 'x' });
  fresh.restore(snap);
  ok(fresh.state === a.u.state && fresh.pos.x === a.u.pos.x && fresh.time === a.u.time && fresh.reach === a.u.reach, 'restore on a fresh Usher');
  fresh.restore(null);
  fresh.restore({});
  ok(true, 'restore tolerates nothing and {}');
}

// ---- destroy, identity of the reused getters ---------------------------------------------------------------------------------------
{
  const r = rig({});
  r.u.destroy();
  toll(r, 0, 0, 3, 'bell');
  ok(r.u.state === 'STAND', 'destroy() unsubscribes from the bus');
  const q = rig({});
  toll(q, 0, 0, 3);
  ok(q.u.sphere === q.u.sphere && q.u.aim === q.u.aim && q.u.pos === q.u.pos && q.u.anim === q.u.anim, 'getters hand back reused objects (no allocation per read)');
  // large steps are exact too
  const big = rig({});
  toll(big, 0, 0, 3);
  big.u.step(0.7);
  big.u.step(20);
  ok(near(of(big, 'whip')[0].at, 4.5) && near(of(big, 'recoil')[0].at, 4.85) && big.u.state === 'STAND', 'a 20 s step meets every timer exactly');
  const huge = rig({ difficulty: 'abyss' });
  toll(huge, 0, 0, 3, 'gong');
  huge.u.step(100);
  ok(near(of(huge, 'whip')[0].at, 3.5) && huge.u.time === 100 && huge.u.state === 'STAND', 'one step of 100 s');
  const bad = rig({});
  bad.u.step(0);
  bad.u.step(-1);
  bad.u.step(NaN);
  ok(bad.u.time === 0, 'step(0 / negative / NaN) does nothing');
}

console.log(`${fail ? 'FAILED' : 'ok'}: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
