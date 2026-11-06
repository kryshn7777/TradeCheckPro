/* THE LANTERN — sim/lanternHood.js
 * THE HOOD (docs/abyssal-tether-3d/plans/LANTERN_HOOD.md): cover your lantern. Light keeps you alive, but light draws the Mason
 * (sim/masonSight.js sees only the lantern-bearer). The hood is the counterplay that is in your hands: cover the flame and it stops
 * SEEING you (its notice count breaks, a chase loses you after its memory), but it still HEARS you, the swarm stops fleeing, and you
 * cannot read the holds in the dark.
 *
 *   const h = new LanternHood(bus)       game.hood (the contract: `on`, `k`)
 *   h.mode = 'hold' | 'toggle'           settings.lanternHood
 *   h.update(dt, want, live, toggle)     per run frame: want = the hood input held (VR right grip at the lantern, desktop V, touch
 *                                        HOOD), toggle = a toggle edge (VR left-stick tap), live = the run is live (else: off at once)
 *   h.k        0..1 how covered the flame is (slews in over 0.25 s, out over 0.2 s)
 *   h.on       k > 0.6: the light no longer shows (game.js passes lit = false to the Mason's sight)
 *   h.lightMul / h.rangeMul / h.drainMul   the lantern's intensity x(1 - 0.93 k), range x(0.25 + 0.75 (1 - k)), drain x(1 - 0.7 k)
 *
 * Rules: in 'hold' mode the hood is on while the input is held (a toggle edge latches it; pressing the hold input takes the latch
 * back); in 'toggle' mode each press of the hold input or a toggle edge flips it. After an uncover the hood cannot come back for 0.6 s
 * (the re-hood lock-out: no strobing the light to cheat the notice count, which needs 0.5 s of CONTINUOUS sight). Bus: 'lantern:hood'
 * {on} on every change of `on` (the payload objects are reused). Deterministic, no allocation per frame, Node-safe (no three.js).
 */

export const HOOD = Object.freeze({
  coverTime: 0.25, // s from uncovered to fully covered
  uncoverTime: 0.2, // s from covered to uncovered
  onK: 0.6, // k above which the light no longer shows (on)
  lockout: 0.6, // s after an uncover before it can be covered again
  lightCut: 0.93, // intensity x (1 - lightCut k): a slit of flame
  rangeFloor: 0.25, // range x (rangeFloor + (1 - rangeFloor)(1 - k))
  drainHooded: 0.3, // the charge drains at x0.3 while fully covered (a starved flame burns slowly)
});

export const HOOD_MODES = Object.freeze(['hold', 'toggle']);

/** The hood mode from the settings (anything but 'toggle' is 'hold'). */
export function hoodMode(settings) {
  return settings && settings.lanternHood === 'toggle' ? 'toggle' : 'hold';
}

export class LanternHood {
  /** @param {EventBus} [bus] emits 'lantern:hood' {on} */
  constructor(bus) {
    this.bus = bus || null;
    this.mode = 'hold';
    this.k = 0;
    this.on = false;
    this.latched = false; // a toggle latch (toggle edges; every press in 'toggle' mode)
    this.lock = 0; // s of re-hood lock-out left
    this.want = false; // the last desired state (after the lock-out)
    this.forced = 0; // debug: 1 = covered, -1 = uncovered, 0 = the input decides
    this.stats = { covers: 0, uncovers: 0, time: 0, refused: 0 };
    this._prevHeld = false;
    this._prevDesire = false;
    this._evOn = { on: true };
    this._evOff = { on: false };
  }

  /** The lantern's intensity factor. */
  get lightMul() {
    return 1 - HOOD.lightCut * this.k;
  }

  /** The lantern's range factor. */
  get rangeMul() {
    return HOOD.rangeFloor + (1 - HOOD.rangeFloor) * (1 - this.k);
  }

  /** The charge drain factor (sim/inventory3d.js update drainMul). */
  get drainMul() {
    return 1 - (1 - HOOD.drainHooded) * this.k;
  }

  /** Back to uncovered at once (a new run, a respawn, the menu). Emits the uncover when it was on. */
  reset() {
    const was = this.on;
    this.k = 0;
    this.on = false;
    this.latched = false;
    this.lock = 0;
    this.want = false;
    this._prevHeld = false;
    this._prevDesire = false;
    if (was) this._emit(false);
  }

  /** Debug (AT3D.debug.hood): true = covered, false = uncovered, null / undefined = the input decides again. */
  force(v) {
    this.forced = v === true ? 1 : v === false ? -1 : 0;
    if (this.forced !== 0) this.latched = false;
  }

  /**
   * One step.
   * @param {number} dt seconds
   * @param {boolean} held the hood input is held this frame
   * @param {boolean} live the run is live (playing and alive); false uncovers at once
   * @param {boolean} [toggle] a toggle edge this frame
   * @returns {LanternHood} this
   */
  update(dt, held, live, toggle) {
    const d = dt > 0 && dt < 1 ? dt : 0;
    if (!live) {
      this._prevHeld = !!held;
      if (this.k > 0 || this.on || this.latched || this.lock > 0) this.reset();
      return this;
    }
    if (this.lock > 0) this.lock = this.lock > d ? this.lock - d : 0;
    const h = !!held;
    const rise = h && !this._prevHeld;
    this._prevHeld = h;
    if (this.mode === 'toggle') {
      if (rise) this._flip();
      if (toggle) this._flip();
    } else {
      if (rise) this.latched = false; // the hold input takes the latch back
      if (toggle) this._flip();
    }
    let desire = this.mode === 'toggle' ? this.latched : h || this.latched;
    if (this.forced !== 0) desire = this.forced > 0;
    else if (desire && this.lock > 0) {
      if (!this._prevDesire) this.stats.refused++;
      desire = false;
    }
    if (this._prevDesire && !desire && this.on) this.lock = HOOD.lockout; // uncovering starts the lock-out
    this._prevDesire = desire;
    this.want = desire;
    // the slew: in over coverTime, out over uncoverTime (linear: the flame is pinched, not eased)
    if (desire) this.k = Math.min(1, this.k + d / HOOD.coverTime);
    else this.k = Math.max(0, this.k - d / HOOD.uncoverTime);
    const on = this.k > HOOD.onK;
    if (on !== this.on) {
      this.on = on;
      if (on) this.stats.covers++;
      else {
        this.stats.uncovers++;
        if (this.lock <= 0 && this.forced === 0) this.lock = HOOD.lockout;
      }
      this._emit(on);
    }
    if (this.on) this.stats.time += d;
    return this;
  }

  _flip() {
    if (this.latched) this.latched = false;
    else if (this.lock > 0) this.stats.refused++;
    else this.latched = true;
  }

  _emit(on) {
    const b = this.bus;
    if (b && typeof b.emit === 'function') b.emit('lantern:hood', on ? this._evOn : this._evOff);
  }
}
