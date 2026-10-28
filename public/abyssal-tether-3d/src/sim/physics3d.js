/* ABYSSAL TETHER 3D — physics3d.js
 * The player body, the two tethers (one per hand) and sphere-vs-box
 * collision, generalised from the 2D game's physics to three dimensions.
 * Game-feel physics, not a rope simulation: predictable and stable.
 *
 * Fixed step (CONFIG.PHYSICS_DT). Per step:
 *   1. timers & control
 *   2. gravity + intent (run / air control / swing pump along the rope
 *      tangent plane / reel / yank)
 *   3. semi-implicit Euler integration with clamps
 *   4. rope bookkeeping (tension total, catch jolt events)
 *   5. sphere-vs-box collisions, impacts, crumbling ledges, hazards
 *   (2b. grip climbing, sim/climb3d.js: while a hand holds a climb zone it sets the velocity after the forces)
 *
 * A shot is a projectile (TetherSystem.launch): the hook flies for distance / CONFIG.rope.flightSpeed
 * and attaches on arrival; the pull then builds up over CONFIG.rope.attachRamp (Rope3D.pull, `grip`).
 *
 * Ropes are forces, not projections (Rope3D.pull): a taut line is a stiff spring-damper
 * (stretch of a few % of its length, over-damped at catch speeds: no rebound) on the semi-implicit
 * Euler step, so a swing is a symplectic pendulum and a central pull conserves angular
 * momentum exactly. The winch has a holding load (CONFIG.rope.maxTensionG): when the
 * line would need more, the clutch slips and pays line out at the rate that holds the
 * load at the limit, dissipating the excess ('rope:slip'). Air drag is quadratic.
 *
 * Coordinates: metres, +Y up (three.js). Boxes are {minX,minY,minZ,maxX,maxY,maxZ}.
 * No three.js / DOM dependency (runs in Node).
 */

import { CONFIG, U } from './config3d.js';
import { Health3D } from './health3d.js';
import { Climb3D } from './climb3d.js';

const C = CONFIG;
export const HANDS = ['left', 'right'];

// Math.hypot is variadic and far slower than sqrt in V8's 240 Hz hot paths.
const len3 = (x, y, z) => Math.sqrt(x * x + y * y + z * z);
const len2 = (x, z) => Math.sqrt(x * x + z * z);

// =============================================================================
// Player
// =============================================================================
export class Player3D {
  constructor(x = 0, y = 0, z = 0) {
    this.radius = C.player.radius;
    this.reset(x, y, z);
  }

  reset(x, y, z) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.prevX = x; // previous physics step (render interpolation)
    this.prevY = y;
    this.prevZ = z;
    this.rx = x; // interpolated render position (set by the game each frame)
    this.ry = y;
    this.rz = z;
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
    this.grounded = false;
    this.alive = true;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.stagger = 0;
    this.airTime = 0;
    this.groundTime = 0;
    this.fallPeak = 0; // highest downward speed this airborne phase
    this.groundSolid = null;
    this.lastImpact = 0;
    this.tension = 0; // summed rope tension estimate (feedback)
    this.ropeJolt = 0;
    this.deathCause = null;
    this.landedThisStep = false;
    this.speedMul = 1; // adrenaline: set each frame by the game (sim/inventory3d.js)
    this.climbing = false; // a hand holds a climb zone and drives the velocity (sim/climb3d.js)
  }

  get speed() {
    return len3(this.vx, this.vy, this.vz);
  }
  /** Any tether attached. */
  get tethered() {
    return this._tethered === true;
  }
}

// =============================================================================
// Rope — one hand's tether: anchor, length, reel, pump, elastic pull + slip clutch.
// =============================================================================
export class Rope3D {
  constructor(hand) {
    this.hand = hand;
    this.anchor = null;
    this.length = 0;
    // Scratch from measure(): distance and unit vector anchor → player.
    this.d = 0;
    this.nx = 0;
    this.ny = -1;
    this.nz = 0;
    this.tension = 0; // load the line applied last step (m/s^2, per unit mass, capped by the clutch)
    // Per-step scratch (recomputed every step, never read across steps except as noted):
    this.dl = 0; // length change by the winch this step (reel), for the stretch rate
    this.catchSpeed = 0; // outward radial speed at the moment a slack line went taut (0 otherwise)
    this.slipSpeed = 0; // m/s of line the clutch is paying out right now (0 = holding)
    this.slipClock = 0; // s since the last rope:slip event of the current slip (events only)
    this.rampT = C.rope.attachRamp; // s since the hook bit; the pull builds up over CONFIG.rope.attachRamp
    this.grip = 1; // 0..1 share of the line's pull in force right now (smoothstep of rampT / attachRamp)
  }

  get attached() {
    return this.anchor !== null;
  }

  attach(anchor, distance, maxLength) {
    this.anchor = anchor;
    this.length = U.clamp(distance, C.rope.minLength, maxLength);
    this.tension = 0;
    this.dl = 0;
    this.catchSpeed = 0;
    this.slipSpeed = 0;
    this.slipClock = 0;
    this.rampT = 0; // a fresh bite: the pull starts at 0 and builds (a flying hook, then a soft catch)
    this.grip = C.rope.attachRamp > 0 ? 0 : 1;
  }

  detach() {
    this.anchor = null;
    this.length = 0;
    this.tension = 0;
    this.dl = 0;
    this.catchSpeed = 0;
    this.slipSpeed = 0;
    this.slipClock = 0;
    this.rampT = C.rope.attachRamp;
    this.grip = 1;
  }

