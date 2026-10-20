// Swing / rope physics bench for Abyssal Tether 3D: drives the REAL Player3D / TetherSystem /
// Physics3D (through verify/sim.mjs, so --root / AT3D_ROOT work like every other tool) and
// measures what the owner feels: the near-grab spin, the free pendulum, rope catches, two
// ropes at once, and every bot route on every variant.
//
//   node tools/abyssal-tether-3d/tests/physics/swingbench.mjs [--only 1,2,3,4,5,6,7] [--variant normal|nightmare|abyss|all] [--set rope.maxTensionG=4,...] [--json] [--check]
//
//   1  near grab: attach 1.3 / 1.6 / 2.0 m from the anchor while moving 6 / 9 / 12 m/s tangentially
//      -> peak omega about the anchor (rad/s), peak rope load (g), revolutions in 3 s
//   2  free pendulum, no input, no drag: L = 4 / 8 / 15 m at 10 and 60 degrees ->
//      period vs 2 pi sqrt(L/g) x large-angle correction, energy drift per period
//   3  catches after a 5 / 10 / 20 m free fall onto a rope: peak load (g), rebound, pay-out
//   4  two ropes taut at once: energy gain, jitter, a stalled reel between far-apart anchors
//   5  every bot route on every variant: max omega, max g, frames above 4 g
//   7  a typical game swing, old vs new feel: attach to an anchor ahead-and-above while moving, no input: peak speed, apex height, time
//   6  reeling in on an orbit (gravity off): angular momentum about the anchor before / after, spin-up rate vs the cap
//
// "g" in every load figure is CONFIG.player.gravity (13.5 m/s^2, the game's own unit, as the haptics
// use). Load = specific force = |dv/dt - gravity| / g per fixed step: what an accelerometer on the
// body reads, independent of how the rope is modelled (so a one-step inelastic catch shows its true
// impulse). Steps with a collision are excluded. Without --check this is a read-out (exit code 0);
// --check asserts the limits below on the tables and exits 1 on a miss (tests/run-tests.mjs runs it that way).
import { Sim, Player3D, TetherSystem, Physics3D, EventBus, CONFIG, DIFFICULTY, HANDS, makeIntent, DT, FRAME } from '../../verify/sim.mjs';
import { Bot } from '../../verify/bot.mjs';
import { CHAPTERS, variantKeys } from '../../verify/chapters.mjs';
import { argValue, hasFlag } from '../../verify/args.mjs';

const argv = process.argv.slice(2);
const only = argValue(argv, '--only', '1,2,3,4,5,6,7').split(',').map(Number);
const variants = variantKeys(argValue(argv, '--variant', 'all'));
const asJson = hasFlag(argv, '--json');
const checkMode = hasFlag(argv, '--check');
const failures = [];
const check = (ok, what) => {
  if (!ok) failures.push(what);
};
// --set rope.maxTensionG=4,rope.catchPeakG=6   overrides CONFIG values for this run (tuning sweeps)
for (const kv of argValue(argv, '--set', '').split(',').filter(Boolean)) {
  const [path, val] = kv.split('=');
  const [blk, key] = path.split('.');
  if (!CONFIG[blk] || !(key in CONFIG[blk])) throw new Error(`--set: unknown CONFIG.${path}`);
  CONFIG[blk][key] = Number(val);
}
const G = CONFIG.player.gravity;
const out = { git: process.env.BENCH_LABEL || '', tests: {} };
const log = (...a) => {
  if (!asJson) console.log(...a);
};

// -----------------------------------------------------------------------------
// Rig: a body, two tethers and the physics in an empty world (no solids, no hazards).
// -----------------------------------------------------------------------------
const emptyLevel = {
  bounds: { minY: -1e9, maxY: 1e9 },
  querySolids: (a, b, c, d, e, f, o) => {
    o.length = 0;
    return o;
  },
  queryHazards: (a, b, c, d, e, f, o) => {
    o.length = 0;
    return o;
  },
  anchorsNear: (x, y, z, r, o) => {
    o.length = 0;
    return o;
  },
  segmentBlocked: () => false,
};

