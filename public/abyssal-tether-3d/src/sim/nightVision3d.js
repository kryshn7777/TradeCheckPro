/* ABYSSAL TETHER 3D — nightVision3d.js
 * The night vision goggles (a built-in part of the diver's kit) and how dark the shaft is made on purpose the deeper it goes.
 * Pure and deterministic: no three.js, no DOM, no Math.random, no clock other than the dt it is stepped with, no allocation
 * after construction (the same module runs in Node for the tests).
 *
 *   NightVision3D(bus)
 *     .toggle()              flip the goggles (refused while the cell is flat); returns the new `on`
 *     .update(dt, live)      once per frame; `live` = playing, alive, not paused. Not live: nothing drains, goggles drop
 *     .reset()               a new run: off, full cell
 *     .snapshot() / .restore()   a checkpoint keeps the charge; a respawn puts the goggles down
 *   read-only:  on, charge (0..1), k (0..1 power-up ramp the view fades with), level (k with the low-charge stutter),
 *               flat (the cell ran out and the goggles stay off until `minOn` is back), low
 *   bus events: 'nv:on', 'nv:off' {reason}, 'nv:refuse' {reason}, 'nv:low' {charge}, 'nv:flat', 'nv:ready'
 *
 * The cell drains while the goggles are on (about two minutes of continuous use) and trickles back while they are off
 * (about three minutes for a full cell): they are for scouting a dark stretch, not for wearing all the way down.
 *
 * depthDarkness(section) / lanternFade(section): the descent is dark on purpose. The world gets darker with each section
 * (the renderer folds depthDarkness into the difficulty's darkness) and the lantern burns weaker with depth, so the
 * lower sections cannot be read with the naked eye and the goggles are the way through.
 */

export const NV = Object.freeze({
  drain: 1 / 120, // cell per second while on
  recharge: 1 / 180, // cell per second while off
  minOn: 0.12, // a flat cell must climb back to this before the goggles will start
  lowAt: 0.2, // below this the picture stutters and the view warns
  rampIn: 0.42, // s: the tubes warming up
  rampOut: 0.22,
});

/** Extra darkness (0..1) by section index, folded into the difficulty's darkness: 1 - (1 - base) * (1 - depth). */
export const DEPTH_DARK = Object.freeze([0, 0.03, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6]);
/** The lantern's reach / strength by section index: it fades the deeper the diver goes. */
export const DEPTH_LANTERN = Object.freeze([1, 1, 0.92, 0.84, 0.74, 0.64, 0.55, 0.48]);

function at(table, section) {
  const n = table.length;
  const i = section | 0;
  return table[i < 0 ? 0 : i >= n ? n - 1 : i];
}

export function depthDarkness(section) {
  return at(DEPTH_DARK, section);
}

export function lanternFade(section) {
  return at(DEPTH_LANTERN, section);
}

/** Linear interpolation of a table at a fractional section (the renderer blends sections by height). */
function lerpAt(table, sectionF) {
  const n = table.length;
  const f = sectionF > 0 ? (sectionF < n - 1 ? sectionF : n - 1) : 0;
  const i = Math.floor(f);
  const j = i + 1 < n ? i + 1 : n - 1;
  return table[i] + (table[j] - table[i]) * (f - i);
}

export function depthDarknessAt(sectionF) {
  return lerpAt(DEPTH_DARK, sectionF);
}

export function lanternFadeAt(sectionF) {
  return lerpAt(DEPTH_LANTERN, sectionF);
}

/** The difficulty's darkness and the depth's, folded: neither can lighten the other. */
export function foldDarkness(base, depth) {
  const b = base > 0 ? (base < 1 ? base : 1) : 0;
  const d = depth > 0 ? (depth < 1 ? depth : 1) : 0;
  return 1 - (1 - b) * (1 - d);
}

export class NightVision3D {
  constructor(bus) {
    this.bus = bus || null;
    this._snap = 1;
    this.reset();
  }

  _emit(type, payload) {
    if (this.bus) this.bus.emit(type, payload);
  }

  reset() {
    this.on = false;
    this.charge = 1;
    this.k = 0;
    this.level = 0;
    this.flat = false;
    this.low = false;
    this._t = 0;
    this._snap = 1;
  }

  snapshot() {
    this._snap = this.charge;
  }

  restore() {
    this.charge = this._snap;
    this.flat = this.charge < NV.minOn;
    this.low = this.charge <= NV.lowAt;
    if (this.on) {
      this.on = false;
      this._emit('nv:off', { reason: 'respawn' });
    }
  }

  /** @returns {boolean} the goggles' new state */
  toggle() {
    if (this.on) {
      this.on = false;
      this._emit('nv:off', { reason: 'toggle' });
      return false;
    }
    if (this.flat || this.charge < NV.minOn) {
      this._emit('nv:refuse', { reason: 'flat' });
      return false;
    }
    this.on = true;
    this._emit('nv:on', {});
    return true;
  }

  update(dt, live) {
    const d = dt > 0 ? (dt < 0.1 ? dt : 0.1) : 0;
    if (!live) {
      if (this.on) {
        this.on = false;
        this._emit('nv:off', { reason: 'not-live' });
      }
    }
    const before = this.charge;
    if (this.on) {
      this.charge = before - NV.drain * d;
      if (this.charge <= 0) {
        this.charge = 0;
        this.on = false;
        this.flat = true;
        this._emit('nv:off', { reason: 'flat' });
        this._emit('nv:flat', {});
      } else if (before > NV.lowAt && this.charge <= NV.lowAt) {
        this._emit('nv:low', { charge: this.charge });
      }
    } else if (live && this.charge < 1) {
      this.charge = Math.min(1, before + NV.recharge * d);
      if (this.flat && this.charge >= NV.minOn) {
        this.flat = false;
        this._emit('nv:ready', {});
      }
    }
    this.low = this.charge <= NV.lowAt;
    // the tubes warm up / spool down
    const want = this.on ? 1 : 0;
    const rate = want ? 1 / NV.rampIn : 1 / NV.rampOut;
    if (this.k < want) this.k = Math.min(want, this.k + rate * d);
    else if (this.k > want) this.k = Math.max(want, this.k - rate * d);
    // a nearly flat cell makes the picture stutter (bounded, never a strobe: it only ever dips to ~55 %)
    this._t += d;
    let st = 1;
    if (this.on && this.low) {
      const w = 1 - this.charge / NV.lowAt; // 0 at the threshold .. 1 flat
      const s = Math.sin(this._t * 17.3) * Math.sin(this._t * 5.1 + 0.6);
      st = 1 - 0.45 * w * (s > 0.35 ? (s - 0.35) / 0.65 : 0);
    }
    this.level = this.k * st;
  }
}