  /** Measures anchor → player; returns true when taut. */
  measure(p) {
    const dx = p.x - this.anchor.x;
    const dy = p.y - this.anchor.y;
    const dz = p.z - this.anchor.z;
    const d = len3(dx, dy, dz) || 1e-6;
    this.d = d;
    this.nx = dx / d;
    this.ny = dy / d;
    this.nz = dz / d;
    return d >= this.length - C.rope.tautSlack;
  }

  /**
   * Reel: input > 0 reels IN (shorten), < 0 lets OUT. The winch only moves the line's natural
   * length; the pull (pull()) then accelerates the body inward. The pull is central, so
   * shortening a taut line conserves angular momentum about the anchor by construction
   * (v_t x r = const): reeling mid-swing speeds the swing up. reelSpinCap bounds that
   * spin-up: a taut line shortens by at most (1 - 1/reelSpinCap) of its length per step
   * (2 % per step, i.e. 4.8 x its length per second, at the cap). Call measure() first.
   */
  reel(p, input, speed, dt, maxLength, taut) {
    this.dl = 0;
    if (input > 0.15) {
      if (!taut) this.length = Math.min(this.length, this.d);
      let step = speed * input * dt;
      if (taut) {
        const cap = this.length * (1 - 1 / C.rope.reelSpinCap);
        if (step > cap) step = cap;
      }
      const newLen = Math.max(C.rope.minLength, this.length - step);
      this.dl = newLen - this.length;
      this.length = newLen;
    } else if (input < -0.15) {
      // (a line already paid out past maxLength by the clutch is left as it is, never snapped shorter)
      const newLen = Math.max(this.length, Math.min(maxLength, this.length + C.rope.reelOutSpeed * -input * dt));
      this.dl = newLen - this.length;
      this.length = newLen;
    }
  }

  /**
   * Swing pump: the intended (world, horizontal) acceleration projected onto
   * the plane tangent to the rope sphere, so input always pushes along the
   * arc and never fights the rope. Call measure() first.
   */
  pump(p, ax, az, accel, dt) {
    // a = (ax, 0, az); a_t = a - (a·n) n
    const an = ax * this.nx + az * this.nz;
    p.vx += (ax - an * this.nx) * accel * dt;
    p.vy += (0 - an * this.ny) * accel * dt;
    p.vz += (az - an * this.nz) * accel * dt;
  }

  /**
   * The line's force on the body, applied to the velocity (semi-implicit Euler: the caller
   * integrates the position afterwards). Call measure() and reel() first.
   *
   * Taut (d > length) it is a spring-damper along the line, pulling only:
   *   T = k s + 2 zeta(s') sqrt(k) s'      s = d - length, s' = its rate (body radial speed minus the winch)
   * with k = maxTension / (strainAtMax x length): the stretch is a few % of the length and a
   * catch (zeta = catchDamping at catch speeds) has (almost) no rebound; T < 0 (line going slack) is
   * no push. zeta falls to restDamping for small stretch rates, so a steady swing, whose line
   * only breathes with the load, does not bleed energy.
   * Inside the elastic zone (s < strainAtMax x length) the catch may spike to catchPeakG; the
   * spring part alone never exceeds maxTension.
   *
   * SLIP CLUTCH: when the spring would hold more than maxTension, the winch lets the line out
   * at exactly the rate that keeps the stretch (so the load) at the limit; the excess energy
   * is dissipated, the line stays that much longer. Returns nothing; sets this.tension (the
   * load applied), this.catchSpeed (outward radial speed absorbed by a fresh catch) and
   * this.slipSpeed (m/s of line paid out by the clutch, smoothed over slipFxSmooth: feedback
   * only, nothing in the simulation reads it).
   *
   * ATTACH RAMP: the hook arrives after its flight (TetherSystem), then the line's pull builds from 0 to
   * full over CONFIG.rope.attachRamp (smoothstep, `grip`): the spring, the clutch and the catch brake are all
   * scaled, so the body is taken up softly instead of snapping. The clutch's pay-out is not scaled: a line
   * that is not yet gripping spools out freely. The ramp runs faster the faster the body runs out on the line
   * (attachRampSpeed), so a fall arrest still bites at once.
   */
  pull(p, dt) {
    const R = C.rope;
    this.catchSpeed = 0;
    let grip = 1;
    if (this.rampT < R.attachRamp) {
      // The faster the body is running out on the line, the faster the brake takes hold (a fall arrest must not wait).
      const vOut = p.vx * this.nx + p.vy * this.ny + p.vz * this.nz;
      this.rampT += dt * (1 + (vOut > 0 ? vOut : 0) / R.attachRampSpeed);
      const u = this.rampT >= R.attachRamp ? 1 : this.rampT / R.attachRamp;
      grip = u * u * (3 - 2 * u);
    }
    this.grip = grip;
    const s = this.d - this.length;
    if (s <= 0) {
      this.tension = 0;
      this.slipSpeed *= 1 - Math.min(1, dt / R.slipFxSmooth);
      return;
    }
    const gAcc = C.player.gravity;
    const tmax = R.maxTensionG * gAcc;
    const sCap = R.strainAtMax * this.length;
    const k = tmax / sCap;
    const vr = p.vx * this.nx + p.vy * this.ny + p.vz * this.nz;
    const sdot = vr - this.dl / dt;
    const as = sdot < 0 ? -sdot : sdot;
    // Damping rises with the stretch rate and with the stretch itself (q^3: ~0 in a swing, 1 at the
    // clutch limit), so the recoil after a slip is dead too, while a steady swing keeps its energy.
    const q = s / sCap;
    let f = as / R.catchDampingSpeed;
    if (q * q * q > f) f = q * q * q;
    const zeta = R.restDamping + (R.catchDamping - R.restDamping) * (f < 1 ? f : 1);
    let T = k * s + 2 * zeta * Math.sqrt(k) * sdot;
    if (T <= 0) {
      this.tension = 0;
      this.slipSpeed *= 1 - Math.min(1, dt / R.slipFxSmooth);
      return;
    }
    let slip = 0;
    if (s > sCap) {
      // Beyond the elastic zone the winch pays the line out. It holds maxTension against a swing
      // (no outward radial speed) and brakes a fast catch harder, up to catchPeakG: the clutch
      // drags in proportion to the speed the line runs out at (a fall arrest, not a bungee).
      T = tmax + R.slipBrakeG * gAcc * (vr > 0 ? vr : 0);
      const peakSlip = R.catchPeakG * gAcc;
      if (T > peakSlip) T = peakSlip;
      const pay = s - sCap;
      this.length += pay;
      slip = pay + (this.dl < 0 ? this.dl : 0); // a reel that cannot pull in is not a slip
      if (slip < 0) slip = 0;
    } else {
      const peak = R.catchPeakG * gAcc;
      if (T > peak) T = peak;
    }
    T *= grip;
    if (T <= 1e-6) {
      this.tension = 0;
      this.slipSpeed += (slip / dt - this.slipSpeed) * Math.min(1, dt / R.slipFxSmooth);
      return;
    }
    if (this.tension === 0 && vr > 0) this.catchSpeed = vr;
    p.vx -= this.nx * T * dt;
    p.vy -= this.ny * T * dt;
    p.vz -= this.nz * T * dt;
    this.tension = T;
    this.slipSpeed += (slip / dt - this.slipSpeed) * Math.min(1, dt / R.slipFxSmooth);
  }