class Rig {
  constructor(diffKey = 'normal') {
    this.bus = new EventBus();
    this.diff = DIFFICULTY[diffKey];
    this.player = new Player3D(0, 0, 0);
    this.tethers = new TetherSystem(emptyLevel, this.diff, this.bus, {});
    this.physics = new Physics3D(emptyLevel, this.diff, this.bus);
    this.intent = makeIntent();
    this.events = { slip: 0, jolt: 0, slipMax: 0 };
    this.bus.on('rope:slip', (e) => {
      this.events.slip++;
      this.events.slipMax = Math.max(this.events.slipMax, e.intensity || 0);
    });
    this.bus.on('rope:jolt', () => this.events.jolt++);
    this.g = 0; // load (g) of the last step
  }
  place(x, y, z, vx = 0, vy = 0, vz = 0) {
    const p = this.player;
    p.reset(x, y, z);
    p.vx = vx;
    p.vy = vy;
    p.vz = vz;
  }
  attach(hand, ax, ay, az, length) {
    const an = { id: 'a-' + hand, kind: 'fixed', x: ax, y: ay, z: az };
    this.tethers.attach(this.player, hand, an);
    if (length !== undefined) this.tethers.hands[hand].rope.length = length;
    return an;
  }
  rope(hand) {
    return this.tethers.hands[hand].rope;
  }
  /** One fixed step; sets this.g (load in g) and returns false once a collision/landing happened. */
  step() {
    const p = this.player;
    const v0x = p.vx;
    const v0y = p.vy;
    const v0z = p.vz;
    const li = p.lastImpact;
    this.physics.step(p, this.tethers, this.intent, DT);
    const ax = (p.vx - v0x) / DT;
    const ay = (p.vy - v0y) / DT + G;
    const az = (p.vz - v0z) / DT;
    this.g = Math.sqrt(ax * ax + ay * ay + az * az) / G;
    return p.lastImpact === li && !p.landedThisStep;
  }
}

/** Zero every drag term for the "no drag" tests (whatever the config calls them), run fn, restore. */
function withNoDrag(fn) {
  const P = CONFIG.player;
  const keys = Object.keys(P).filter((k) => /drag/i.test(k) && k !== 'overspeedFriction');
  const saved = keys.map((k) => P[k]);
  for (const k of keys) P[k] = 0;
  try {
    return fn();
  } finally {
    keys.forEach((k, i) => (P[k] = saved[i]));
  }
}

/** Angular rate about an anchor (rad/s): |r x v| / |r|^2. */
function omegaAbout(p, an) {
  const rx = p.x - an.x;
  const ry = p.y - an.y;
  const rz = p.z - an.z;
  const cx = ry * p.vz - rz * p.vy;
  const cy = rz * p.vx - rx * p.vz;
  const cz = rx * p.vy - ry * p.vx;
  const r2 = rx * rx + ry * ry + rz * rz || 1e-9;
  return Math.sqrt(cx * cx + cy * cy + cz * cz) / r2;
}

const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : String(v));
const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : String(v));
const f3 = (v) => (Number.isFinite(v) ? v.toFixed(3) : String(v));
const pad = (s, n) => String(s).padStart(n);

