/* THE LANTERN (ABYSSAL TETHER 3D) — knocker3d.js
 * THE KNOCKER: the player's one tool against the Mason. "Also there must be a gadget to distract the mason temporarily."
 * Lore: the walls knock (DO NOT ANSWER WHAT KNOCKS / IT HAS LEARNED OUR KNOCKS) and the Mason answers knocks. A small
 * brass-and-iron clockwork rattle: you throw it, it lands, winds up and clacks the Mason's own knock rhythm for 9 s; the
 * Mason turns to answer it, crawls over and inspects it, and you have a window to cross. Limited (1 at the start, rare in
 * the supplies, 3 carried at most), skill-based (where it lands is where the Mason goes), never an 'I win' button (one
 * at a time, a 3 s cooldown, a throw down the shaft is lost and buys nothing).
 *
 * Pure and deterministic: no three.js, no DOM, no Math.random, no allocation after construction (the event payloads,
 * the slots, the raycast result and the distract options are all reused). The same module runs in Node for the tests.
 *
 * Flight: a point projectile (radius 6 cm) under the game's gravity with LINEAR air drag, integrated EXACTLY per sub-step
 * (v(t) = vt + (v0 - vt) e^-kt, x(t) = x0 + vt t + (v0 - vt)(1 - e^-kt)/k; vt = the terminal velocity), so a free flight
 * matches the analytic ballistic arc at any frame rate. Each sub-step is swept against the level's active solids
 * (level.raycast); a hit reflects the normal part of the velocity with restitution 0.35 and keeps 0.6 of the tangential
 * part (friction). It comes to rest on a floor (|vn| small, slow along it) or is laid down on the floor it last touched at
 * most 1.8 s after its first bounce. It is LOST when it falls 60 m below where it was thrown, leaves the level's bounds
 * or flies 12 s (a far-off clack is heard: 'knocker:end' {reason:'lost'}).
 *
 * Lying still it WINDS UP for 0.4 s, then CLACKS for 9 s: a fixed 7-beat bar (3 s) that echoes the Mason's own triple
 * knock, three bars, then a final clunk; then it is SPENT and lies there as a prop until the next respawn / warp / run.
 * While it clacks it calls creature.distract(x, y, z, { duration, strength }) at the first beat and then once a second
 * (duration = what is left of the 9 s), when the creature has that method (the Mason's sight branch). The skitterlings
 * never hear it. A crumbling ledge that falls from under it drops it again (it resumes its clacking where it lands).
 *
 * Use: tryThrow(inv, ctx, x, y, z, vx, vy, vz) refuses with a reason ('off' setting, 'dead', 'busy' = not live: paused /
 * cutscene / intro / victory, 'empty', 'cooldown' 3 s since the last throw, 'active' = one is still flying / clacking);
 * otherwise it takes one from the bag and launches it. Desktop: G held charges 0..1 s (a tap lobs ~6 m, a full charge
 * ~19 m: throwVelocity). VR: pulled from the bag and thrown by the hand (vrThrowVelocity: the hand's release velocity).
 *
 * Bus events: 'knocker:throw' {x,y,z,vx,vy,vz,speed}, 'knocker:bounce' {x,y,z,speed,kind,ny}, 'knocker:land' {x,y,z},
 *             'knocker:clack' {x,y,z,beat,idx,bar,accent}, 'knocker:end' {x,y,z,reason:'done'|'lost'|'reset'},
 *             'knocker:refuse' {reason}.
 */

import { CONFIG } from './config3d.js';
import { ITEM } from './inventory3d.js';

