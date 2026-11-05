/**
 * ABYSSAL TETHER 3D - death scenes (pure timelines, no three.js, no DOM).
 *
 * Two deaths used to look the same: the view flashed and fell to near-black in half a second. They are scenes now.
 *
 *   'collapse'  a fall / a hard landing / the old ironwork / the Dresser. The camera drops to the floor like a body that has gone
 *               down (desktop: it also rolls onto its side and looks at the ground), lingers, and the EYELIDS close slowly:
 *               heavy, a flutter where they try to open, then shut.
 *   'bitten'    a skitterling swarm: the collapse, quicker, with blood on the lens.
 *   'devour'    the Mason: the strike throws you down, the world goes out, two red eyes ignite in the dark and come closer,
 *               the maw opens wider than it should, it lunges over the camera and bites. Blood on the lens, black, the sound
 *               of it eating. (R-rated on purpose.)
 *
 * Everything here is a function of time: `sampleDeath(kind, t, opts, out)` fills a plain snapshot, `DeathScene` steps a clock and
 * reports the beats (named moments) crossed, which the game turns into sound. The renderer-side pieces (render/deathOverlay.js:
 * eyelids + blood on the lens, masonRigView.cine: the face) only read the snapshot.
 *
 * Snapshot fields (all numbers, `face` an object):
 *   camDrop    metres the eye drops below its normal place (the game clamps it to the floor)
 *   camPitch   radians added to the desktop camera's pitch (+ looks up)           [desktop only]
 *   camRoll    radians the desktop camera rolls                                     [desktop only]
 *   lids       0 open .. 1 shut (the eyelid overlay)
 *   black      0..1 the view is hidden behind black (after the lids, or after the bite)
 *   dark       0..1 how much the world has gone out (the game scales exposure by 1 - 0.84 * dark)
 *   blood      0..1 blood on the lens; drip 0..1 how far it has run
 *   shake      0..1 camera shake (the game scales it down in comfort modes)
 *   flash      0..1 a red-white pulse on the strike / the bite
 *   face       { on, dist, h, gape, eyes, lunge }: the Mason's head relative to the camera (metres ahead, metres above), the jaw
 *              opening 0..1, the eyes' glow 0..1, the lunge progress 0..1
 */

export const KINDS = Object.freeze({
  collapse: { panelAt: 4.0, skipAt: 1.7 },
  bitten: { panelAt: 3.7, skipAt: 1.4 },
  devour: { panelAt: 6.6, skipAt: 2.8 },
});

/** The scene a death cause plays. `killer` is the creature that did it ('mason' | 'skitter' | ...), when known. */
export function sceneKind(cause, killer) {
  if (cause === 'creature') return killer === 'skitter' ? 'bitten' : 'devour';
  return 'collapse'; // impact, fall, hazard, dressed, anything else that kills
}

/** Beats (named moments) per kind, in time order: [t, name]. The audio and the haptics key off these. */
export const BEATS = Object.freeze({
  collapse: [
    [0.0, 'down'], // the impact itself (the game's own hit sounds already play)
    [0.15, 'drop'], // the camera starts to fall
    [0.95, 'rest'], // it lies on the floor
    [1.0, 'lidsStart'],
    [2.35, 'flutter'], // the lids try to open
    [3.5, 'lidsShut'],
  ],
  bitten: [
    [0.0, 'down'],
    [0.05, 'splat'],
    [0.12, 'drop'],
    [0.8, 'rest'],
    [0.8, 'lidsStart'],
    [1.9, 'flutter'],
    [3.0, 'lidsShut'],
  ],
  devour: [
    [0.0, 'strike'], // the blow
    [0.12, 'drop'],
    [1.2, 'dark'], // the world is out
    [1.45, 'eyes'], // two red points ignite
    [2.1, 'breath'], // it comes closer; breathing
    [3.0, 'gape'], // the jaw begins to open
    [4.0, 'lungeStart'],
    [4.46, 'bite'], // it closes
    [4.6, 'chew'], // the sound of being eaten
    [5.9, 'swallow'],
  ],
});

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a, b, v) => {
  const t = clamp01((v - a) / (b - a || 1));
  return t * t * (3 - 2 * t);
};
const easeOut = (v) => 1 - Math.pow(1 - clamp01(v), 3);
const easeIn = (v) => Math.pow(clamp01(v), 3);
const mix = (a, b, k) => a + (b - a) * k;