// -----------------------------------------------------------------------------
// 1. near-grab spin
// -----------------------------------------------------------------------------
function test1() {
  log('\n[1] NEAR GRAB: anchor straight above the body, body moving tangentially (horizontal) at attach; 3 s, no input');
  log('    dist  v_t   | peak omega  peak load  load@steady   revs/3s  final omega  final L   slips');
  const rows = [];
  for (const d of [1.3, 1.6, 2.0]) {
    for (const vt of [6, 9, 12]) {
      const r = new Rig();
      r.place(0, 0, 0, vt, 0, 0);
      const an = r.attach('right', 0, d, 0);
      const rope = r.rope('right');
      // signed rotation about the initial angular-momentum axis (x-y plane here: axis = r x v)
      let rev = 0;
      let peakOmega = 0;
      let peakG = 0;
      let prevAng = Math.atan2(r.player.y - an.y, r.player.x - an.x);
      let steadySum = 0;
      let steadyN = 0;
      const N = 720;
      for (let i = 0; i < N; i++) {
        r.step();
        const p = r.player;
        const ang = Math.atan2(p.y - an.y, p.x - an.x);
        let da = ang - prevAng;
        if (da > Math.PI) da -= 2 * Math.PI;
        if (da < -Math.PI) da += 2 * Math.PI;
        // initial motion is +x at the bottom of the circle = counter-clockwise (+angle) about the anchor
        rev += da / (2 * Math.PI);
        prevAng = ang;
        const om = omegaAbout(p, an);
        if (rope.tension > 0 && om > peakOmega) peakOmega = om; // only while the line pulls (a slack body flying past the anchor is not spinning)
        if (r.g > peakG) peakG = r.g;
        if (i >= N - 240) {
          steadySum += r.g;
          steadyN++;
        }
      }
      const row = { dist: d, vt, peakOmega, peakG, steadyG: steadySum / steadyN, revs: rev, finalOmega: omegaAbout(r.player, an), finalL: rope.length, slips: r.events.slip };
      rows.push(row);
      log(`    ${f1(d)}  ${pad(vt, 3)}   | ${pad(f1(peakOmega), 8)}   ${pad(f1(peakG), 8)}   ${pad(f1(row.steadyG), 9)}   ${pad(f2(rev), 8)}  ${pad(f1(row.finalOmega), 10)}  ${pad(f2(rope.length), 7)}   ${r.events.slip}`);
    }
  }
  out.tests.nearGrab = rows;
  for (const r of rows) {
    const tag = `near grab ${r.dist} m @ ${r.vt} m/s`;
    check(r.revs < 1.5, `${tag}: ${f2(r.revs)} revolutions in 3 s (limit 1.5)`);
    check(r.finalOmega < 4, `${tag}: still spinning at ${f1(r.finalOmega)} rad/s after 3 s (limit 4)`);
    check(r.peakG < 8, `${tag}: peak load ${f1(r.peakG)} g (limit 8)`);
  }
}

// -----------------------------------------------------------------------------
// 2. free pendulum
// -----------------------------------------------------------------------------
/** Complete elliptic integral of the first kind K(k) by the arithmetic-geometric mean. */
function ellipticK(k) {
  let a = 1;
  let b = Math.sqrt(1 - k * k);
  for (let i = 0; i < 30; i++) {
    const an = (a + b) / 2;
    b = Math.sqrt(a * b);
    a = an;
  }
  return Math.PI / (2 * a);
}

function test2() {
  log('\n[2] FREE PENDULUM: no input, no drag, released at rest from the amplitude; period over 10 swings, energy at the turning points');
  log('    L(m)  amp  | T measured  T exact(large-angle)  err%   | energy drift %/period (turning points 3..12)');
  const rows = [];
  withNoDrag(() => {
    for (const L of [4, 8, 15]) {
      for (const ampDeg of [10, 60]) {
        const r = new Rig();
        const th = (ampDeg * Math.PI) / 180;
        r.place(L * Math.sin(th), -L * Math.cos(th), 0);
        r.attach('right', 0, 0, 0);
        const exact = ((2 * Math.PI * Math.sqrt(L / G)) * (2 * ellipticK(Math.sin(th / 2)))) / Math.PI;
        // right-hand turning points (vx changes sign at x > 0): one per period
        const turns = []; // { t, E }
        let prevVx = 0;
        let t = 0;
        const total = Math.ceil((exact * 13) / DT);
        for (let i = 0; i < total; i++) {
          r.step();
          t += DT;
          const p = r.player;
          // right-hand extremes only: vx crosses from + to -
          if (prevVx > 0 && p.vx <= 0 && p.x > 0) {
            const f = prevVx / (prevVx - p.vx);
            const E = 0.5 * (p.vx * p.vx + p.vy * p.vy + p.vz * p.vz) + G * p.y;
            turns.push({ t: t - DT + f * DT, E });
          }
          prevVx = p.vx;
        }
        // period: 12 gaps between right-hand extremes, skipping the first one (breathing transient)
        const n = turns.length - 1;
        const period = n >= 4 ? (turns[n].t - turns[1].t) / (n - 1) : NaN;
        const E3 = turns[2] ? turns[2].E : NaN;
        const En = turns[n].E;
        const Ebot = -G * L; // potential at the bottom of the nominal circle (E measured from y = 0 at the anchor)
        const drift = n > 3 ? (((En - E3) / (E3 - Ebot)) * 100) / (n - 2) : NaN;
        const row = { L, ampDeg, period, exact, errPct: ((period - exact) / exact) * 100, driftPctPerPeriod: drift };
        rows.push(row);
        log(`    ${pad(L, 4)}  ${pad(ampDeg, 3)}  | ${pad(f3(period), 9)}  ${pad(f3(exact), 12)}  ${pad(f2(row.errPct), 18)} | ${pad(f3(drift), 10)}`);
      }
    }
  });
  out.tests.pendulum = rows;
  for (const r of rows) {
    const tag = `pendulum L=${r.L} @ ${r.ampDeg} deg`;
    check(Math.abs(r.errPct) < 1, `${tag}: period off by ${f2(r.errPct)} % (limit 1)`);
    check(Math.abs(r.driftPctPerPeriod) < 0.5, `${tag}: energy drift ${f3(r.driftPctPerPeriod)} %/period (limit 0.5)`);
  }
}

