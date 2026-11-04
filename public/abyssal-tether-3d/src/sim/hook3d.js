/* ABYSSAL TETHER 3D — sim/hook3d.js
 * THE HOOK of Chapter II (docs/abyssal-tether-3d/plans/CHAPTER_II_DIRECTION.md section 4): the last minutes of II-13 THE SOOT THROAT.
 *
 * The player rests at the Throat's lip (nothing hunts there: the rest is never betrayed), steps onto the chain platform, and is lowered 36 m. The pawl clicks
 * every 3 m (a bell: the rule of the chapter). Past the end of the pit's walls the Throat opens into the Mere's cavern: black water, thousands of dark lanterns,
 * and under the surface the Ushers of the Mere turning to the clicks, a wave of pale rings across the lake. The platform stops 6 m over the water: the last
 * click, then silence. The nearest Usher's throat rises beside you and opens its ring on you; it never goes gold. Then it bows, and every Usher in the Mere
 * rises and bows into an aisle of arches that leads into the fog, to one small warm light and the shape of a chair. The chapter card (III . THE MERE) and the end
 * card follow. A jump into the water is the first fall that does not kill (a fixture plate the director arms): it plays the card at once.
 *
 *   const h = new HookSequence({ bus, chain: { y, drop, clickEvery }, water: { y }, wallsEndY })
 *   h.update(dt, { onPad, platformY, jumped })   once per fixed step; reads the platform's measured height (a lift mover), never moves anything itself
 *   h.state       { phase, e, open, wave, rear, bow, seat, card, clicks }  everything the view draws is a function of these, 0..1 where it is a blend
 *   h.reset()
 * Phases: 'rest' (waiting for the platform) -> 'lower' -> 'arrive' (the silence) -> 'rear' -> 'bow' -> 'card' -> 'end' (done: the game shows its end card).
 * Events on the bus: hook:start, hook:click {n, y}, hook:open, hook:arrive, hook:rear, hook:bow, hook:seat, hook:card, hook:end.
 * Pure: no imports; no allocation per step.
 */

export const HOOK = {
  stepOn: 1.0, // s standing on the platform before the chain starts (the pawl ticks once)
  waveSpeed: 14, // m/s: the wave of turning rings crosses the lake (the speed of the descent, and then some)
  openRise: 6, // m of descent past the walls' end over which the cavern shows
  rearAt: 5, // s after the platform stops: the nearest throat rises
  rearTime: 3,
  bowAt: 13, // s after the stop: it bows
  bowTime: 6,
  seatAt: 18, // s after the stop: the one small warm light far down the aisle
  cardAfterBow: 4, // s after the bow completes: the chapter card
  cardMax: 30, // s after the stop: the card shows regardless
  cardTime: 9, // s the chapter card is up before the end card
};

export class HookSequence {
  constructor({ bus = null, chain, water, wallsEndY } = {}) {
    this.bus = bus;
    this.chain = chain || { y: 0, drop: 36, clickEvery: 3 };
    this.water = water || { y: -40 };
    this.wallsEndY = typeof wallsEndY === 'number' ? wallsEndY : this.chain.y - 14;
    this.state = { phase: 'rest', e: 0, open: 0, wave: 0, rear: 0, bow: 0, seat: 0, card: 0, clicks: 0 };
    this._standT = 0;
    this._arrivedT = -1;
    this._openT = -1;
    this._cardT = -1;
    this._fired = { start: false, open: false, arrive: false, rear: false, bow: false, seat: false, card: false, end: false };
  }

  reset() {
    const s = this.state;
    s.phase = 'rest';
    s.e = 0;
    s.open = 0;
    s.wave = 0;
    s.rear = 0;
    s.bow = 0;
    s.seat = 0;
    s.card = 0;
    s.clicks = 0;
    this._standT = 0;
    this._arrivedT = -1;
    this._openT = -1;
    this._cardT = -1;
    for (const k of Object.keys(this._fired)) this._fired[k] = false;
  }

