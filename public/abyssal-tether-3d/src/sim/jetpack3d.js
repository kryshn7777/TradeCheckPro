/**
 * ABYSSAL TETHER 3D - the JETPACK (pure sim: no three.js, no DOM, no Math.random).
 *
 * "Plan to implement a jetpack which has a really low fuel, and he can find fuel rarely, but it just saves him if he falls down. Press both
 * the triggers at once to trigger it briefly for a moment and then save himself. The fuel does not recharge when the player dies."
 *
 * A small pack on the harness. It exists for one moment: you are falling and there is no anchor. Both triggers pressed together (within
 * 90 ms), or J on a keyboard, while you fall faster than 5 m/s with no rope attached, light it. It burns a BURST: a hard brake against the fall
 * (feedback control: thrust = hover + gain x (target - vy), capped), which settles into a slow descent (-2.4 m/s) and holds it until you touch
 * down, the fuel runs out, 2.4 s have passed or you press the chord again. A soft landing costs no health. Fuel is cheap while hovering
 * (a hover burns about 60 % of a brake), so the small tank is a save or two, not flight.
 *
 *   FUEL     tank 1.0; a new run starts with 0.5 (one save); a FUEL CAN adds 0.5 (cap 1.0). 0.45 / s at full thrust.
 *   CANS     rare: one in every other section, favouring risky perches and alcoves (the same candidate spots as the supplies).
 *            Picked up by walking or swinging through (0.9 m) or a hand with the grip (0.35 m). Once taken a can stays taken: dying does NOT put
 *            it back, and dying does NOT refill the tank (the checkpoint restores the bag, not this). A new run resets both.
 *   INPUT    chord(hand, now): the second press within CHORD s of the first (and the first press still fires its rope as usual). With no
 *            fuel the presses are ordinary rope shots and 'jetpack:empty' sounds once per second so you know why nothing lit.
 *
 * Bus events: 'jetpack:ignite' {fuel, vy, x,y,z}, 'jetpack:cut' {reason: 'ground'|'fuel'|'time'|'rope'|'cancel'|'death', fuel, burned},
 *             'jetpack:empty' {}, 'jetpack:can' {id, x,y,z, fuel, gained}, 'jetpack:low' {fuel} (once, when a burst leaves < 0.2).
 */
import { CONFIG, U } from './config3d.js';

export const JET = Object.freeze({
  tank: 1.0,
  startFuel: 0.5,
  canFuel: 0.5,
  burn: 0.45, // fuel / s at full thrust
  hoverShare: 0.6, // a hover burns this share of a full-thrust second
  burstMax: 2.4, // s: one ignition
  minFall: 5, // m/s down needed to light it
  chord: 0.09, // s between the two trigger presses
  gain: 12, // 1/s: how hard it pushes the vertical speed to the target
  maxThrust: 46, // m/s^2 up (gravity 13.5, CONFIG.player.gravity: a net +32 against the fall)
  hoverVy: -2.4, // m/s: the settled descent
  emptyGap: 1, // s between 'empty' clicks
  lowAt: 0.2,
  canRadius: 0.9,
  handRadius: 0.35,
  cooldown: 0.4, // s after a cut before it lights again
});

/**
 * Fuel can spots from the supplies: one in every second section (2, 4, 6, 8), never on a 'slow' ledge (the fork's safe line is its own reward).
 * Weighted toward the awkward places: risky perches 6, alcoves 2, open ledges 1. Deterministic per seed.
 */
