/* ABYSSAL TETHER 3D — audio/lampholdSfx.js
 * CHAPTER II · LAMPHOLD's sounds, as methods mixed into AudioManager3D (audio3d.js: `Object.assign(AudioManager3D.prototype, LAMPHOLD_SFX)`), built from its own voice
 * helpers (_begin, _vOsc, _vNoise, _vFilter, _vGain, _perc, _swell, _commit) so they share its voice budget, its spatialisation and its limiter. Diegetic first
 * (docs/abyssal-tether-3d/plans/CHAPTER_II_DIRECTION.md section 3.9 and 6): the Usher's breath through a pipe, the hum that rises while its torch tightens (200 -> 800 Hz, an
 * octave up when the aim is locked), the pipe note and the crack of the whip, a long breath out; the Great Bell, the gongs, the brass chime of a ring, the iron groan of
 * the Span and its crash, the shutter, a lamp going out; the chain's pawl in the Throat and the held note of the bow (the Lamp motif's five notes).
 * Every handler is silent without an audio context (the tests, a blocked page) because _begin returns null.
 */
import { SeqRng } from './sfxDesign.js';

const SEQ = new SeqRng(0x1a3f); // seeded jitter, never Math.random (plans/SFX_DESIGN.md section 4)
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
const rand = (a, b) => a + SEQ.next() * (b - a);

function at(self, p) {
  return self._at(num(p && p.x, NaN), num(p && p.y, NaN), num(p && p.z, NaN));
}