/** Every number of the knocker (tune here). */
export const KNOCKER = Object.freeze({
  start: Object.freeze({ normal: 1, sandbox: 2, nightmare: 1, abyss: 0 }), // carried at the start of a run
  cap: 3, // carried at most (CONFIG.bag.caps[ITEM.KNOCKER])
  cooldown: 3, // s between two throws
  maxProps: 3, // slots: the live one + the spent props still lying around (the oldest spent one is recycled)
  // flight
  gravity: CONFIG.player.gravity, // m/s^2 (13.5, the player's own)
  drag: 0.08, // 1/s linear air drag
  radius: 0.06, // m
  restitution: 0.35,
  friction: 0.6, // share of the tangential speed kept per bounce
  restVn: 1.1, // m/s: a floor bounce slower than this (along the normal) ...
  restVt: 0.6, // ... and slower than this along the floor: it lies there
  settleMax: 1.8, // s after the first bounce: laid down on the last floor it touched
  lostDrop: 60, // m below the throw: gone down the shaft
  maxFlight: 12, // s
  substep: 1 / 120,
  spin: 2.4, // rad per metre of throw speed: the tumble in flight
  // throw
  tapTime: 0.12, // s: a press shorter than this is a plain lob
  chargeTime: 1.0, // s to a full throw
  vMin: 9.0, // m/s: a tap (about 6 m on the flat)
  vMax: 18.5, // m/s: fully charged (about 19 m)
  loft: 0.42, // rad added to the look pitch (a throw is a lob, not a shot)
  loftMaxPitch: 1.25, // rad: never lofted past this
  vrGain: 1.25, // the hand's release speed x this ...
  vrMin: 1.0, // m/s: a release slower than this puts the knocker back in the bag
  // the clack
  windup: 0.4, // s of ratchet before the first knock
  duration: 9, // s of knocking
  bar: 3.0, // s: one pass of the 7-beat pattern
  distractEvery: 1.0, // s between creature.distract calls while it clacks
  strength: 1,
  glowDecay: 0.12, // s: the amber glint after each beat
});

/** The 7-beat bar (s from the start of the bar): the Mason's own triple knock, a pair, then two late, lone answers. */
export const KNOCK_PATTERN = Object.freeze([0, 0.28, 0.56, 1.24, 1.52, 2.2, 2.62]);
/** Accent per beat of the bar (the first of each group strikes hardest). */
export const KNOCK_ACCENT = Object.freeze([1, 0.7, 0.85, 0.9, 0.65, 0.8, 0.6]);
/** Beats in one clack: three bars of seven. */
export const KNOCK_BEATS = Math.round(KNOCKER.duration / KNOCKER.bar) * KNOCK_PATTERN.length;

export const KSTATE = Object.freeze({ FREE: 0, HELD: 1, FLIGHT: 2, WINDUP: 3, CLACK: 4, SPENT: 5 });

/** Knockers a run starts with on a difficulty. */
export function startCount(diffKey) {
  const n = KNOCKER.start[diffKey];
  return typeof n === 'number' ? n : KNOCKER.start.normal;
}

/** Time (s from the clack's start) of beat b (0 .. KNOCK_BEATS-1). */
export function beatTime(b) {
  const n = KNOCK_PATTERN.length;
  return Math.floor(b / n) * KNOCKER.bar + KNOCK_PATTERN[b % n];
}

/**
 * Desktop throw: the velocity for a charge held `held` seconds along the unit look direction (dx, dy, dz). The look pitch
 * gets KNOCKER.loft added (capped). Writes {vx, vy, vz, speed, charge} into `out` and returns it.
 */
export function throwVelocity(held, dx, dy, dz, out) {
  const K = KNOCKER;
  const charge = held <= K.tapTime ? 0 : Math.min(1, (held - K.tapTime) / (K.chargeTime - K.tapTime));
  const speed = K.vMin + (K.vMax - K.vMin) * charge;
  const h = Math.sqrt(dx * dx + dz * dz);
  let pitch = Math.atan2(dy, h > 1e-6 ? h : 1e-6);
  pitch = Math.min(K.loftMaxPitch, pitch + K.loft);
  const hx = h > 1e-6 ? dx / h : 0;
  const hz = h > 1e-6 ? dz / h : -1;
  const c = Math.cos(pitch);
  out.vx = hx * c * speed;
  out.vy = Math.sin(pitch) * speed;
  out.vz = hz * c * speed;
  out.speed = speed;
  out.charge = charge;
  return out;
}