// -----------------------------------------------------------------------------
// 3. catches after a free fall
// -----------------------------------------------------------------------------
function test3() {
  log('\n[3] CATCH after a free fall onto a rope (anchor above, slack rope of length L, body starts 0.3 m off the plumb line)');
  log('    fall(m) | v at catch  peak load(g)  rope tension peak(g)  rebound up (m/s, %)  pay-out(m)  stop dist(m)  slips');
  const rows = [];
  for (const L of [5, 10, 20]) {
    const r = new Rig();
    r.place(0.3, 0, 0);
    r.attach('right', 0, 0, 0);
    const rope = r.rope('right');
    rope.length = L;
    let caught = false;
    let vImpact = 0;
    let peakG = 0;
    let peakT = 0;
    let rebound = 0;
    let lowest = 0;
    let tCatch = 0;
    let maxL = L;
    for (let i = 0; i < 240 * 6; i++) {
      const vyBefore = r.player.vy;
      r.step();
      const p = r.player;
      const d = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
      if (!caught && (d >= rope.length - 0.05 || rope.tension > 0)) {
        caught = true;
        vImpact = -vyBefore;
      }
      if (caught) {
        tCatch += DT;
        if (r.g > peakG) peakG = r.g;
        if (rope.tension / G > peakT) peakT = rope.tension / G;
        if (p.vy > rebound) rebound = p.vy;
        if (p.y < lowest) lowest = p.y;
        if (rope.length > maxL) maxL = rope.length;
        if (tCatch > 1.5) break;
      }
    }
    const row = { fall: L, vImpact, peakG, peakTensionG: peakT, reboundUp: rebound, reboundPct: (rebound / vImpact) * 100, payout: maxL - L, stopDist: -lowest - L, slips: r.events.slip };
    rows.push(row);
    log(`    ${pad(L, 5)}   | ${pad(f1(vImpact), 8)}   ${pad(f1(peakG), 10)}   ${pad(f1(peakT), 14)}        ${pad(f1(rebound), 6)} ${pad(f1(row.reboundPct) + '%', 7)}   ${pad(f2(row.payout), 9)}   ${pad(f2(row.stopDist), 10)}   ${r.events.slip}`);
  }
  out.tests.catches = rows;
  for (const r of rows) {
    check(r.peakG < 8, `catch after ${r.fall} m: peak load ${f1(r.peakG)} g (limit 8)`);
    check(r.reboundPct < 10, `catch after ${r.fall} m: rebound ${f1(r.reboundPct)} % of the impact speed (limit 10)`);
  }
}