export function newSnapshot() {
  return {
    kind: 'collapse',
    t: 0,
    camDrop: 0,
    camPitch: 0,
    camRoll: 0,
    lids: 0,
    black: 0,
    dark: 0,
    blood: 0,
    drip: 0,
    shake: 0,
    flash: 0,
    face: { on: false, dist: 8, h: 0.5, gape: 0, eyes: 0, lunge: 0 },
  };
}

/**
 * The eyelids over time (0 open .. 1 shut), given k = progress 0..1 of the closing: heavy to 0.6, a flutter back to ~0.45 where the
 * eyes try to open, then shut. Monotone except for the flutter.
 */
export function lidCurve(k) {
  k = clamp01(k);
  let l = 0.6 * smooth(0, 0.5, k);
  l -= 0.17 * Math.sin(Math.PI * smooth(0.5, 0.7, k)); // the flutter
  l += 0.4 * smooth(0.68, 1, k);
  return l < 0 ? 0 : l > 1 ? 1 : l;
}

/**
 * @param {string} kind  'collapse' | 'bitten' | 'devour'
 * @param {number} t     seconds since the death
 * @param {{xr?:boolean, eye?:number}} [o]  xr: a headset (no roll / pitch, smaller drop); eye: the eye's height above the feet (m)
 * @param {object} [out] a snapshot to fill (newSnapshot())
 */
export function sampleDeath(kind, t, o, out) {
  const s = out || newSnapshot();
  const xr = !!(o && o.xr);
  const eye = o && o.eye > 0.2 ? o.eye : 1.6;
  s.kind = kind;
  s.t = t;
  s.camDrop = s.camPitch = s.camRoll = 0;
  s.lids = s.black = s.dark = s.blood = s.drip = s.shake = s.flash = 0;
  const f = s.face;
  f.on = false;
  f.dist = 8;
  f.h = 0.5;
  f.gape = f.eyes = f.lunge = 0;
  if (t < 0) return s;
  const bounce = (t0) => (t > t0 && t < t0 + 0.5 ? Math.sin(((t - t0) / 0.5) * Math.PI) * (1 - (t - t0) / 0.5) : 0);

  if (kind === 'collapse' || kind === 'bitten') {
    const fast = kind === 'bitten';
    const t0 = fast ? 0.12 : 0.15;
    const dur = fast ? 0.68 : 0.8;
    const k = easeOut((t - t0) / dur);
    // down to a body's height above the floor (about 0.28 m), never more than the eye had
    const maxDrop = Math.max(0.15, Math.min(eye - 0.28, xr ? 0.9 : 1.3));
    s.camDrop = maxDrop * (k - 0.035 * bounce(t0 + dur - 0.05));
    if (!xr) {
      s.camPitch = -0.3 * k;
      s.camRoll = 0.85 * k * (1 + 0.05 * Math.sin(t * 1.3));
    }
    s.shake = 0.9 * Math.exp(-t * 7);
    s.flash = 0.7 * Math.exp(-t * 5);
    const l0 = fast ? 0.8 : 1.0;
    const ld = fast ? 2.2 : 2.5;
    s.lids = lidCurve((t - l0) / ld);
    s.dark = 0.3 * s.lids;
    s.black = smooth(l0 + ld - 0.1, l0 + ld + 0.45, t);
    if (fast) {
      s.blood = 0.85 * smooth(0.05, 0.25, t);
      s.drip = smooth(0.4, 3.2, t);
    }
    return s;
  }

  // ---- devour: the Mason eats you ----
  // the blow: thrown onto your back, looking up
  const kd = easeOut((t - 0.12) / 0.85);
  const maxDrop = Math.max(0.15, Math.min(eye - 0.3, xr ? 0.8 : 1.15));
  s.camDrop = maxDrop * kd;
  if (!xr) {
    s.camPitch = 0.34 * kd;
    s.camRoll = -0.22 * kd;
  }
  s.dark = smooth(0.05, 1.2, t);
  s.flash = 1.0 * Math.exp(-t * 6);
  s.shake = 1.0 * Math.exp(-t * 5) + 0.55 * smooth(4.35, 4.5, t) * Math.exp(-(t - 4.46) * 4);

  // the face in the dark: eyes first (they flicker on), then the whole head creeps in, the jaw opens, the lunge, the bite
  const eyesOn = smooth(1.45, 1.9, t);
  const flick = t > 1.45 && t < 2.4 ? 0.5 + 0.5 * Math.sin(t * 38) * Math.sin(t * 7.3) : 1;
  f.on = t >= 1.4;
  f.eyes = clamp01(eyesOn * (t < 2.4 ? 0.55 + 0.45 * flick : 1));
  const creep = smooth(1.5, 4.0, t);
  f.dist = mix(7.2, 2.5, creep);
  f.h = mix(0.7, 0.35, creep); // it comes down over you
  const open = smooth(3.0, 4.2, t);
  f.gape = open;
  // the lunge: 4.0 -> 4.46 it covers the last 2.3 m (cubic: slow, then all at once)
  const lg = easeIn((t - 4.0) / 0.46);
  f.lunge = lg;
  if (t > 4.0) {
    f.dist = mix(2.5, 0.12, lg);
    f.h = mix(0.35, 0.0, lg);
  }
  // the bite: the jaw slams shut
  if (t >= 4.46) {
    f.dist = 0.12;
    f.h = 0;
    f.gape = 1 - smooth(4.46, 4.62, t);
    f.lunge = 1;
  }
  if (t > 5.0) f.on = t < 5.6; // it is gone from view once it has you (the screen is black / blood by then)

  const bite = smooth(4.46, 4.56, t);
  s.blood = 0.95 * bite;
  s.drip = smooth(4.5, 6.6, t);
  s.black = 0.88 * smooth(4.5, 4.9, t) + 0.12 * smooth(5.7, 6.4, t);
  s.flash = Math.max(s.flash, 0.9 * bite * Math.exp(-(t - 4.5) * 5));
  return s;
}

