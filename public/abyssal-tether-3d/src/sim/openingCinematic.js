/* THE LANTERN — sim/openingCinematic.js
 * The opening cinematic as a pure timeline (docs/abyssal-tether-3d/plans/OPENING_CINEMATIC.md): no three.js, no DOM, no
 * Math.random, no clock but the one it is stepped with. Everything the film does is a function of t (seconds):
 *
 *   sampleOpening(t, opts, out)  fills a plain snapshot (newOpeningSnapshot()):
 *     cam      {x, y, z, yaw, pitch, roll, fov}  the desktop camera (yaw 0 looks down -Z, + pitch looks up; fov is vertical, deg)
 *     vr       {x, y, z, cut}                     a headset: where the HEAD is put (a static vantage; cut = it changed this frame
 *                                                 behind black). The rig is never rotated in a headset (opts.xr).
 *     fade     0..1 black over the view            bars 0..1 the letterbox (desktop)
 *     dark     0..1 how dark the world is held (the level's lamps, ambient and haze; the hero lantern is not affected)
 *     lantern  {on, x, y, z, swayX, swayZ, light, flame, lean, leanX, leanZ, scale, range}  the hero lantern (its light is the game's own)
 *     chainTop y of the chain's top (it pays out from the dark above)
 *     mason    {on, x, y, z, fx, fy, fz, eyes, gape, lunge}  the Mason's head (MasonRigView.cine), facing (fx, fy, fz)
 *     player   {hands, lantern}  the player's own hands shown (0 / 1) and the gauntlet lantern's light 0..1 (the waking)
 *     title    {a, glow, sub}  the title card: alpha, the hit's glow, the subtitle's alpha
 *     caption  {id, speaker, text, a}  the line being spoken (subtitles of the narration; a = alpha)
 *     shot     index into SHOTS
 *   OpeningCinematic   steps a clock, reports the CUES crossed (the sound) and the VO lines started, handles the skip.
 *
 * The last frame is the game's spawn view (opts.handoff = the spawn eye position and yaw): the hand-off into play is seamless.
 */

export const DURATION = 84;
/** A skip: SKIP_FADE s to black (time stops), then the film jumps to SKIP_TO and the black lifts over SKIP_LIFT s. */
export const SKIP_TO = 82.0;
export const SKIP_FADE = 0.3;
export const SKIP_LIFT = 1.2;
/** Presses in the first GRACE s are ignored (the click that began the run). */
export const GRACE = 0.5;
/** Holding the skip input this long skips. */
export const SKIP_HOLD = 1.0;

export const TITLE_AT = 67.3;
export const LANTERN_OUT_AT = 64.6;
export const WAKE_AT = 76.0;

/** The S1 spawn the film ends on (level-data-3d.js spawn + the standing eye height); the game passes its own as opts.handoff. */
export const DEFAULT_HANDOFF = Object.freeze({ x: -4, y: 2.06, z: 8.5, yaw: 0 });

/** Where the hero lantern hangs (it comes down the chimney on this line and stops over the Threshold, in front of the spawn). */
export const LANTERN_X = -4;
export const LANTERN_Z = 5.3;
export const LANTERN_REST_Y = 2.75;
export const LANTERN_STOP_AT = 40.4;
/** Its height over time (monotone cubic through the keys: it never overshoots). Slower past the window. */
const LANTERN_Y_KEYS = [
  [0, 50.6],
  [17.5, 50.2],
  [27.0, 25.0],
  [34.0, 15.5],
  [38.6, 6.4],
  [LANTERN_STOP_AT, LANTERN_REST_Y],
  [DURATION, LANTERN_REST_Y],
];

/** The well (east of the lip): the Mason rises out of it in shot 7. */
const WELL = [7.3, -1.2];

const S = (id, name, t0, t1, keys, extra) => Object.freeze(Object.assign({ id, name, t0, t1, keys }, extra || {}));
const A = (x, y, z) => ({ abs: [x, y, z] });
const L = (x, y, z) => ({ rel: [x, y, z] }); // relative to the hero lantern
const HO = (x, y, z) => ({ hand: [x, y, z] }); // relative to the hand-off eye