// -----------------------------------------------------------------------------
// 4. two ropes taut at once
// -----------------------------------------------------------------------------
function test4() {
  log('\n[4] TWO ROPES TAUT: anchors (+-3,0,0), body 4 m below the midpoint; 10 s, no drag');
  log('    case                     | energy J/kg: start -> max -> end   gain vs start   jitter(g, last 3 s)  peak load(g)  max |v|');
  const rows = [];
  withNoDrag(() => {
    // [name, vz, reel seconds (reel both hands in, then stop)]
    const cases = [
      ['cradle swing 5 m/s', 5, 0],
      ['cradle swing 12 m/s', 12, 0],
      ['reel both in 1.5 s, then hold', 0, 1.5],
    ];
    for (const [name, vz, reelT] of cases) {
      const r = new Rig();
      r.place(0, -4, 0, 0, 0, vz);
      const dd = Math.sqrt(9 + 16);
      r.attach('left', -3, 0, 0, dd);
      r.attach('right', 3, 0, 0, dd);
      const E = () => {
        const p = r.player;
        return 0.5 * (p.vx * p.vx + p.vy * p.vy + p.vz * p.vz) + G * p.y;
      };
      let E0 = E(); // energy at the start, or at the moment the reel stops
      let Emax = E0;
      let peakG = 0;
      let jit = 0;
      let prevG = 0;
      let vmax = 0;
      const N = 2400;
      const nReel = Math.round(reelT * 240);
      for (let i = 0; i < N; i++) {
        r.intent.reel = i < nReel ? 1 : 0;
        if (i === nReel && nReel > 0) {
          E0 = E();
          Emax = E0;
        }
        r.step();
        if (r.g > peakG) peakG = r.g;
        if (i >= N - 720) jit = Math.max(jit, Math.abs(r.g - prevG));
        prevG = r.g;
        if (i >= nReel) {
          const e = E();
          if (e > Emax) Emax = e;
        }
        const sp = r.player.speed;
        if (sp > vmax) vmax = sp;
      }
      const ref = Math.max(1, Math.abs(E0 + G * 4) + 0.5 * vz * vz); // energy above the lowest point
      const row = { name, E0, Emax, Eend: E(), gainPct: ((Emax - E0) / ref) * 100, jitter: jit, peakG, vmax };
      rows.push(row);
      log(`    ${name.padEnd(28)} | ${pad(f1(E0), 7)} -> ${pad(f1(Emax), 7)} -> ${pad(f1(row.Eend), 7)}      ${pad(f2(row.gainPct) + '%', 8)}      ${pad(f3(jit), 8)}          ${pad(f1(peakG), 6)}      ${f1(vmax)}`);
    }
  });
  out.tests.twoRopes = rows;
  for (const r of rows) {
    check(Number.isFinite(r.vmax) && r.vmax < CONFIG.player.maxSpeed, `two ropes (${r.name}): speed ${f1(r.vmax)} m/s`);
    check(r.gainPct < 0.5, `two ropes (${r.name}): energy gained ${f2(r.gainPct)} % (limit 0.5)`);
  }
}

