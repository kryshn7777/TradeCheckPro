// Waypoint bot driving the REAL physics through the same intent interface the
// game uses. For an ordered route it aims a ray from the body at the next anchor
// (TetherSystem.findTarget must return exactly that anchor), attaches with
// alternating hands (the next before releasing the previous), pumps / reels
// toward the next waypoint, and decides releases with a look-ahead: it clones
// the simulation state, lets go, flies with the same air-steering controller
// and only releases when the clone lands on the intended platform below
// 0.85 × lethal impact.
//
// Flight: a shot is a projectile (TetherSystem.fire / launch): the hook is IN FLIGHT for distance / CONFIG.rope.flightSpeed
// (<= flightMax) and the line attaches on arrival, then builds its pull over attachRamp. The bot therefore presses once, keeps
// holding while the hook flies (steering / pumping on as before, no second press), and a chain (the next hook before letting go of
// the previous one) lets go of the old line only when the new one has bitten (chainRelease), never during the flight.
//
// Route steps:
//   { a: 'anchorId', mode?: 'apex'|'asap'|'near', near?: m, walk?: [x,z], reel?: r, jump?: bool, t?: s }
//   { p: 'solidId', mode?: 'swing'|'lower'|'walk'|'auto', at?: [x,z], reel?: r, jump?: bool, ok?: [ids], t?: s }
//   { w: [x,z], jump?: bool }       walk to a point on the ground (not attached)
//   { release: true }
//   { goal: true }                  run/air-steer into the goal box
// Objective verbs (LEVEL_FUN_PLAN P3, sim/objectives3d.js):
//   { ring: 'fixtureId', walk?: [x,z], reel?: r }   hanging on the current line, pump toward a bell until it is struck
//                                                   (standing: run toward walk / the bell to step off)
//   { haul: 'objectiveId', keep?: bool, walk?: [x,z] }  yank the hand on the objective's haul ring until it is done, then
//                                                   let go (walk: keep walking there while hauling, the rope slack)
//   { light: 'fixtureId' }                          walk up to a lamp, hold the lantern probe PROBE_OUT m toward its wick
//                                                   until it is lit
import { makeIntent, FRAME, HANDS, CONFIG } from './sim.mjs';

