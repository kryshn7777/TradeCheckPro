/* ABYSSAL TETHER 3D — health3d.js
 * The player's health and fall damage. Pure and deterministic: no three.js, no DOM, no
 * Math.random, no clock other than the dt it is stepped with (runs in Node for the route bot).
 *
 * hp is 0..1 (100 hp). Damage sources:
 *
 *   LANDING (floor-like contact). Driven by the same pre-contact speed the lethality rule used
 *   (Physics3D passes lethalMeasure: the fall speed weighted by how floor-like the contact is).
 *     r = speed / diff.lethalImpact
 *     damage = ((r - t) / (1 - t))^2     for t < r < 1  (t = diff.health.fallThreshold, ~0.35)
 *     damage = 0 below t, 1 (dead from any hp) at r >= 1
 *   i.e. nothing for a hop, a little for a short drop, a lot for a long one, and the old lethal
 *   fall (speed >= lethalImpact) still kills. Convex, continuous, zero slope at the threshold.
 *
 *   WALL / SIDE impact (non-floor contact, normal-component speed): gentler,
 *     damage = min(cap, wallMax * wallScale * ((min(r, 1.5) - 0.5) / 0.5)^2), r > 0.5.
 *
 *   HAZARD (spikes / blades / rebar): diff.health.hazardDamage (0.6 on Normal), then a 1.2 s
 *   cooldown; touching again after it (or ending at 0 hp) is the existing 'hazard' death.
 *
 *   CREATURE attack: still lethal (Physics3D.kill -> die()).
 *
 * One landing is never counted twice: after a hit there is hitCooldown seconds in which another
 * floor/wall hit only pays the excess over the one already taken (so the total is the larger of
 * the two, not the sum).
 *
 * Checkpoints: Game3D restores full health on reaching a new checkpoint (CONFIG.health.checkpointHeal) and a respawn /
 * restart / warp resets it; Abyss has no checkpoints, so there it only regenerates.
 *
 * Regeneration: regenDelay seconds without damage, then regenRate hp/s (fraction of full) up to
 * full. Normal 6 s / 5 hp/s, Nightmare 9 s / 3 hp/s, Abyss 12 s / 2 hp/s. Sandbox (no lethal
 * impacts) takes no fall damage. god (debug) takes none at all.
 *
 * Bus events (payloads are plain objects):
 *   'health:damage' { amount, hp, cause: 'fall'|'wall'|'hazard', speed, lethal }
 *   'health:low'    { hp }                      crossing down through lowEnter (0.35)
 *   'health:recover'{ hp, full }                low ended (hp >= lowExit) or hp back to full
 *   'health:heal'   { amount, hp }              a bag item (heal()) restored health
 *
 * Read-only for the presentation: hp, low, dead, heartbeatRate (bpm; 60 calm .. 140 near zero,
 * 0 once dead), adrenaline (0..1 after a hit), sinceHurt (s), lastDamage, totalDamage, hits, minHp.
 */

import { CONFIG, U } from './config3d.js';

const H = CONFIG.health;

/** Landing damage (0..1 of full health) for a floor-like impact at `speed`. */
export function fallDamage(speed, lethal, threshold, exp = H.fallExp) {
  if (!(speed > 0) || !(lethal > 0)) return 0;
  if (speed >= lethal) return 1;
  const r = speed / lethal;
  if (r <= threshold) return 0;
  return Math.pow((r - threshold) / (1 - threshold), exp);
}

/** Wall / side impact damage for the impact's normal-component speed. */
export function wallDamage(speed, lethal, scale = 1) {
  if (!(speed > 0) || !(lethal > 0)) return 0;
  const r = Math.min(speed / lethal, H.wallSpeedCap);
  if (r <= H.wallThreshold) return 0;
  const d = H.wallMax * scale * Math.pow((r - H.wallThreshold) / (1 - H.wallThreshold), H.wallExp);
  return Math.min(H.wallCap, d);
}

/** Heart rate (bpm) for an hp and an adrenaline level (0..1): 60 calm, ~140 near zero. */
export function heartRate(hp, adrenaline = 0) {
  const stress = Math.pow(U.clamp(1 - hp, 0, 1), H.bpmExp);
  return Math.min(H.bpmMax + H.adrenalineBpm * 0.4, H.bpmCalm + (H.bpmMax - H.bpmCalm) * stress + H.adrenalineBpm * adrenaline * (1 - 0.5 * stress));
}

