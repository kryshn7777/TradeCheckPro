/* ABYSSAL TETHER 3D — mason/masonClipGraph.js
 * The Mason's clip graph: a pure function of the sim snapshot (state, attack timer, listening, scalars) that returns the
 * weight of every clip, the parametric pose values and the one-shot triggers of this frame. three-free and DOM-free, so
 * it runs in Node (tools/abyssal-tether-3d/tests/test-mason-rig.mjs). The view (masonRigView.js) applies the result to its
 * AnimationActions: base clips override the crown subtree, additive clips ride on top, the attack clips are SCRUBBED by
 * the sim's own timer (phase lock), so the animation can never drift from the kill timing.
 *
 *   state / situation                 base clip                      additive / parametric
 *   DORMANT, DISTANT, APPROACHING...  crown_idle                     breathe_seams, arms_flare(frondOpen), pit_dilate(glow)
 *   OBSERVING + listening             listen                         pit_dilate; breathing off
 *   OBSERVING (near, not listening),  linger_breathe                 pit_dilate
 *     creeping toward you
 *   BURST                             crown_idle (+ notice_snap)     plate_shiver(jitter), arms_flare
 *   ATTACK wind-up                    rear_windup (scrubbed)         portal_open(lunge)
 *   ATTACK strike                     strike (scrubbed to contact)   portal_snap on a miss, recoil after contact
 *   strike HIT                        take_close
 *   RECOVERING                        crown_idle                     retreat_fold, recoil
 *   victory slam on the gate, sighting pause   roar_display
 */

export const BASE_CLIPS = ['crown_idle', 'listen', 'linger_breathe', 'roar_display', 'rear_windup', 'strike', 'take_close', 'notice_snap'];
export const ADDITIVE_CLIPS = ['plate_shiver', 'breathe_seams', 'recoil', 'portal_snap', 'flinch', 'retreat_fold'];
export const PARAM_CLIPS = ['arms_flare', 'pit_dilate', 'portal_open'];
export const STRIKE_CONTACT = 0.16; // s: the strike clip's contact time == the sim's strikeTime (CREATURE_TUNING.strikeTime)
export const WINDUP_CLIP = 0.75; // s: rear_windup duration (scaled onto the sim's wind-up: 0.75 / 0.65 / 0.5 s)

// one-shot envelopes: [duration the weight holds, fade in, fade out]
const ONESHOT = {
  roar_display: [2.5, 0.18, 0.5],
  notice_snap: [0.45, 0.05, 0.35],
  take_close: [1e9, 0.1, 0.35],
  recoil: [0.6, 0.02, 0.15],
  portal_snap: [0.25, 0.02, 0.12],
  flinch: [0.5, 0.02, 0.15],
};

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
function approach(cur, target, up, down, dt) {
  const r = target > cur ? up : down;
  if (r <= 0) return target;
  const k = 1 - Math.exp(-dt / r);
  return cur + (target - cur) * k;
}

export class ClipGraph {
  constructor() {
    this.w = {};
    for (const n of BASE_CLIPS) this.w[n] = 0;
    for (const n of ADDITIVE_CLIPS) this.w[n] = 0;
    this.param = { arms_flare: 0, pit_dilate: 0, portal_open: 0 };
    this.out = { w: this.w, param: this.param, windupTime: -1, strikeTime: -1, triggers: [], attackBlend: 0, freeze: false, focusGain: 1 };
    this._one = {};
    for (const n in ONESHOT) this._one[n] = { t: -1, w: 0 };
    this._prev = { state: '', phase: null, hit: false, victory: '', sightHold: false };
    this._listenW = 0;
    this._lingerW = 0;
    this._rearW = 0;
    this._strikeW = 0;
    this._retreatW = 0;
    this._hitHold = false;
    this.snapshot = { state: 'DORMANT', phase: null, atkT: 0, atkWindup: 0.75, hit: false, listening: false, creeping: false, jitter: 0, lunge: 0, frondOpen: 0.3, glow: 0.1, distance: 99, victory: '', sighting: false, sightingK: 0 };
  }

  reset() {
    for (const n in this.w) this.w[n] = 0;
    for (const n in this._one) {
      this._one[n].t = -1;
      this._one[n].w = 0;
    }
    this._listenW = this._lingerW = this._rearW = this._strikeW = this._retreatW = 0;
    this._hitHold = false;
    this._prev.state = '';
    this._prev.phase = null;
    this._prev.victory = '';
    this._prev.sightHold = false;
  }

  /** Starts (or restarts) a one-shot clip's envelope. */
  trigger(name) {
    const o = this._one[name];
    if (!o) return false;
    o.t = 0;
    if (name === 'take_close') o.w = 0;
    const t = this.out.triggers;
    if (t.indexOf(name) < 0) t.push(name);
    return true;
  }