/** VR throw: the hand's release velocity, scaled and capped. Writes {vx,vy,vz,speed} into `out`; speed 0 = too slow (put back). */
export function vrThrowVelocity(hvx, hvy, hvz, out) {
  const K = KNOCKER;
  const s = Math.sqrt(hvx * hvx + hvy * hvy + hvz * hvz);
  if (!(s >= K.vrMin)) {
    out.vx = out.vy = out.vz = out.speed = 0;
    return out;
  }
  const v = Math.min(K.vMax, s * K.vrGain);
  const k = v / s;
  out.vx = hvx * k;
  out.vy = hvy * k;
  out.vz = hvz * k;
  out.speed = v;
  return out;
}

// ---- exact linear-drag integration -------------------------------------------------------------

/** Closed-form position / velocity after t seconds of free flight (linear drag k, gravity g down). For tests and the arc. */
export function ballistic(x, y, z, vx, vy, vz, t, out, k = KNOCKER.drag, g = KNOCKER.gravity) {
  if (k > 1e-9) {
    const e = Math.exp(-k * t);
    const vt = -g / k;
    const f = (1 - e) / k;
    out.x = x + vx * f;
    out.z = z + vz * f;
    out.y = y + vt * t + (vy - vt) * f;
    out.vx = vx * e;
    out.vz = vz * e;
    out.vy = vt + (vy - vt) * e;
  } else {
    out.x = x + vx * t;
    out.z = z + vz * t;
    out.y = y + vy * t - 0.5 * g * t * t;
    out.vx = vx;
    out.vz = vz;
    out.vy = vy - g * t;
  }
  return out;
}

const _hit = { t: 0, solid: null, x: 0, y: 0, z: 0 };
const _bs = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
const _n = { x: 0, y: 0, z: 0 };

/** Outward face normal of an axis-aligned box at a point on its surface, against the travel direction (allocation-free). */
function faceNormal(s, x, y, z, dx, dy, dz, out) {
  let best = Math.abs(x - s.minX);
  let ax = 0;
  let sg = -1;
  let d = Math.abs(x - s.maxX);
  if (d < best) (best = d), (ax = 0), (sg = 1);
  d = Math.abs(y - s.minY);
  if (d < best) (best = d), (ax = 1), (sg = -1);
  d = Math.abs(y - s.maxY);
  if (d < best) (best = d), (ax = 1), (sg = 1);
  d = Math.abs(z - s.minZ);
  if (d < best) (best = d), (ax = 2), (sg = -1);
  d = Math.abs(z - s.maxZ);
  if (d < best) (best = d), (ax = 2), (sg = 1);
  out.x = ax === 0 ? sg : 0;
  out.y = ax === 1 ? sg : 0;
  out.z = ax === 2 ? sg : 0;
  if (out.x * dx + out.y * dy + out.z * dz > 0) {
    out.x = -out.x;
    out.y = -out.y;
    out.z = -out.z;
  }
  return out;
}

/**
 * The aim preview: the flight path from (x,y,z) at (vx,vy,vz) sampled every `dt` s into `out` (x,y,z triples) until it
 * meets a solid (the meeting point is the last sample) or `maxN` samples. Returns the number of samples. Allocation-free.
 */
export function predictArc(level, x, y, z, vx, vy, vz, out, maxN, dt = 0.05) {
  let px = x;
  let py = y;
  let pz = z;
  let n = 0;
  out[0] = px;
  out[1] = py;
  out[2] = pz;
  n = 1;
  for (let i = 1; i < maxN; i++) {
    const b = ballistic(x, y, z, vx, vy, vz, i * dt, _bs);
    const mx = b.x - px;
    const my = b.y - py;
    const mz = b.z - pz;
    const len = Math.sqrt(mx * mx + my * my + mz * mz);
    if (level && typeof level.raycast === 'function' && len > 1e-6) {
      const h = level.raycast(px, py, pz, mx, my, mz, len, _hit);
      if (h && h.t <= len) {
        out[n * 3] = h.x;
        out[n * 3 + 1] = h.y;
        out[n * 3 + 2] = h.z;
        return n + 1;
      }
    }
    out[n * 3] = px = b.x;
    out[n * 3 + 1] = py = b.y;
    out[n * 3 + 2] = pz = b.z;
    n++;
  }
  return n;
}

