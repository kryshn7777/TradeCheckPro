/* THE LANTERN — render/mason/attackPhase.js
 * MASON SNAKE ATTACK (plans/MASON_SNAKE_ATTACK.md): ONE attack phase per frame for the views and the sounds, whatever the sim offers.
 *
 *   idle | stalk | dash | rise | stare | lock | strike | recoil
 *
 * Source, in order:
 *   1. forced   AT3D.debug.masonPhase(phase, u): held at u (captures) or played at its nominal length; 'cycle' loops the whole dance
 *   2. sim      the snake choreography's own read-only fields (creature.attackPhase, attackT01, aimX/aimY/aimZ), and the bus
 *               `creature:phase {phase, t, dur, tx, ty, tz}` for the duration / the locked point (onPhaseEvent)
 *   3. derived  today's sim: attack.phase 'windup' = RISE then LOCK (the last LOCK_MAX s, at most 45 % of the wind-up; the aim frozen
 *               where you stood when it began), 'strike' / 'lunge' = STRIKE (the aim = the lunge's end point), 'recoil' = RECOIL,
 *               state BURST = DASH, an aware state within STARE_RANGE = STARE, an aware state further out = STALK, else IDLE
 * Pure (no three, no DOM), deterministic, allocation-free per update (numbers and frozen strings only).
 */

export const PHASES = Object.freeze(['idle', 'stalk', 'dash', 'rise', 'stare', 'lock', 'strike', 'recoil']);

export const ATTACK_TUNE = Object.freeze({
  lockMax: 0.3, // s: the derived lock window (the dodge deadline)
  lockFrac: 0.45, // ... at most this share of the wind-up
  strikeTime: 0.16, // s: sim/creature3d.js CREATURE_TUNING.strikeTime
  postStrike: 0.45, // s: CREATURE_TUNING.postStrike (the recoil)
  stareRange: 12, // m: an aware Mason this near holds its coil and stares
  stareRamp: 2, // s: a derived stare's t01 runs over this
  stalkRamp: 3,
  eye: 1.55, // m above the player's feet when there is no head position (the aim point)
});

/** Nominal lengths (s): the forced playback and the derived t01 of the open-ended phases. */
export const NOMINAL = Object.freeze({ idle: 2, stalk: 3, dash: 2, rise: 0.9, stare: 1.6, lock: 0.3, strike: 0.2, recoil: 0.5 });
const CYCLE = Object.freeze(['stalk', 'dash', 'rise', 'stare', 'lock', 'strike', 'recoil', 'stare', 'lock', 'strike', 'recoil']);
const CYCLE_LOOP = 3; // after the first pass the loop restarts at CYCLE[3] (stare -> lock -> strike -> recoil ...)

const AWARE = Object.freeze({ OBSERVING: 1, APPROACHING: 1, PURSUING: 1, BURST: 1, ATTACK: 1, RECOVERING: 1 });
const SIM_MAP = Object.freeze({
  idle: 'idle',
  stalk: 'stalk',
  dash: 'dash',
  rise: 'rise',
  coil: 'rise',
  stare: 'stare',
  lock: 'lock',
  strike: 'strike',
  lunge: 'strike',
  recoil: 'recoil',
});

const fin = (v) => typeof v === 'number' && v === v && v !== Infinity && v !== -Infinity;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** The adapter's phase name for a sim phase string (unknown / empty: 'idle'). */
export function mapSimPhase(s) {
  return (typeof s === 'string' && SIM_MAP[s]) || 'idle';
}

/** The derived lock window (s) for a wind-up of `windup` s. */
export function lockWindow(windup) {
  const w = fin(windup) && windup > 0 ? windup : 0.5;
  return Math.min(ATTACK_TUNE.lockMax, ATTACK_TUNE.lockFrac * w);
}

