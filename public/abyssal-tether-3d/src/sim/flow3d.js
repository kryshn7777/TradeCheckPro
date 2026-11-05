/* THE LANTERN — flow3d.js
 * SWING CHAINS: each airborne transfer from line to line is a LINK. A new line bitten while the other is still attached (or
 * this hand re-hooked without letting go, or a line was let go less than FLOW.window seconds ago), at more than
 * FLOW.minSpeed, without the body touching the ground or a hold in between, adds one to the chain.
 *   - every link: bus 'flow:link' {n, hand, x, y, z} (the game: a rising haptic pop, a little lantern flare; `flare` here)
 *   - from link FLOW.rewardFrom: + FLOW.chargePerLink lantern charge per link, at most FLOW.chargeCap per chain, through
 *     `lantern.addCharge(k)` (the bag, sim/inventory3d.js; null = no reward, e.g. a difficulty without the bag)
 *   - the chain ends on a landing / standing on the ground, a grab on a hold (climb:grab), a death, a line-less fall past the
 *     window, or an attach that does not link: bus 'flow:end' {n, reason, scored, descent} when it had at least one link.
 * Anti-farming: a link's anchor must differ (by id, and by more than FLOW.sameDist metres) from the last two anchors of the
 * chain (a ping-pong between two hooks links once); the charge reward and `scored` need a net descent of FLOW.minDescent m
 * since the chain began.
 * Pure: no three.js, no DOM, no Math.random, no clock but the dt it is stepped with, no allocation per event beyond the
 * payloads it emits. Listens on the bus it is given: grapple:attach {hand, anchor, speed, previous}, grapple:release {hand,
 * reason}, player:land, climb:grab, player:death. `player` (optional) is read for y / grounded / climbing.
 */

export const FLOW = Object.freeze({
  window: 1.2, // s after a release in which a new line still links
  minSpeed: 5, // m/s at the bite
  sameDist: 1.5, // m: an anchor this close to one of the last two counts as the same one
  minDescent: 1, // m of net descent the chain needs to score / pay
  rewardFrom: 4, // links from which each link pays lantern charge
  chargePerLink: 0.03,
  chargeCap: 0.15, // per chain
  flare: 0.35, // lantern flare per link (decays at flareDecay /s)
  flareDecay: 2.5,
});

const HANDS = ['left', 'right'];

export class Flow3D {
  /**
   * @param {EventBus|null} bus
   * @param {object|null} player read: y, grounded, climbing
   */
  constructor(bus, player) {
    this.bus = bus || null;
    this.player = player || null;
    this.lantern = null; // { addCharge(k) } or null
    this.attached = { left: false, right: false };
    // the last two anchors of the chain (ids + positions; plain fields, no arrays per event)
    this._a1 = { on: false, id: null, x: 0, y: 0, z: 0 };
    this._a2 = { on: false, id: null, x: 0, y: 0, z: 0 };
    this.links = 0; // lifetime links (this run)
    this.chains = 0; // chains of 4+ that scored (this run)
    this.best = 0;
    this._offs = [];
    this.reset();
    if (this.bus) {
      const on = (t, fn) => this._offs.push(this.bus.on(t, fn));
      on('grapple:attach', (e) => this.onAttach(e));
      on('grapple:release', (e) => this.onRelease(e));
      on('player:land', () => this.touch('land'));
      on('climb:grab', () => this.touch('grab'));
      on('player:death', () => this.end('death'));
    }
  }

  /** A new run: no chain, no lines, nothing counted. */
  reset() {
    this.n = 0;
    this.active = false; // a chain has begun (at least its first anchor)
    this.clock = 0;
    this.releaseT = -1e9;
    this.startY = 0;
    this.charge = 0; // charge paid by this chain
    this.flare = 0;
    this.attached.left = false;
    this.attached.right = false;
    this._a1.on = false;
    this._a2.on = false;
    this.links = 0;
    this.chains = 0;
    this.best = 0;
  }

  dispose() {
    for (const off of this._offs) off();
    this._offs.length = 0;
  }

  _emit(type, payload) {
    if (this.bus) this.bus.emit(type, payload);
  }

  _airborne() {
    const p = this.player;
    return !p || (!p.grounded && !p.climbing);
  }