  /** Reads the snapshot (this.snapshot, filled by the view) and updates `out`. */
  update(dt) {
    const s = this.snapshot;
    const o = this.out;
    o.triggers.length = 0;
    const p = this._prev;
    const dts = dt > 0 ? Math.min(dt, 0.1) : 0;

    // ---- edges ----
    if (s.phase === 'strike' && p.phase !== 'strike') this._hitHold = false;
    if (s.phase === 'recoil' && p.phase === 'strike') {
      this.trigger('recoil');
      if (s.hit) {
        this.trigger('take_close');
        this._hitHold = true;
      } else this.trigger('portal_snap');
    }
    if (s.state === 'BURST' && p.state !== 'BURST' && p.state !== 'ATTACK') this.trigger('notice_snap');
    if (s.victory === 'slam' && p.victory !== 'slam') this.trigger('roar_display');
    const sightHold = !!s.sighting && s.state === 'OBSERVING';
    if (sightHold && !p.sightHold) this.trigger('roar_display');
    // a hit holds take_close until the run is over (the sim leaves ATTACK / RECOVERING on respawn)
    if (this._hitHold && s.state !== 'ATTACK' && s.state !== 'RECOVERING') this._hitHold = false;
    p.state = s.state;
    p.phase = s.phase;
    p.hit = s.hit;
    p.victory = s.victory;
    p.sightHold = sightHold;

    // ---- one-shot envelopes ----
    for (const n in this._one) {
      const e = this._one[n];
      const cfg = ONESHOT[n];
      let w = 0;
      if (e.t >= 0) {
        e.t += dts;
        if (n === 'take_close') {
          // holds while the hit stands, then releases
          e.w = this._hitHold ? Math.min(1, e.w + dts / cfg[1]) : Math.max(0, e.w - dts / cfg[2]);
          w = e.w;
          if (!this._hitHold && w <= 0) e.t = -1;
        } else if (e.t < cfg[1]) w = e.t / cfg[1];
        else if (e.t < cfg[0]) w = 1;
        else if (e.t < cfg[0] + cfg[2]) w = 1 - (e.t - cfg[0]) / cfg[2];
        else e.t = -1;
      }
      this.w[n] = w;
    }

    // ---- attack scrub times (phase lock) ----
    o.windupTime = -1;
    o.strikeTime = -1;
    let rearTarget = 0;
    let strikeTarget = 0;
    if (s.phase === 'windup') {
      const u = clamp(s.atkT / Math.max(s.atkWindup, 0.05), 0, 1);
      o.windupTime = u * WINDUP_CLIP;
      rearTarget = 1;
    } else if (s.phase === 'strike') {
      o.strikeTime = Math.min(s.atkT, STRIKE_CONTACT);
      strikeTarget = 1;
    } else if (s.phase === 'recoil') {
      o.strikeTime = STRIKE_CONTACT + s.atkT;
      strikeTarget = 1;
    }
    // soft hand-overs (no pop between the wind-up pose and the strike): the wind-up fades out under the strike for ~60 ms
    this._rearW = approach(this._rearW, rearTarget, 0.07, 0.05, dts);
    if (this._rearW < 0.004 && !rearTarget) this._rearW = 0;
    this._strikeW = strikeTarget ? approach(this._strikeW, 1, 0.03, 0, dts) : approach(this._strikeW, 0, 0, 0.45, dts);

    // ---- listening / lingering / retreat ----
    const attacking = s.phase !== null;
    const listenT = s.listening && !attacking ? 1 : 0;
    this._listenW = approach(this._listenW, listenT, 0.18, 0.22, dts);
    const near = s.distance < 22;
    const lingerT = !attacking && !s.listening ? (s.state === 'OBSERVING' && near ? 0.85 : 0) + (s.creeping ? 0.6 : 0) : 0;
    this._lingerW = approach(this._lingerW, clamp(lingerT, 0, 1), 0.45, 0.4, dts);
    const retreatT = s.state === 'RECOVERING' && !s.victory ? 1 : 0;
    this._retreatW = approach(this._retreatW, retreatT, 0.3, 0.5, dts);

    // ---- base weights (sum to 1; crown_idle takes the rest) ----
    const w = this.w;
    w.rear_windup = this._rearW;
    w.strike = this._strikeW;
    w.listen = this._listenW;
    w.linger_breathe = this._lingerW;
    const hi = w.rear_windup + w.strike + w.take_close + w.roar_display + w.notice_snap;
    const attackBlend = clamp(hi, 0, 1);
    // the attack and one-shot clips take priority over the ambient ones
    const room = Math.max(0, 1 - hi);
    const amb = w.listen + w.linger_breathe;
    const sc = amb > room && amb > 0 ? room / amb : 1;
    w.listen *= sc;
    w.linger_breathe *= sc;
    let sum = hi + w.listen + w.linger_breathe;
    if (sum > 1) {
      // too many at once (a one-shot over an attack): normalise
      const k = 1 / sum;
      w.rear_windup *= k;
      w.strike *= k;
      w.take_close *= k;
      w.roar_display *= k;
      w.notice_snap *= k;
      w.listen *= k;
      w.linger_breathe *= k;
      sum = 1;
    }
    w.crown_idle = Math.max(0, 1 - sum);

    // ---- additive layers ----
    w.plate_shiver = clamp(s.jitter, 0, 1) * (1 - 0.7 * this._listenW);
    const calm = s.state === 'DORMANT' || s.state === 'DISTANT' ? 1 : s.state === 'OBSERVING' ? 0.6 : 0.3;
    w.breathe_seams = calm * (1 - this._listenW) * (1 - attackBlend);
    w.retreat_fold = this._retreatW;
    // ---- parametric poses (time = value x duration) ----
    const quiet = 1 - attackBlend;
    this.param.arms_flare = clamp(s.frondOpen, 0, 1) * quiet;
    this.param.pit_dilate = clamp(s.glow * 0.9 + (s.listening ? 0.1 : 0), 0, 1) * quiet;
    this.param.portal_open = clamp(s.lunge, 0, 1) * (1 - this._rearW) * (1 - this._strikeW);
    o.attackBlend = attackBlend;
    o.freeze = s.listening && !attacking && this._listenW > 0.6; // the true freeze: legs stop, springs off
    return o;
  }
}
