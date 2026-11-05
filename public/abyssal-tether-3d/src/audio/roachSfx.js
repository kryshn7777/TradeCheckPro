/* THE LANTERN (ABYSSAL TETHER 3D) — audio/roachSfx.js
 * The RED ROACHES' sounds (sim/roaches.js, docs/abyssal-tether-3d/plans/ROACHES.md), as methods mixed into AudioManager3D (audio3d.js:
 * `Object.assign(AudioManager3D.prototype, ROACH_SFX)`), built from its voice helpers (_begin, _vFilter, _vGain, _vOsc, _perc, _swell, _tick,
 * _commit) so they share its voice budget, its spatialisation and its limiter. Tiny sounds, placed where the roach is (HRTF while there is room,
 * the 'flat' panner: direction only; the distance law is ours, a small thing's: 1 / (1 + (d / 2.5)^1.6), silent past 9-12 m):
 *
 *   roach:skitter {x,y,z,n,speed}   dry chitin ticks: a short train of 3-9 clicks (band-passed noise, 3-7 kHz, a 4 ms decay) in the tripod's
 *                                   strong-weak-strong rhythm, faster with speed, a breath of rustle under it when several run
 *   roach:scatter {x,y,z,n}         a skitter burst: 10-30 clicks from several runners at once, accelerating then thinning as they get away
 *   roach:squish {x,y,z}            a wet crunch (the shell cracking: three bright ticks), a squelch (a falling band of brown noise) and a tiny
 *                                   low pop
 *   roach:burst {x,y,z,n}           the crack: something shifting inside the wall (a rising band of rustle and a soft knock), then a stream of
 *                                   ticks pouring out
 *
 * DESIGNED, NOT RANDOM: every variation (tick count, spacing, pitch, accents, the noise buffer's start) comes from a counter through an integer
 * hash; no Math.random. Silent without an audio context (the tests, a blocked page): _begin returns null.
 */
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);

