/* ABYSSAL TETHER 3D — objectiveHint.js
 * "After 20 seconds, if the player has not found the trigger that opens the grating, highlight the trigger."
 *
 * Presentation-side logic (stepped by game.js with the frame dt, never by the physics step, so the route bots and the verify
 * harness are untouched): while the player is playing in a section whose seal is still closed, a clock runs. It restarts
 *   - on any progress of that section's objective (a fixture done, a haul / winch notch, a relight begun) and
 *   - while the player is within FOUND_R of a pending trigger (they have found it: they are working it out),
 * and the section changing, a death or a pause stop it. When it reaches HINT_AFTER seconds the pending triggers are
 * marked: `targets` holds up to MAX_TARGETS of them (x, y, z, kind) for the view to glow, until progress is made.
 * Pure: no three.js, no DOM, no allocation per frame after the first call.
 */

export const HINT_AFTER = 20; // s in a section with its seal closed, away from the triggers, without progress
export const FOUND_R = 5; // m: this close to a pending trigger counts as found
export const MAX_TARGETS = 6;
const KIND_NAMES = ['hook', 'bell', 'haul', 'lamp', 'winch', 'breach', 'survive'];

export class ObjectiveHint {
  constructor() {
    this.targets = [];
    for (let i = 0; i < MAX_TARGETS; i++) this.targets.push({ x: 0, y: 0, z: 0, kind: '', on: false });
    this.on = false;
    this.count = 0;
    this.kind = ''; // the verb of the first target (the toast words)
    this.reset();
  }

  /** A new run / a restart: nothing running, nothing shown. */
  reset() {
    this._t = 0;
    this._sec = -1;
    this._sig = -1;
    this.on = false;
    this.count = 0;
    this.kind = '';
    this.announced = false; // the game shows its toast once per activation
    for (const t of this.targets) t.on = false;
  }

  _hide() {
    this.on = false;
    this.count = 0;
    this.announced = false;
    for (const t of this.targets) t.on = false;
  }

  /**
   * @param {number} dt seconds (frame)
   * @param {object} O  Objectives3D (objectives, fixtures, done, fxDone, fxN, count, sealOpen, fixtureDone)
   * @param {{x:number,y:number,z:number}} p the player's body
   * @param {number} section the section the player is in
   * @param {boolean} playing alive, in a run, not paused
   * @returns {ObjectiveHint} this (read `on`, `targets`, `count`, `kind`, `announced`)
   */
  update(dt, O, p, section, playing) {
    if (!O || !p || !O.objectives) {
      this._hide();
      return this;
    }
    if (section !== this._sec) {
      this._sec = section;
      this._t = 0;
      this._sig = -1;
      this._hide();
    }
    let obj = null;
    for (let i = 0; i < O.objectives.length; i++) {
      const o = O.objectives[i];
      if (o.section === section && !O.done[o.index] && !O.sealOpen[o.seal]) {
        obj = o;
        break;
      }
    }
    if (!obj) {
      this._t = 0;
      this._sig = -1;
      this._hide();
      return this;
    }
    // progress signature: fixtures done + their notches; any change = the player is at it
    let sig = O.count[obj.index];
    for (let k = 0; k < obj.fx.length; k++) sig += O.fxN[obj.fx[k]] * 0.001 + (O.fxDone[obj.fx[k]] ? 1 : 0);
    if (this._sig >= 0 && sig !== this._sig) {
      this._t = 0;
      this._hide();
    }
    this._sig = sig;
    if (!playing) return this; // a death or a pause neither runs the clock nor hides a shown hint
    // the pending triggers (and whether the player stands at one)
    let n = 0;
    let near = false;
    for (let k = 0; k < obj.fx.length && n < MAX_TARGETS; k++) {
      const fi = obj.fx[k];
      if (O.fixtureDone(fi)) continue;
      const f = O.fixtures[fi];
      if (f.hidden) continue;
      const dx = f.x - p.x;
      const dy = f.y - p.y;
      const dz = f.z - p.z;
      if (dx * dx + dy * dy + dz * dz < FOUND_R * FOUND_R) near = true;
      const t = this.targets[n++];
      t.x = f.x;
      t.y = f.y;
      t.z = f.z;
      t.kind = KIND_NAMES[f.k] || '';
    }
    if (near) {
      this._t = 0;
      this._hide();
      return this;
    }
    if (this.on) {
      // keep the marks on the pending ones (a fixture finished since: fewer marks)
      this.count = n;
      for (let i = 0; i < MAX_TARGETS; i++) this.targets[i].on = i < n;
      return this;
    }
    this._t += dt;
    if (this._t >= HINT_AFTER && n > 0) {
      this.on = true;
      this.count = n;
      this.kind = this.targets[0].kind;
      for (let i = 0; i < MAX_TARGETS; i++) this.targets[i].on = i < n;
    }
    return this;
  }
}