/**
 * The shots. keys: [u, position, target, fov, roll?] with u in 0..1 of the shot (eased: smootherstep over the whole shot, then a
 * Catmull-Rom through the keys). `cut`: the shot starts on a cut (on a cue, or through black); otherwise it continues the last.
 * `look` instead of a target: [yaw, pitch] (the waking: the spawn's own look).
 */
export const SHOTS = Object.freeze([
  S('ember', 'EMBER', 0, 9, [
    [0, L(0.34, 0.06, 1.08), L(0, 0.02, 0), 26],
    [1, L(0.16, 0.05, 0.86), L(0, 0.03, 0), 24],
  ]),
  S('kept', 'THE LIGHT WE KEPT', 9, 17.5, [
    [0, L(1.1, 0.05, 1.25), L(0, 0.05, 0), 36],
    [0.55, L(0.45, 0.15, 1.6), L(0, 0.22, 0), 36],
    [1, L(-0.6, 0.25, 1.6), L(0, 0.36, 0), 34],
  ], { cut: true }),
  S('lowering', 'THE LOWERING', 17.5, 28, [
    [0, L(2.6, 5.0, 3.4), L(0, -0.6, 0), 50],
    [1, L(1.8, 3.6, 2.6), L(0, -1.0, 0), 44],
  ], { cut: true }),
  S('window', 'THE WINDOW', 28, 38, [
    [0, L(-3.4, 0.8, 2.5), L(4.4, 0.2, -2.6), 40],
    [1, L(-3.7, 0.35, -0.7), L(4.6, 0.7, -0.4), 38],
  ], { cut: true }),
  S('threshold', 'THE THRESHOLD', 38, 42, [
    [0, A(-3.4, 0.4, 2.3), A(-4.2, 6.0, 10.8), 54],
    [1, A(-3.5, 0.45, 2.8), A(-4.1, 4.4, 10.8), 50],
  ], { cut: true }),
  S('door', 'THE DOOR', 42, 48, [
    [0, A(-4.6, 2.5, 0.6), A(-4.0, 3.6, 10.8), 48],
    [1, A(-4.4, 2.45, 2.2), A(-4.0, 2.9, 10.8), 36],
  ], { cut: true }),
  S('knock', 'THE KNOCK', 48, 56.5, [
    [0, L(1.3, 0.3, 1.5), L(0, 0.02, 0), 30],
    [1, L(0.42, 0.08, 0.62), L(0, 0.0, 0), 23],
  ], { cut: true }),
  S('well', 'BEFORE THE LAMP', 56.5, 66, [
    [0, A(-5.9, 3.95, 7.5), A(5.6, -9.5, -1.0), 42, 0.03],
    [1, A(-5.2, 3.7, 6.7), A(6.4, -5.5, -1.2), 40, 0.045],
  ], { cut: true }),
  S('title', 'THE LANTERN', 66, WAKE_AT, [
    [0, A(-5.2, 3.7, 6.7), A(6.4, -5.5, -1.2), 40, 0],
    [1, A(-5.2, 3.7, 6.7), A(6.4, -5.5, -1.2), 40, 0],
  ], { cut: true }),
  S('waking', 'THE WAKING', WAKE_AT, DURATION, [
    [0, HO(0, 0, 0), null, 70, 0, -0.42],
    [0.45, HO(0, 0, 0), null, 70, 0, -0.42],
    [0.88, HO(0, 0, 0), null, 70, 0, 0],
    [1, HO(0, 0, 0), null, 70, 0, 0],
  ], { cut: true, look: true, linear: true }),
]);

/**
 * The cue sheet: [t, name]. audio/openingSfx.js has one designed sound per name (the score, the foley, the creature); every cut
 * that is not through black sits on one. Times are exact: the same film sounds the same every time.
 */