/** Integer hash -> 0..1. */
function h01(n) {
  let h = (n | 0) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** A small thing's loudness at d metres (1 at the ear, 0.43 at 3 m, 0.11 at 9 m), zero past `far`. */
export function roachGain(d, far = 11) {
  if (!(d >= 0) || d > far) return 0;
  return 1 / (1 + Math.pow(d / 2.5, 1.6));
}

export const ROACH_SFX = {
  /** The next variation counter (one per sound, shared by all four). */
  _roachK() {
    this._roachN = ((this._roachN | 0) + 1) >>> 0;
    return this._roachN * 2654435761;
  },

  /** Where it is and how loud it may be: { pos, g } in this._roachAt (reused), or null. */
  _roachWhere(p, far) {
    const pos = this._at(num(p && p.x, NaN), num(p && p.y, NaN), num(p && p.z, NaN));
    if (!pos) return null;
    const d = Math.hypot(pos.x - num(this._lx, pos.x), pos.y - num(this._ly, pos.y), pos.z - num(this._lz, pos.z));
    const g = roachGain(d, far);
    if (g <= 0) return null;
    const w = this._roachAt || (this._roachAt = { pos: null, g: 0, d: 0 });
    w.pos = pos;
    w.g = g;
    w.d = d;
    return w;
  },

  /** A looping noise source started at a hashed offset (the engine's own helper starts at a random one). */
  _roachNoise(v, buf, t, k, rate) {
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    if (rate && rate !== 1) s.playbackRate.value = rate;
    s.start(t, h01(k) * Math.max(0, buf.duration - 0.05));
    v.nodes.push(s);
    v.sources.push(s);
    return s;
  },

  /**
   * `count` dry clicks from t over about `span` s through one band-pass: the tripod's accent (strong, weak, strong ...), pitch and spacing
   * from the hash, `accel` < 1 makes the train speed up, `fade` thins its tail. Returns the end time.
   */
  _roachTicks(v, t, count, span, peak, fLo, fHi, k, accel, fade) {
    const n = this._roachNoise(v, this._white, t, k, 1);
    const hp = this._vFilter(v, 'highpass', 1800, 0.5);
    const bp = this._vFilter(v, 'bandpass', fHi, 5);
    const g = this._vGain(v, 0);
    n.connect(hp);
    hp.connect(bp);
    bp.connect(g);
    g.connect(v.out);
    let tt = t;
    let step = span / Math.max(1, count);
    for (let i = 0; i < count; i++) {
      const r1 = h01(k + i * 7919);
      const r2 = h01(k + i * 104729 + 13);
      const acc = i % 3 === 1 ? 0.55 : 1; // the tripod: strong, weak, strong
      const tail = count > 1 ? 1 - fade * (i / (count - 1)) : 1;
      bp.frequency.setValueAtTime(clamp(fLo + (fHi - fLo) * r1, 200, this._nyq), tt);
      this._tick(g.gain, tt, peak * acc * tail * (0.7 + 0.3 * r2), 0.004 + 0.003 * r2);
      tt += step * (0.7 + 0.6 * r2);
      step *= accel;
    }
    return tt;
  },

  /** The ticking of the nearest runner: dry, short, faster as it speeds up. */
  _onRoachSkitter(p) {
    const w = this._roachWhere(p, 9);
    if (!w) return;
    const k = this._roachK();
    const sp = clamp(num(p.speed, 0.5) / 1.3, 0, 1);
    const n = clamp(num(p.n, 1) | 0, 1, 12);
    const count = 3 + Math.floor(h01(k) * 3) + Math.min(3, n - 1);
    const span = count * (0.05 - 0.024 * sp);
    const v = this._begin('roachSkit', 1, 0.1, span + 0.2, this.busPlayer, w.g * (0.32 + 0.3 * sp) * (1 + 0.06 * Math.min(5, n - 1)), 0, 0.1, 0, w.pos, 'flat', true);
    if (!v) return;
    const t = v.t0;
    this._roachTicks(v, t, count, span, 0.85, 3200, 6800, k, 0.97, 0.3);
    if (n >= 3) {
      // several of them: a breath of rustle under the clicks
      const r = this._roachNoise(v, this._brown, t, k + 5, 1);
      const bp = this._vFilter(v, 'bandpass', 1100 + 500 * h01(k + 9), 1.2);
      const rg = this._vGain(v, 0);
      this._swell(rg.gain, t, 0.12, span * 0.3, span * 0.4, 0.06);
      r.connect(bp);
      bp.connect(rg);
      rg.connect(v.out);
    }
    this._commit(v);
  },

  /** They scatter from your light / your hand: a burst of clicks from several runners, fast, then thinning as they get away. */
  _onRoachScatter(p) {
    const w = this._roachWhere(p, 12);
    if (!w) return;
    const k = this._roachK();
    const n = clamp(num(p.n, 2) | 0, 1, 12);
    const count = clamp(10 + n * 3, 10, 30);
    const span = 0.35 + 0.25 * h01(k + 1);
    const v = this._begin('roachScat', 2, 0.25, span + 0.35, this.busPlayer, w.g * 0.75, 0, 0.14, 0, w.pos, 'flat', true);
    if (!v) return;
    const t = v.t0;
    // two overlapping trains (left and right of the group), a few ms apart
    this._roachTicks(v, t, count >> 1, span, 0.8, 3000, 7200, k, 0.96, 0.75);
    this._roachTicks(v, t + 0.011, count - (count >> 1), span * 0.9, 0.7, 2600, 6200, k + 77, 0.95, 0.8);
    const r = this._roachNoise(v, this._pink, t, k + 3, 1);
    const bp = this._vFilter(v, 'bandpass', 1800, 0.9);
    bp.frequency.setValueAtTime(2400, t);
    bp.frequency.exponentialRampToValueAtTime(1200, t + span);
    const rg = this._vGain(v, 0);
    this._swell(rg.gain, t, 0.16, 0.03, span * 0.3, span * 0.35);
    r.connect(bp);
    bp.connect(rg);
    rg.connect(v.out);
    this._commit(v);
  },

  /** Under a palm or a boot: the shell cracks, a wet squelch, a tiny low pop. */
  _onRoachSquish(p) {
    const w = this._roachWhere(p, 12);
    if (!w) return;
    const k = this._roachK();
    const v = this._begin('roachSquish', 2, 0.04, 0.5, this.busPlayer, Math.max(0.35, w.g) * 0.9, 0, 0.08, 0, w.pos, 'flat');
    if (!v) return;
    const t = v.t0;
    // the crunch: three bright ticks inside 25 ms
    this._roachTicks(v, t, 3, 0.025, 1.0, 2200, 4200, k, 1, 0.4);
    // the squelch: brown noise through a band falling 1400 -> 380 Hz
    const n = this._roachNoise(v, this._brown, t, k + 11, 1);
    const bp = this._vFilter(v, 'bandpass', 1400, 2.2);
    bp.frequency.setValueAtTime(1300 + 300 * h01(k + 2), t + 0.004);
    bp.frequency.exponentialRampToValueAtTime(380, t + 0.14);
    const g = this._vGain(v, 0);
    this._perc(g.gain, t + 0.004, 0.75, 0.006, 0.05);
    n.connect(bp);
    bp.connect(g);
    g.connect(v.out);
    // the pop
    const o = this._vOsc(v, 'sine', 170 + 40 * h01(k + 4), t);
    o.frequency.exponentialRampToValueAtTime(62, t + 0.05);
    const og = this._vGain(v, 0);
    this._perc(og.gain, t, 0.45, 0.002, 0.028);
    o.connect(og);
    og.connect(v.out);
    this._commit(v);
  },

  /** The crack beside your hand: something shifts in the wall, then they pour out. */
  _onRoachBurst(p) {
    const w = this._roachWhere(p, 14);
    if (!w) return;
    const k = this._roachK();
    const n = clamp(num(p.n, 6) | 0, 1, 12);
    const v = this._begin('roachBurst', 3, 1.5, 1.7, this.busPlayer, Math.max(0.45, w.g) * 0.95, 0, 0.22, 0, w.pos, 'flat');
    if (!v) return;
    const t = v.t0;
    // the wall gives: a soft knock and a rising band of rustle inside it
    const o = this._vOsc(v, 'sine', 95, t);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.12);
    const og = this._vGain(v, 0);
    this._perc(og.gain, t, 0.3, 0.004, 0.06);
    o.connect(og);
    og.connect(v.out);
    const r = this._roachNoise(v, this._brown, t, k + 21, 1);
    const bp = this._vFilter(v, 'bandpass', 600, 1.6);
    bp.frequency.setValueAtTime(600, t);
    bp.frequency.exponentialRampToValueAtTime(2400, t + 0.3);
    bp.frequency.exponentialRampToValueAtTime(1300, t + 1.2);
    const rg = this._vGain(v, 0);
    this._swell(rg.gain, t, 0.3, 0.22, 0.5, 0.25);
    r.connect(bp);
    bp.connect(rg);
    rg.connect(v.out);
    // the stream: a train that speeds up as they pour, then two stragglers
    const end = this._roachTicks(v, t + 0.18, clamp(n * 5, 20, 50), 0.8, 0.9, 2800, 7000, k, 0.975, 0.5);
    this._roachTicks(v, end + 0.05, 4, 0.12, 0.5, 3400, 6400, k + 99, 1, 0.3);
    this._commit(v);
  },
};

/** bus event -> method name, added to AudioManager3D's table. */
export const ROACH_EVENTS = {
  'roach:skitter': '_onRoachSkitter',
  'roach:scatter': '_onRoachScatter',
  'roach:squish': '_onRoachSquish',
  'roach:burst': '_onRoachBurst',
};