const G = CONFIG.player.gravity;
/** Frames of the longest hook flight (+ one for the arrival frame): the look-ahead windows are this much longer. */
const SPIN_LIMIT = 6; // rad/s about the anchor above which the bot stops reeling in
const MIN_BITE_LENGTH = 3.2; // m: a chained hook must bite with at least this much line (see testChain)
const HP_RESERVE = 0.25; // landings are planned to leave this much health (fraction of full)
const FLIGHT_FRAMES = Math.ceil(CONFIG.rope.flightMax * 60) + 1;
/** The bots hold the lantern this far from the body toward a lamp's wick (LEVEL_FUN_PLAN item 2: "probe = body + 0.5 m"). */
export const PROBE_OUT = 0.5;
// The bot plans its releases and catches so that no landing comes close to lethal. With fall damage (health3d.js) a
// landing at 85 % of the lethal speed costs ~60 hp, so the bot now plans at 68 % (at most ~27 hp a landing). The look-ahead
// takes no damage itself (it only judges the landing speed), so a line is the same on every difficulty; the real run shows
// what it costs. The verify gate on a route's real maximum stays 0.85 (LAND_OK). AT3D_LAND_LIMIT overrides the planning
// limit for experiments.
const LAND_LIMIT = (typeof process !== 'undefined' && process.env && Number(process.env.AT3D_LAND_LIMIT)) || 0.68; // (the browser e2e runs this file too)
// Reach floors (LEVEL_FUN_PLAN item 5): the bot plays every line with the section's reach shortened by this much, so a line
// that passes leaves a player 1.5 m of targeting range to spare (verify.mjs REACH_MARGIN checks the shots it fired).
const REACH_MARGIN_ENV = typeof process !== 'undefined' && process.env ? Number(process.env.AT3D_REACH_MARGIN) : NaN;
export const BOT_REACH_MARGIN = isFinite(REACH_MARGIN_ENV) ? REACH_MARGIN_ENV : 1.5;

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export class Bot {
  constructor(sim, route, opts = {}) {
    this.sim = sim;
    this.level = sim.level;
    this.route = route;
    this.i = 0;
    this.intent = makeIntent();
    this.gIntent = makeIntent();
    this.holding = { left: false, right: false };
    this.lastHand = opts.firstHand === 'left' ? 'right' : 'left';
    this.stepT = 0;
    this.okStreak = 0;
    this.prevAlong = null;
    this.pendingRelease = [];
    this.chainRelease = null; // { hand, others }: let go of `others` once `hand`'s hook has bitten
    this.fail = null;
    this.log = [];
    this.maxFrames = opts.maxFrames || 60 * 400;
    this.verbose = !!opts.verbose;
    this.reachMargin = opts.reachMargin !== undefined ? opts.reachMargin : BOT_REACH_MARGIN;
    this.lookaheads = 0;
    this.misTarget = [];
  }

  get p() {
    return this.sim.player;
  }

  anchor(id) {
    if (Array.isArray(id)) {
      for (const k of id) if (this.level.byId[k] && this.level.byId[k].minX === undefined) return this.level.byId[k];
      throw new Error(`no anchor among ${id}`);
    }
    const a = this.level.byId[id];
    if (!a || a.x === undefined || a.minX !== undefined) throw new Error(`no anchor ${id}`);
    return a;
  }

  solid(id) {
    if (Array.isArray(id)) {
      for (const k of id) if (this.level.byId[k] && this.level.byId[k].minX !== undefined) return this.level.byId[k];
      throw new Error(`no solid among ${id}`);
    }
    const s = this.level.byId[id];
    if (!s || s.minX === undefined) throw new Error(`no solid ${id}`);
    return s;
  }

  // -------------------------------------------------------------------------
  // Aiming
  // -------------------------------------------------------------------------
  aimAt(it, hand, an) {
    const p = this.p;
    const dx = an.x - p.x;
    const dy = an.y - p.y;
    const dz = an.z - p.z;
    const l = Math.hypot(dx, dy, dz) || 1;
    const hi = it.hands[hand];
    if (!hi.aim) hi.aim = { ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: 0 };
    hi.aim.ox = p.x;
    hi.aim.oy = p.y;
    hi.aim.oz = p.z;
    hi.aim.dx = dx / l;
    hi.aim.dy = dy / l;
    hi.aim.dz = dz / l;
    return hi.aim;
  }

  /** Would firing `hand` along the body→anchor ray attach exactly `an`? */
  targetable(an, hand) {
    const p = this.p;
    const dx = an.x - p.x;
    const dy = an.y - p.y;
    const dz = an.z - p.z;
    const l = Math.hypot(dx, dy, dz);
    if (l > this.sim.tethers.aimRangeAt(p) - this.reachMargin || an.broken) return false; // the section's reach minus the bot's margin
    const aim = { ox: p.x, oy: p.y, oz: p.z, dx: dx / l, dy: dy / l, dz: dz / l };
    const r = this.sim.tethers.findTarget(p, aim, hand);
    if (r && r.anchor !== an) {
      if (this.misTarget.length < 20) this.misTarget.push([an.id, r.anchor.id, +this.sim.t.toFixed(2)]);
      return false;
    }
    return !!r;
  }

  attachedHands() {
    return this.sim.attachedHands();
  }

  currentAnchor() {
    const T = this.sim.tethers;
    let best = null;
    let bestT = Infinity;
    for (const h of HANDS) {
      const st = T.hands[h];
      if (st.rope.attached && st.attachTime < bestT) {
        bestT = st.attachTime;
        best = st.rope.anchor;
      }
    }
    return best;
  }

  /** The hand whose hook is in the air towards anchor `an` (or any anchor when `an` is omitted), else null. */
  flyingHand(an) {
    const T = this.sim.tethers;
    for (const h of HANDS) {
      const st = T.hands[h];
      if (st.flying && (!an || st.flightObj.target === an)) return h;
    }
    return null;
  }

  freeHand() {
    const T = this.sim.tethers;
    const l = T.hands.left.rope.attached || T.hands.left.flying;
    const r = T.hands.right.rope.attached || T.hands.right.flying;
    if (l && !r) return 'right';
    if (r && !l) return 'left';
    return this.lastHand === 'right' ? 'left' : 'right';
  }

  // -------------------------------------------------------------------------
  // Movement controllers (write it.move / it.reel)
  // -------------------------------------------------------------------------
  run(it, tx, tz) {
    const p = this.p;
    const dx = tx - p.x;
    const dz = tz - p.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) {
      it.move.x = 0;
      it.move.z = 0;
      return d;
    }
    const k = Math.min(1, d / 0.6);
    it.move.x = (dx / d) * k;
    it.move.z = (dz / d) * k;
    return d;
  }

  airSteer(it, tx, tz, topY) {
    const p = this.p;
    const h = p.y - (topY + p.radius);
    const disc = p.vy * p.vy + 2 * G * h;
    let T = disc > 0 ? (p.vy + Math.sqrt(disc)) / G : 0.3;
    T = clamp(T, 0.05, 4);
    const ex = tx - (p.x + p.vx * T);
    const ez = tz - (p.z + p.vz * T);
    const el = Math.hypot(ex, ez);
    if (el < 0.03) {
      it.move.x = 0;
      it.move.z = 0;
      return;
    }
    const k = Math.min(1, el / 0.4);
    it.move.x = (ex / el) * k;
    it.move.z = (ez / el) * k;
  }

  /** Resonance pumping along the horizontal axis anchor → target, damping sideways motion. */
  pump(it, an, tx, tz) {
    const p = this.p;
    let ax = tx - an.x;
    let az = tz - an.z;
    let al = Math.hypot(ax, az);
    if (al < 0.5) {
      ax = tx - p.x;
      az = tz - p.z;
      al = Math.hypot(ax, az);
    }
    if (al < 1e-3) {
      it.move.x = -p.vx * 0.3;
      it.move.z = -p.vz * 0.3;
      return 0;
    }
    ax /= al;
    az /= al;
    const along = p.vx * ax + p.vz * az;
    let mx;
    let mz;
    if (Math.abs(along) < 0.6) {
      mx = ax;
      mz = az;
    } else if (p.speed > (this.speedCap || 16)) {
      // Fast enough: no more pumping, just keep the swing plane aimed (human-like).
      mx = 0;
      mz = 0;
    } else {
      const s = Math.sign(along);
      mx = ax * s;
      mz = az * s;
    }
    const px = p.vx - along * ax;
    const pz = p.vz - along * az;
    const pl = Math.hypot(px, pz);
    if (pl > 0.15) {
      const k = Math.min(1, pl / 2) * 0.9;
      mx -= (px / pl) * k;
      mz -= (pz / pl) * k;
    }
    const ml = Math.hypot(mx, mz);
    if (ml > 1) {
      mx /= ml;
      mz /= ml;
    }
    it.move.x = mx;
    it.move.z = mz;
    return along;
  }

  /** PD steer over a point while hanging (lowering). */
  hover(it, tx, tz) {
    const p = this.p;
    let mx = (tx - p.x) * 0.5 - p.vx * 0.6;
    let mz = (tz - p.z) * 0.5 - p.vz * 0.6;
    const ml = Math.hypot(mx, mz);
    if (ml > 1) {
      mx /= ml;
      mz /= ml;
    }
    it.move.x = mx;
    it.move.z = mz;
  }

  edgeAhead(it) {
    const p = this.p;
    const ml = Math.hypot(it.move.x, it.move.z);
    if (ml < 0.1) return false;
    const qx = p.x + (it.move.x / ml) * 0.9;
    const qz = p.z + (it.move.z / ml) * 0.9;
    const list = this.level.querySolids(qx - 0.05, p.y - p.radius - 1.2, qz - 0.05, qx + 0.05, p.y - p.radius + 0.05, qz + 0.05, []);
    for (const s of list) if (s.active !== false) return false;
    return true;
  }

  // -------------------------------------------------------------------------
  // Hands
  // -------------------------------------------------------------------------
  press(it, hand, an) {
    this.aimAt(it, hand, an);
    it.hands[hand].pressed = true;
    it.hands[hand].held = true;
    this.holding[hand] = true;
    this.lastHand = hand;
  }

  releaseHand(it, hand) {
    if (!this.holding[hand]) return;
    this.holding[hand] = false;
    it.hands[hand].held = false;
    it.hands[hand].released = true;
  }

  releaseAll(it) {
    for (const h of HANDS) this.releaseHand(it, h);
  }

  prepIntent(it, holding) {
    it.move.x = 0;
    it.move.z = 0;
    it.reel = 0;
    it.jumpPressed = false;
    it.brake = false;
    for (const h of HANDS) {
      const hi = it.hands[h];
      hi.pressed = false;
      hi.released = false;
      hi.yank = 0;
      hi.held = holding[h];
    }
    if (it.probe) it.probe.on = false;
  }

  /** Is the look-ahead's landing unacceptable (a landing above LAND_LIMIT of the lethal speed)? */
  landBad() {
    return this.sim.ghostMaxLand >= this.landLimit();
  }

  /**
   * The planning limit on a landing (fraction of the lethal speed): LAND_LIMIT while healthy; as health drops it shrinks so the
   * expected fall damage ((r - threshold) / (1 - threshold))^fallExp leaves HP_RESERVE of full health (a bot on a no-recovery
   * difficulty must not spend its health as if it were refilled at every landing).
   */
  landLimit() {
    const sim = this.sim;
    const hp = sim.physics && sim.physics.health ? sim.physics.health.hp : 1;
    const th = sim.diff.health ? sim.diff.health.fallThreshold : 0.35;
    const room = hp - HP_RESERVE;
    const r = th + (1 - th) * Math.pow(Math.max(0.02, room), 1 / CONFIG.health.fallExp);
    return r < LAND_LIMIT ? r : LAND_LIMIT;
  }

  // -------------------------------------------------------------------------
  // Look-ahead (clone → simulate → restore)
  // -------------------------------------------------------------------------
  lookahead(first, ctrl, maxFrames, judge) {
    const sim = this.sim;
    this.lookaheads++;
    const snap = sim.snapshot();
    const savedHolding = { left: this.holding.left, right: this.holding.right };
    const savedLast = this.lastHand;
    // The bot plans on the lethal landing limit only (as before the health model): look-ahead frames take no
    // damage, so its lines are the same as without health and the real run shows what they cost.
    const hp = sim.physics ? sim.physics.health : null;
    const godWas = hp ? hp.god : false;
    if (hp) hp.god = true;
    sim.ghost = true;
    sim.ghostMaxLand = 0;
    const it = this.gIntent;
    this.prepIntent(it, this.holding);
    first(it);
    sim.frame(it);
    let res = false;
    for (let k = 0; k < maxFrames; k++) {
      if (!sim.player.alive) {
        res = false;
        break;
      }
      const r = judge(k);
      if (r !== undefined) {
        res = r;
        break;
      }
      this.prepIntent(it, this.holding);
      ctrl(it, k);
      sim.frame(it);
    }
    sim.ghost = false;
    if (hp) hp.god = godWas;
    sim.restore(snap);
    this.holding.left = savedHolding.left;
    this.holding.right = savedHolding.right;
    this.lastHand = savedLast;
    return res;
  }

  /** Release now, air-steer to (tx,tz) on solid P: lands on P (or ok ids) safely? */
  testRelease(P, tx, tz, okIds) {
    let groundedFrames = 0;
    const top = P.maxY;
    return this.lookahead(
      (it) => this.releaseAll(it),
      (it) => {
        if (this.p.grounded) {
          it.brake = true;
        } else this.airSteer(it, tx, tz, top);
      },
      330,
      () => {
        const p = this.p;
        if (p.grounded) {
          const gs = p.groundSolid;
          if (!gs || (gs !== P && !(okIds && okIds.includes(gs.id)))) return false;
          if (++groundedFrames > 24) return !this.landBad();
        } else if (groundedFrames > 0) return false;
        if (p.y < top - 30) return false;
        return undefined;
      },
    );
  }

  /**
   * Fall-arrest catch: attach `an` now, hold until it gives (fragile) or for
   * 1.5 s, then (if the route continues onto a platform) steer onto it.
   * Safe = no death and no landing >= 0.85 lethal in the whole window.
   */
  testCatch(an, hand, next) {
    const P = next && next.p ? this.solid(next.p) : null;
    const hold = an.kind === 'fragile' ? Math.round(this.sim.diff.fragileTime * 60) + 2 : 90;
    const tx = P ? (next.at ? next.at[0] : (P.minX + P.maxX) / 2) : an.x;
    const tz = P ? (next.at ? next.at[1] : (P.minZ + P.maxZ) / 2) : an.z;
    return this.lookahead(
      (it) => this.press(it, hand, an),
      (it) => {
        if (this.p.grounded) it.brake = true;
        else if (P) {
          if (this.sim.tethers.hands[hand].rope.attached) this.hover(it, tx, tz);
          else this.airSteer(it, tx, tz, P.maxY);
        }
      },
      hold + 100 + FLIGHT_FRAMES,
      (k) => (this.landBad() ? false : k >= hold + 99 + FLIGHT_FRAMES ? true : undefined),
    );
  }

  /** Attach `an` with `hand` now, release the others next frame, hang: safe? */
  testChain(an, hand) {
    const others = HANDS.filter((h) => h !== hand && this.holding[h]);
    const horizon = an.kind === 'fragile' ? Math.round(this.sim.diff.fragileTime * 0.85 * 60) : 135;
    // The hook flies first (the old line is kept until it bites), then the horizon counts from the bite.
    let bitAt = -1;
    let tooShort = false;
    return this.lookahead(
      (it) => this.press(it, hand, an),
      (it, k) => {
        const st = this.sim.tethers.hands[hand];
        if (bitAt < 0 && st.rope.attached) {
          bitAt = k;
          for (const h of others) this.releaseHand(it, h);
          // The body keeps moving while the hook flies: a bite on a line that is nearly spent (the hook lands under / beside
          // the body) is a fast tight spin around the anchor. Not a line a player would take.
          if (st.rope.length < MIN_BITE_LENGTH) tooShort = true;
        }
      },
      horizon + FLIGHT_FRAMES,
      (k) => {
        const T = this.sim.tethers;
        const st = T.hands[hand];
        if (!st.rope.attached && !st.flying) return false;
        if (tooShort || this.landBad()) return false;
        if (bitAt >= 0 && k - bitAt >= horizon - 1) return true;
        return undefined;
      },
    );
  }

  // -------------------------------------------------------------------------
  // Main loop
  // -------------------------------------------------------------------------
  runRoute() {
    const sim = this.sim;
    const it = this.intent;
    let frames = 0;
    while (this.i < this.route.length) {
      if (!sim.player.alive) {
        this.fail = `died (${sim.deathCause}) at step ${this.i} ${JSON.stringify(this.route[this.i])}`;
        break;
      }
      if (frames++ > this.maxFrames) {
        this.fail = 'frame budget exhausted';
        break;
      }
      this.prepIntent(it, this.holding);
      for (const h of this.pendingRelease) this.releaseHand(it, h);
      this.pendingRelease.length = 0;
      // A chain: the new hook has bitten, now let go of the old line(s). (If the hook missed, keep the old line.)
      const cr = this.chainRelease;
      if (cr) {
        const cst = sim.tethers.hands[cr.hand];
        if (cst.rope.attached) {
          for (const h of cr.others) this.releaseHand(it, h);
          this.chainRelease = null;
        } else if (!cst.flying) this.chainRelease = null;
      }
      // A rope that broke (or a hook that fell off) while held: let go of the trigger.
      for (const h of HANDS) if (this.holding[h] && !sim.tethers.hands[h].rope.attached && !sim.tethers.hands[h].flying) this.releaseHand(it, h);
      const step = this.route[this.i];
      const limit = step.t || 25;
      if (this.stepT > limit) {
        this.fail = `timeout at step ${this.i} ${JSON.stringify(step)} pos ${this.p.x.toFixed(1)},${this.p.y.toFixed(1)},${this.p.z.toFixed(1)} v ${this.p.vx.toFixed(1)},${this.p.vy.toFixed(1)},${this.p.vz.toFixed(1)} grounded ${this.p.grounded} att ${this.attachedHands()}`;
        break;
      }
      let done = false;
      if (step.a) done = this.stepAnchor(it, step);
      else if (step.p) done = this.stepPlatform(it, step);
      else if (step.w) done = this.stepWalk(it, step);
      else if (step.wait !== undefined) {
        const A = this.currentAnchor();
        if (A && step.toward) this.pump(it, A, step.toward[0], step.toward[1]);
        else if (step.toward) this.run(it, step.toward[0], step.toward[1]);
        let due = this.stepT + FRAME >= step.wait;
        if (step.untilNear) {
          const an = this.level.byId[step.untilNear[0]];
          due = due || Math.hypot(an.x - this.p.x, an.y - this.p.y, an.z - this.p.z) < step.untilNear[1];
        }
        if (step.release && due) this.releaseAll(it);
        done = due;
      } else if (step.release) {
        this.releaseAll(it);
        done = true;
      } else if (step.goal) done = this.stepGoal(it, step);
      else if (step.ring) done = this.stepRing(it, step);
      else if (step.haul) done = this.stepHaul(it, step);
      else if (step.light) done = this.stepLight(it, step);
      sim.frame(it);
      this.stepT += FRAME;
      if (done) {
        if (this.verbose) console.log(`  step ${this.i} done t=${sim.t.toFixed(2)}`, JSON.stringify(step), this.p.x.toFixed(1), this.p.y.toFixed(1), this.p.z.toFixed(1));
        this.log.push([this.i, +sim.t.toFixed(2)]);
        this.i++;
        this.stepT = 0;
        this.okStreak = 0;
        this.prevAlong = null;
        this.minD = Infinity;
        this.fromReached = false;
      }
    }
    if (!this.fail && !sim.player.alive) this.fail = `died (${sim.deathCause}) at the end`;
    return {
      ok: !this.fail,
      fail: this.fail,
      time: sim.t,
      deaths: sim.deaths,
      maxLand: sim.maxLand,
      maxLandAt: sim.maxLandAt,
      attaches: sim.attaches.slice(),
      lookaheads: this.lookaheads,
      misTarget: this.misTarget,
      damage: sim.damageReport ? sim.damageReport() : null,
    };
  }

  stepAnchor(it, step) {
    const p = this.p;
    const N = this.anchor(step.a);
    const T = this.sim.tethers;
    for (const h of HANDS) if (T.hands[h].rope.anchor === N && this.holding[h]) return true;
    const flying = this.flyingHand(N) !== null; // our hook is already on its way to N: no second press
    const att = this.attachedHands();
    const hand = step.hand && !T.hands[step.hand].rope.attached ? step.hand : this.freeHand();
    if (att.length === 0) {
      if (step.from && !this.fromReached) {
        if (Math.hypot(step.from[0] - p.x, step.from[1] - p.z) > 0.35 || !p.grounded) {
          this.run(it, step.from[0], step.from[1]);
          return false;
        }
        this.fromReached = true;
      }
      const belowOk = step.mode !== 'below' || p.y < N.y - (step.below || 0.6);
      // Airborne catch: only when the look-ahead says the rope arrests us clear of the floor.
      const catchOk = p.grounded || (step.mode === 'below' ? this.testCatch(N, hand, this.route[this.i + 1]) : this.testChain(N, hand));
      if (flying) {
        // The hook is in the air: keep moving as the step does (a human does not stop to watch it fly).
        if (!p.grounded) this.airSteer(it, step.walk ? step.walk[0] : N.x, step.walk ? step.walk[1] : N.z, N.y - 30);
        return false;
      }
      if (belowOk && this.targetable(N, hand) && (!step.jump || !p.grounded) && catchOk) {
        this.press(it, hand, N);
        return false;
      }
      if (p.grounded) {
        const w = step.walk || [N.x, N.z];
        const d = this.run(it, w[0], w[1]);
        if (step.jump && (d < 0.5 || this.edgeAhead(it))) it.jumpPressed = true;
      } else {
        this.airSteer(it, step.walk ? step.walk[0] : N.x, step.walk ? step.walk[1] : N.z, N.y - 30);
      }
      return false;
    }
    // Attached to something else: pump toward N; chain at a good moment.
    const A = this.currentAnchor();
    if (step.mode === 'below') {
      // Fall-arrest chain: hang until the fall is killed, then let go and drop past N.
      const st = this.sim.tethers.hands[att[0]];
      if (st.attachTime > (step.hang || 0.25) && Math.abs(p.vy) < (step.vyMax || 3)) this.releaseAll(it);
      return false;
    }
    if (p.grounded) {
      const w = step.walk || [N.x, N.z];
      this.run(it, w[0], w[1]);
      if (step.jump && this.edgeAhead(it)) it.jumpPressed = true;
    } else {
      const along = this.pump(it, A, N.x, N.z);
      it.reel = step.reel || 0;
      if (step.reelFn) it.reel = step.reelFn(this);
      this.unstick(it, A, N.x, N.z);
      this.governor(it, A, N.x, N.z, it.reel);
      const d = Math.hypot(N.x - p.x, N.y - p.y, N.z - p.z);
      let good = false;
      const mode = A.kind === 'fragile' ? 'asap' : step.mode || 'apex';
      if (mode === 'asap') good = true;
      else if (mode === 'near') good = d < (step.near || 8);
      else {
        const prev = this.prevAlong;
        good = (prev !== null && prev > 0.3 && along <= 0.3) || d < (step.near || 6) || (p.speed < 1.2 && this.stepT > 1.5) || this.stepT > 9;
      }
      this.prevAlong = along;
      if (good && !flying && this.targetable(N, hand) && this.testChain(N, hand)) {
        const others = HANDS.filter((h) => h !== hand && this.holding[h]);
        this.press(it, hand, N);
        this.chainRelease = { hand, others };
      }
    }
    return false;
  }

  stepPlatform(it, step) {
    const p = this.p;
    const P = this.solid(step.p);
    const tx = step.at ? step.at[0] : (P.minX + P.maxX) / 2;
    const tz = step.at ? step.at[1] : (P.minZ + P.maxZ) / 2;
    const att = this.attachedHands();
    const onP = p.grounded && (p.groundSolid === P || (step.ok && p.groundSolid && step.ok.includes(p.groundSolid.id)));
    if (onP) {
      if (att.length) {
        this.releaseAll(it);
        return false;
      }
      it.brake = true;
      return Math.hypot(p.vx, p.vz) < 2.5 || this.stepT > 3;
    }
    if (att.length === 0) {
      if (p.grounded) {
        this.run(it, tx, tz);
        if (step.jump && this.edgeAhead(it)) it.jumpPressed = true;
      } else this.airSteer(it, tx, tz, P.maxY);
      return false;
    }
    const A = this.currentAnchor();
    if (p.grounded) {
      // Standing somewhere else while tethered: run off toward the target.
      const w = step.walk || [tx, tz];
      this.run(it, w[0], w[1]);
      if (step.jump && this.edgeAhead(it)) it.jumpPressed = true;
      return false;
    }
    const m = 0.4;
    const over = p.x > P.minX + m && p.x < P.maxX - m && p.z > P.minZ + m && p.z < P.maxZ - m && p.y > P.maxY;
    const mode = step.mode || 'swing';
    if (mode === 'lower' || (mode === 'auto' && over)) {
      const hxA = Math.hypot(tx - A.x, tz - A.z);
      const h = p.y - p.radius - P.maxY;
      if (hxA > 3 && !over) {
        this.pump(it, A, tx, tz);
        it.reel = step.reel || 0;
        this.unstick(it, A, tx, tz);
      } else {
        this.hover(it, tx, tz);
        it.reel = over || h > 4 ? this.lowerReel(A, h, step.lowerReel || 0.6) : 0;
        this.spinGuard(it, A);
        const rr = this.ropeOf(A);
        if (over && rr && rr.L >= this.sim.tethers.maxRopeLength() - 0.05 && h < 2.5 && Math.abs(p.vy) < 1) this.releaseAll(it);
      }
      return false;
    }
    this.pump(it, A, tx, tz);
    it.reel = step.reel !== undefined ? step.reel : this.autoReel(A, P);
    this.spinGuard(it, A);
    this.unstick(it, A, tx, tz);
    this.governor(it, A, tx, tz, it.reel);
    const fragile = A.kind === 'fragile';
    if (this.frameParity++ % (fragile ? 1 : 2) === 0) {
      if (this.testRelease(P, tx, tz, step.ok)) this.okStreak++;
      else this.okStreak = 0;
      if (this.okStreak >= (fragile || step.quick ? 1 : 2)) this.releaseAll(it);
    }
    return false;
  }

  /**
   * Safety governor: would keeping up this swing policy for ~1.1 s slam us into
   * something (death or a landing >= 0.85 lethal)? If so, damp for a moment.
   * Returns true while damping (the caller's movement is overridden).
   */
  governor(it, A, tx, tz, reel) {
    if (this.dampT > 0) {
      this.dampT -= FRAME;
      const p = this.p;
      it.move.x = clamp(-p.vx * 0.5, -1, 1);
      it.move.z = clamp(-p.vz * 0.5, -1, 1);
      it.reel = 0;
      return true;
    }
    if (this.govParity++ % 6 !== 0) return false;
    const safe = this.lookahead(
      () => {},
      (g) => {
        this.pump(g, A, tx, tz);
        g.reel = reel;
      },
      66,
      (k) => (this.landBad() ? false : k >= 65 ? true : undefined),
    );
    if (!safe) {
      this.dampT = 0.6;
      this.governed = (this.governed || 0) + 1;
    }
    return !safe;
  }

  /**
   * Reeling in on a fast swing spins the body up (angular momentum about the anchor is conserved): above SPIN_LIMIT rad/s the bot
   * stops reeling in (a player would not wind a fast line in to a short radius either).
   */
  spinGuard(it, A) {
    if (!(it.reel > 0)) return;
    const p = this.p;
    const dx = p.x - A.x;
    const dy = p.y - A.y;
    const dz = p.z - A.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < 1e-6) return;
    const cx = dy * p.vz - dz * p.vy;
    const cy = dz * p.vx - dx * p.vz;
    const cz = dx * p.vy - dy * p.vx;
    if (Math.sqrt(cx * cx + cy * cy + cz * cz) / d2 > SPIN_LIMIT) it.reel = 0;
  }

  /** Rope state of the newest attached hand: {L, d, taut}. */
  ropeOf(A) {
    const T = this.sim.tethers;
    for (const h of HANDS) {
      const r = T.hands[h].rope;
      if (r.anchor === A) {
        const p = this.p;
        const d = Math.hypot(p.x - A.x, p.y - A.y, p.z - A.z);
        return { L: r.length, d, taut: d >= r.length - 0.08 };
      }
    }
    return null;
  }

  /** Lowering: catch a slack rope (reel in snaps it to the current distance), then let out gently. */
  lowerReel(A, h, speed) {
    const r = this.ropeOf(A);
    const p = this.p;
    if (!r) return 0;
    if (!r.taut && r.L - r.d > 0.6 && p.vy < -2.5) return 1; // brake: snap the rope taut
    if (!r.taut) return 0;
    if (h > 5) return -speed;
    if (h > 2) return -speed * 0.6;
    return -0.3;
  }

  /** Reel in while the rope circle passes under the target ledge's near edge. */
  autoReel(A, P) {
    const r = this.ropeOf(A);
    if (!r) return 0;
    const p = this.p;
    if (p.y > A.y - 0.5) return 0;
    const nx = clamp(A.x, P.minX, P.maxX);
    const nz = clamp(A.z, P.minZ, P.maxZ);
    const dn = Math.hypot(nx - A.x, nz - A.z);
    if (r.L <= dn + 0.3) return 0;
    const circleY = A.y - Math.sqrt(r.L * r.L - dn * dn);
    const need = P.maxY + p.radius + 0.8;
    if (circleY < need && r.L > 2.5) return 0.8;
    return 0;
  }

  /** Pressed against geometry while hanging: swing away for a moment to rebuild momentum. */
  unstick(it, A, tx, tz) {
    const p = this.p;
    if (p.speed < 0.6 && !p.grounded) this.stuckT = (this.stuckT || 0) + FRAME;
    else this.stuckT = Math.max(0, (this.stuckT || 0) - FRAME * 0.5);
    if (this.stuckT > 0.4) this.awayT = 0.7;
    if (this.awayT > 0) {
      this.awayT -= FRAME;
      this.stuckT = 0;
      const dx = A.x - tx;
      const dz = A.z - tz;
      const l = Math.hypot(dx, dz) || 1;
      it.move.x = dx / l;
      it.move.z = dz / l;
      it.reel = 0.5;
    }
  }

  stepWalk(it, step) {
    const p = this.p;
    if (!p.grounded) {
      this.airSteer(it, step.w[0], step.w[1], p.y - 2);
      return false;
    }
    const d = this.run(it, step.w[0], step.w[1]);
    if (step.jump && this.edgeAhead(it)) it.jumpPressed = true;
    return d < (step.tol || 0.5);
  }

  // -------------------------------------------------------------------------
  // Objective verbs (LEVEL_FUN_PLAN P3)
  // -------------------------------------------------------------------------
  /** The fixture of this level's objectives named `id` (index), or -1 (no objectives / not in this variant). */
  fixtureIndex(id) {
    const O = this.sim.objectives;
    return O ? O.fixtureIndex(id) : -1;
  }

  /** Bell: pump the current line toward the bell until a strike has done it (standing: run off toward it). */
  stepRing(it, step) {
    const O = this.sim.objectives;
    const i = this.fixtureIndex(step.ring);
    if (i < 0 || O.fixtureDone(i)) return true;
    const f = O.fixtures[i];
    const p = this.p;
    const A = this.currentAnchor();
    const w = step.walk || [f.x, f.z];
    if (p.grounded) {
      this.run(it, w[0], w[1]);
      return false;
    }
    if (!A) {
      this.airSteer(it, w[0], w[1], f.y - 30);
      return false;
    }
    this.pump(it, A, f.x, f.z);
    it.reel = step.reel || 0;
    this.unstick(it, A, f.x, f.z);
    return false;
  }

  /** Haul: yank the hand whose rope is on the objective's haul ring (brake on the ground); done: let go of it. */
  stepHaul(it, step) {
    const O = this.sim.objectives;
    const o = O ? O.objective(step.haul) : null;
    if (!o) return true;
    const T = this.sim.tethers;
    let hand = null;
    for (const fi of o.fx) {
      const f = O.fixtures[fi];
      if (f.anchor) for (const h of HANDS) if (T.hands[h].rope.anchor === f.anchor) hand = h;
    }
    if (O.done[o.index]) {
      if (hand && !step.keep) this.releaseHand(it, hand);
      return true;
    }
    if (!hand) return false; // not on the ring (the step times out)
    it.hands[hand].yank = 1;
    const p = this.p;
    if (!p.grounded) this.hover(it, p.x, p.z);
    else if (step.walk && this.run(it, step.walk[0], step.walk[1]) > 0.3 && !this.edgeAhead(it)) {
      // hauling on the move (a haul ring never reels you in): walk on with the line slack
    } else {
      it.move.x = 0;
      it.move.z = 0;
      it.brake = true;
    }
    return false;
  }

  /** Lamp: walk until the wick is within the probe's reach, then hold the lantern toward it (braking) until it is lit. */
  stepLight(it, step) {
    const O = this.sim.objectives;
    const i = this.fixtureIndex(step.light);
    if (i < 0 || O.fixtureDone(i)) return true;
    const f = O.fixtures[i];
    const p = this.p;
    const dx = f.x - p.x;
    const dy = f.y - p.y;
    const dz = f.z - p.z;
    const d = Math.hypot(dx, dy, dz);
    if (!p.grounded) {
      this.airSteer(it, f.x, f.z, p.y - 2);
      return false;
    }
    if (d > f.r + PROBE_OUT - 0.08) {
      this.run(it, f.x, f.z);
      if (this.edgeAhead(it)) {
        it.move.x = 0;
        it.move.z = 0;
        it.brake = true;
      }
      return false;
    }
    it.brake = true;
    const k = Math.min(PROBE_OUT, d) / (d || 1);
    if (!it.probe) it.probe = { on: false, x: 0, y: 0, z: 0 };
    it.probe.on = true;
    it.probe.x = p.x + dx * k;
    it.probe.y = p.y + dy * k;
    it.probe.z = p.z + dz * k;
    return false;
  }

  stepGoal(it, step) {
    const p = this.p;
    const g = this.level.goal;
    const tx = step.at ? step.at[0] : (g.minX + g.maxX) / 2;
    const tz = step.at ? step.at[1] : (g.minZ + g.maxZ) / 2;
    if (this.attachedHands().length && p.grounded) this.releaseAll(it);
    if (p.grounded) this.run(it, tx, tz);
    else this.airSteer(it, tx, tz, g.minY);
    return this.level.inGoal(p.x, p.y, p.z);
  }
}
Bot.prototype.frameParity = 0;
Bot.prototype.govParity = 0;
Bot.prototype.dampT = 0;
Bot.prototype.minD = Infinity;