export const CUES = Object.freeze([
  [0.0, 'roomTone'],
  [0.4, 'flameIn'],
  [4.0, 'motif1'],
  [9.0, 'swell'],
  [15.2, 'gutter'],
  [17.5, 'winch'],
  [28.0, 'motif2'],
  [38.0, 'chainSlow'],
  [LANTERN_STOP_AT, 'chainStop'],
  [42.0, 'creak'],
  [48.0, 'musicOut'],
  [49.2, 'knock'],
  [50.0, 'knock'],
  [50.8, 'knock'],
  [50.9, 'lean'],
  [51.4, 'heartbeat'],
  [56.5, 'grind'],
  [59.2, 'eyes'],
  [60.2, 'breath'],
  [61.8, 'riser'],
  [64.0, 'tear'],
  [64.15, 'lunge'],
  [LANTERN_OUT_AT, 'snuff'],
  [66.55, 'preHit'],
  [TITLE_AT, 'titleHit'],
  [73.6, 'titleOut'],
  [77.4, 'lampFlare'],
  [77.9, 'breathIn'],
  [78.6, 'lanternCatch'],
  [80.2, 'cloth'],
  [80.8, 'heart2'],
  [DURATION, 'end'],
]);

/** The narration (Kokoro clips in assets/audio/opening/<id>.ogg): the start time and the slot it must fit (its caption's span). */
export const VO = Object.freeze([
  { id: 'op-1', at: 2.6, slot: 6.4, speaker: 'MAREN', text: 'Seventeen ninety-one. One woman climbed out of this shaft, carrying a flame.' },
  { id: 'op-2', at: 9.6, slot: 5.6, speaker: 'MAREN', text: 'It burned nothing. It never went out. Every lamp we have was lit from hers.' },
  { id: 'op-3', at: 15.5, slot: 2.4, speaker: 'ODESSA', text: 'It is dimming.' },
  { id: 'op-4', at: 18.6, slot: 6.4, speaker: 'ODESSA', text: 'Five hundred and fifty-six metres of cut stone. Every probe we lowered went quiet at the bottom.' },
  { id: 'op-5', at: 25.4, slot: 2.6, speaker: 'ODESSA', text: 'So we are lowering a person.' },
  { id: 'op-6', at: 41.0, slot: 3.0, speaker: 'MAREN', text: 'They carved one rule over the door.' },
  { id: 'op-7', at: 44.2, slot: 4.4, speaker: 'MAREN', text: 'Trust the ring, not the floor. The floor keeps.' },
  { id: 'op-8', at: 51.9, slot: 5.0, speaker: 'MAREN', text: 'The record says something was down here before the lamp.' },
  { id: 'op-9', at: 57.3, slot: 4.8, speaker: 'MAREN', text: 'Before the first stone was cut. Something we never prepared for.' },
  { id: 'op-10', at: 62.2, slot: 1.8, speaker: 'MAREN', text: 'We confronted it, but', cut: true },
]);

/** The title card. */
export const TITLE = Object.freeze({ text: 'THE LANTERN', sub: 'I · THE UNDERSPIRE' });

/** A headset: two static vantages, changed only behind black (VR_CUT). Before it, the head floats in the dark facing the lantern. */
export const VR_CUT = 17.6;
const VR_DIP = [17.0, 18.2];
const VR_TOP = { dx: 0, dy: -0.05, dz: 0.9 }; // the head relative to the lantern at the top: 0.9 m behind it (the rig faces -Z)

// ---- maths (no allocation in sample()) --------------------------------------------------------------------------------------
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a, b, k) => a + (b - a) * k;
/** smootherstep: zero velocity and acceleration at both ends (no robot moves). */
export function ease(u) {
  u = clamp01(u);
  return u * u * u * (u * (u * 6 - 15) + 10);
}
const smooth = (a, b, v) => {
  const u = clamp01((v - a) / (b - a || 1));
  return u * u * (3 - 2 * u);
};
/** 1 inside [a, b] with smooth ramps of `r` s outside them. */
const span = (t, a, b, rin, rout) => (t < a - rin || t > b + rout ? 0 : t < a ? smooth(a - rin, a, t) : t > b ? 1 - smooth(b, b + rout, t) : 1);

/** Monotone cubic (Fritsch-Carlson) through [t, v] keys: smooth, and never overshoots a key (a lantern does not bounce up). */
function monotone(keys) {
  const n = keys.length;
  const xs = keys.map((k) => k[0]);
  const ys = keys.map((k) => k[1]);
  const d = [];
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  const m = new Array(n).fill(0);
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const k = 3 / Math.sqrt(s);
      m[i] = k * a * d[i];
      m[i + 1] = k * b * d[i];
    }
  }
  return (t) => {
    if (t <= xs[0]) return ys[0];
    if (t >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (t > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i];
    const u = (t - xs[i]) / h;
    const u2 = u * u;
    const u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * ys[i] + (u3 - 2 * u2 + u) * h * m[i] + (-2 * u3 + 3 * u2) * ys[i + 1] + (u3 - u2) * h * m[i + 1];
  };
}
const lanternY = monotone(LANTERN_Y_KEYS);