export class AttackPhase {
  constructor() {
    this.phase = 'idle';
    this.prev = 'idle';
    this.t01 = 0;
    this.time = 0; // s in this phase
    this.dur = 0; // its expected length (0: open-ended / unknown)
    this.aimX = 0;
    this.aimY = 0;
    this.aimZ = 0;
    this.locked = false; // the aim is frozen (lock, strike)
    this.changed = false; // the phase changed on the last update
    this.source = 'derived'; // 'sim' | 'derived' | 'forced'
    this.distance = 99;
    // the bus event of the new sim (creature:phase)
    this._ev = { on: false, phase: 'idle', dur: 0, tx: 0, ty: 0, tz: 0, has: false };
    // forced (debug)
    this._force = '';
    this._forceU = -1;
    this._forceT = 0;
    this._cycleI = 0;
    this._lockX = 0;
    this._lockY = 0;
    this._lockZ = 0;
  }

  /** The bus `creature:phase` {phase, t, dur, tx, ty, tz} (the new sim): the duration and the locked point. */
  onPhaseEvent(p) {
    if (!p || typeof p !== 'object') return;
    const e = this._ev;
    e.on = true;
    e.phase = mapSimPhase(p.phase);
    e.dur = fin(p.dur) && p.dur > 0 ? p.dur : 0;
    e.has = fin(p.tx) && fin(p.ty) && fin(p.tz);
    if (e.has) {
      e.tx = p.tx;
      e.ty = p.ty;
      e.tz = p.tz;
    }
  }

  /**
   * Forces a phase (debug / captures): u in 0..1 holds it there, u < 0 / omitted plays it at its nominal length (then holds the end);
   * 'cycle' loops the whole choreography; '' / null / 'off' returns to the sim. Returns whether the name was understood.
   */
  force(phase, u) {
    if (phase == null || phase === '' || phase === 'off' || phase === false) {
      this._force = '';
      return true;
    }
    const name = phase === 'cycle' ? 'cycle' : SIM_MAP[phase];
    if (!name) return false;
    this._force = name;
    this._forceU = fin(u) && u >= 0 ? clamp01(u) : -1;
    this._forceT = 0;
    this._cycleI = 0;
    return true;
  }

  get forced() {
    return this._force;
  }

  /** A forced phase held at a fixed u (captures): the pose shows its canonical shape for that moment. */
  get held() {
    return !!this._force && this._force !== 'cycle' && this._forceU >= 0;
  }