// -----------------------------------------------------------------------------
// 5. every bot route on every variant
// -----------------------------------------------------------------------------
function test5() {
  log('\n[5] BOT ROUTES: max angular rate about the anchor, max load, 60 Hz frames above 4 g (rope attached, no collision)');
  log('    variant   route    | result  time   maxOmega  maxG  maxRopeT(g)  frames>4g >6g >10g  slip s  pay m  maxSpeed');
  const rows = [];
  const ch = CHAPTERS.ch1;
  const R = ch.routes;
  const starts = Object.assign({}, R.ROUTE_START, R.ALT_START || {});
  const routes = Object.assign({}, R.ROUTES, R.ALT_ROUTES || {});
  const tot = {};
  for (const v of variants) {
    const level = ch.makeLevel(v);
    for (const key of Object.keys(routes)) {
      const sim = new Sim(level, v);
      const cp = level.sections[starts[key]].checkpoint;
      sim.spawn(cp.x, cp.y, cp.z);
      // slipS = seconds the clutch was paying line out; payM = metres paid out in total. Measured from the line
      // length (not from rope:slip events: the bot's look-ahead restores a snapshot that has no event state).
      const m = { maxOmega: 0, maxG: 0, maxT: 0, frames4: 0, frames6: 0, frames10: 0, speed: 0, slipS: 0, payM: 0 };
      const handL = { left: 0, right: 0 };
      const p = sim.player;
      const ph = sim.physics;
      const orig = ph.step;
      let frameMax = 0;
      let sub = 0;
      ph.step = function (...args) {
        if (sim.ghost) return orig.apply(this, args);
        const v0x = p.vx;
        const v0y = p.vy;
        const v0z = p.vz;
        const li = p.lastImpact;
        const wasGrounded = p.grounded;
        const wasAttached = sim.tethers.attached;
        for (const h of HANDS) handL[h] = sim.tethers.hands[h].rope.attached ? sim.tethers.hands[h].rope.length : -1;
        const r = orig.apply(this, args);
        if (wasAttached || sim.tethers.attached) {
          const ax = (p.vx - v0x) / DT;
          const ay = (p.vy - v0y) / DT + G;
          const az = (p.vz - v0z) / DT;
          const clean = p.lastImpact === li && !p.landedThisStep && !p.grounded && !wasGrounded; // ground friction / run accel are not rope load
          if (clean) {
            const g = Math.sqrt(ax * ax + ay * ay + az * az) / G;
            if (g > m.maxG) m.maxG = g;
            if (g > frameMax) frameMax = g;
          }
          let t = 0;
          for (const h of HANDS) {
            const rope = sim.tethers.hands[h].rope;
            if (!rope.attached) continue;
            const om = omegaAbout(p, rope.anchor);
            if (rope.tension > 0 && om > m.maxOmega) m.maxOmega = om;
            const pay = handL[h] >= 0 ? rope.length - handL[h] - (rope.dl || 0) : 0;
            if (pay > 1e-9) {
              m.payM += pay;
              m.slipS += DT;
            }
            t += rope.tension;
          }
          if (t / G > m.maxT) m.maxT = t / G;
        }
        const sp = p.speed;
        if (sp > m.speed) m.speed = sp;
        if (++sub === 4) {
          if (frameMax > 4) m.frames4++;
          if (frameMax > 6) m.frames6++;
          if (frameMax > 10) m.frames10++;
          frameMax = 0;
          sub = 0;
        }
        return r;
      };
      const bot = new Bot(sim, routes[key], {});
      const res = bot.runRoute();
      const ok = res.ok && res.deaths === 0 && res.maxLand < 0.85;
      const row = { variant: v, route: key, ok, time: res.time, ...m };
      rows.push(row);
      log(`    ${v.padEnd(9)} ${key.padEnd(8)} | ${ok ? 'PASS' : 'FAIL'}  ${pad(f1(res.time), 5)}  ${pad(f1(m.maxOmega), 7)}  ${pad(f1(m.maxG), 5)}  ${pad(f1(m.maxT), 8)}  ${pad(m.frames4, 9)} ${pad(m.frames6, 3)} ${pad(m.frames10, 4)}  ${pad(f1(m.slipS), 6)}  ${pad(f1(m.payM), 5)}  ${pad(f1(m.speed), 7)}`);
      tot.omega = Math.max(tot.omega || 0, m.maxOmega);
      tot.g = Math.max(tot.g || 0, m.maxG);
      tot.f4 = (tot.f4 || 0) + m.frames4;
      tot.f6 = (tot.f6 || 0) + m.frames6;
      tot.f10 = (tot.f10 || 0) + m.frames10;
      tot.time = (tot.time || 0) + res.time;
      tot.slipS = (tot.slipS || 0) + m.slipS;
      tot.payM = (tot.payM || 0) + m.payM;
      tot.fail = (tot.fail || 0) + (ok ? 0 : 1);
    }
  }
  log(`    TOTAL: max omega ${f1(tot.omega)} rad/s, max load ${f1(tot.g)} g, frames above 4 g ${tot.f4} / 6 g ${tot.f6} / 10 g ${tot.f10}, slipping ${f1(tot.slipS)} s / ${f1(tot.payM)} m of line in total, summed route time ${f1(tot.time)} s, failing routes ${tot.fail}`);
  out.tests.routes = { rows, total: tot };
  check(tot.fail === 0, `${tot.fail} bot route(s) failed`);
  check(tot.f10 === 0, `${tot.f10} 60 Hz frame(s) above 10 g on the routes`);
  check(tot.g < 9, `route peak load ${f1(tot.g)} g (limit 9)`);
  check(tot.omega < 9, `route peak angular rate ${f1(tot.omega)} rad/s (limit 9)`);
}