/** Catmull-Rom of four scalars at u in 0..1 between b and c. */
function cr(a, b, c, d, u) {
  const u2 = u * u;
  const u3 = u2 * u;
  return 0.5 * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u2 + (-a + 3 * b - 3 * c + d) * u3);
}

// ---- the snapshot --------------------------------------------------------------------------------------------------------------
export function newOpeningSnapshot() {
  return {
    t: 0,
    shot: 0,
    cam: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, fov: 70 },
    vr: { x: 0, y: 0, z: 0, cut: false },
    fade: 1,
    bars: 0,
    dark: 1,
    lantern: { on: 1, x: LANTERN_X, y: 50, z: LANTERN_Z, swayX: 0, swayZ: 0, light: 1, flame: 1, lean: 0, leanX: 1, leanZ: 0, scale: 2.6, range: 6.5 },
    chainTop: 62,
    mason: { on: false, x: 0, y: 0, z: 0, fx: 0, fy: 0, fz: 1, eyes: 0, gape: 0, lunge: 0 },
    player: { hands: 0, lantern: 0 },
    title: { a: 0, glow: 0, sub: 0 },
    caption: { id: '', speaker: '', text: '', a: 0 },
  };
}

const _p = [0, 0, 0];
const _q = [0, 0, 0];
const _a = [0, 0, 0];
const _d = [0, 0, 0];
const _k = [null, null, null, null];

function resolve(ref, lan, ho, out) {
  if (ref.abs) {
    out[0] = ref.abs[0];
    out[1] = ref.abs[1];
    out[2] = ref.abs[2];
  } else if (ref.rel) {
    out[0] = lan.x + ref.rel[0];
    out[1] = lan.y + ref.rel[1];
    out[2] = lan.z + ref.rel[2];
  } else {
    out[0] = ho.x + ref.hand[0];
    out[1] = ho.y + ref.hand[1];
    out[2] = ho.z + ref.hand[2];
  }
  return out;
}

/** Index of the shot playing at t. */
export function shotAt(t) {
  for (let i = SHOTS.length - 1; i >= 0; i--) if (t >= SHOTS[i].t0) return i;
  return 0;
}

/** The hero lantern at t (position, sway, light, flame). */
function sampleLantern(t, o) {
  o.y = lanternY(t);
  // the sway: a slow pendulum (0.21 Hz) that the descent excites; the stop at LANTERN_STOP_AT kicks it and it dies away
  const moving = t > 17.5 && t < LANTERN_STOP_AT ? 1 : 0;
  const kick = t > LANTERN_STOP_AT ? 0.11 * Math.exp(-(t - LANTERN_STOP_AT) * 0.55) : 0;
  const base = 0.012 + 0.028 * moving * smooth(17.5, 20, t);
  const w = 2 * Math.PI * 0.42;
  o.swayX = (base + kick) * Math.sin(w * t + 0.4);
  o.swayZ = (base * 0.6 + kick * 0.35) * Math.sin(w * 0.93 * t + 1.9);
  o.x = LANTERN_X + o.swayX * 0.55;
  o.z = LANTERN_Z + o.swayZ * 0.55;
  o.on = t < LANTERN_OUT_AT ? 1 : 0;
  // the flame: alive (fixed sines, never random), the gutter at 15.2 (it is dimming), leaning toward the well after the third knock
  const live = 1 + 0.06 * Math.sin(t * 9.7) * Math.sin(t * 2.3 + 0.5) + 0.03 * Math.sin(t * 17.9 + 1.1);
  const gut = 1 - 0.58 * span(t, 15.35, 15.75, 0.15, 0.9) - 0.22 * smooth(15.3, 16.6, t);
  const fadeIn = smooth(0.2, 1.6, t);
  const dying = t > 63.6 ? 1 - smooth(63.6, LANTERN_OUT_AT, t) : 1;
  const flare = 1 + 0.35 * span(t, 64.15, 64.3, 0.05, 0.25); // it flares as the thing comes for it, then it is gone
  o.flame = o.on ? live * gut * fadeIn * dying * flare : 0;
  o.light = o.on ? (0.25 + 0.75 * fadeIn) * gut * dying * flare * (0.98 + 0.04 * Math.sin(t * 11.3)) : 0;
  o.lean = 0.52 * smooth(50.85, 51.7, t) + 0.12 * smooth(56.5, 62, t) + 0.05 * Math.sin(t * 3.1) * smooth(51, 52, t);
  const wx = WELL[0] - LANTERN_X;
  const wz = WELL[1] - LANTERN_Z;
  const wl = Math.hypot(wx, wz);
  o.leanX = wx / wl;
  o.leanZ = wz / wl;
  o.scale = 2.6;
  // how far its light reaches (m): close on the lantern the far walls stay black; the descent lights the shaft; the Threshold between
  o.range = t < 17.5 ? 6.5 : t < 40 ? 19 : 11;
}