export function pickCans(spots, seed, opts = {}) {
  const rng = U.rng((seed >>> 0) ^ 0x6a09e667);
  const nSec = opts.sections || spots.reduce((m, s) => Math.max(m, (s.section | 0) + 1), 0);
  const every = opts.every || 2;
  const W = { risk: 6, alcove: 2, ledge: 1 };
  const out = [];
  for (let s = every - 1; s < nSec; s += every) {
    const here = [];
    let total = 0;
    for (let i = 0; i < spots.length; i++) {
      const sp = spots[i];
      if ((sp.section | 0) !== s || sp.tier === 'slow') continue;
      const w = W[sp.tier] || 1;
      here.push({ sp, i, w });
      total += w;
    }
    if (!here.length) continue;
    let r = rng() * total;
    let pick = here[here.length - 1];
    for (const o of here) {
      r -= o.w;
      if (r <= 0) {
        pick = o;
        break;
      }
    }
    out.push({ id: 'can-' + pick.sp.id, spot: pick.i, x: pick.sp.x, y: pick.sp.y + 0.15, z: pick.sp.z, section: s });
  }
  return out;
}

export class Jetpack3D {
  /** @param {{emit:Function}|null} bus */
  constructor(bus) {
    this.bus = bus || null;
    this.enabled = true;
    this.fuel = JET.startFuel;
    this.burning = false;
    this.burnT = 0; // s into this burst
    this.burned = 0; // fuel spent in this burst
    this.thrust = 0; // m/s^2 this step (read by the view / audio)
    this.cool = 0;
    this.cans = []; // {id, x,y,z, section, taken}
    this.version = 0; // bumps when a can is taken / the list changes
    this._first = 0; // time of the last unmatched press
    this._firstHand = '';
    this._t = 0; // own clock
    this._emptyAt = -9;
    this._lowSent = false;
    this._taken = new Set();
  }

  /** A NEW RUN: the starting fuel, every can back. (A respawn does NOT call this: the tank stays as it is.) */
  reset(spots, seed, nSections) {
    this.fuel = JET.startFuel;
    this.burning = false;
    this.burnT = 0;
    this.burned = 0;
    this.thrust = 0;
    this.cool = 0;
    this._first = 0;
    this._firstHand = '';
    this._emptyAt = -9;
    this._lowSent = false;
    this._taken.clear();
    this.cans = pickCans(spots || [], seed >>> 0, { sections: nSections }).map((c) => Object.assign(c, { taken: false }));
    this.version++;
  }

  /** A respawn: nothing comes back. The burn (if any) is over. */
  onRespawn() {
    if (this.burning) this._cut('death');
    this.thrust = 0;
    this.cool = 0;
    this._first = 0;
  }

  /** The state a save keeps (fuel + the cans already taken). */
  saveState() {
    return { fuel: +this.fuel.toFixed(3), taken: Array.from(this._taken) };
  }

  /** Restores a saved run (Continue). Unknown ids are ignored. */
  loadState(s) {
    if (!s || typeof s !== 'object') return;
    if (typeof s.fuel === 'number' && Number.isFinite(s.fuel)) this.fuel = U.clamp(s.fuel, 0, JET.tank);
    this._taken.clear();
    if (Array.isArray(s.taken)) for (const id of s.taken) if (typeof id === 'string') this._taken.add(id);
    for (const c of this.cans) c.taken = this._taken.has(c.id);
    this.version++;
  }

  /** Records a trigger press; true when it completes a chord (the other hand pressed within JET.chord s). */
  chord(hand, now) {
    const t = typeof now === 'number' ? now : this._t;
    const second = this._first > 0 && t - this._first <= JET.chord && this._firstHand !== '' && this._firstHand !== hand;
    if (second) {
      this._first = 0;
      this._firstHand = '';
      return true;
    }
    this._first = t;
    this._firstHand = hand;
    return false;
  }

  /** May it light now? (airborne, falling fast enough, no rope, not cooling down). */
  canLight(p, roped) {
    return this.enabled && !this.burning && this.cool <= 0 && !!p && p.alive !== false && !p.grounded && p.vy <= -JET.minFall && !roped;
  }