// -----------------------------------------------------------------------------
// 6. reeling conserves angular momentum
// -----------------------------------------------------------------------------
function test6() {
  log('\n[6] REEL IN ON A CONICAL SWING (no drag; anchor at the origin, body 40 deg off the plumb line, moving round it): h = x vz - z vx (the');
  log('    angular momentum about the vertical axis through the anchor, conserved by any central pull) before the reel -> after it');
  log('    L(m)  v_t  reel(m/s) | h before -> after   change%  | r_xz before -> after  tangential speed after  peak load(g)');
  const rows = [];
  withNoDrag(() => {
    for (const [L, vt, speed] of [[8, 5, 9.5], [6, 6, 9.5], [5, 5, 17]]) {
      const r = new Rig();
      const th = (40 * Math.PI) / 180;
      r.place(L * Math.sin(th), -L * Math.cos(th), 0, 0, 0, vt);
      r.attach('right', 0, 0, 0);
      const p = r.player;
      const h = () => p.x * p.vz - p.z * p.vx;
      const rxz = () => Math.sqrt(p.x * p.x + p.z * p.z);
      const h0 = h();
      const r0 = rxz();
      const useYank = speed > CONFIG.rope.reelInSpeed;
      r.intent.reel = useYank ? 0 : 1;
      r.intent.hands.right.yank = useYank ? speed / CONFIG.rope.yankSpeed : 0;
      let peak = 0;
      for (let i = 0; i < 240 && r.rope('right').length > CONFIG.rope.minLength + 0.01; i++) {
        r.step();
        if (r.g > peak) peak = r.g;
      }
      r.intent.reel = 0;
      r.intent.hands.right.yank = 0;
      for (let i = 0; i < 6; i++) r.step();
      const h1 = h();
      const row = { L, vt, speed, h0, h1, changePct: ((h1 - h0) / h0) * 100, r0, r1: rxz(), vtAfter: Math.abs(h1) / rxz(), peakG: peak };
      rows.push(row);
      log(`    ${pad(L, 4)}  ${pad(vt, 3)}  ${pad(speed, 7)}  | ${pad(f2(h0), 7)} -> ${pad(f2(h1), 7)}  ${pad(f2(row.changePct), 7)}  | ${pad(f2(r0), 5)} -> ${pad(f2(row.r1), 5)}      ${pad(f2(row.vtAfter), 8)}                ${pad(f1(peak), 5)}`);
    }
  });
  out.tests.reel = rows;
  for (const r of rows) check(Math.abs(r.changePct) < 0.5, `reel ${r.L} m: angular momentum changed ${f2(r.changePct)} % (limit 0.5)`);
}

// -----------------------------------------------------------------------------
// 7. a typical swing (feel)
// -----------------------------------------------------------------------------
function test7() {
  log('\n[7] TYPICAL SWING: body at the origin moving 8 m/s forward (+x), anchor ahead and above, no input, 8 s, drag as configured');
  log('    anchor (x,y)   L(m) | peak speed  first apex height  t(apex)  speed at 4 s  load peak(g)  slips');
  const rows = [];
  for (const [ax, ay] of [[8, 10], [12, 14], [6, 18], [20, 12]]) {
    const r = new Rig();
    r.place(0, 0, 0, 8, 0, 0);
    r.attach('right', ax, ay, 0);
    const p = r.player;
    let peak = 0;
    let apexY = -Infinity;
    let apexT = 0;
    let peakG = 0;
    let passedBottom = false;
    let v4 = 0;
    let prevVy = 0;
    const N = 240 * 8;
    for (let i = 0; i < N; i++) {
      r.step();
      if (p.speed > peak) peak = p.speed;
      if (r.g > peakG) peakG = r.g;
      if (p.vy > 0) passedBottom = true;
      if (passedBottom && prevVy > 0 && p.vy <= 0 && apexT === 0) {
        apexY = p.y;
        apexT = i * DT;
      }
      prevVy = p.vy;
      if (i === 240 * 4) v4 = p.speed;
    }
    const row = { ax, ay, L: Math.sqrt(ax * ax + ay * ay), peak, apexY, apexT, v4, peakG, slips: r.events.slip };
    rows.push(row);
    log(`    (${pad(ax, 2)},${pad(ay, 2)})      ${pad(f1(row.L), 5)} | ${pad(f1(peak), 8)}  ${pad(f1(apexY), 14)}  ${pad(f2(apexT), 7)}  ${pad(f1(v4), 10)}  ${pad(f1(peakG), 10)}   ${r.events.slip}`);
  }
  out.tests.typical = rows;
}

log(`swingbench: gravity ${G} m/s^2, dt 1/${Math.round(1 / DT)} s, rope.minLength ${CONFIG.rope.minLength}${CONFIG.rope.maxTensionG ? ', rope.maxTensionG ' + CONFIG.rope.maxTensionG : ' (no clutch)'}`);
void FRAME;
if (only.includes(1)) test1();
if (only.includes(2)) test2();
if (only.includes(3)) test3();
if (only.includes(4)) test4();
if (only.includes(5)) test5();
if (only.includes(6)) test6();
if (only.includes(7)) test7();
if (asJson) console.log(JSON.stringify(out));
if (checkMode) {
  for (const msg of failures) console.log('FAIL  ' + msg);
  console.log(failures.length ? `\n${failures.length} CHECK(S) FAILED` : '\nALL CHECKS PASS');
  process.exitCode = failures.length ? 1 : 0;
}
