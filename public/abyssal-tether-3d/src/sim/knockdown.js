/* THE LANTERN — sim/knockdown.js
 * The player's knockdown after a creature hit (plans/MASON_STRIKES.md): a Mason strike throws you down for a moment and you get up
 * slowly; a skitterling bite (or a Mason hit while you hang / grip / fly) is only a stagger. Pure state, no DOM, no three.js, no
 * allocation per frame, Node-safe. The FEEDBACK side (the view, the fall / rise of the body camera, the red flash) reads `k`,
 * `phase`, `moveMul` and the events; the game's controls read `moveMul` (sim/playerHits.js, game.js _stepPhysics).
 *
 *   phase   'none' | 'down' | 'rise'      t  s in the phase      dur  the phase's total s      active  phase !== 'none'
 *   k       0 standing .. 1 flat: down = cubic ease-out to 1 over KNOCK.fall s, held; rise = smoothstep back to 0 (slow)
 *   moveMul 0 while down, KNOCK.riseFrom -> 1 across the rise, KNOCK.staggerFrom -> 1 across a stagger, 1 standing
 *   stagger s left of a stagger (phase stays 'none', k 0)
 *   events  player:down {dur}, player:rise {dur}, player:up {}
 */

export const KNOCK = Object.freeze({
  down: 1.1, // s flat on the floor
  rise: 2.4, // s getting up
  fall: 0.25, // s of the fall itself (k 0 -> 1)
  riseFrom: 0.35, // moveMul at the start of the rise
  stagger: 0.35, // s of a bite's stumble
  staggerHard: 0.6, // s of a Mason hit that could not knock you down (gripping, hanging, in the air)
  staggerFrom: 0.4, // moveMul at the start of a stagger
  abortRise: 0.4, // s: the fast get-up when the body leaves the floor mid-knockdown
});

/** Total seconds of a full knockdown (down + rise). */
export const KNOCK_TOTAL = KNOCK.down + KNOCK.rise;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (u) => u * u * (3 - 2 * u);

export class Knockdown {
  /** @param {{emit:function}} [bus] */
  constructor(bus) {
    this.bus = bus || null;
    this.phase = 'none';
    this.t = 0;
    this.dur = 0;
    this.k = 0;
    this.moveMul = 1;
    this.stagger = 0;
    this.staggerDur = 0;
    this._k0 = 0; // k when the rise began
  }

  get active() {
    return this.phase !== 'none';
  }

  /** Seconds until the player stands with full control again (0 standing). */
  get left() {
    if (this.phase === 'down') return this.dur - this.t + KNOCK.rise;
    if (this.phase === 'rise') return this.dur - this.t;
    return this.stagger;
  }

  /**
   * A hit. strength >= 1 with floorOk: the full knockdown; otherwise a stagger (0.6 s for strength >= 1, 0.35 s below).
   * Returns true when it knocked the player down.
   */
  start(strength, floorOk) {
    const s = strength > 0 ? strength : 0;
    if (s >= 1 && floorOk) {
      this.phase = 'down';
      this.t = 0;
      this.dur = KNOCK.down;
      this.stagger = 0;
      this.staggerDur = 0;
      this.k = 0;
      this.moveMul = 0;
      this._emit('player:down', KNOCK.down);
      return true;
    }
    if (this.phase !== 'none') return false; // already down: a stagger adds nothing
    const d = s >= 1 ? KNOCK.staggerHard : KNOCK.stagger;
    if (d > this.stagger) {
      this.stagger = d;
      this.staggerDur = d;
    }
    this.moveMul = KNOCK.staggerFrom;
    return false;
  }

  update(dt) {
    const h = dt > 0 ? dt : 0;
    if (this.phase === 'down') {
      this.t += h;
      this.k = 1 - Math.pow(1 - clamp01(this.t / KNOCK.fall), 3);
      this.moveMul = 0;
      if (this.t >= this.dur) this._beginRise(KNOCK.rise);
    } else if (this.phase === 'rise') {
      this.t += h;
      const u = clamp01(this.t / this.dur);
      this.k = this._k0 * (1 - smooth(u));
      this.moveMul = KNOCK.riseFrom + (1 - KNOCK.riseFrom) * u;
      if (this.t >= this.dur) {
        this._stand();
        this._emit('player:up', -1);
      }
    } else if (this.stagger > 0) {
      this.stagger = Math.max(0, this.stagger - h);
      const u = this.staggerDur > 0 ? 1 - this.stagger / this.staggerDur : 1;
      this.moveMul = this.stagger > 0 ? KNOCK.staggerFrom + (1 - KNOCK.staggerFrom) * u : 1;
      this.k = 0;
    } else {
      this.k = 0;
      this.moveMul = 1;
    }
  }

  /** The body left the floor (it grabbed a wall, the floor gave way): a fast get-up from where it is. */
  abort() {
    if (this.phase === 'none') return;
    if (this.phase === 'rise' && this.dur - this.t <= KNOCK.abortRise) return;
    this._beginRise(KNOCK.abortRise);
  }

  /** Standing at once (death, respawn, restart, menu). Emits player:up when it was down. */
  cancel() {
    const was = this.phase !== 'none';
    this._stand();
    this.stagger = 0;
    this.staggerDur = 0;
    if (was) this._emit('player:up', -1);
  }

  _beginRise(dur) {
    this.phase = 'rise';
    this.t = 0;
    this.dur = dur;
    this._k0 = this.k;
    this.moveMul = KNOCK.riseFrom;
    this._emit('player:rise', dur);
  }

  _stand() {
    this.phase = 'none';
    this.t = 0;
    this.dur = 0;
    this.k = 0;
    this._k0 = 0;
    this.moveMul = 1;
  }

  /** Rare events (a hit, a get-up): the payload is a fresh object (listeners may keep it). dur < 0: no payload fields. */
  _emit(type, dur) {
    if (this.bus && typeof this.bus.emit === 'function') this.bus.emit(type, dur >= 0 ? { dur } : {});
  }
}
