/* THE LANTERN — sim/playerHits.js
 * How a creature hit lands on the player (plans/MASON_STRIKES.md): a Mason strike takes 30 % of the health and knocks you down (on
 * a floor) or staggers you (gripping, hanging, in the air: never a forced deadly fall); a hunter-skitterling bite takes 10 % and
 * makes you stumble. Owns the Knockdown (game.knock), the immunity window after a hit and the edge-safe knockback. Emits
 * `player:hit` after the health's own `health:damage`. Pure (no DOM, no three.js), allocation-free per frame, Node-safe.
 *
 *   mason(src, player, ctx)            ctx: { health, kill(cause), level, gripping (bool), god (bool) }  -> 'hit' | 'dead' | 'immune' | ''
 *   skitter(amount, src, player, ctx)  the same for a bite (amount from the skitterlings: STRIKE_DAMAGE.skitter)
 *   update(dt, player, level)          the knockdown, the immunity clock, the knockback slices, the abort when the body leaves the floor
 *   immune                             true while a hit cannot land (the creature reads it: Creature3D.immune)
 *   moveMul / reelMul / jumpOk         the control lock; applyIntent(si) applies it to the game's step intent
 *   reset()                            standing, not immune (respawn, restart, menu, death); also on those bus events
 */

import { Knockdown, KNOCK_TOTAL } from './knockdown.js';
import { STRIKE_DAMAGE, STRIKE_COMMON } from './strikeZone.js';

export const HITS = Object.freeze({
  knockback: 0.8, // m along the blow on a knockdown (never more than knockbackMax, never off an edge)
  knockbackMax: 1.5,
  knockbackTime: 0.25, // s over which it is applied (the fall)
  slice: 0.1, // m per probe step
  floorRay: 0.9, // m: a ray down from the body centre must hit a floor within this (the body radius + a step)
  airGrace: 0.2, // s off the floor before a knockdown aborts into the fast get-up
  immunity: STRIKE_COMMON.immunity, // s after standing up again
});

export class PlayerHits {
  /** @param {{emit:function, on?:function}} [bus] */
  constructor(bus) {
    this.bus = bus || null;
    this.knock = new Knockdown(bus);
    this.immuneT = 0;
    this.stats = { mason: 0, skitter: 0, knockdowns: 0, staggers: 0, ignored: 0, deaths: 0 };
    this._kbLeft = 0; // m of knockback still to apply
    this._kbRate = 0; // m/s
    this._kbx = 0;
    this._kbz = 0;
    this._air = 0;
    this._ray = { t: 0, solid: null, x: 0, y: 0, z: 0 };
    if (bus && typeof bus.on === 'function') {
      const r = () => this.reset();
      for (const e of ['game:start', 'game:restart', 'game:menu', 'game:respawn', 'player:death']) bus.on(e, r);
    }
  }

  get immune() {
    return this.immuneT > 0;
  }
  get moveMul() {
    return this.knock.moveMul;
  }
  /** The reel is held only while down / rising (a stagger keeps it: you hold on). */
  get reelMul() {
    return this.knock.active ? this.knock.moveMul : 1;
  }
  /** No jump while the controls are below half (a press then is dropped, not buffered). */
  get jumpOk() {
    return this.knock.moveMul >= 0.5;
  }

  /**
   * Scales the game's step intent ({move:{x,z}, reel}) by the control lock. Returns true when a jump must be dropped (not buffered).
   * The intent is rebuilt from the raw input every frame, so nothing latches across the knockdown.
   */
  applyIntent(si) {
    const m = this.knock.moveMul;
    if (!(m < 1) || !si) return false;
    if (si.move) {
      si.move.x *= m;
      si.move.z *= m;
    }
    if (typeof si.reel === 'number') si.reel *= this.reelMul;
    if (!this.jumpOk) {
      si.jumpPressed = false;
      return true;
    }
    return false;
  }

  reset() {
    this.knock.cancel();
    this.immuneT = 0;
    this._kbLeft = 0;
    this._air = 0;
  }

  /**
   * Floor under the body: grounded, not climbing / gripping, and a short ray down from the body centre at (x, z) hits a solid
   * (ropes may stay attached: a slack line does not matter).
   */
  floorOk(player, level, gripping) {
    if (!player || !player.grounded || player.climbing || gripping) return false;
    return this._floorAt(level, player.x, player.y, player.z);
  }