  /**
   * An ignition request (the chord or the key). True when it lit (the caller then swallows the presses). With no fuel: one click per second.
   * While burning, a request cancels the burst (and saves the rest of the fuel).
   */
  request(p, roped) {
    if (this.burning) {
      this._cut('cancel');
      return true;
    }
    if (!this.canLight(p, roped)) return false;
    if (this.fuel <= 0.004) {
      if (this._t - this._emptyAt >= JET.emptyGap) {
        this._emptyAt = this._t;
        if (this.bus) this.bus.emit('jetpack:empty', {});
      }
      return false;
    }
    this.burning = true;
    this.burnT = 0;
    this.burned = 0;
    if (this.bus) this.bus.emit('jetpack:ignite', { fuel: this.fuel, vy: p.vy, x: p.x, y: p.y, z: p.z });
    return true;
  }

  /**
   * One fixed physics step. Returns the upward acceleration to ADD to the player's vertical speed this step (the physics step applies gravity
   * itself), 0 when not burning. `roped`: a rope is attached (it catches you: the burn stops).
   */
  step(dt, p, roped) {
    this._t += dt;
    if (this.cool > 0) this.cool -= dt;
    this.thrust = 0;
    if (!this.burning) return 0;
    if (!p || p.alive === false) {
      this._cut('death');
      return 0;
    }
    if (p.grounded) {
      this._cut('ground');
      return 0;
    }
    if (roped) {
      this._cut('rope');
      return 0;
    }
    if (this.fuel <= 0) {
      this._cut('fuel');
      return 0;
    }
    if (this.burnT >= JET.burstMax) {
      this._cut('time');
      return 0;
    }
    const g = CONFIG.player.gravity;
    const want = g + JET.gain * (JET.hoverVy - p.vy);
    const a = want < 0 ? 0 : want > JET.maxThrust ? JET.maxThrust : want;
    const share = JET.hoverShare + (1 - JET.hoverShare) * (a / JET.maxThrust);
    const use = Math.min(this.fuel, JET.burn * share * dt);
    this.fuel -= use;
    this.burned += use;
    this.burnT += dt;
    this.thrust = a;
    return a;
  }

  _cut(reason) {
    if (!this.burning) return;
    this.burning = false;
    this.thrust = 0;
    this.cool = JET.cooldown;
    if (this.bus) this.bus.emit('jetpack:cut', { reason, fuel: this.fuel, burned: this.burned });
    if (this.fuel < JET.lowAt && !this._lowSent && reason !== 'death') {
      this._lowSent = true;
      if (this.bus) this.bus.emit('jetpack:low', { fuel: this.fuel });
    }
  }

  /** Cans: the body centre (or a gripping hand) within reach takes one. Returns the can taken this call (or null). */
  collect(px, py, pz, hands) {
    for (let i = 0; i < this.cans.length; i++) {
      const c = this.cans[i];
      if (c.taken) continue;
      let near = this._within(c, px, py, pz, JET.canRadius);
      if (!near && hands) {
        for (let h = 0; h < hands.length; h++) {
          const hd = hands[h];
          if (hd && hd.grip && this._within(c, hd.x, hd.y, hd.z, JET.handRadius)) near = true;
        }
      }
      if (!near) continue;
      if (this.fuel >= JET.tank - 0.001) {
        // a full tank leaves it: 'jetpack:full' once per approach is the caller's business (no event here: nothing was taken)
        continue;
      }
      const gained = Math.min(JET.canFuel, JET.tank - this.fuel);
      c.taken = true;
      this._taken.add(c.id);
      this.fuel += gained;
      this._lowSent = this.fuel < JET.lowAt;
      this.version++;
      if (this.bus) this.bus.emit('jetpack:can', { id: c.id, x: c.x, y: c.y, z: c.z, fuel: this.fuel, gained });
      return c;
    }
    return null;
  }

  _within(c, x, y, z, r) {
    const dx = c.x - x;
    const dy = c.y - y;
    const dz = c.z - z;
    return dx * dx + dy * dy + dz * dz <= r * r;
  }
}