/** Free-fall drop height (m) that lands at `speed` (gravity of the game, no drag): for tables and tooltips. */
export function dropHeight(speed) {
  return (speed * speed) / (2 * CONFIG.player.gravity);
}

/** Speed (m/s) at which a free fall of `h` metres lands (no drag). */
export function dropSpeed(h) {
  return Math.sqrt(2 * CONFIG.player.gravity * Math.max(0, h));
}

const SNAP_LEN = 13;

export class Health3D {
  /**
   * @param {object} diff DIFFICULTY preset (reads lethalImpact, impactsLethal and health)
   * @param {EventBus|null} bus
   */
  constructor(diff, bus) {
    this.diff = diff;
    this.bus = bus || null;
    const d = (diff && diff.health) || {};
    this.fallThreshold = typeof d.fallThreshold === 'number' ? d.fallThreshold : 0.35;
    this.regenDelay = typeof d.regenDelay === 'number' ? d.regenDelay : 6;
    this.regenRate = typeof d.regenRate === 'number' ? d.regenRate : 0.05;
    this.hazardDamage = typeof d.hazardDamage === 'number' ? d.hazardDamage : 0.6;
    this.wallScale = typeof d.wallScale === 'number' ? d.wallScale : 1;
    this.lethal = diff && diff.lethalImpact > 0 ? diff.lethalImpact : 17;
    /** Falls and wall hits hurt (Sandbox: impactsLethal false -> they do not). */
    this.fallsEnabled = !diff || diff.impactsLethal !== false;
    /** Debug / victory: no damage at all. */
    this.god = false;
    this.lastDamage = { amount: 0, cause: '', speed: 0, t: 0 };
    this.reset();
  }

  /** Full health, all timers and the run statistics cleared (respawn, restart, warp). */
  reset() {
    this.hp = 1;
    this.low = false;
    this.dead = false;
    this.wounded = false; // damaged since the last time hp was full
    this.clock = 0;
    this.sinceHurt = 1e9;
    this.impactCd = 0;
    this.impactAmt = 0;
    this.hazardCd = 0;
    this.adrenaline = 0;
    this.heartbeatRate = H.bpmCalm;
    this.totalDamage = 0;
    this.hits = 0;
    this.minHp = 1;
    this.lastDamage.amount = 0;
    this.lastDamage.cause = '';
    this.lastDamage.speed = 0;
    this.lastDamage.t = -1;
  }

  /** hp in points (0..100). */
  get hp100() {
    return Math.round(this.hp * 100);
  }

  /** 0..1 how hurt the player looks (0 at/above vignetteStart, 1 at zero hp). */
  get hurt() {
    return U.clamp(1 - this.hp / H.vignetteStart, 0, 1);
  }

  /** Advances the timers and regenerates. Call once per physics step (or per frame) with its dt. */
  step(dt) {
    if (this.dead) return;
    this.clock += dt;
    this.sinceHurt += dt;
    if (this.impactCd > 0) {
      this.impactCd -= dt;
      if (this.impactCd <= 0) {
        this.impactCd = 0;
        this.impactAmt = 0;
      }
    }
    if (this.hazardCd > 0) this.hazardCd = Math.max(0, this.hazardCd - dt);
    if (this.adrenaline > 0) this.adrenaline = Math.max(0, this.adrenaline - dt / H.adrenalineTime);
    if (this.hp < 1 && this.sinceHurt >= this.regenDelay && this.regenRate > 0 && !this.god) {
      this.hp = Math.min(1, this.hp + this.regenRate * dt);
      this._settle();
    }
    this.heartbeatRate = heartRate(this.hp, this.adrenaline);
  }

  /** Landing on something floor-like at `speed` (m/s). Returns true when it killed. */
  landing(speed) {
    if (!this.fallsEnabled || this.god || this.dead) return false;
    const amount = speed >= this.lethal ? 1 : fallDamage(speed, this.lethal, this.fallThreshold);
    return this._impact(amount, 'fall', speed);
  }

  /** A side impact with normal-component speed `speed`. Returns true when it killed. */
  wallHit(speed) {
    if (!this.fallsEnabled || this.god || this.dead) return false;
    return this._impact(wallDamage(speed, this.lethal, this.wallScale), 'wall', speed);
  }

  /** Spikes / blades / rebar contact. Returns true when it killed. */
  hazardHit() {
    if (this.god || this.dead) return false;
    if (this.hazardCd > 0) return false;
    this.hazardCd = H.hazardCooldown;
    return this.damage(this.hazardDamage, 'hazard', 0);
  }