  _floorAt(level, x, y, z) {
    if (!level || typeof level.raycast !== 'function') return true; // no level (a unit test): trust grounded
    return !!level.raycast(x, y, z, 0, -1, 0, HITS.floorRay, this._ray);
  }

  /** A Mason strike connected (Creature3D.caughtPlayer). */
  mason(src, player, ctx) {
    return this._hit('mason', STRIKE_DAMAGE.mason, src, player, ctx, 1, 'creature', 'creature');
  }

  /** A hunter skitterling bit (`amount` hp: STRIKE_DAMAGE.skitter per bite from SkitterGroup). */
  skitter(amount, src, player, ctx) {
    return this._hit('skitter', amount, src, player, ctx, 0.3, 'skitter', 'creature');
  }

  _hit(source, amount, src, player, ctx, strength, cause, deathCause) {
    const h = ctx && ctx.health;
    if (!player || player.alive === false || !h || !(amount > 0)) return '';
    if (h.god || (ctx && ctx.god)) return '';
    if (this.immuneT > 0) {
      this.stats.ignored++;
      return 'immune';
    }
    this.stats[source]++;
    const lethal = h.damage(amount, cause, 0);
    let dx = src ? player.x - src.x : 0;
    let dz = src ? player.z - src.z : 0;
    const dl = Math.hypot(dx, dz);
    if (dl > 1e-4) {
      dx /= dl;
      dz /= dl;
    } else {
      dx = 0;
      dz = 0;
    }
    let down = false;
    if (!lethal) {
      const floor = strength >= 1 && this.floorOk(player, ctx.level, !!ctx.gripping);
      down = this.knock.start(strength, floor);
      if (down) {
        this.stats.knockdowns++;
        this._kbx = dx;
        this._kbz = dz;
        this._kbLeft = Math.min(HITS.knockbackMax, HITS.knockback);
        this._kbRate = this._kbLeft / HITS.knockbackTime;
        this.immuneT = KNOCK_TOTAL + HITS.immunity;
      } else {
        this.stats.staggers++;
        if (source === 'mason') this.immuneT = this.knock.stagger + HITS.immunity;
      }
    }
    if (this.bus) {
      this.bus.emit('player:hit', { source, amount, hp: h.hp, x: src ? src.x : player.x, y: src ? src.y : player.y, z: src ? src.z : player.z, dx, dz, down });
    }
    if (lethal) {
      this.stats.deaths++;
      if (ctx && typeof ctx.kill === 'function') ctx.kill(deathCause);
      return 'dead';
    }
    return 'hit';
  }

  /** Once per frame while playing (game.js _updateCreature; the pacing sim). */
  update(dt, player, level) {
    if (this.immuneT > 0) this.immuneT = Math.max(0, this.immuneT - dt);
    const K = this.knock;
    if (player && K.active) {
      if (player.alive === false) {
        this.reset();
        return;
      }
      // the body left the floor (it grabbed a wall, the floor gave way, a rope lifted it): the fast get-up, never stuck down
      if (!player.grounded || player.climbing) this._air += dt;
      else this._air = 0;
      if (this._air > HITS.airGrace || player.climbing) {
        K.abort();
        this._kbLeft = 0;
      }
      if (this._kbLeft > 0) this._knockback(dt, player, level);
    }
    K.update(dt);
  }

  /** The knockback in slices: each one only on a clear path with floor under the new point; it stops at an edge, never past it. */
  _knockback(dt, player, level) {
    let step = Math.min(this._kbLeft, this._kbRate * dt);
    this._kbLeft -= step;
    while (step > 1e-6) {
      const s = Math.min(step, HITS.slice);
      step -= s;
      const nx = player.x + this._kbx * s;
      const nz = player.z + this._kbz * s;
      if (level) {
        const r = (player.radius > 0 ? player.radius : 0.38) + 0.08; // + a margin
        // the body's leading edge must not enter a solid (a wall, a pillar)
        if (typeof level.segmentBlocked === 'function' && level.segmentBlocked(player.x, player.y, player.z, nx + this._kbx * r, player.y, nz + this._kbz * r, 0)) {
          this._kbLeft = 0;
          return;
        }
        // the floor must be under the leading edge of the body too (radius ahead), so the body never hangs over the lip
        if (!this._floorAt(level, nx, player.y, nz) || !this._floorAt(level, nx + this._kbx * r, player.y, nz + this._kbz * r)) {
          this._kbLeft = 0;
          return;
        }
      }
      player.x = nx;
      player.z = nz;
    }
  }
}