  /** Has the chain been started (the platform is on its way or arrived)? */
  get started() {
    return this.state.phase !== 'rest';
  }

  /** Seconds of standing on the platform that start the chain (the game then starts the lift mover). */
  get wantsStart() {
    return this.state.phase === 'rest' && this._standT >= HOOK.stepOn;
  }

  /** Called by the game when it has started the lift: the sequence runs from here. */
  begin() {
    if (this.state.phase !== 'rest') return;
    this.state.phase = 'lower';
    this._emit('start', 'hook:start', { y: this.chain.y });
  }

  _emit(key, type, payload) {
    if (this._fired[key]) return;
    this._fired[key] = true;
    if (this.bus) this.bus.emit(type, payload || {});
  }

  /**
   * @param {number} dt
   * @param {{ onPad: boolean, platformY: number, jumped?: boolean, splash?: boolean }} c  onPad: the player stands on the platform; platformY: the lift's
   *   current height; splash: the player has gone into the water
   */
  update(dt, c) {
    const s = this.state;
    if (s.phase === 'rest') {
      this._standT = c.onPad ? this._standT + dt : 0;
      return s;
    }
    if (s.phase === 'end') return s;
    s.e += dt;
    const drop = this.chain.y - c.platformY;
    const n = Math.max(0, Math.floor(drop / this.chain.clickEvery + 1e-6));
    while (s.clicks < n) {
      s.clicks++;
      if (this.bus) this.bus.emit('hook:click', { n: s.clicks, y: this.chain.y - s.clicks * this.chain.clickEvery });
    }
    // the cavern opens as the platform passes the walls' end
    s.open = Math.min(1, Math.max(0, (this.wallsEndY - c.platformY) / HOOK.openRise));
    if (s.open > 0) {
      if (this._openT < 0) this._openT = s.e;
      this._emit('open', 'hook:open', {});
      s.wave = (s.e - this._openT) * HOOK.waveSpeed;
    }
    const arrived = drop >= this.chain.drop - 0.05;
    if (arrived && this._arrivedT < 0) {
      this._arrivedT = s.e;
      s.phase = 'arrive';
      this._emit('arrive', 'hook:arrive', { y: c.platformY });
    }
    if (this._arrivedT >= 0) {
      const a = s.e - this._arrivedT;
      s.rear = clamp01((a - HOOK.rearAt) / HOOK.rearTime);
      s.bow = clamp01((a - HOOK.bowAt) / HOOK.bowTime);
      s.seat = clamp01((a - HOOK.seatAt) / 4);
      if (s.rear > 0) {
        if (s.phase === 'arrive') s.phase = 'rear';
        this._emit('rear', 'hook:rear', {});
      }
      if (s.bow > 0) {
        s.phase = 'bow';
        this._emit('bow', 'hook:bow', {});
      }
      if (s.seat > 0) this._emit('seat', 'hook:seat', {});
      const cardAt = Math.min(HOOK.bowAt + HOOK.bowTime + HOOK.cardAfterBow, HOOK.cardMax);
      if ((a >= cardAt || c.splash) && this._cardT < 0) this._cardT = s.e;
    } else if (c.splash && this._cardT < 0) this._cardT = s.e; // a jump from the platform on the way down
    if (this._cardT >= 0) {
      const k = s.e - this._cardT;
      s.card = clamp01(k / 2.5);
      s.phase = 'card';
      this._emit('card', 'hook:card', {});
      if (k >= HOOK.cardTime) {
        s.phase = 'end';
        this._emit('end', 'hook:end', {});
      }
    }
    return s;
  }

  snapshot() {
    return { state: Object.assign({}, this.state), standT: this._standT, arrivedT: this._arrivedT, openT: this._openT, cardT: this._cardT, fired: Object.assign({}, this._fired) };
  }

  restore(sn) {
    if (!sn) return;
    Object.assign(this.state, sn.state);
    this._standT = sn.standT;
    this._arrivedT = sn.arrivedT;
    this._openT = sn.openT;
    this._cardT = sn.cardT;
    Object.assign(this._fired, sn.fired);
  }
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
