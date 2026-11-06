/* THE LANTERN — lanternMood.js
 * The living flame: the carried lantern's light reads the danger around you, with no UI.
 *   - a fast fall: the flame gutters (it dips and warms);
 *   - a wind squall: it leans (a small sideways offset) and dims;
 *   - the creature's threat: it shrinks and goes blue-white, steadily, the more danger there is;
 *   - the Mason commits to a burst / an attack: it shudders hard (an honest tell: only then);
 *   - hidden in a Masons' rest: perfectly still and steady (safe);
 *   - covered by THE HOOD (sim/lanternHood.js): still too, and the visible flame pinched to a slit (inp.hood = hood.k, 0..1).
 *
 * Pure and deterministic: no Math.random (phase accumulators and sines), no allocation per call (the state lives on `out`).
 * Never a strobe: every oscillator is <= MAX_HZ (12 Hz) and the fast intensity flutter is shallow (FLUTTER_MAX); every output is
 * low-pass filtered and slew-limited (RATE), so nothing jumps between frames. settings.reducedEffects halves the whole effect;
 * settings.livingFlame === false is the identity (and the state resets, so turning it back on eases in from calm).
 *
 *   const m = createLanternMood();
 *   lanternMood(dt, lanternMoodInputs(game, inp), m);   // per frame
 *   m.intensityMul  x the lantern's intensity          (1 = unchanged)
 *   m.hueShift      -1 (blue-white) .. 0 .. +1 (deep warm): applyLanternHue(color, m.hueShift)
 *   m.jitter        0..1 how agitated the flame is (for views that want it)
 *   m.scale         x the visible flame's size
 *   m.still         0..1 how much of the renderer's own idle flicker to suppress (1 = in a refuge)
 *   m.jx, m.jy      the flame's offset in its parent's frame (m): the lean of a squall + the shudder
 */

/** The fastest oscillation anywhere in the mood (Hz): the photosensitivity cap. */
export const MAX_HZ = 12;
/** Depth of the fast (> 3 Hz) intensity flutter at its strongest (a shudder), before reducedEffects. */
export const FLUTTER_MAX = 0.08;
/** Slew limits of the outputs, per second. */
export const RATE = Object.freeze({ intensity: 6, hue: 3, scale: 4, jitter: 6, offset: 1.5 });

// The oscillators (Hz). All <= MAX_HZ.
const HZ = Object.freeze({ shudderA: 10.3, shudderB: 7.1, gutter: 4.3, gutterSlow: 1.7, lean: 0.9, leanFlap: 3.1 });
// Low-pass rates (1/s) of the input envelopes: how fast each mood comes on / goes off.
const ON = Object.freeze({ gutter: 4, squall: 2.5, threat: 1.5, burst: 8, refuge: 2 });
const OFF = Object.freeze({ gutter: 2, squall: 1.5, threat: 1, burst: 3, refuge: 3 });
const TAU = Math.PI * 2;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a, b, v) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const fin = (v, d) => (typeof v === 'number' && v === v && v !== Infinity && v !== -Infinity ? v : d);

/** A fresh mood state (the identity output). */
export function createLanternMood() {
  return {
    intensityMul: 1,
    hueShift: 0,
    jitter: 0,
    scale: 1,
    still: 0,
    jx: 0,
    jy: 0,
    // state
    _ph: 0, // phase accumulator (s), wrapped
    _g: 0, // gutter envelope
    _q: 0, // squall
    _t: 0, // threat
    _b: 0, // burst
    _r: 0, // refuge
    _i: 1, // slewed raw outputs (before the reducedEffects scale)
    _h: 0,
    _s: 1,
    _j: 0,
    _x: 0,
    _y: 0,
  };
}

function env(cur, tgt, dt, on, off) {
  const k = tgt > cur ? on : off;
  return cur + (tgt - cur) * (1 - Math.exp(-k * dt));
}

function slew(cur, tgt, maxStep) {
  const d = tgt - cur;
  return d > maxStep ? cur + maxStep : d < -maxStep ? cur - maxStep : tgt;
}

function identity(out) {
  out.intensityMul = 1;
  out.hueShift = 0;
  out.jitter = 0;
  out.scale = 1;
  out.still = 0;
  out.jx = 0;
  out.jy = 0;
  out._g = out._q = out._t = out._b = out._r = 0;
  out._i = out._s = 1;
  out._h = out._j = out._x = out._y = 0;
  return out;
}

/** THE HOOD: a covered flame is still and pinched to a slit (hood.k is already slewed: applied as is, not halved by reducedEffects). */
function hooded(out, inp) {
  const hk = clamp01(fin(inp.hood, 0));
  if (hk > 0) {
    if (hk > out.still) out.still = hk;
    out.scale *= 1 - 0.8 * hk;
  }
  return out;
}

/**
 * One step of the mood.
 * @param {number} dt seconds
 * @param {{speed:number, threat:number, burst:boolean|number, refuge:boolean|number, squall:number, reduced:boolean, enabled?:boolean}} inp
 *   speed: the downward fall speed (m/s); threat 0..1; burst: the Mason commits (BURST / ATTACK); refuge: hidden in a rest;
 *   squall 0..1; reduced: settings.reducedEffects; enabled: settings.livingFlame (default true).
 * @param {object} out createLanternMood() state, updated in place and returned
 */