  /** Applies `amount` (0..1) of damage with no cooldown logic. Returns true when hp reached 0. */
  damage(amount, cause, speed) {
    if (this.god || this.dead || !(amount > 0)) return false;
    const taken = Math.min(this.hp, amount);
    this.hp = Math.max(0, this.hp - amount);
    this.sinceHurt = 0;
    this.wounded = true;
    this.hits++;
    this.totalDamage += taken;
    if (this.hp < this.minHp) this.minHp = this.hp;
    this.adrenaline = Math.min(1, this.adrenaline + 0.35 + taken * 1.2);
    const ld = this.lastDamage;
    ld.amount = taken;
    ld.cause = cause;
    ld.speed = speed || 0;
    ld.t = this.clock;
    this.heartbeatRate = heartRate(this.hp, this.adrenaline);
    const lethal = this.hp <= 0;
    if (this.bus) this.bus.emit('health:damage', { amount: taken, hp: this.hp, cause, speed: speed || 0, lethal });
    if (!this.low && this.hp <= H.lowEnter) {
      this.low = true;
      if (this.bus) this.bus.emit('health:low', { hp: this.hp });
    }
    return lethal;
  }

  /** The player died (any cause): hp 0, the ECG flatlines, nothing regenerates. */
  die() {
    if (this.dead) return;
    this.dead = true;
    this.hp = 0;
    this.heartbeatRate = 0;
    this.adrenaline = 0;
    this.minHp = 0;
  }

  /** Debug / test: sets hp directly (no events, no cooldowns). */
  setHp(hp) {
    if (this.dead) return;
    this.hp = U.clamp(hp, 0, 1);
    this.low = this.hp <= H.lowEnter;
    this.wounded = this.hp < 1;
    this.sinceHurt = 0;
    if (this.hp < this.minHp) this.minHp = this.hp;
    this.heartbeatRate = heartRate(this.hp, this.adrenaline);
  }

  /**
   * Restores `fraction` of full health (a checkpoint, a bag item), never above full. Returns the fraction actually
   * gained (0 when dead or already full). Emits 'health:heal' { amount, hp } for a real gain unless `silent`
   * ('health:low' ends / 'health:recover' come from _settle as usual).
   */
  heal(fraction = 1, silent = false) {
    if (this.dead || !(fraction > 0)) return 0;
    const before = this.hp;
    this.hp = Math.min(1, this.hp + fraction);
    const gained = this.hp - before;
    this._settle();
    this.heartbeatRate = heartRate(this.hp, this.adrenaline);
    if (gained > 0 && !silent && this.bus) this.bus.emit('health:heal', { amount: gained, hp: this.hp });
    return gained;
  }

  _impact(amount, cause, speed) {
    if (!(amount > 0)) return false;
    let pay = amount;
    if (this.impactCd > 0) {
      pay = amount - this.impactAmt; // the same landing seen again: only the excess counts
      if (!(pay > 1e-6)) return false;
      this.impactAmt = amount;
    } else {
      this.impactAmt = amount;
      this.impactCd = H.hitCooldown;
    }
    // A lethal hit is lethal from any hp (damage 1).
    return this.damage(amount >= 1 ? 1 : pay, cause, speed);
  }

  _settle() {
    if (this.low && this.hp >= H.lowExit) {
      this.low = false;
      if (this.bus) this.bus.emit('health:recover', { hp: this.hp, full: this.hp >= 1 });
    }
    if (this.wounded && this.hp >= 1) {
      this.wounded = false;
      if (this.bus) this.bus.emit('health:recover', { hp: 1, full: true });
    }
  }

  /** State for the bot's look-ahead (clone -> simulate -> restore). */
  snapshot() {
    return [this.hp, this.low, this.dead, this.wounded, this.clock, this.sinceHurt, this.impactCd, this.impactAmt, this.hazardCd, this.adrenaline, this.totalDamage, this.hits, this.minHp];
  }

  restore(s) {
    if (!s || s.length < SNAP_LEN) return;
    [this.hp, this.low, this.dead, this.wounded, this.clock, this.sinceHurt, this.impactCd, this.impactAmt, this.hazardCd, this.adrenaline, this.totalDamage, this.hits, this.minHp] = s;
    this.heartbeatRate = this.dead ? 0 : heartRate(this.hp, this.adrenaline);
  }
}