export const LAMPHOLD_SFX = {
  /** The Usher listening: breath through a pipe (band-passed brown noise, a slow swell), three light raps before it. */
  _onUsherListen(p) {
    const pos = at(this, p);
    const v = this._begin('uListen', 2, 1.2, 2.4, this.busPlayer, 0.55, 0, 0.35, 0, pos, 'far');
    if (!v) return;
    const t = v.t0;
    for (let i = 0; i < 3; i++) {
      const o = this._vOsc(v, 'triangle', 190 * rand(0.98, 1.02), t + i * 0.28);
      const g = this._vGain(v, 0);
      this._perc(g.gain, t + i * 0.28, 0.28, 0.002, 0.04);
      o.connect(g);
      g.connect(v.out);
    }
    const n = this._vNoise(v, this._brown, t + 0.9, 1);
    const bp = this._vFilter(v, 'bandpass', 420, 5);
    const ng = this._vGain(v, 0);
    this._swell(ng.gain, t + 0.9, 0.5, 0.5, 0.4, 0.35);
    n.connect(bp);
    bp.connect(ng);
    ng.connect(v.out);
    this._commit(v);
  },

  /** COIL: the hum rises 200 -> 800 Hz over the telegraph (never shorter than 1.5 s). */
  _onUsherCoil(p) {
    const pos = at(this, p);
    const v = this._begin('uCoil', 3, 0.5, 2.1, this.busPlayer, 0.7, 0, 0.3, 0, pos, 'near');
    if (!v) return;
    const t = v.t0;
    const dur = clamp(num(p && p.dur, 1.7), 1.4, 2.0);
    for (const [m, a] of [[1, 0.34], [1.5, 0.12]]) {
      const o = this._vOsc(v, 'sawtooth', 200 * m, t);
      o.frequency.exponentialRampToValueAtTime(800 * m, t + dur);
      const lp = this._vFilter(v, 'lowpass', 900, 0.7);
      const g = this._vGain(v, 0);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(a, t + dur * 0.8);
      g.gain.setTargetAtTime(0, t + dur, 0.05);
      o.connect(lp);
      lp.connect(g);
      g.connect(v.out);
    }
    this._commit(v);
  },

  /** COMMIT: the hum jumps an octave and the keys stop. */
  _onUsherCommit(p) {
    const pos = at(this, p);
    const v = this._begin('uCommit', 3, 0.3, 0.6, this.busPlayer, 0.6, 0, 0.25, 0, pos, 'near');
    if (!v) return;
    const t = v.t0;
    const o = this._vOsc(v, 'sawtooth', 1600, t);
    const lp = this._vFilter(v, 'lowpass', 2400, 0.7);
    const g = this._vGain(v, 0);
    this._perc(g.gain, t, 0.3, 0.004, 0.12);
    o.connect(lp);
    lp.connect(g);
    g.connect(v.out);
    this._commit(v);
  },

  /** WHIP: the throat snaps straight: a pipe note and a crack. */
  _onUsherWhip(p) {
    if (p && p.lethal === false) return;
    const pos = at(this, p);
    const v = this._begin('uWhip', 4, 0.3, 1.2, this.busPlayer, 0.9, 0, 0.4, 0, pos, 'near');
    if (!v) return;
    const t = v.t0;
    const o = this._vOsc(v, 'sine', 392, t);
    o.frequency.setTargetAtTime(330, t, 0.1);
    const g = this._vGain(v, 0);
    this._perc(g.gain, t, 0.5, 0.004, 0.28);
    o.connect(g);
    g.connect(v.out);
    const n = this._vNoise(v, this._white, t, 1);
    const hp = this._vFilter(v, 'highpass', 3000, 0);
    const ng = this._vGain(v, 0);
    this._perc(ng.gain, t, 0.55, 0.001, 0.025);
    n.connect(hp);
    hp.connect(ng);
    ng.connect(v.out);
    this._commit(v);
  },

  /** RECOIL: a long breath out. */
  _onUsherRecoil(p) {
    const pos = at(this, p);
    const v = this._begin('uRecoil', 1, 1.0, 3.2, this.busPlayer, 0.4, 0, 0.4, 0, pos, 'far');
    if (!v) return;
    const t = v.t0;
    const n = this._vNoise(v, this._brown, t, 1);
    const bp = this._vFilter(v, 'bandpass', 520, 3);
    bp.frequency.setValueAtTime(520, t);
    bp.frequency.exponentialRampToValueAtTime(240, t + 2.4);
    const ng = this._vGain(v, 0);
    this._swell(ng.gain, t, 0.45, 0.15, 0.6, 0.8);
    n.connect(bp);
    bp.connect(ng);
    ng.connect(v.out);
    this._commit(v);
  },

  /** A lamp goes out: a soft pop and a puff of soot (a short band of noise falling). */
  _onLampSnuffSfx(p) {
    const pos = at(this, p);
    const v = this._begin('uSnuff', 1, 0.35, 0.8, this.busPlayer, 0.45, 0, 0.25, 0, pos, 'near');
    if (!v) return;
    const t = v.t0;
    const o = this._vOsc(v, 'sine', 300, t);
    o.frequency.setTargetAtTime(90, t, 0.04);
    const g = this._vGain(v, 0);
    this._perc(g.gain, t, 0.4, 0.002, 0.06);
    o.connect(g);
    g.connect(v.out);
    const n = this._vNoise(v, this._brown, t, 1);
    const bp = this._vFilter(v, 'bandpass', 900, 1);
    const ng = this._vGain(v, 0);
    this._perc(ng.gain, t, 0.25, 0.01, 0.12);
    n.connect(bp);
    bp.connect(ng);
    ng.connect(v.out);
    this._commit(v);
  },

  /** Iron breaks (the pawl, the Tenor's stand): a clank with a long ring. */
  _onUsherBlow(p) {
    const pos = at(this, p);
    const v = this._begin('uBlow', 3, 0.3, 2.4, this.busPlayer, 0.85, 0, 0.4, 0, pos, 'near');
    if (!v) return;
    const t = v.t0;
    for (const [m, a, tc] of [[1, 0.4, 0.9], [2.4, 0.25, 0.5], [4.1, 0.14, 0.25]]) {
      const o = this._vOsc(v, 'sine', 150 * m * rand(0.99, 1.01), t);
      const g = this._vGain(v, 0);
      this._perc(g.gain, t, a, 0.002, tc);
      o.connect(g);
      g.connect(v.out);
    }
    const n = this._vNoise(v, this._white, t, 1);
    const bp = this._vFilter(v, 'bandpass', 1800, 0.8);
    const ng = this._vGain(v, 0);
    this._perc(ng.gain, t, 0.5, 0.001, 0.05);
    n.connect(bp);
    bp.connect(ng);
    ng.connect(v.out);
    this._commit(v);
  },

  /** The Great Bell: nine metres of bronze, a stroke every six seconds (very low, very long, heard everywhere). */
  _onGreatStroke(p) {
    const pos = at(this, p);
    const v = this._begin('uGreat', 4, 2, 6.5, this.busPlayer, 1.0, 0, 0.6, 0, pos, 'far');
    if (!v) return;
    const t = v.t0;
    const base = 65.4;
    for (const [m, a, tc] of [[1, 0.6, 2.6], [2.02, 0.35, 1.8], [2.76, 0.28, 1.2], [4.1, 0.14, 0.7], [5.4, 0.08, 0.4]]) {
      const o = this._vOsc(v, 'sine', base * m, t);
      const g = this._vGain(v, 0);
      this._perc(g.gain, t, a, 0.01, tc);
      o.connect(g);
      g.connect(v.out);
    }
    this._commit(v);
  },

  /** The span's iron groans before a plate goes. */
  _onC2Creak(p) {
    const pos = at(this, p);
    const v = this._begin('c2Creak', 1, 0.25, 1.2, this.busPlayer, 0.5, 0, 0.3, 0, pos, 'near');
    if (!v) return;
    const t = v.t0;
    const n = this._vNoise(v, this._brown, t, 1);
    const bp = this._vFilter(v, 'bandpass', 160, 6);
    bp.frequency.setValueAtTime(160, t);
    bp.frequency.exponentialRampToValueAtTime(95, t + 0.7);
    const ng = this._vGain(v, 0);
    this._swell(ng.gain, t, 0.7, 0.2, 0.3, 0.2);
    n.connect(bp);
    bp.connect(ng);
    ng.connect(v.out);
    this._commit(v);
  },

  /** A plate (or the Tenor) crashes down. */
  _onC2Crash(p) {
    const pos = at(this, p);
    const v = this._begin('c2Crash', 3, 0.2, 2.2, this.busPlayer, 0.95, 0, 0.5, 0, pos, 'near');
    if (!v) return;
    const t = v.t0;
    const n = this._vNoise(v, this._brown, t, 1);
    const lp = this._vFilter(v, 'lowpass', 700, 0.8);
    const ng = this._vGain(v, 0);
    this._perc(ng.gain, t, 0.9, 0.004, 0.45);
    n.connect(lp);
    lp.connect(ng);
    ng.connect(v.out);
    const o = this._vOsc(v, 'sine', 80, t);
    o.frequency.setTargetAtTime(38, t, 0.1);
    const g = this._vGain(v, 0);
    this._perc(g.gain, t, 0.6, 0.004, 0.3);
    o.connect(g);
    g.connect(v.out);
    this._commit(v);
  },

  /** The Throat's shutter slams. */
  /** Three soft knocks on a door of the Street (wood, not bronze), then a latch. */
  _onC2Knock(p) {
    const pos = at(this, p);
    const v = this._begin('c2Knock', 2, 1.5, 1.6, this.busPlayer, 0.6, 0, 0.3, 0, pos, 'near');
    if (!v) return;
    const t = v.t0;
    for (let i = 0; i < 3; i++) {
      const tt = t + i * 0.34;
      const o = this._vOsc(v, 'sine', 140 * rand(0.97, 1.03), tt);
      o.frequency.setTargetAtTime(95, tt, 0.03);
      const g = this._vGain(v, 0);
      this._perc(g.gain, tt, 0.5, 0.002, 0.05);
      o.connect(g);
      g.connect(v.out);
    }
    const o2 = this._vOsc(v, 'square', 520, t + 1.25);
    const lp = this._vFilter(v, 'lowpass', 900, 0.7);
    const g2 = this._vGain(v, 0);
    this._perc(g2.gain, t + 1.25, 0.12, 0.002, 0.04);
    o2.connect(lp);
    lp.connect(g2);
    g2.connect(v.out);
    this._commit(v);
  },

  _onC2Grind() {
    const v = this._begin('c2Grind', 3, 4, 4.6, this.busPlayer, 0.8, 0, 0.4, 0, null, 'far');
    if (!v) return;
    const t = v.t0;
    const n = this._vNoise(v, this._brown, t, 1);
    const bp = this._vFilter(v, 'bandpass', 120, 5);
    bp.frequency.setValueAtTime(120, t);
    bp.frequency.exponentialRampToValueAtTime(52, t + 4);
    const ng = this._vGain(v, 0);
    this._swell(ng.gain, t, 0.9, 1.2, 2.0, 0.4);
    n.connect(bp);
    bp.connect(ng);
    ng.connect(v.out);
    this._commit(v);
  },

  _onC2Shutter(p) {
    const pos = at(this, p);
    const v = this._begin('c2Shutter', 4, 3, 3.2, this.busPlayer, 1.0, 0, 0.5, 0, pos, 'near');
    if (!v) return;
    const t = v.t0;
    const o = this._vOsc(v, 'sine', 110, t);
    o.frequency.setTargetAtTime(42, t, 0.12);
    const g = this._vGain(v, 0);
    this._perc(g.gain, t, 0.9, 0.003, 0.5);
    o.connect(g);
    g.connect(v.out);
    const n = this._vNoise(v, this._white, t, 1);
    const bp = this._vFilter(v, 'bandpass', 1200, 0.7);
    const ng = this._vGain(v, 0);
    this._perc(ng.gain, t, 0.6, 0.001, 0.08);
    n.connect(bp);
    bp.connect(ng);
    ng.connect(v.out);
    this._commit(v);
  },

  /** A toll of a kind with no bell body of its own: the cage's gong, a brass ring's chime. */
  _onTollEmit(p) {
    if (!p) return;
    const pos = at(this, p);
    if (p.kind === 'gong') {
      const v = this._begin('c2Gong', 2, 0.4, 3.0, this.busPlayer, 0.8, 0, 0.5, 0, pos, 'near');
      if (!v) return;
      const t = v.t0;
      for (const [m, a, tc] of [[1, 0.5, 1.2], [1.58, 0.3, 0.8], [2.4, 0.15, 0.4]]) {
        const o = this._vOsc(v, 'sine', 110 * m, t);
        const g = this._vGain(v, 0);
        this._perc(g.gain, t, a, 0.004, tc);
        o.connect(g);
        g.connect(v.out);
      }
      this._commit(v);
    } else if (p.kind === 'ring') {
      const v = this._begin('c2Chime', 1, 0.3, 1.4, this.busPlayer, 0.35, 0, 0.45, 0, pos, 'near');
      if (!v) return;
      const t = v.t0;
      for (const [m, a, tc] of [[1, 0.35, 0.5], [2.9, 0.2, 0.25]]) {
        const o = this._vOsc(v, 'sine', 1320 * m, t);
        const g = this._vGain(v, 0);
        this._perc(g.gain, t, a, 0.002, tc);
        o.connect(g);
        g.connect(v.out);
      }
      this._commit(v);
    }
  },

  /** The chain's pawl clicks every 3 m: a dry tick that rings once in the stone. */
  _onHookClick(p) {
    const v = this._begin('hookClick', 1, 0.2, 1.2, this.busPlayer, 0.5, 0, 0.6, 0, null, 'near');
    if (!v) return;
    const t = v.t0;
    const n = this._vNoise(v, this._white, t, 1);
    const bp = this._vFilter(v, 'bandpass', 2200, 2);
    const ng = this._vGain(v, 0);
    this._perc(ng.gain, t, 0.5 * clamp(1 - num(p && p.n, 0) * 0.02, 0.5, 1), 0.001, 0.012);
    n.connect(bp);
    bp.connect(ng);
    ng.connect(v.out);
    const o = this._vOsc(v, 'sine', 523 * rand(0.99, 1.01), t);
    const g = this._vGain(v, 0);
    this._perc(g.gain, t, 0.12, 0.002, 0.45);
    o.connect(g);
    g.connect(v.out);
    this._commit(v);
  },

  /** The bow: one held, wordless note: the Lamp motif's five notes, whole, unaccompanied. */
  _onHookBow() {
    const v = this._begin('hookBow', 4, 5, 14, this.busPlayer, 0.8, 0, 0.7, 0, null, 'far');
    if (!v) return;
    const t = v.t0;
    const notes = [261.6, 293.7, 392.0, 349.2, 523.3];
    notes.forEach((f, i) => {
      const o = this._vOsc(v, 'sine', f, t + i * 1.6);
      const o2 = this._vOsc(v, 'triangle', f * 2.003, t + i * 1.6);
      const g = this._vGain(v, 0);
      g.gain.setValueAtTime(0, t + i * 1.6);
      g.gain.linearRampToValueAtTime(0.22, t + i * 1.6 + 1.0);
      g.gain.setTargetAtTime(i === notes.length - 1 ? 0.09 : 0.0, t + i * 1.6 + 1.4, i === notes.length - 1 ? 3.5 : 0.6);
      o.connect(g);
      o2.connect(g);
      g.connect(v.out);
    });
    this._commit(v);
  },
};

/** bus event -> method name, added to AudioManager3D's table. */
export const LAMPHOLD_EVENTS = {
  'usher:listen': '_onUsherListen',
  'usher:coil': '_onUsherCoil',
  'usher:commit': '_onUsherCommit',
  'usher:whip': '_onUsherWhip',
  'usher:recoil': '_onUsherRecoil',
  'usher:snuff': '_onLampSnuffSfx',
  'lamp:snuff': '_onLampSnuffSfx',
  'usher:blow': '_onUsherBlow',
  'evening:stroke': '_onGreatStroke',
  'c2:creak': '_onC2Creak',
  'c2:crash': '_onC2Crash',
  'c2:shutter': '_onC2Shutter',
  'c2:grind': '_onC2Grind',
  'c2:knock': '_onC2Knock',
  'c2:stop': '_onC2Shutter',
  'toll:emit': '_onTollEmit',
  'hook:click': '_onHookClick',
  'hook:bow': '_onHookBow',
};