  _same(slot, an) {
    if (!slot.on) return false;
    if (an.id != null && slot.id === an.id) return true;
    const dx = (an.x || 0) - slot.x;
    const dy = (an.y || 0) - slot.y;
    const dz = (an.z || 0) - slot.z;
    return dx * dx + dy * dy + dz * dz < FLOW.sameDist * FLOW.sameDist;
  }

  _push(an) {
    const a = this._a2;
    this._a2 = this._a1;
    this._a1 = a;
    a.on = true;
    a.id = an.id != null ? an.id : null;
    a.x = an.x || 0;
    a.y = an.y || 0;
    a.z = an.z || 0;
  }

  _begin(an) {
    this.n = 0;
    this.charge = 0;
    this.active = true;
    this._a1.on = false;
    this._a2.on = false;
    this._push(an);
    this.startY = this.player ? this.player.y : an.y || 0;
  }

  onAttach(e) {
    const hand = e && e.hand === 'left' ? 'left' : 'right';
    const other = hand === 'left' ? 'right' : 'left';
    const an = e && e.anchor ? e.anchor : e || {};
    const otherOn = this.attached[other];
    this.attached[hand] = true;
    const linked = this.active && (otherOn || !!(e && e.previous) || this.clock - this.releaseT < FLOW.window) && e && e.speed > FLOW.minSpeed && this._airborne();
    if (!linked) {
      // not a transfer: whatever chain there was ends here and a new one begins on this anchor (from the ground too: the first
      // swing off a ledge leads into the first link)
      if (this.active) this.end('slow');
      this._begin(an);
      return;
    }
    if (this._same(this._a1, an) || this._same(this._a2, an)) return; // ping-pong / the same hook again: not a link, no break
    this._push(an);
    this.n++;
    this.links++;
    if (this.n > this.best) this.best = this.n;
    this.flare = Math.min(1, this.flare + FLOW.flare);
    if (this.n >= FLOW.rewardFrom && this.lantern && this._descent() >= FLOW.minDescent && this.charge < FLOW.chargeCap - 1e-9) {
      const k = Math.min(FLOW.chargePerLink, FLOW.chargeCap - this.charge);
      this.charge += k;
      if (typeof this.lantern.addCharge === 'function') this.lantern.addCharge(k);
    }
    this._emit('flow:link', { n: this.n, hand, x: an.x, y: an.y, z: an.z });
  }

  onRelease(e) {
    const hand = e && e.hand === 'left' ? 'left' : 'right';
    this.attached[hand] = false;
    const r = e && e.reason;
    if (r === 'reset' || r === 'death') {
      this.end(r);
      return;
    }
    this.releaseT = this.clock;
  }

  _descent() {
    return this.player ? this.startY - this.player.y : 0;
  }

  /** The body touched the ground / a hold: a chain with links ends; one without links just starts again from here. */
  touch(reason) {
    if (!this.active) return;
    if (this.n > 0) this.end(reason);
    else if (this.player) this.startY = this.player.y;
  }

  /** Ends the chain (no-op without one); emits flow:end when it had a link. */
  end(reason) {
    if (!this.active) return;
    const n = this.n;
    const descent = this._descent();
    const scored = n >= FLOW.rewardFrom && descent >= FLOW.minDescent;
    if (scored) this.chains++;
    this.active = false;
    this.n = 0;
    this.charge = 0;
    this._a1.on = false;
    this._a2.on = false;
    if (n > 0) this._emit('flow:end', { n, reason: reason || 'end', scored, descent });
  }

  /** Once per run frame with the sim dt: the release window, the ground, the flare. */
  step(dt) {
    const d = dt > 0 ? dt : 0;
    this.clock += d;
    if (this.flare > 0) this.flare = Math.max(0, this.flare - FLOW.flareDecay * d);
    if (!this.active) return;
    const p = this.player;
    if (p && (p.grounded || p.climbing)) {
      if (this.n > 0) this.end(p.grounded ? 'land' : 'grab');
      else this.startY = p.y; // no link yet: the chain starts where the body leaves the ground / the hold
    } else if (!this.attached[HANDS[0]] && !this.attached[HANDS[1]] && this.clock - this.releaseT >= FLOW.window) this.end('fall');
  }
}