  /**
   * Slip event throttle: returns the rope:slip intensity (0..1) when an event is due this
   * step (at the start of a slip, then every slipFxPeriod while it goes on), else 0.
   */
  slipEvent(dt) {
    const R = C.rope;
    if (this.slipSpeed < R.slipFxMin) {
      this.slipClock = 0;
      return 0;
    }
    const due = this.slipClock === 0 || this.slipClock >= R.slipFxPeriod;
    this.slipClock = due ? dt : this.slipClock + dt;
    return due ? Math.min(1, this.slipSpeed / R.slipFxSpeed) : 0;
  }
}

// =============================================================================
// TetherSystem — targeting, firing, flight, attach/release for both hands.
//
// A shot is a projectile. fire() picks the target (as always) and launches the hook: it is IN FLIGHT for
// flight = distance / CONFIG.rope.flightSpeed (clamped to [flightMin, flightMax]); the hand reports
// state 'flying' (hand.flight = { t, dur, target }, hand.flightFrac 0..1), the line exerts no force, a
// release cancels it. step() lands the hook on arrival (the target must still be sound and in reach, else
// it falls off: a miss) and attaches through attach(); the pull then builds up over CONFIG.rope.attachRamp
// (Rope3D.pull). Events: 'rope:fire' {hand,x,y,z,target,dur,buffered}, 'rope:hit' {hand,x,y,z,normal:{x,y,z}},
// 'grapple:attach' (the arrival, unchanged payload), 'rope:cancel' {hand,reason}, 'grapple:miss'.
// =============================================================================
export class TetherSystem {
  /**
   * @param {Level3D} level
   * @param {object} diff  DIFFICULTY preset
   * @param {EventBus} bus
   * @param {object} settings live settings (aimAssist read per query)
   */
  constructor(level, diff, bus, settings) {
    this.level = level;
    this.diff = diff;
    this.bus = bus;
    this.settings = settings || {};
    this._scratch = [];
    this._found = { anchor: null, score: 0 }; // reused result (callers read it immediately)
    // aimRangeAt cache: the per-section ranges of (level, diff), and the y band of the last section asked about
    this._reach = { level: null, diff: null, ranges: null, lo: 0, hi: -1, range: 0 };
    this.hands = {};
    for (const h of HANDS) this.hands[h] = this._makeHand(h);
  }

  _makeHand(hand) {
    return {
      hand,
      rope: new Rope3D(hand),
      target: null, // highlighted anchor for this hand's aim
      held: false,
      buffer: 0,
      extend: 1, // visual extension 0..1 (the hook's flight progress while flying)
      attachTime: 0,
      miss: null, // { x,y,z, dx,dy,dz, len, t }
      lastAim: null,
      flying: false, // the hook is in flight (flightObj is live)
      flightObj: { t: 0, dur: 0, target: null }, // preallocated: no allocation per shot
      /** 'flying' | 'attached' | 'idle' */
      get state() {
        return this.flying ? 'flying' : this.rope.anchor ? 'attached' : 'idle';
      },
      /** { t, dur, target } while the hook is in flight, else null. */
      get flight() {
        return this.flying ? this.flightObj : null;
      },
      /** 0..1 progress of the hook's flight (0 when not flying). */
      get flightFrac() {
        return this.flying && this.flightObj.dur > 0 ? Math.min(1, this.flightObj.t / this.flightObj.dur) : 0;
      },
    };
  }

  reset() {
    for (const h of HANDS) this.hands[h] = this._makeHand(h);
  }

  /** Any hand attached. */
  get attached() {
    return this.hands.left.rope.attached || this.hands.right.rope.attached;
  }

  anchorOf(hand) {
    return this.hands[hand].rope.anchor;
  }

  /** The rope's maximum length: diff-wide (aimRange + 4), NOT the section reach (a lowering keeps its rope everywhere). */
  maxRopeLength() {
    return this.diff.aimRange + C.rope.maxLengthBonus;
  }