/**
 * Fills `out` (newOpeningSnapshot()) with the film at t.
 * @param {number} t seconds
 * @param {{xr?: boolean, handoff?: {x,y,z,yaw}, skipped?: number}} [opts]  skipped = seconds since a skip landed (fade lift), or -1
 */
export function sampleOpening(t, opts, out) {
  const o = out || newOpeningSnapshot();
  const xr = !!(opts && opts.xr);
  const ho = (opts && opts.handoff) || DEFAULT_HANDOFF;
  t = t < 0 ? 0 : t > DURATION ? DURATION : t;
  o.t = t;
  const si = shotAt(t);
  o.shot = si;
  const lan = o.lantern;
  sampleLantern(t, lan);
  o.chainTop = Math.min(62, lan.y + 40);

  // ---- the camera (desktop) ----
  const sh = SHOTS[si];
  const keys = sh.keys;
  const u = clamp01((t - sh.t0) / (sh.t1 - sh.t0));
  const e = sh.linear ? u : ease(u);
  let seg = 0;
  while (seg < keys.length - 2 && e > keys[seg + 1][0]) seg++;
  const k0 = keys[seg];
  const k1 = keys[seg + 1];
  const su = clamp01((e - k0[0]) / (k1[0] - k0[0] || 1));
  const v = sh.linear ? ease(su) : su;
  _k[0] = keys[Math.max(0, seg - 1)];
  _k[1] = k0;
  _k[2] = k1;
  _k[3] = keys[Math.min(keys.length - 1, seg + 2)];
  const c = o.cam;
  // position: Catmull-Rom through the keys (each resolved against the lantern / hand-off at this t)
  let px = 0;
  let py = 0;
  let pz = 0;
  {
    const a = resolve(_k[0][1], lan, ho, _a);
    const b = resolve(_k[1][1], lan, ho, _p);
    const cc = resolve(_k[2][1], lan, ho, _q);
    const d = resolve(_k[3][1], lan, ho, _d);
    px = cr(a[0], b[0], cc[0], d[0], v);
    py = cr(a[1], b[1], cc[1], d[1], v);
    pz = cr(a[2], b[2], cc[2], d[2], v);
  }
  c.x = px;
  c.y = py;
  c.z = pz;
  c.fov = mix(k0[3], k1[3], v);
  c.roll = mix(k0[4] || 0, k1[4] || 0, v);
  if (sh.look) {
    c.yaw = ho.yaw || 0;
    c.pitch = mix(k0[5] || 0, k1[5] || 0, v);
  } else {
    const a = resolve(k0[2], lan, ho, _p);
    const b = resolve(k1[2], lan, ho, _q);
    const tx = mix(a[0], b[0], v) - px;
    const ty = mix(a[1], b[1], v) - py;
    const tz = mix(a[2], b[2], v) - pz;
    c.yaw = Math.atan2(-tx, -tz);
    c.pitch = Math.atan2(ty, Math.hypot(tx, tz));
  }

  // ---- the headset: two static vantages, the cut behind black ----
  const vr = o.vr;
  if (t < VR_CUT) {
    vr.x = LANTERN_X + VR_TOP.dx;
    vr.y = lanternY(0) + VR_TOP.dy;
    vr.z = LANTERN_Z + VR_TOP.dz;
  } else {
    vr.x = ho.x;
    vr.y = ho.y;
    vr.z = ho.z;
  }

  // ---- the frame ----
  let fade = 1 - smooth(0.4, 3.6, t); // up from black
  if (t >= LANTERN_OUT_AT + 0.04) fade = 1; // the lantern is out: black
  if (t >= WAKE_AT) fade = 1 - smooth(78.0, 82.5, t); // the waking: the black lifts
  if (xr) fade = Math.max(fade, span(t, VR_DIP[0] + 0.45, VR_DIP[1] - 0.45, 0.45, 0.45)); // the vantage change, behind black
  const sk = opts && typeof opts.skipped === 'number' && opts.skipped >= 0 ? opts.skipped : -1;
  if (sk >= 0) fade = Math.max(fade, 1 - smooth(0, SKIP_LIFT, sk));
  o.fade = fade;
  o.bars = xr ? 0 : 1 - smooth(WAKE_AT + 1.5, 80.5, t);

  // the world: held dark so the lantern is the key; the window shot lets the cold in; the waking gives it all back
  let dark = 0.965;
  dark -= 0.04 * smooth(17.5, 22, t); // the lowering: a little of the shaft
  dark -= 0.3 * span(t, 29.5, 34.5, 2.2, 2.6); // THE WINDOW: the cold, the god rays
  dark -= 0.1 * span(t, 41.6, 47.6, 0.6, 0.4); // the door: its lamp, a little
  dark += 0.04 * smooth(48, 50, t); // the knock: down again
  if (t >= LANTERN_OUT_AT) dark = 1;
  if (t >= WAKE_AT) dark = 1 - 0.55 * smooth(77.3, 77.9, t) - 0.45 * smooth(78.6, 82.6, t); // the lamp flares, then the rest
  o.dark = clamp01(dark);

  // ---- the Mason (shot 7) ----
  const m = o.mason;
  m.on = t >= 58.9 && t < LANTERN_OUT_AT + 0.05;
  if (m.on) {
    const rise = ease(clamp01((t - 58.9) / (63.95 - 58.9)));
    const lunge = ease(clamp01((t - 63.95) / (LANTERN_OUT_AT - 63.95)));
    const hx = mix(WELL[0], WELL[0] - 0.6, rise);
    const hy = mix(-17, -9.3, rise); // up to the seal's bars (the grating across the chimney), its eyes between them
    const hz = mix(WELL[1], WELL[1] + 0.2, rise);
    // the lunge: up out of the well and over the lip at the lantern (it stops short of it: the light goes out first)
    const tx = lan.x + 1.3;
    const ty = lan.y - 0.4;
    const tz = lan.z - 1.1;
    m.x = mix(hx, tx, lunge);
    m.y = mix(hy, ty, lunge);
    m.z = mix(hz, tz, lunge);
    let fx = lan.x - m.x;
    let fy = lan.y - m.y;
    let fz = lan.z - m.z;
    // facing: toward the lantern, but never straight up (the rig's frame needs a horizontal heading)
    const fl = Math.hypot(fx, fz) || 1;
    fy = Math.max(-0.6, Math.min(0.6, fy / Math.max(fl, 1e-3) * 0.35));
    fx /= fl;
    fz /= fl;
    const n = Math.hypot(fx, fy, fz) || 1;
    m.fx = fx / n;
    m.fy = fy / n;
    m.fz = fz / n;
    m.eyes = smooth(59.2, 59.75, t) * (0.85 + 0.15 * Math.sin(t * 6.1));
    m.gape = 0.15 + 0.25 * smooth(60.2, 62.5, t) + 0.6 * lunge;
    m.lunge = lunge;
  } else {
    m.eyes = 0;
    m.gape = 0;
    m.lunge = 0;
  }

  // ---- the player (the waking) ----
  const p = o.player;
  p.hands = t >= WAKE_AT ? 1 : 0;
  p.lantern = t < 78.6 ? 0 : Math.min(1, smooth(78.6, 79.0, t) * (1 + 0.28 * span(t, 78.95, 79.05, 0.3, 0.7)));

  // ---- the title ----
  const ti = o.title;
  ti.a = t < TITLE_AT ? 0 : smooth(TITLE_AT, TITLE_AT + 0.12, t) * (1 - smooth(73.6, 75.6, t));
  ti.glow = t < TITLE_AT ? 0 : Math.exp(-(t - TITLE_AT) * 1.4) * (1 - smooth(73.6, 75.0, t));
  ti.sub = smooth(68.6, 69.6, t) * (1 - smooth(73.2, 74.8, t));

  // ---- the caption: the narration being spoken ----
  const cap = o.caption;
  cap.a = 0;
  cap.id = '';
  cap.speaker = '';
  cap.text = '';
  for (let i = 0; i < VO.length; i++) {
    const l = VO[i];
    if (t >= l.at - 0.15 && t <= l.at + l.slot + 0.35) {
      cap.id = l.id;
      cap.speaker = l.speaker;
      cap.text = l.text;
      cap.a = span(t, l.at, l.at + l.slot, 0.15, 0.35);
      if (l.id === 'op-10' && t > 64.0) cap.a = 0; // torn off with the line
    }
  }
  return o;
}