function makeSlot(i) {
  return {
    i,
    state: KSTATE.FREE,
    seq: 0, // throw order (the oldest spent prop is recycled first)
    hand: '', // VR: the hand holding it
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    throwY: 0,
    t: 0, // s in the current state
    flight: 0, // s since the throw
    firstHit: -1, // flight time of the first bounce (-1 none)
    bounces: 0,
    floorY: NaN, // the last floor touched (y of its top face), NaN none
    floorX: 0,
    floorZ: 0,
    floorSolid: null,
    rest: null, // the solid it lies on
    yaw: 0, // heading of the throw (the prop lies along it)
    spin: 0, // tumble angle (rad) about the axis across the throw
    spinRate: 0,
    key: 0, // the wind-up key's angle (rad)
    glow: 0, // 0..1 the amber glint (a beat)
    beat: 0, // next beat to strike
    nextDistract: 0,
    fade: 1, // 1 = shown (the view scales it)
  };
}

export class Knocker3D {
  /** @param {EventBus|null} bus */
  constructor(bus) {
    this.bus = bus || null;
    this.enabled = true;
    this.slots = [];
    for (let i = 0; i < KNOCKER.maxProps; i++) this.slots.push(makeSlot(i));
    this.cooldown = 0; // s until the next throw is allowed
    this.active = -1; // the slot flying / winding / clacking, else -1
    this.held = -1; // VR: the slot in a hand, else -1
    this.seq = 0;
    this.time = 0;
    this.lastRefusal = '';
    this.drawable = false; // the game sets it each frame: could a knocker be pulled from the bag now (VR gesture)
    this.stats = { thrown: 0, landed: 0, lost: 0, done: 0, clacks: 0, distracts: 0, bounces: 0 };
    this._dOpts = { duration: KNOCKER.duration, strength: KNOCKER.strength, source: 'knocker' };
    this._p = {
      throw: { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, speed: 0 },
      bounce: { x: 0, y: 0, z: 0, speed: 0, kind: '', ny: 0 },
      land: { x: 0, y: 0, z: 0 },
      clack: { x: 0, y: 0, z: 0, beat: 0, idx: 0, bar: 0, accent: 1 },
      end: { x: 0, y: 0, z: 0, reason: '' },
      refuse: { reason: '' },
    };
  }

  /** Clears every knocker in the world (a new run, a respawn, a warp). The bag count is the Inventory's business. */
  reset() {
    if (this.active >= 0) {
      const s = this.slots[this.active];
      this._end(s, 'reset');
    }
    for (const s of this.slots) {
      s.state = KSTATE.FREE;
      s.rest = null;
      s.floorSolid = null;
      s.glow = 0;
      s.hand = '';
    }
    this.active = -1;
    this.held = -1;
    this.cooldown = 0;
  }

  /** The slot clacking / flying (or null). */
  get live() {
    return this.active >= 0 ? this.slots[this.active] : null;
  }

  /** Count of slots in use (held, flying, clacking or spent). */
  get inWorld() {
    let n = 0;
    for (const s of this.slots) if (s.state !== KSTATE.FREE) n++;
    return n;
  }

  /**
   * Why a knocker cannot be thrown now ('' when it can).
   * @param {number} count knockers in the bag
   * @param {{dead?:boolean, busy?:boolean}} [ctx] dead = the player is dead; busy = not live (paused, cutscene, intro, victory)
   */
  refusal(count, ctx) {
    if (!this.enabled) return 'off';
    if (ctx && ctx.dead) return 'dead';
    if (ctx && ctx.busy) return 'busy';
    if (!(count > 0)) return 'empty';
    if (this.active >= 0) return 'active';
    if (this.cooldown > 0) return 'cooldown';
    return '';
  }

  _refuse(why) {
    this.lastRefusal = why;
    const p = this._p.refuse;
    p.reason = why;
    this._emit('knocker:refuse', p);
  }

