/* ABYSSAL TETHER 3D — holster3d.js
 * The rope guns live in a holster on each hip. With both holstered the hands are bare (fingers free, the grip still climbs) and the
 * diver walks at the usual speed; with a gun out the walk is 20 % slower (HOLSTER.walkMul, applied to the ground run only: the air,
 * the reel and the swing are untouched). Pure and deterministic: no three.js, no DOM, no clock other than the dt it is stepped with.
 *
 *   Holster3D(bus)
 *     .step(dt, intent, ctx)   once per frame BEFORE tethers.handleInput. ctx = { live, grounded, busy: [left, right] }
 *                              (busy = that hand has a line out / in flight / a shot looking for a hold). Eases `k`, draws a gun on a
 *                              press (the press is held back until the gun is out, then fired: nothing is lost), stows after
 *                              HOLSTER.autoAfter s of standing about with the hand idle. Mutates `intent.hands[h].pressed` only.
 *     .toggle()                H / right stick click: stow both when any gun is out, else draw both
 *     .reset()                 a run, a respawn: both holstered
 *     .enabled                 false (`?holster=off`): both always out, walkMul 1 (the bots and the old behaviour)
 *   read-only:  out[h] (the hand wants its gun out), k[h] (0 holstered .. 1 in hand: the view lerps with it), walkMul
 *   bus events: 'holster:draw' {hand}, 'holster:stow' {hand}
 */

export const HOLSTER = Object.freeze({
  drawTime: 0.14, // s from the hip to the hand (a press that draws fires when it is out)
  stowTime: 0.18, // s from the hand to the hip
  autoAfter: 3.5, // s of standing about with a gun out and nothing on the line before it goes back
  walkMul: 0.8, // the ground walk with a gun out
});

const HANDS = ['left', 'right'];

export class Holster3D {
  constructor(bus) {
    this.bus = bus || null;
    this.enabled = true;
    this.out = [false, false];
    this.k = [0, 0];
    this._pend = [false, false]; // a press waiting for its gun
    this._idle = [0, 0];
    this.walkMul = 1;
    this.reset();
  }

  _emit(type, payload) {
    if (this.bus) this.bus.emit(type, payload);
  }

  reset() {
    this.out[0] = this.out[1] = !this.enabled;
    this.k[0] = this.k[1] = this.enabled ? 0 : 1;
    this._pend[0] = this._pend[1] = false;
    this._idle[0] = this._idle[1] = 0;
    this.walkMul = 1;
  }

  setEnabled(on) {
    this.enabled = !!on;
    this.reset();
  }

  /** Both away when any gun is out, else both out. */
  toggle() {
    if (!this.enabled) return false;
    const any = this.out[0] || this.out[1];
    for (let i = 0; i < 2; i++) this._set(i, !any);
    return !any;
  }

  _set(i, want) {
    if (this.out[i] === want) return;
    this.out[i] = want;
    this._idle[i] = 0;
    if (!want) this._pend[i] = false;
    this._emit(want ? 'holster:draw' : 'holster:stow', { hand: HANDS[i] });
  }

  /**
   * @param {number} dt seconds
   * @param {object} intent the frame's intent (hands[h].pressed / held are read; pressed is suppressed or injected)
   * @param {{live:boolean, grounded:boolean, busy:boolean[]}} ctx
   */
  step(dt, intent, ctx) {
    if (!this.enabled) {
      this.walkMul = 1;
      return;
    }
    const d = dt > 0 ? (dt < 0.1 ? dt : 0.1) : 0;
    for (let i = 0; i < 2; i++) {
      const hi = intent && intent.hands ? intent.hands[HANDS[i]] : null;
      const live = !!(ctx && ctx.live);
      // ease the gun between the hip and the hand
      const want = this.out[i];
      if (want && this.k[i] < 1) this.k[i] = Math.min(1, this.k[i] + d / HOLSTER.drawTime);
      else if (!want && this.k[i] > 0) this.k[i] = Math.max(0, this.k[i] - d / HOLSTER.stowTime);
      if (!hi || !live) continue;
      const busy = !!(ctx && ctx.busy && ctx.busy[i]);
      if (!this.out[i]) {
        // a press on a holstered hand draws it; the shot waits for the gun
        if (hi.pressed) {
          this._set(i, true);
          this._pend[i] = true;
          hi.pressed = false;
        }
      } else if (this.k[i] < 1) {
        if (hi.pressed) {
          this._pend[i] = true;
          hi.pressed = false;
        }
        if (!hi.held) this._pend[i] = false;
      } else if (this._pend[i]) {
        this._pend[i] = false;
        if (hi.held) hi.pressed = true; // still held: the shot goes now
      }
      // standing about with nothing on the line: it goes back
      if (this.out[i]) {
        if (hi.held || busy || !ctx.grounded) this._idle[i] = 0;
        else {
          this._idle[i] += d;
          if (this._idle[i] >= HOLSTER.autoAfter) this._set(i, false);
        }
      }
    }
    this.walkMul = this.out[0] || this.out[1] || this.k[0] > 0 || this.k[1] > 0 ? HOLSTER.walkMul : 1;
  }
}