  /**
   * The hook's targeting range (m) where the player is (LEVEL_FUN_PLAN item 5): `where` = a section index, or anything
   * with a `y` (the player; the section of that height). Level3D.reachOf: the section's `reach` for this difficulty,
   * never above diff.aimRange. Cached per (level, diff) and per section band: no allocation per call.
   */
  aimRangeAt(where) {
    const L = this.level;
    const c = this._reach;
    if (!L || typeof L.reachOf !== 'function' || !L.sections || !L.sections.length) return this.diff.aimRange;
    if (c.level !== L || c.diff !== this.diff || !c.ranges) {
      c.level = L;
      c.diff = this.diff;
      c.ranges = new Float64Array(L.sections.length);
      for (let i = 0; i < L.sections.length; i++) c.ranges[i] = L.reachOf(i, this.diff);
      c.lo = 0;
      c.hi = -1;
    }
    if (typeof where === 'number') return c.ranges[U.clamp(where | 0, 0, c.ranges.length - 1)];
    const y = where && typeof where.y === 'number' ? where.y : NaN;
    if (y >= c.lo && y < c.hi) return c.range;
    const S = L.sections;
    const i = L.sectionIndexAt(y);
    c.lo = i === S.length - 1 ? -Infinity : S[i].yBottom;
    c.hi = i === 0 ? Infinity : S[i - 1].yBottom;
    c.range = c.ranges[i];
    return c.range;
  }

  assist() {
    return U.clamp(this.settings.aimAssist || 1, 0.6, 1.4);
  }

  /**
   * Soft targeting along an aim ray {ox,oy,oz,dx,dy,dz} (unit dir). Among
   * anchors within range of the player with line of sight, eligible if the
   * angle to the ray is inside the cone OR the anchor lies within `rayAssist`
   * metres of the ray; best = most aligned (angle + perpendicular offset),
   * with a little stickiness for this hand's current highlight.
   * Returns a reused { anchor, score } object (read it immediately) or null.
   */
  findTarget(player, aim, hand) {
    if (!aim) return null;
    const range = this.aimRangeAt(player); // the section's reach (LEVEL_FUN_PLAN item 5)
    const cone = this.diff.aimCone * this.assist();
    const assistR = this.diff.rayAssist * this.assist();
    const dl = len3(aim.dx, aim.dy, aim.dz);
    if (dl < C.targeting.minAimLength) return null;
    const dx = aim.dx / dl;
    const dy = aim.dy / dl;
    const dz = aim.dz / dl;
    const list = this.level.anchorsNear(player.x, player.y, player.z, range, this._scratch);
    const current = hand ? this.hands[hand].target : null;
    let other = null;
    if (hand) {
      const oh = this.hands[hand === 'left' ? 'right' : 'left'];
      other = oh.rope.anchor || (oh.flying ? oh.flightObj.target : null);
    }
    let best = null;
    let bestScore = Infinity;
    for (let i = 0; i < list.length; i++) {
      const an = list[i];
      if (an.broken || an === other) continue;
      const pd = len3(an.x - player.x, an.y - player.y, an.z - player.z);
      if (pd > range || pd < 0.3) continue;
      const ox = an.x - aim.ox;
      const oy = an.y - aim.oy;
      const oz = an.z - aim.oz;
      const t = ox * dx + oy * dy + oz * dz;
      if (t <= 0) continue; // behind the hand
      const px = ox - dx * t;
      const py = oy - dy * t;
      const pz = oz - dz * t;
      const perp = len3(px, py, pz);
      const ang = Math.atan2(perp, t);
      if (ang > cone && perp > assistR) continue;
      let score = (ang / cone) * 0.6 + (Math.min(perp, assistR * 3) / assistR) * 0.8 + (pd / range) * 0.2;
      if (an === current) score -= C.targeting.stickiness;
      if (score >= bestScore) continue;
      if (this.level.segmentBlocked(player.x, player.y, player.z, an.x, an.y, an.z, C.targeting.losEndClearance)) continue;
      best = an;
      bestScore = score;
    }
    if (!best) return null;
    this._found.anchor = best;
    this._found.score = bestScore;
    return this._found;
  }

  /** Refresh each hand's highlight from its aim (once per frame). */
  updateTargets(player, intent) {
    for (const h of HANDS) {
      const st = this.hands[h];
      const aim = intent.hands && intent.hands[h] ? intent.hands[h].aim : null;
      st.lastAim = aim || st.lastAim;
      const found = player.alive && aim ? this.findTarget(player, aim, h) : null;
      st.target = found ? found.anchor : null;
    }
  }

  /**
   * Applies per-hand edges once per frame:
   * intent.hands[h] = { aim, pressed, held, released }.
   */
  handleInput(player, intent, dt) {
    if (!player.alive) return;
    for (const h of HANDS) {
      const hi = intent.hands ? intent.hands[h] : null;
      if (!hi) continue;
      const st = this.hands[h];
      if (hi.pressed) {
        st.held = true;
        this.fire(player, h, hi.aim);
      }
      if (hi.released || (!hi.held && st.held)) {
        st.held = false;
        st.buffer = 0;
        if (st.rope.attached || st.flying) this.release(player, h, 'input');
      }
      // Buffered fire: a held trigger that whiffed keeps looking briefly.
      if (st.held && !st.rope.attached && !st.flying && st.buffer > 0) {
        st.buffer -= dt;
        const found = this.findTarget(player, hi.aim, h);
        if (found) this.launch(player, h, found.anchor, true);
      }
    }
  }