  /**
   * One frame.
   * @param {object} c       the Creature3D (or a synthetic one): state, attack, distance, body, and the new fields when present
   * @param {object} player  the aim fallback: {x, y, z} (feet) or a head point with `head: true`
   * @param {number} dt
   */
  update(c, player, dt) {
    dt = dt > 0 ? (dt < 0.25 ? dt : 0.25) : 0;
    const was = this.phase;
    let ph = 'idle';
    let t01 = 0;
    let dur = 0;
    let aimLocked = false;
    // the default aim: the player's eyes
    let ax = this.aimX;
    let ay = this.aimY;
    let az = this.aimZ;
    if (player && fin(player.x) && fin(player.y) && fin(player.z)) {
      ax = player.x;
      ay = player.y + (player.head ? 0 : ATTACK_TUNE.eye);
      az = player.z;
    }
    this.distance = c && fin(c.distance) ? c.distance : 99;
    if (this._force) {
      this.source = 'forced';
      if (this._force === 'cycle') {
        this._forceT += dt;
        let nm = CYCLE[this._cycleI];
        while (this._forceT >= NOMINAL[nm]) {
          this._forceT -= NOMINAL[nm];
          this._cycleI = this._cycleI + 1 < CYCLE.length ? this._cycleI + 1 : CYCLE_LOOP;
          nm = CYCLE[this._cycleI];
        }
        ph = nm;
        dur = NOMINAL[nm];
        t01 = clamp01(this._forceT / dur);
      } else {
        ph = this._force;
        dur = NOMINAL[ph];
        if (this._forceU >= 0) t01 = this._forceU;
        else {
          this._forceT += dt;
          t01 = clamp01(this._forceT / dur);
        }
      }
      aimLocked = ph === 'lock' || ph === 'strike';
    } else if (c && typeof c.attackPhase === 'string') {
      // the new sim's own choreography
      this.source = 'sim';
      ph = mapSimPhase(c.attackPhase);
      if (c.active === false || (c.body && c.body.visible === false)) ph = 'idle';
      t01 = fin(c.attackT01) ? clamp01(c.attackT01) : clamp01((this.time + dt) / NOMINAL[ph]);
      const e = this._ev;
      dur = e.on && e.phase === ph ? e.dur : 0;
      if (fin(c.aimX) && fin(c.aimY) && fin(c.aimZ)) {
        ax = c.aimX;
        ay = c.aimY;
        az = c.aimZ;
      } else if (e.on && e.has && e.phase === ph) {
        ax = e.tx;
        ay = e.ty;
        az = e.tz;
      }
      aimLocked = ph === 'lock' || ph === 'strike';
    } else if (c && c.active !== false && !(c.body && c.body.visible === false)) {
      this.source = 'derived';
      const st = c.state;
      const a = c.attack;
      const ap = st === 'ATTACK' && a ? a.phase : null;
      if (ap === 'windup') {
        const W = fin(a.windup) && a.windup > 0 ? a.windup : 0.5;
        const L = lockWindow(W);
        const at = fin(a.t) ? a.t : 0;
        if (at < W - L) {
          ph = 'rise';
          dur = W - L;
          t01 = clamp01(at / dur);
        } else {
          ph = 'lock';
          dur = L;
          t01 = clamp01((at - (W - L)) / L);
          aimLocked = true;
        }
      } else if (ap === 'strike' || ap === 'lunge') {
        ph = 'strike';
        dur = ATTACK_TUNE.strikeTime;
        t01 = clamp01((fin(a.t) ? a.t : 0) / dur);
        aimLocked = true;
        if (fin(a.lx) && fin(a.ly) && fin(a.lz)) {
          // the lunge's end point is where it locked on
          this._lockX = a.lx;
          this._lockY = a.ly;
          this._lockZ = a.lz;
        }
      } else if (ap === 'recoil') {
        ph = 'recoil';
        dur = ATTACK_TUNE.postStrike;
        t01 = clamp01((fin(a.t) ? a.t : 0) / dur);
      } else if (st === 'BURST') {
        ph = 'dash';
      } else if (AWARE[st] === 1) {
        ph = this.distance <= ATTACK_TUNE.stareRange ? 'stare' : 'stalk';
      }
      if (dur === 0 && ph !== 'idle') t01 = clamp01((ph === was ? this.time + dt : 0) / (ph === 'stare' ? ATTACK_TUNE.stareRamp : ph === 'stalk' ? ATTACK_TUNE.stalkRamp : NOMINAL[ph]));
    } else this.source = 'derived';

    this.changed = ph !== was;
    if (this.changed) {
      this.prev = was;
      this.time = 0;
    } else this.time += dt;
    this.phase = ph;
    this.t01 = t01;
    this.dur = dur;
    // the aim: frozen from the frame it locked (the strike carries the locked point on), else live
    if (aimLocked) {
      if (!this.locked) {
        // first locked frame: freeze where you are now (a derived strike already wrote the lunge's end point)
        if (!(ph === 'strike' && this.source === 'derived' && this.changed && was !== 'lock')) {
          this._lockX = ax;
          this._lockY = ay;
          this._lockZ = az;
        }
      }
      if (this.source === 'sim') {
        // the sim's aim fields ARE the locked point
        this._lockX = ax;
        this._lockY = ay;
        this._lockZ = az;
      }
      this.aimX = this._lockX;
      this.aimY = this._lockY;
      this.aimZ = this._lockZ;
    } else {
      this.aimX = ax;
      this.aimY = ay;
      this.aimZ = az;
    }
    this.locked = aimLocked;
    return this;
  }
}