  /**
   * Throws one: refuses (event + false) or takes one from `inv` (Inventory3D, ITEM.KNOCKER) and launches it from (x,y,z) at
   * (vx,vy,vz). Pass inv = null to throw without a bag (debug / tests).
   */
  tryThrow(inv, ctx, x, y, z, vx, vy, vz) {
    const count = inv ? inv.counts[ITEM.KNOCKER] : 1;
    const why = this.refusal(count, ctx);
    if (why) {
      this._refuse(why);
      return false;
    }
    if (inv && !inv.take(ITEM.KNOCKER)) {
      this._refuse('empty');
      return false;
    }
    this.lastRefusal = '';
    this._launch(this.held >= 0 ? this.slots[this.held] : this._freeSlot(), x, y, z, vx, vy, vz);
    return true;
  }

  /** VR: a knocker pulled from the bag sits in `hand` (it is not taken from the bag until it is thrown). Returns false when refused. */
  hold(hand, x, y, z, count, ctx) {
    if (this.held >= 0) return true;
    const why = this.refusal(count, ctx);
    if (why) {
      this._refuse(why);
      return false;
    }
    const s = this._freeSlot();
    s.state = KSTATE.HELD;
    s.hand = hand;
    s.x = x;
    s.y = y;
    s.z = z;
    s.t = 0;
    s.spin = 0;
    s.key = 0;
    s.glow = 0;
    s.fade = 1;
    this.held = s.i;
    return true;
  }

  /** VR: the held knocker follows the hand. */
  moveHeld(x, y, z, yaw) {
    if (this.held < 0) return;
    const s = this.slots[this.held];
    s.x = x;
    s.y = y;
    s.z = z;
    if (yaw === yaw) s.yaw = yaw;
  }

  /** VR: the hand let go too gently (or was untracked): the knocker goes back into the bag, nothing spent. */
  putBack() {
    if (this.held < 0) return false;
    const s = this.slots[this.held];
    s.state = KSTATE.FREE;
    s.hand = '';
    this.held = -1;
    return true;
  }

  /** A free slot, else the oldest spent prop (recycled). */
  _freeSlot() {
    let best = null;
    for (const s of this.slots) if (s.state === KSTATE.FREE) return s;
    for (const s of this.slots) if (s.state === KSTATE.SPENT && (!best || s.seq < best.seq)) best = s;
    return best || this.slots[0];
  }

  _launch(s, x, y, z, vx, vy, vz) {
    if (this.held === s.i) this.held = -1;
    s.state = KSTATE.FLIGHT;
    s.hand = '';
    s.seq = ++this.seq;
    s.x = x;
    s.y = y;
    s.z = z;
    s.vx = vx;
    s.vy = vy;
    s.vz = vz;
    s.throwY = y;
    s.t = 0;
    s.flight = 0;
    s.firstHit = -1;
    s.bounces = 0;
    s.floorY = NaN;
    s.floorSolid = null;
    s.rest = null;
    const sp = Math.sqrt(vx * vx + vy * vy + vz * vz);
    s.yaw = Math.atan2(-vx, -vz);
    s.spin = 0;
    s.spinRate = sp * KNOCKER.spin;
    s.key = 0;
    s.glow = 0;
    s.beat = 0;
    s.fade = 1;
    this.active = s.i;
    this.cooldown = KNOCKER.cooldown;
    this.stats.thrown++;
    const p = this._p.throw;
    p.x = x;
    p.y = y;
    p.z = z;
    p.vx = vx;
    p.vy = vy;
    p.vz = vz;
    p.speed = sp;
    this._emit('knocker:throw', p);
  }