  /** Pulls the trigger: the hook launches at the best target (and is in flight), else the shot whiffs. */
  fire(player, hand, aim) {
    const a0 = aim || this.hands[hand].lastAim;
    if (a0) {
      // the aim ray itself (the creature gets annoyed when a shot passes through it, whether or not the hook finds an anchor)
      const l0 = len3(a0.dx, a0.dy, a0.dz) || 1;
      this.bus.emit('rope:shot', { hand, ox: a0.ox, oy: a0.oy, oz: a0.oz, dx: a0.dx / l0, dy: a0.dy / l0, dz: a0.dz / l0, range: this.aimRangeAt(player) });
    }
    const found = this.findTarget(player, aim, hand);
    if (found) {
      this.launch(player, hand, found.anchor, false);
      return true;
    }
    const st = this.hands[hand];
    const a = aim || st.lastAim;
    if (a) {
      const l = len3(a.dx, a.dy, a.dz) || 1;
      st.miss = { x: a.ox, y: a.oy, z: a.oz, dx: a.dx / l, dy: a.dy / l, dz: a.dz / l, len: this.aimRangeAt(player) * 0.85, t: 0 };
    }
    st.buffer = C.rope.grappleBuffer;
    this.bus.emit('rope:fire', { hand, x: player.x, y: player.y, z: player.z, target: null, dur: C.rope.missTime, buffered: false });
    this.bus.emit('grapple:miss', { hand, x: player.x, y: player.y, z: player.z });
    return false;
  }

  /** The hook leaves the muzzle for `anchor`; it attaches in step() when it arrives. */
  launch(player, hand, anchor, buffered) {
    const R = C.rope;
    const st = this.hands[hand];
    if (st.flying) this._endFlight(st);
    if (st.rope.attached) this.release(player, hand, 'refire'); // a new shot lets go of the old line first
    const d = len3(player.x - anchor.x, player.y - anchor.y, player.z - anchor.z);
    const dur = U.clamp(d / R.flightSpeed, R.flightMin, R.flightMax);
    const fl = st.flightObj;
    fl.t = 0;
    fl.dur = dur;
    fl.target = anchor;
    st.flying = true;
    st.extend = 0;
    st.miss = null;
    st.buffer = 0;
    this.bus.emit('rope:fire', { hand, x: player.x, y: player.y, z: player.z, target: anchor, dur, buffered: !!buffered });
  }

  _endFlight(st) {
    st.flying = false;
    st.flightObj.target = null;
    st.flightObj.t = 0;
  }

  /** The trigger was let go (or the player died) with the hook in the air: it retracts. */
  _cancelFlight(player, hand, reason) {
    const st = this.hands[hand];
    const fl = st.flightObj;
    const an = fl.target;
    if (an) {
      const dx = an.x - player.x;
      const dy = an.y - player.y;
      const dz = an.z - player.z;
      const l = len3(dx, dy, dz) || 1;
      const frac = fl.dur > 0 ? Math.min(1, fl.t / fl.dur) : 0;
      // The whip-back animation (RopeView.miss) from the point the hook had reached.
      st.miss = { x: player.x, y: player.y, z: player.z, dx: dx / l, dy: dy / l, dz: dz / l, len: l * frac, t: C.rope.missTime * 0.45 };
    }
    this._endFlight(st);
    st.extend = 1;
    this.bus.emit('rope:cancel', { hand, reason: reason || 'input' });
  }

  /** The hook reached its target: bite if it is still sound and in reach, else it falls off. */
  _arrive(player, hand) {
    const st = this.hands[hand];
    const an = st.flightObj.target;
    this._endFlight(st);
    const d = len3(player.x - an.x, player.y - an.y, player.z - an.z);
    if (an.broken || d > this.maxRopeLength()) {
      // Crumbled while the hook was in the air, or the body moved out of reach: the hook falls off.
      const l = d || 1;
      st.miss = { x: player.x, y: player.y, z: player.z, dx: (an.x - player.x) / l, dy: (an.y - player.y) / l, dz: (an.z - player.z) / l, len: d, t: C.rope.missTime * 0.45 };
      st.extend = 1;
      st.buffer = C.rope.grappleBuffer;
      this.bus.emit('grapple:miss', { hand, x: an.x, y: an.y, z: an.z, fell: true });
      return;
    }
    const inv = 1 / (d || 1);
    this.bus.emit('rope:hit', { hand, x: an.x, y: an.y, z: an.z, normal: { x: (player.x - an.x) * inv, y: (player.y - an.y) * inv, z: (player.z - an.z) * inv }, anchor: an });
    this.attach(player, hand, an);
  }

  /** Instant attach (arrival of the hook, and the debug API). */
  attach(player, hand, anchor) {
    const st = this.hands[hand];
    const prev = st.rope.anchor;
    if (st.flying) this._endFlight(st);
    const d = len3(player.x - anchor.x, player.y - anchor.y, player.z - anchor.z);
    st.rope.attach(anchor, d, this.maxRopeLength());
    st.extend = 1; // the line is already out (the flight was the extension)
    st.attachTime = 0;
    st.miss = null;
    st.buffer = 0;
    if (anchor.kind === 'fragile' && !anchor.load) anchor.load = 0;
    this.bus.emit('grapple:attach', { hand, anchor, x: anchor.x, y: anchor.y, z: anchor.z, speed: player.speed, previous: prev, distance: d });
  }

  release(player, hand, reason) {
    const st = this.hands[hand];
    if (st.flying) this._cancelFlight(player, hand, reason);
    if (!st.rope.attached) return;
    const anchor = st.rope.anchor;
    st.rope.detach();
    const otherAttached = this.hands[hand === 'left' ? 'right' : 'left'].rope.attached;
    // A small, predictable boost keeps well-timed releases snappy (only when
    // letting go completely).
    if (reason === 'input' && !otherAttached && player.speed > C.rope.releaseBoostMinSpeed) {
      player.vx *= C.rope.releaseBoost;
      player.vy *= C.rope.releaseBoost;
      player.vz *= C.rope.releaseBoost;
    }
    this.bus.emit('grapple:release', { hand, anchor, reason: reason || 'input', speed: player.speed });
  }