/**
 * The film's clock. update(dt) returns the cues crossed (names) and fills `voStarted` with the VO lines that began; skip() fades to
 * black and jumps to the waking's last seconds; seek(t) holds a frame (tests, stills, the trailer).
 */
export class OpeningCinematic {
  constructor(opts) {
    this.opts = { xr: !!(opts && opts.xr), handoff: (opts && opts.handoff) || DEFAULT_HANDOFF, skipped: -1 };
    this.s = newOpeningSnapshot();
    this.t = 0;
    this.done = false;
    this.skipping = -1; // >= 0: seconds into the skip's fade to black
    this.skippedAt = -1; // the film time the skip landed at (the black lifts from there)
    this._cues = [];
    this.voStarted = [];
    this._noCues = Object.freeze([]);
    sampleOpening(0, this.opts, this.s);
  }

  get active() {
    return !this.done;
  }

  get handoff() {
    return this.opts.handoff;
  }

  setXR(on) {
    this.opts.xr = !!on;
  }

  /** Advance dt seconds; returns the cue names crossed (a reused array). */
  update(dt) {
    const out = this._cues;
    out.length = 0;
    this.voStarted.length = 0;
    if (this.done) return out;
    dt = dt > 0 ? Math.min(dt, 0.1) : 0;
    if (this.skipping >= 0) {
      this.skipping += dt;
      sampleOpening(this.t, this.opts, this.s);
      this.s.fade = Math.max(this.s.fade, smooth(0, SKIP_FADE, this.skipping));
      if (this.skipping >= SKIP_FADE) {
        this.skipping = -1;
        this.t = SKIP_TO;
        this.skippedAt = SKIP_TO;
        out.push('skipLand');
        this.opts.skipped = 0;
        sampleOpening(this.t, this.opts, this.s);
      }
      return out;
    }
    const t0 = this.t;
    const t1 = Math.min(DURATION, t0 + dt);
    this.t = t1;
    for (let i = 0; i < CUES.length; i++) {
      const ct = CUES[i][0];
      if ((ct > t0 || (t0 === 0 && ct === 0 && !this._started)) && ct <= t1) out.push(CUES[i][1]);
    }
    for (let i = 0; i < VO.length; i++) {
      const at = VO[i].at;
      if (at > t0 && at <= t1 && (this.skippedAt < 0 || at > this.skippedAt)) this.voStarted.push(VO[i]);
    }
    this._started = true;
    if (this.skippedAt >= 0) this.opts.skipped = t1 - this.skippedAt;
    sampleOpening(t1, this.opts, this.s);
    if (t1 >= DURATION) this.done = true;
    return out;
  }

  /** Hold the film at t (no cues). */
  seek(t) {
    this.t = Math.max(0, Math.min(DURATION, +t || 0));
    this._started = true;
    sampleOpening(this.t, this.opts, this.s);
    return this.s;
  }

  /** Start the skip (a fade to black, then the end of the waking). False when it is too late to matter or already skipping. */
  skip() {
    if (this.done || this.skipping >= 0 || this.t >= SKIP_TO) return false;
    this.skipping = 0;
    return true;
  }
}