export function lanternMood(dt, inp, out) {
  if (!out) out = createLanternMood();
  if (!inp) return identity(out);
  if (inp.enabled === false) return hooded(identity(out), inp); // the hood is gameplay: it pinches the flame with the living flame off too
  const d = Math.min(Math.max(fin(dt, 0), 0), 0.1);
  out._ph += d;
  if (out._ph > 1000) out._ph -= 1000; // every oscillator below completes a whole number of cycles in 1000 s (frequencies x 1000 are integers)

  // the envelopes
  out._g = env(out._g, smooth(9, 24, fin(inp.speed, 0)), d, ON.gutter, OFF.gutter);
  out._q = env(out._q, clamp01(fin(inp.squall, 0)), d, ON.squall, OFF.squall);
  out._t = env(out._t, clamp01(fin(inp.threat, 0)), d, ON.threat, OFF.threat);
  out._b = env(out._b, inp.burst ? 1 : 0, d, ON.burst, OFF.burst);
  out._r = env(out._r, inp.refuge ? 1 : 0, d, ON.refuge, OFF.refuge);
  const calm = 1 - out._r; // a refuge takes every mood away
  const g = out._g * calm;
  const q = out._q * calm;
  const t = out._t * calm;
  const b = out._b * calm;

  const p = out._ph;
  const sA = Math.sin(TAU * HZ.shudderA * p);
  const sB = Math.sin(TAU * HZ.shudderB * p + 1.1);
  const gu = 0.5 + 0.5 * Math.sin(TAU * HZ.gutter * p) * Math.sin(TAU * HZ.gutterSlow * p + 0.4); // 0..1, mostly low
  const ln = Math.sin(TAU * HZ.lean * p);
  const lf = Math.sin(TAU * HZ.leanFlap * p + 2.3);

  // intensity: threat dims steadily; a fall gutters (deeper dips); a squall dims; a burst dips + a shallow fast flutter
  let i = (1 - 0.38 * t) * (1 - g * (0.18 + 0.22 * gu)) * (1 - 0.22 * q) * (1 - 0.12 * b);
  i *= 1 + FLUTTER_MAX * (b * (0.6 * sA + 0.4 * sB) + 0.25 * q * lf);
  // hue: threat -> blue-white (negative), a fall -> warmer (positive)
  const h = Math.max(-1, Math.min(1, 0.55 * g - 0.75 * t - 0.15 * b));
  // the visible flame: smaller with threat, a little smaller guttering, flickers with the burst
  const s = (1 - 0.35 * t) * (1 - 0.18 * g) * (1 - 0.1 * q) * (1 + 0.12 * b * sB);
  const j = clamp01(Math.max(b, 0.6 * q, 0.5 * g, 0.25 * t));
  // position: a squall leans the flame (slow sway + a flap), a burst shakes it
  const x = 0.022 * q * (0.7 + 0.3 * ln) + 0.004 * q * lf + 0.012 * b * sA;
  const y = -0.006 * q + 0.01 * b * sB;

  const r = RATE;
  out._i = slew(out._i, i, r.intensity * d);
  out._h = slew(out._h, h, r.hue * d);
  out._s = slew(out._s, s, r.scale * d);
  out._j = slew(out._j, j, r.jitter * d);
  out._x = slew(out._x, x, r.offset * d);
  out._y = slew(out._y, y, r.offset * d);

  const k = inp.reduced ? 0.5 : 1;
  out.intensityMul = 1 + (out._i - 1) * k;
  out.hueShift = out._h * k;
  out.scale = 1 + (out._s - 1) * k;
  out.jitter = out._j * k;
  out.jx = out._x * k;
  out.jy = out._y * k;
  out.still = out._r; // the renderer's idle flicker fades out in a refuge (in every mode: steady is the calm reading)
  return hooded(out, inp);
}

/**
 * Reads the mood's inputs off the live game (no allocation: fills `inp`). game.player (vy), game.threat.value, game.creature
 * (state, refuge), game.objectives.squallNow, game.settings (reducedEffects, livingFlame).
 */
export function lanternMoodInputs(game, inp) {
  const o = inp || { speed: 0, threat: 0, burst: false, refuge: false, squall: 0, reduced: false, enabled: true, hood: 0 };
  const P = game && game.player;
  const playing = !!P && P.alive !== false && (!game.state || game.state === 'playing');
  const th = game && game.threat;
  const c = game && game.creature;
  const sq = game && game.objectives && game.objectives.squallNow;
  const s = game && game.settings;
  o.speed = playing ? Math.max(0, -fin(P.vy, 0)) : 0;
  o.threat = playing ? clamp01(fin(th && (typeof th === 'number' ? th : th.value), 0)) : 0;
  o.burst = playing && !!c && (c.state === 'BURST' || c.state === 'ATTACK');
  o.refuge = playing && !!c && c.refuge === 1;
  o.squall = playing && sq ? clamp01(Math.max(fin(sq.k, 0), 0.6 * fin(sq.rise, 0))) : 0;
  o.reduced = !!(s && s.reducedEffects);
  o.enabled = !(s && s.livingFlame === false);
  const hd = game && game.hood; // THE HOOD (sim/lanternHood.js)
  o.hood = playing && hd ? fin(hd.k, 0) : 0;
  return o;
}

const WARM = { r: 1.0, g: 0.48, b: 0.16 }; // a guttering flame: deep orange
const COLD = { r: 0.78, g: 0.88, b: 1.0 }; // a starved flame: blue-white

/** Shifts a THREE.Color-like {r,g,b} in place: hue > 0 toward deep warm, < 0 toward blue-white (lerp by |hue|). */
export function applyLanternHue(color, hue) {
  const h = Math.max(-1, Math.min(1, fin(hue, 0)));
  if (h === 0) return color;
  const T = h > 0 ? WARM : COLD;
  const a = h > 0 ? h : -h;
  color.r += (T.r - color.r) * a;
  color.g += (T.g - color.g) * a;
  color.b += (T.b - color.b) * a;
  return color;
}