  releaseAll(player, reason) {
    for (const h of HANDS) this.release(player, h, reason);
  }

  /** Per-step bookkeeping: hooks in flight, whiffs, fragile anchors. */
  step(player, dt) {
    for (const h of HANDS) {
      const st = this.hands[h];
      if (st.miss) {
        st.miss.t += dt;
        if (st.miss.t >= C.rope.missTime) st.miss = null;
      }
      if (st.flying) {
        const fl = st.flightObj;
        fl.t += dt;
        st.extend = fl.dur > 0 ? Math.min(1, fl.t / fl.dur) : 1;
        if (fl.t >= fl.dur) this._arrive(player, h);
      }
      const rope = st.rope;
      if (!rope.attached) continue;
      st.attachTime += dt;
      const an = rope.anchor;
      if (an.kind === 'fragile') {
        an.load = (an.load || 0) + dt;
        if (an.load >= this.diff.fragileTime * (an.life || 1)) {
          an.broken = true;
          this.bus.emit('grapple:break', { hand: h, anchor: an, x: an.x, y: an.y, z: an.z });
          this.release(player, h, 'break');
        }
      }
    }
  }

  /** 0..1 stress of a hand's fragile anchor. */
  anchorStress(hand) {
    const an = this.hands[hand].rope.anchor;
    if (!an || an.kind !== 'fragile') return 0;
    return U.clamp((an.load || 0) / (this.diff.fragileTime * (an.life || 1)), 0, 1);
  }
}

// =============================================================================
// Physics3D — fixed-step integrator.
// =============================================================================
export class Physics3D {
  constructor(level, diff, bus) {
    this.level = level;
    this.diff = diff;
    this.bus = bus;
    this._solids = [];
    this._hazards = [];
    // Fall / hazard damage (health3d.js). Death comes from hp reaching 0 (or the lethal speed, which is damage 1).
    this.health = new Health3D(diff, bus);
    // Grip climbing (climb zones in the level data, grip stamina): see sim/climb3d.js.
    this.climb = new Climb3D(level, diff, bus);
  }

  /** The climb model with the current bus (Sim swaps physics.bus for look-ahead frames). */
  _climb() {
    const c = this.climb;
    c.bus = this.bus;
    return c;
  }

  /** The health model with the current bus (Sim swaps physics.bus for look-ahead frames). */
  _health() {
    const h = this.health;
    h.bus = this.bus;
    return h;
  }