  /**
   * Advances the flight, the clack and the cooldown.
   * @param {number} dt
   * @param {Level3D|null} level  raycast / bounds
   * @param {object|null} creature  the Mason (distract(x,y,z,opts) when it has it); never the skitterlings
   */
  update(dt, level, creature) {
    if (!(dt > 0)) return;
    this.time += dt;
    if (this.cooldown > 0) this.cooldown = Math.max(0, this.cooldown - dt);
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (s.state === KSTATE.FREE || s.state === KSTATE.HELD) continue;
      if (s.glow > 0) s.glow = Math.max(0, s.glow - dt / KNOCKER.glowDecay);
      let adv = dt; // the clack's share of this frame
      if (s.state === KSTATE.FLIGHT) this._fly(s, dt, level);
      else if (s.rest && s.rest.active === false) {
        // the ledge under it crumbled away: it falls again (and picks its knocking up where it lands)
        s.rest = null;
        if (s.state !== KSTATE.SPENT) {
          s.state = KSTATE.FLIGHT;
          s.vx = s.vy = s.vz = 0;
          s.flight = 0;
          s.firstHit = -1;
          s.throwY = s.y;
        } else s.state = KSTATE.FREE;
      } else if (s.state === KSTATE.WINDUP) {
        s.t += dt;
        s.key += dt * 22; // the ratchet winding: a fast turn
        if (s.t >= KNOCKER.windup) {
          adv = s.t - KNOCKER.windup; // the knocking starts exactly 0.4 s after the landing
          s.state = KSTATE.CLACK;
          s.t = 0;
          s.beat = 0;
          s.nextDistract = 0;
        } else adv = -1;
      }
      if (s.state === KSTATE.CLACK && adv >= 0) this._clack(s, adv, creature);
    }
  }

  _fly(s, dt, level) {
    const K = KNOCKER;
    let left = dt;
    while (left > 1e-9 && s.state === KSTATE.FLIGHT) {
      const h = left > K.substep ? K.substep : left;
      left -= h;
      s.flight += h;
      s.spin += s.spinRate * h;
      const b = ballistic(s.x, s.y, s.z, s.vx, s.vy, s.vz, h, _bs);
      const mx = b.x - s.x;
      const my = b.y - s.y;
      const mz = b.z - s.z;
      const len = Math.sqrt(mx * mx + my * my + mz * mz);
      let hit = null;
      if (level && typeof level.raycast === 'function' && len > 1e-7) hit = level.raycast(s.x, s.y, s.z, mx, my, mz, len + K.radius, _hit);
      if (hit && hit.t < len + K.radius) {
        const ux = mx / len;
        const uy = my / len;
        const uz = mz / len;
        const n = faceNormal(hit.solid, hit.x, hit.y, hit.z, ux, uy, uz, _n);
        const tt = Math.max(0, hit.t - K.radius);
        s.x += ux * tt + n.x * 0.002;
        s.y += uy * tt + n.y * 0.002;
        s.z += uz * tt + n.z * 0.002;
        // the velocity at the contact: the step's end velocity is close enough for a 1/120 s step
        const vx = b.vx;
        const vy = b.vy;
        const vz = b.vz;
        const vn = vx * n.x + vy * n.y + vz * n.z;
        if (vn < 0) {
          const tx = vx - vn * n.x;
          const ty = vy - vn * n.y;
          const tz = vz - vn * n.z;
          s.vx = tx * K.friction - vn * K.restitution * n.x;
          s.vy = ty * K.friction - vn * K.restitution * n.y;
          s.vz = tz * K.friction - vn * K.restitution * n.z;
          s.spinRate *= 0.55;
          if (s.firstHit < 0) s.firstHit = s.flight;
          s.bounces++;
          this.stats.bounces++;
          if (-vn > 0.9) {
            const p = this._p.bounce;
            p.x = s.x;
            p.y = s.y;
            p.z = s.z;
            p.speed = -vn;
            p.kind = hit.solid && hit.solid.kind ? hit.solid.kind : 'stone';
            p.ny = n.y;
            this._emit('knocker:bounce', p);
          }
          if (n.y > 0.7) {
            s.floorY = hit.y;
            s.floorX = hit.x;
            s.floorZ = hit.z;
            s.floorSolid = hit.solid;
            const vt = Math.sqrt(s.vx * s.vx + s.vz * s.vz);
            if (-vn < K.restVn && vt < K.restVt) {
              this._settle(s, hit.x, hit.y, hit.z, hit.solid);
              return;
            }
          }
        } else {
          s.vx = vx;
          s.vy = vy;
          s.vz = vz;
        }
      } else {
        s.x = b.x;
        s.y = b.y;
        s.z = b.z;
        s.vx = b.vx;
        s.vy = b.vy;
        s.vz = b.vz;
      }
      // settle: never bounce about for long (laid down on the last floor it touched)
      if (s.firstHit >= 0 && s.flight - s.firstHit > K.settleMax && s.floorY === s.floorY && s.y - s.floorY < 0.6 && s.vy <= 0.5) {
        this._settle(s, s.x, s.floorY, s.z, s.floorSolid);
        return;
      }
      // lost: down the shaft, out of the level, or flying forever
      const bd = level && level.bounds;
      const out = bd ? s.x < bd.minX - 8 || s.x > bd.maxX + 8 || s.z < bd.minZ - 8 || s.z > bd.maxZ + 8 || s.y < bd.minY - 8 : false;
      if (s.throwY - s.y > K.lostDrop || out || s.flight > K.maxFlight) {
        this.stats.lost++;
        this._end(s, 'lost');
        s.state = KSTATE.FREE;
        return;
      }
    }
  }

  _settle(s, x, y, z, solid) {
    const K = KNOCKER;
    s.x = x;
    s.y = y + K.radius;
    s.z = z;
    s.vx = s.vy = s.vz = 0;
    s.spinRate = 0;
    s.spin = 0;
    s.rest = solid || null;
    this.stats.landed++;
    if (s.beat > 0) {
      // it fell off a crumbling ledge mid-knock: no second wind-up, the knocking goes on
      s.state = KSTATE.CLACK;
    } else {
      s.state = KSTATE.WINDUP;
      s.t = 0;
      const p = this._p.land;
      p.x = s.x;
      p.y = s.y;
      p.z = s.z;
      this._emit('knocker:land', p);
    }
  }

  _clack(s, dt, creature) {
    const K = KNOCKER;
    s.t += dt;
    s.key += dt * 2.2; // the key turns slowly while it knocks
    // the Mason: at the first beat and then once a second, with what is left of the 9 s (9, 8, 7 ...)
    if (s.t >= s.nextDistract && s.nextDistract < K.duration - 1e-6) {
      const at = s.nextDistract;
      s.nextDistract += K.distractEvery;
      if (creature && typeof creature.distract === 'function') {
        const o = this._dOpts;
        o.duration = K.duration - at;
        o.strength = K.strength;
        try {
          creature.distract(s.x, s.y, s.z, o);
        } catch {
          /* a creature that throws does not stop the knocking */
        }
        this.stats.distracts++;
      }
    }
    while (s.beat < KNOCK_BEATS && s.t >= beatTime(s.beat)) {
      const n = KNOCK_PATTERN.length;
      const p = this._p.clack;
      p.x = s.x;
      p.y = s.y;
      p.z = s.z;
      p.beat = s.beat;
      p.idx = s.beat % n;
      p.bar = Math.floor(s.beat / n);
      p.accent = KNOCK_ACCENT[p.idx];
      s.glow = 0.55 + 0.45 * p.accent;
      s.beat++;
      this.stats.clacks++;
      this._emit('knocker:clack', p);
    }
    if (s.t >= K.duration) {
      s.state = KSTATE.SPENT;
      s.glow = 0;
      this.stats.done++;
      this._end(s, 'done');
    }
  }

  _end(s, reason) {
    if (this.active === s.i) this.active = -1;
    const p = this._p.end;
    p.x = s.x;
    p.y = s.y;
    p.z = s.z;
    p.reason = reason;
    this._emit('knocker:end', p);
  }

  _emit(type, payload) {
    if (this.bus) this.bus.emit(type, payload);
  }

  /** Read-out for the debug API / tests (allocates: not for the frame loop). */
  debugState() {
    const r = (v) => Math.round(v * 1000) / 1000;
    const names = ['free', 'held', 'flight', 'windup', 'clack', 'spent'];
    return {
      enabled: this.enabled,
      cooldown: r(this.cooldown),
      active: this.active,
      held: this.held,
      refusal: this.lastRefusal,
      stats: Object.assign({}, this.stats),
      slots: this.slots.map((s) => ({ state: names[s.state], x: r(s.x), y: r(s.y), z: r(s.z), t: r(s.t), beat: s.beat, flight: r(s.flight), bounces: s.bounces })),
    };
  }
}