export class DeathScene {
  constructor() {
    this.s = newSnapshot();
    this.active = false;
    this.kind = 'collapse';
    this.t = 0;
    this.panelAt = 0;
    this.skipAt = 0;
    this._opts = { xr: false, eye: 1.6 };
    this._beatI = 0;
    this._beats = [];
    this._fired = [];
    this.noBeats = Object.freeze([]); // returned by callers that seek instead of step
  }

  /**
   * @param {string} cause  the death cause ('impact' | 'fall' | 'hazard' | 'creature' | 'dressed')
   * @param {{killer?:string, xr?:boolean, eye?:number, reduced?:boolean}} [o]
   * @returns {string} the scene kind
   */
  begin(cause, o) {
    o = o || {};
    const kind = sceneKind(cause, o.killer);
    this.kind = kind;
    this.t = 0;
    this.active = true;
    this._opts.xr = !!o.xr;
    this._opts.eye = o.eye > 0.2 ? o.eye : 1.6;
    const K = KINDS[kind];
    this.panelAt = K.panelAt;
    this.skipAt = K.skipAt;
    this._beats = BEATS[kind];
    this._beatI = 0;
    sampleDeath(kind, 0, this._opts, this.s);
    return kind;
  }

  /** Steps the clock; returns the beats crossed this step (a reused array, empty most frames). */
  update(dt) {
    this._fired.length = 0;
    if (!this.active) return this._fired;
    this.t += dt > 0 ? dt : 0;
    sampleDeath(this.kind, this.t, this._opts, this.s);
    const B = this._beats;
    while (this._beatI < B.length && B[this._beatI][0] <= this.t) this._fired.push(B[this._beatI++][1]);
    return this._fired;
  }

  /** Jumps to time `t` without firing beats (captures, tests). */
  seek(t) {
    if (!this.active) return;
    this.t = t > 0 ? t : 0;
    sampleDeath(this.kind, this.t, this._opts, this.s);
  }

  /** The panel may appear (the scene has played out). */
  get done() {
    return this.active && this.t >= this.panelAt;
  }

  /** Input may cut the scene short from here on. */
  get skippable() {
    return this.active && this.t >= this.skipAt;
  }

  /** Jumps to the end (the panel shows); false before `skipAt`. */
  skip() {
    if (!this.skippable) return false;
    this.t = Math.max(this.t, this.panelAt);
    sampleDeath(this.kind, this.t, this._opts, this.s);
    return true;
  }

  /** Back to nothing (a respawn, a restart, a return to the menu). */
  end() {
    this.active = false;
    this.t = 0;
    this._fired.length = 0;
    const s = this.s;
    s.camDrop = s.camPitch = s.camRoll = 0;
    s.lids = s.black = s.dark = s.blood = s.drip = s.shake = s.flash = 0;
    s.face.on = false;
    s.face.gape = s.face.eyes = s.face.lunge = 0;
  }
}