  /**
   * One fixed step.
   * intent: {
   *   move: {x, z}  world-space horizontal intent, |move| ≤ 1 (already rotated by head yaw)
   *   reel: -1..1   (+ = reel in all tethered hands)
   *   jumpPressed, brake (bool: stop on the ground)
   *   hands: { left: { yank 0..1 }, right: { yank 0..1 } }
   * }
   */
  step(player, tethers, intent, dt) {
    if (!player.alive) return;
    const P = C.player;
    const R = C.rope;
    // Adrenaline (sim/inventory3d.js): multiplies the run / air speed caps, accelerations, reel and pump speed.
    // Gravity, drag, fall damage and the global speed clamp are untouched.
    const sm = player.speedMul > 1 ? player.speedMul : 1;

    player.prevX = player.x;
    player.prevY = player.y;
    player.prevZ = player.z;
    player.landedThisStep = false;
    this._health().step(dt);

    // ---- 1. timers & control ------------------------------------------------
    if (player.stagger > 0) player.stagger = Math.max(0, player.stagger - dt);
    const control = player.stagger > 0 ? P.staggerControl : 1;
    let mx = intent.move ? intent.move.x || 0 : 0;
    let mz = intent.move ? intent.move.z || 0 : 0;
    const ml = len2(mx, mz);
    if (ml > 1) {
      mx /= ml;
      mz /= ml;
    }
    mx *= control;
    mz *= control;
    const moving = ml > 0.05;

    if (player.grounded) {
      player.coyote = P.coyoteTime;
      player.groundTime += dt;
      player.airTime = 0;
    } else {
      player.coyote = Math.max(0, player.coyote - dt);
      player.airTime += dt;
      player.groundTime = 0;
    }
    if (intent.jumpPressed) player.jumpBuffer = P.jumpBuffer;
    else player.jumpBuffer = Math.max(0, player.jumpBuffer - dt);

    // ---- 2. forces -------------------------------------------------------------
    player.vy -= P.gravity * dt;

    let anyTaut = false;
    let attached = false;
    player._reeling = false;
    for (const h of HANDS) {
      const rope = tethers.hands[h].rope;
      if (!rope.attached) continue;
      attached = true;
      const taut = rope.measure(player);
      anyTaut = anyTaut || taut;
      // A haul ring (LEVEL_FUN_PLAN P3, sim/objectives3d.js: `anchor.haul`): the yank and the reel-in haul the counterweight
      // instead of reeling the player toward it (comfort: hauling never moves you); letting rope out still works.
      const haul = rope.anchor.haul === true;
      if (taut && !haul && (intent.reel > 0.1 || (intent.hands && intent.hands[h] && intent.hands[h].yank > 0.15))) player._reeling = true; // reeling a loaded line (climb3d: grip cost on Nightmare and up)
      // Grip on a tethered hand yanks that rope in hard; otherwise the shared reel axis.
      const yank = intent.hands && intent.hands[h] ? intent.hands[h].yank || 0 : 0;
      if (yank > 0.15 && !haul) rope.reel(player, 1, R.yankSpeed * sm * yank, dt, tethers.maxRopeLength(), taut);
      else rope.reel(player, haul ? Math.min(0, intent.reel || 0) : intent.reel || 0, R.reelInSpeed * sm, dt, tethers.maxRopeLength(), taut);
      if (taut && moving && !player.grounded) rope.pump(player, mx, mz, R.pumpAccel * sm, dt);
      // The line's own pull (elastic catch + slip clutch); both hands act on the same state.
      rope.pull(player, dt);
    }
    player._tethered = attached;

    if (player.grounded) {
      if (intent.brake && !attached) {
        const k = Math.exp(-P.groundFriction * P.brakeFactor * dt);
        player.vx *= k;
        player.vz *= k;
      } else if (moving) {
        const runMax = P.runMaxSpeed * sm;
        const tx = mx * runMax;
        const tz = mz * runMax;
        const hs = len2(player.vx, player.vz);
        if (hs > runMax && player.vx * mx + player.vz * mz > 0) {
          player.vx = U.damp(player.vx, tx, P.overspeedFriction, dt);
          player.vz = U.damp(player.vz, tz, P.overspeedFriction, dt);
        } else {
          // Approach the target velocity along the difference vector.
          const ex = tx - player.vx;
          const ez = tz - player.vz;
          const el = len2(ex, ez);
          const step = P.runAccel * sm * dt;
          if (el <= step) {
            player.vx = tx;
            player.vz = tz;
          } else {
            player.vx += (ex / el) * step;
            player.vz += (ez / el) * step;
          }
        }
      } else {
        const k = Math.exp(-P.groundFriction * dt);
        player.vx *= k;
        player.vz *= k;
        if (len2(player.vx, player.vz) < 0.05) {
          player.vx = 0;
          player.vz = 0;
        }
      }
    } else if (!anyTaut) {
      // Air control: steer up to airMaxSpeed along the intent, never braking momentum.
      if (moving) {
        const along = player.vx * mx + player.vz * mz; // speed along intent (mx,mz may be < 1)
        const im = len2(mx, mz) || 1;
        if (along / im < P.airMaxSpeed * sm) {
          player.vx += mx * P.airAccel * sm * dt;
          player.vz += mz * P.airAccel * sm * dt;
        }
      }
      const k = Math.exp(-P.airDrag * dt);
      player.vx *= k;
      player.vz *= k;
    }
    if (!player.grounded && P.dragQuad > 0) {
      // Quadratic air drag, integrated implicitly (v' = v / (1 + k |v| dt)): unconditionally stable.
      const f = 1 / (1 + P.dragQuad * player.speed * dt);
      player.vx *= f;
      player.vy *= f;
      player.vz *= f;
    }

    // Jump (buffered + coyote). Not while hanging on a taut rope, nor while a hand holds on (A hops off instead: climb3d).
    if (player.jumpBuffer > 0 && player.coyote > 0 && !anyTaut && !this.climb.holding) {
      player.vy = Math.max(player.vy, P.jumpSpeed);
      player.jumpBuffer = 0;
      player.coyote = 0;
      player.grounded = false;
      this.bus.emit('player:jump', { x: player.x, y: player.y, z: player.z });
    }

    // ---- 2b. grip climbing: a hand on a climb zone drives the velocity (overrides gravity, the rope and the run) -----------
    player.climbing = this._climb().step(player, intent, dt);

    // ---- 3. clamps & integration ---------------------------------------------
    if (!attached && player.vy < -P.maxFallSpeed) player.vy = -P.maxFallSpeed;
    const sp = player.speed;
    if (sp > P.maxSpeed) {
      const k = P.maxSpeed / sp;
      player.vx *= k;
      player.vy *= k;
      player.vz *= k;
    }
    if (!isFinite(player.vx) || !isFinite(player.vy) || !isFinite(player.vz)) {
      player.vx = 0;
      player.vy = 0;
      player.vz = 0;
    }
    player.x += player.vx * dt;
    player.y += player.vy * dt;
    player.z += player.vz * dt;

    // ---- 4. rope bookkeeping ----------------------------------------------------------
    player.tension = 0;
    if (attached) {
      let jolt = 0;
      for (const h of HANDS) {
        const rope = tethers.hands[h].rope;
        if (!rope.attached) continue;
        player.tension += rope.tension;
        if (rope.catchSpeed > jolt) jolt = rope.catchSpeed;
        const slip = rope.slipEvent(dt);
        if (slip > 0) {
          this.bus.emit('rope:slip', { hand: h, intensity: slip, speed: rope.slipSpeed, load: rope.tension / P.gravity, x: player.x, y: player.y, z: player.z });
        }
      }
      if (jolt > R.joltFxSpeed) {
        player.ropeJolt = jolt;
        this.bus.emit('rope:jolt', { speed: jolt, x: player.x, y: player.y, z: player.z });
      }
    }

    // ---- 5. collisions --------------------------------------------------------------
    this.resolveCollisions(player, tethers, dt);
    if (!player.alive) return;

    if (player.grounded) player.fallPeak = 0;
    else if (-player.vy > player.fallPeak) player.fallPeak = -player.vy;

    const r = player.radius;
    const hz = this.level.queryHazards(player.x - r, player.y - r, player.z - r, player.x + r, player.y + r, player.z + r, this._hazards);
    for (let i = 0; i < hz.length; i++) {
      if (hz[i].active === false) continue;
      if (U.sphereBox(player.x, player.y, player.z, r * 0.8, hz[i])) {
        if (this._health().hazardHit()) {
          this.kill(player, tethers, 'hazard');
          return;
        }
      }
    }

    if (player.y < this.level.bounds.minY - P.fallDeathMargin) {
      this.kill(player, tethers, 'fall');
      return;
    }

    tethers.step(player, dt);
  }

  resolveCollisions(player, tethers, dt) {
    const P = C.player;
    const r = player.radius;
    const wasGrounded = player.grounded;
    player.grounded = false;
    player.groundSolid = null;

    let maxImpact = 0;
    let impactNY = 0;
    const preDown = Math.max(0, -player.vy); // downward speed before contact
    const climbing = player.climbing === true;
    let floorFall = 0;
    const solids = this.level.querySolids(player.x - r - 0.2, player.y - r - 0.2, player.z - r - 0.2, player.x + r + 0.2, player.y + r + 0.2, player.z + r + 0.2, this._solids);

    for (let iter = 0; iter < 3; iter++) {
      let any = false;
      for (let i = 0; i < solids.length; i++) {
        const s = solids[i];
        if (s.active === false) continue;
        const cx = U.clamp(player.x, s.minX, s.maxX);
        const cy = U.clamp(player.y, s.minY, s.maxY);
        const cz = U.clamp(player.z, s.minZ, s.maxZ);
        const dx = player.x - cx;
        const dy = player.y - cy;
        const dz = player.z - cz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= r * r) continue;
        let nx;
        let ny;
        let nz;
        let pen;
        if (d2 > 1e-10) {
          const d = Math.sqrt(d2);
          nx = dx / d;
          ny = dy / d;
          nz = dz / d;
          pen = r - d;
        } else {
          // Centre inside the box: push out along the shallowest axis, preferring "up"
          // when we came from above.
          const faces = [
            [player.x - s.minX, -1, 0, 0],
            [s.maxX - player.x, 1, 0, 0],
            [player.y - s.minY, 0, -1, 0],
            [s.maxY - player.y, 0, 1, 0],
            [player.z - s.minZ, 0, 0, -1],
            [s.maxZ - player.z, 0, 0, 1],
          ];
          let bestF = faces[0];
          for (const f of faces) if (f[0] < bestF[0]) bestF = f;
          if (player.prevY >= s.maxY) bestF = faces[3];
          nx = bestF[1];
          ny = bestF[2];
          nz = bestF[3];
          pen = bestF[0] + r;
        }
        player.x += nx * pen;
        player.y += ny * pen;
        player.z += nz * pen;
        const vn = player.vx * nx + player.vy * ny + player.vz * nz;
        if (vn < 0) {
          const impact = -vn;
          if (impact > maxImpact) {
            maxImpact = impact;
            impactNY = ny;
          }
          // Lethality on floor-ish contacts uses the pre-contact fall speed weighted by
          // how floor-like the contact is, so clipping a ledge corner cannot save a fall.
          if (ny > P.lethalNormalY) {
            const fall = preDown * U.smoothstep(P.lethalNormalY, 0.75, ny);
            if (fall > floorFall) floorFall = fall;
          }
          player.vx -= vn * nx;
          player.vy -= vn * ny;
          player.vz -= vn * nz;
        }
        if (ny > P.groundNormalY) {
          player.grounded = true;
          player.groundSolid = s;
        }
        any = true;
      }
      if (!any) break;
    }

    // Crumbling ledges give way after being stood on.
    const gs = player.groundSolid;
    if (gs && gs.kind === 'crumble' && gs.active !== false) {
      gs.load = (gs.load || 0) + dt;
      if (gs.load >= this.diff.crumbleTime * (gs.life || 1)) {
        gs.active = false;
        gs.fallen = true;
        this.bus.emit('platform:crumble', { solid: gs, x: (gs.minX + gs.maxX) / 2, y: gs.maxY, z: (gs.minZ + gs.maxZ) / 2 });
      }
    }

    // A hand that holds a climb zone drives the body: pressing into the floor or a wall with the grip is not an impact.
    if (climbing) {
      maxImpact = 0;
      floorFall = 0;
    }
    if (maxImpact <= 0 && floorFall <= 0) {
      if (!wasGrounded && player.grounded) player.landedThisStep = true;
      return;
    }
    player.lastImpact = maxImpact;
    const floorish = impactNY > P.lethalNormalY;
    const lethalMeasure = Math.max(floorish ? maxImpact : 0, floorFall);
    if (this.diff.impactsLethal) {
      // Landing / wall damage; the lethal speed is damage 1, so the old rule (speed >= lethalImpact kills) still holds.
      const hp = this._health();
      let dead = lethalMeasure > 0 && hp.landing(lethalMeasure);
      if (!dead && !floorish && maxImpact > 0) dead = hp.wallHit(maxImpact);
      if (dead) {
        this.kill(player, tethers, 'impact', Math.max(lethalMeasure, maxImpact));
        return;
      }
    }
    if (floorish && !wasGrounded) {
      const hard = maxImpact >= P.hardLandingSpeed;
      if (hard) player.stagger = P.staggerTime;
      player.landedThisStep = true;
      this.bus.emit('player:land', { impact: maxImpact, hard, x: player.x, y: player.y - r, z: player.z, lethalRatio: maxImpact / this.diff.lethalImpact });
    } else if (!floorish && maxImpact >= P.wallHitFxSpeed) {
      if (maxImpact >= P.hardLandingSpeed) player.stagger = Math.max(player.stagger, P.staggerTime * 0.6);
      this.bus.emit('player:wallhit', { impact: maxImpact, x: player.x, y: player.y, z: player.z });
    }
  }

  kill(player, tethers, cause, impact) {
    if (!player.alive) return;
    if (tethers) tethers.releaseAll(player, 'death');
    this._climb().release(player, 'death');
    this.health.die();
    player.alive = false;
    player.deathCause = cause;
    player.vx = 0;
    player.vy = 0;
    player.vz = 0;
    this.bus.emit('player:death', { cause, x: player.x, y: player.y, z: player.z, impact: impact || 0 });
  }
}
