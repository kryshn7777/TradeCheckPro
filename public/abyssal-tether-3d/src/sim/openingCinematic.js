/* THE LANTERN — sim/openingCinematic.js
 * The opening cinematic as a pure timeline (docs/abyssal-tether-3d/plans/OPENING_V2_THE_COLLAR.md, v2 of OPENING_CINEMATIC.md): no
 * three.js, no DOM, no Math.random, no clock but the one it is stepped with. Everything the film does is a function of t (seconds):
 *
 *   sampleOpening(t, opts, out)  fills a plain snapshot (newOpeningSnapshot()):
 *     cam      {x, y, z, yaw, pitch, roll, fov}  the desktop camera (yaw 0 looks down -Z, + pitch looks up; fov is vertical, deg)
 *     vr       {x, y, z, cut}                     a headset: where the HEAD is put (it rides the cradle, vertically, <= 1 m/s; it
 *                                                 jumps only behind black). The rig is never rotated in a headset (opts.xr).
 *     fade     0..1 black over the view            bars 0..1 the letterbox (desktop)
 *     dark     0..1 how dark the world is held (the level's lamps, ambient and haze; the hero lantern is not affected)
 *     rays     0..1 the level's light shafts       dust {motes, grit} the dust in the lantern's light
 *     lantern  {on, x, y, z, swayX, swayZ, light, flame, lean, leanX, leanZ, scale, range}  the hero lantern on the cradle's rail
 *              (its light is the game's own)
 *     chainTop y of the top of its short chain (the rail hook)
 *     collar   {on}  the station (THE COLLAR) is drawn       iris {open} 0..1 the iris over the shaft
 *     cradle   {on, x, y, z}  the cradle's floor point (the drones carry it down the shaft to Lamp Zero)
 *     drones   [4] {on, x, y, z, rot, led, beam, clamped}  the hoist drones (rot: rotor speed 0..1; led / beam: their lights 0..1)
 *     scan     {a, y}  the measuring line (alpha, world height)       line {on, x, z, y0, y1}  his line, the spool to the winch
 *     mason    {on, x, y, z, fx, fy, fz, eyes, gape, lunge}  the Mason's head (MasonRigView.cine), facing (fx, fy, fz)
 *     player   {hands, lantern}  the player's own hands shown (0 / 1) and the gauntlet lantern's light 0..1 (the waking)
 *     title    {a, glow, sub}  the title card: alpha, the hit's glow, the subtitle's alpha
 *     caption  {id, speaker, text, a}  the line being spoken (subtitles of the narration; a = alpha)
 *     shot     index into SHOTS
 *   OpeningCinematic   steps a clock, reports the CUES crossed (the sound) and the VO lines started, handles the skip.
 *
 * The last frame is the game's spawn view (opts.handoff = the spawn eye position and yaw): the hand-off into play is seamless.
 * Acts I-II (0 .. ACT3) are THE COLLAR: the station, the measure, the iris, the descent, Lamp Zero, the drones' release. Act III
 * (ACT3 ..) is the first film's knock / well / title / waking, every time moved by ACT3 - 48 (A3() below).
 */

export const DURATION = 99.5;
/** A skip: SKIP_FADE s to black (time stops), then the film jumps to SKIP_TO and the black lifts over SKIP_LIFT s. */
export const SKIP_TO = 97.5;
export const SKIP_FADE = 0.3;
export const SKIP_LIFT = 1.2;
/** Presses in the first GRACE s are ignored (the click that began the run). */
export const GRACE = 0.5;
/** Holding the skip input this long skips. */
export const SKIP_HOLD = 1.0;

/** Act III (the knock, the well, the title, the waking) starts here; it is the first film's 48 s on, moved. */
export const ACT3 = 63.5;
const A3 = (t) => ACT3 + (t - 48);

export const TITLE_AT = A3(67.3);
export const LANTERN_OUT_AT = A3(64.6);
export const WAKE_AT = A3(76.0);

/** The S1 spawn the film ends on (level-data-3d.js spawn + the standing eye height; floor = the rig's floor height under it). */
export const DEFAULT_HANDOFF = Object.freeze({ x: -4, y: 2.06, z: 8.5, yaw: 0, floor: 0 });

// ---- THE COLLAR: the choreography's geometry (render/facilityKit.js builds the models; render/openingView.js aligns them to this) ----
/**
 * The station over the shaft (render/facilityKit.js FACILITY, the art owner's numbers, mirrored here: the sim cannot import three.js;
 * tests/ux/opening.mjs checks they agree): the iris over the S1 chimney's mouth (its walls stop at 60) with its top at 60.3, the deck
 * at 60.45, the gantry ring girder (the line's winch) at 69.45, the four drone pads round the descent column (kit PAD_R 21.6, ordered
 * west to east here; a docked drone's centre 0.5 m over the deck), the console (and its empty chair) on the deck facing north.
 */
export const COLLAR = Object.freeze({
  deckY: 60.45,
  restY: 60.3, // the closed iris' top: the cradle's skids rest on it
  iris: Object.freeze({ x: 0, y: 60.3, z: 0 }),
  irisR: 16.0,
  winchY: 69.45,
  pads: Object.freeze([
    Object.freeze([-18.36, 60.45, 11.38]),
    Object.freeze([-12.76, 60.45, 17.43]),
    Object.freeze([-5.3, 60.45, 20.94]),
    Object.freeze([2.93, 60.45, 21.4]),
  ]),
  console: Object.freeze({ x: -1.2, y: 60.45, z: 18.6 }), // on the deck, past the collar ring (r 17.2)
});
/** The cradle's line: it stands on the iris here, goes straight down, and lands on the Threshold 0.5 m in front of the spawn (clear of
 *  the great diagonal girder at y 26 by 2.8 m, of the arch and of the statues). */
export const CRADLE_X = -4;
export const CRADLE_Z = 8.0;
/** The floor plate's thickness: the cradle's floor point sits this far above what it stands on. */
export const CRADLE_PLATE = 0.12;
const Y_REST = COLLAR.restY + CRADLE_PLATE;
const Y_LIFT = Y_REST + 1.0;
export const CRADLE_LAND_Y = CRADLE_PLATE; // the Threshold's top is y 0
/** The descent: 0.9 m/s (a headset rides it: <= 1 m/s), two cuts down the shaft (desktop: on a cue; a headset: inside a black dip). */
export const DESCENT_SPEED = 0.9;
const LIFT = [17.5, 20.0];
export const DESCENT_AT = 24.5;
export const CUT1 = 33.0;
export const CUT2 = 42.0;
export const LAND_AT = 51.0;
const RAMP_IN = 1.5;
const RAMP_OUT = 2.0;
const Y_CUT1 = 30.5;

/** The cradle's floor height at t (monotone after the lift; the two cuts are the only jumps). */
export function cradleY(t) {
  const V = DESCENT_SPEED;
  if (t < LIFT[0]) return Y_REST;
  if (t < DESCENT_AT) return Y_REST + (Y_LIFT - Y_REST) * ease((t - LIFT[0]) / (LIFT[1] - LIFT[0]));
  if (t < CUT1) {
    const s = t - DESCENT_AT;
    return Y_LIFT - (s < RAMP_IN ? (V * s * s) / (2 * RAMP_IN) : V * (s - RAMP_IN / 2));
  }
  if (t < CUT2) return Y_CUT1 - V * (t - CUT1);
  if (t < LAND_AT) {
    const r = LAND_AT - t;
    return CRADLE_LAND_Y + (r < RAMP_OUT ? (V * r * r) / (2 * RAMP_OUT) : V * (r - RAMP_OUT / 2));
  }
  return CRADLE_LAND_Y;
}

/** The hero lantern hangs on the cradle's north (-Z) rail hook: this far up from the floor point, this far forward. */
const LANTERN_UP = 1.45;
const LANTERN_DZ = -0.62;
export const LANTERN_X = CRADLE_X;
export const LANTERN_Z = CRADLE_Z + LANTERN_DZ;
export const LANTERN_REST_Y = CRADLE_LAND_Y + LANTERN_UP;
/** (the first film's name for the moment the lantern comes to rest) */
export const LANTERN_STOP_AT = LAND_AT;
export const LANTERN_SCALE = 1.9;

/** The drones: clamped at the cradle's lift rings (kit: anchorY 2.51, anchorXZ 1.1, the drone's clamp point 0.375 under its centre). */
export const DRONE_UP = 2.885;
export const DRONE_OUT = 1.1;
/** Which corner each pad's drone takes (pads west to east: NW, SW, SE, NE), so no two paths cross. */
export const CORNER = Object.freeze([Object.freeze([-1, -1]), Object.freeze([-1, 1]), Object.freeze([1, 1]), Object.freeze([1, -1])]);
const PAD_LIFT = 0.5; // a docked drone's centre over its pad (kit dockY)
const ARC = Object.freeze([3.2, 2.0, 2.0, 3.2]); // how high each flies over the line to its corner
export const SPIN_AT = 3.0;
const FLY_AT = 8.75; // the first lifts off (each 0.25 s after the last)
const FLY_T = 3.6;
/** The clamps (the cue sheet's `clamp`s): each drone latches on 0.15 s after it arrives. */
export const CLAMPS = Object.freeze([12.5, 12.75, 13.0, 13.25]);
/** The release at Lamp Zero (the cue sheet's `release`s), and when each drone's light dies on the climb home. */
export const RELEASES = Object.freeze([52.0, 52.2, 52.4, 52.6]);
export const LIGHTS_DIE = Object.freeze([54.3, 55.3, 56.2, 57.0]);
export const BEAMS_AT = 23.0;
export const IRIS_AT = 20.5;
const IRIS_T = 4.0;
export const SCAN_AT = 15.4;
const SCAN_T = 2.2;
/** The drones are gone (above the frame, dark) from here. */
const DRONES_GONE = ACT3;

/** A headset: the head rides the cradle until VR_HOME (in the black after the lantern goes out), then it is at the spawn. The two
 *  descent cuts happen inside these black dips. */
export const VR_HOME = 81.0;
export const VR_DIPS = Object.freeze([Object.freeze([CUT1 - 0.6, CUT1 + 0.6]), Object.freeze([CUT2 - 0.6, CUT2 + 0.6])]);

/** The three knocks in the wall (the cue sheet's `knock`s; the grit shakes off at each). */
const KNOCKS = [A3(49.2), A3(50.0), A3(50.8)];

/** The well (east of the lip): the Mason rises out of it in BEFORE THE LAMP. */
const WELL = [7.3, -1.2];

const S = (id, name, t0, t1, keys, extra) => Object.freeze(Object.assign({ id, name, t0, t1, keys }, extra || {}));
const A = (x, y, z) => ({ abs: [x, y, z] });
const L = (x, y, z) => ({ rel: [x, y, z] }); // relative to the hero lantern
const C = (x, y, z) => ({ cra: [x, y, z] }); // relative to the cradle's floor point
const HO = (x, y, z) => ({ hand: [x, y, z] }); // relative to the hand-off eye

/**
 * The shots. keys: [u, position, target, fov, roll?] with u in 0..1 of the shot (eased: smootherstep over the whole shot, then a
 * Catmull-Rom through the keys). `cut`: the shot starts on a cut (on a cue, or through black); otherwise it continues the last.
 * `look` instead of a target: [yaw, pitch] (the waking: the spawn's own look). `track`: the target follows the moving cradle (the
 * shot keeps it framed: its look is not eased to a stop).
 */
export const SHOTS = Object.freeze([
  // ---- ACT I: THE COLLAR ----
  S('collar', 'THE COLLAR', 0, 9, [
    [0, A(9.5, 66.0, -8.8), C(0, 1.2, 0), 40],
    [1, A(7.4, 65.0, -5.6), C(0, 1.3, 0), 36],
  ]),
  S('measure', 'THE MEASURE', 9, 17, [
    [0, C(3.4, 2.6, -3.9), C(0, 1.5, 0), 42],
    [1, C(2.6, 2.2, -3.0), C(0, 1.3, 0), 38],
  ], { cut: true }),
  S('hall', 'THE HALL', 17, 21, [
    [0, A(-0.55, 62.17, 20.35), C(0, 1.55, 0), 34],
    [1, A(-0.7, 62.13, 20.0), C(0, 1.5, 0), 33],
  ], { cut: true, track: true }),
  S('iris', 'THE IRIS', 21, CUT1, [
    [0, A(-1.4, 68.6, 13.4), C(0, 1.0, 0), 46],
    [1, A(-2.0, 66.8, 12.6), C(0, 0.6, 0), 38],
  ], { cut: true, track: true }),
  // ---- ACT II: THE DESCENT ----
  S('window', 'THE WINDOW', CUT1, CUT2, [
    [0, L(-3.4, 0.8, 2.5), L(4.4, 0.2, -2.6), 40],
    [1, L(-3.7, 0.35, -0.7), L(4.6, 0.7, -0.4), 38],
  ], { cut: true }),
  S('lampzero', 'LAMP ZERO', CUT2, 51.5, [
    [0, A(-7.3, 0.5, 4.9), C(0, 2.2, 0), 50],
    [1, A(-7.0, 0.55, 5.4), C(0, 1.5, 0), 44],
  ], { cut: true, track: true }),
  S('release', 'THE RELEASE', 51.5, 57.5, [
    [0, A(-6.4, 0.75, 5.9), A(-4.1, 5.2, 8.3), 52],
    [1, A(-6.2, 0.7, 6.1), A(-3.9, 16.0, 8.2), 50],
  ], { cut: true }),
  S('door', 'THE DOOR', 57.5, ACT3, [
    [0, A(-4.9, 3.7, 2.6), A(-4.0, 2.7, 10.8), 46],
    [1, A(-4.5, 3.3, 4.7), A(-4.0, 2.35, 10.8), 34],
  ], { cut: true }),
  // ---- ACT III: the first film's last four shots, moved ----
  S('knock', 'THE KNOCK', ACT3, A3(56.5), [
    [0, L(1.0, 0.25, 1.15), L(0, 0.02, 0), 30],
    [1, L(0.33, 0.07, 0.48), L(0, 0.0, 0), 23],
  ], { cut: true }),
  S('well', 'BEFORE THE LAMP', A3(56.5), A3(66), [
    [0, A(-5.9, 3.95, 7.5), A(5.6, -9.5, -1.0), 42, 0.03],
    [1, A(-5.2, 3.7, 6.7), A(6.4, -5.5, -1.2), 40, 0.045],
  ], { cut: true }),
  S('title', 'THE LANTERN', A3(66), WAKE_AT, [
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
 * The cue sheet: [t, name]. audio/openingSfx.js has one designed sound per name (the score, the foley, the machines, the creature);
 * every cut that is not through black sits on one. Times are exact: the same film sounds the same every time.
 */
export const CUES = Object.freeze([
  [0.0, 'roomTone'],
  [0.0, 'stationHum'],
  [SPIN_AT, 'droneSpin'],
  [8.6, 'droneFly'],
  [9.0, 'measureIn'],
  [CLAMPS[0], 'clamp'],
  [CLAMPS[1], 'clamp'],
  [CLAMPS[2], 'clamp'],
  [CLAMPS[3], 'clamp'],
  [SCAN_AT, 'scan'],
  [17.0, 'hallIn'],
  [LIFT[0], 'lift'],
  [IRIS_AT, 'iris'],
  [21.0, 'irisIn'],
  [BEAMS_AT, 'beamsOn'],
  [DESCENT_AT, 'descend'],
  [25.0, 'motif1'],
  [CUT1, 'motif2'],
  [CUT2, 'approach'],
  [LAND_AT, 'land'],
  [51.4, 'creak'],
  [51.5, 'releaseIn'],
  [RELEASES[0], 'release'],
  [RELEASES[1], 'release'],
  [RELEASES[2], 'release'],
  [RELEASES[3], 'release'],
  [52.7, 'droneAway'],
  [LIGHTS_DIE[0], 'lightDie'],
  [LIGHTS_DIE[1], 'lightDie'],
  [LIGHTS_DIE[2], 'lightDie'],
  [LIGHTS_DIE[3], 'lightDie'],
  [57.5, 'doorIn'],
  [ACT3, 'musicOut'],
  [KNOCKS[0], 'knock'],
  [KNOCKS[1], 'knock'],
  [KNOCKS[2], 'knock'],
  [A3(50.9), 'lean'],
  [A3(51.4), 'heartbeat'],
  [A3(56.5), 'grind'],
  [A3(59.2), 'eyes'],
  [A3(60.2), 'breath'],
  [A3(61.8), 'riser'],
  [A3(64.0), 'tear'],
  [A3(64.15), 'lunge'],
  [LANTERN_OUT_AT, 'snuff'],
  [A3(66.55), 'preHit'],
  [TITLE_AT, 'titleHit'],
  [A3(73.6), 'titleOut'],
  [A3(77.4), 'lampFlare'],
  [A3(77.9), 'breathIn'],
  [A3(78.6), 'lanternCatch'],
  [A3(80.2), 'cloth'],
  [A3(80.8), 'heart2'],
  [DURATION, 'end'],
]);

/**
 * The narration (Kokoro clips in assets/audio/opening/<id>.ogg): the start time and the slot it must fit (its caption's span).
 * fx 'radio': the team on the uplink (the console speaker's colour); 'close': the record, dry.
 */
export const VO = Object.freeze([
  { id: 'op-11', at: 1.6, slot: 4.6, speaker: 'ODESSA', fx: 'radio', text: "The team's all here, Elias. The Lighters are four hours behind you." },
  { id: 'op-12', at: 6.6, slot: 5.0, speaker: 'ODESSA', fx: 'radio', text: 'Your job is small. Go down to Lamp Zero, clear the ring points, and wait.' },
  { id: 'op-13', at: 13.5, slot: 1.8, speaker: 'TICK', fx: 'radio', text: 'Clamps on. All green.' },
  { id: 'op-14', at: SCAN_AT, slot: 2.2, speaker: 'VESPER', fx: 'radio', text: 'Hold still. Measuring.' },
  { id: 'op-15', at: 17.8, slot: 2.6, speaker: 'TICK', fx: 'radio', text: 'Got you. Head to boots, to the millimetre.' },
  { id: 'op-16', at: 20.8, slot: 4.3, speaker: 'VESPER', fx: 'radio', text: 'Work order confirmed. Payload one. Return zero.' },
  { id: 'op-4', at: 26.0, slot: 6.4, speaker: 'ODESSA', fx: 'close', text: 'Five hundred and fifty-six metres of cut stone. Every probe we lowered went quiet at the bottom.' },
  { id: 'op-5', at: 32.6, slot: 2.6, speaker: 'ODESSA', fx: 'close', text: 'So we are lowering a person.' },
  { id: 'op-1', at: 35.8, slot: 6.4, speaker: 'MAREN', fx: 'close', text: 'Seventeen ninety-one. One woman climbed out of this shaft, carrying a flame.' },
  { id: 'op-17', at: 45.6, slot: 3.6, speaker: 'TICK', fx: 'radio', text: "Five metres. Three. Lamp Zero's right under your boots." },
  { id: 'op-18', at: 52.4, slot: 3.2, speaker: 'TICK', fx: 'radio', text: "That's as deep as they go. Drones heading home." },
  { id: 'op-6', at: 56.2, slot: 3.0, speaker: 'MAREN', fx: 'close', text: 'They carved one rule over the door.' },
  { id: 'op-7', at: 59.7, slot: 4.4, speaker: 'MAREN', fx: 'close', text: 'Trust the ring, not the floor. The floor keeps.' },
  { id: 'op-8', at: A3(51.9), slot: 5.0, speaker: 'MAREN', fx: 'close', text: 'The record says something was down here before the lamp.' },
  { id: 'op-9', at: A3(57.3), slot: 4.8, speaker: 'MAREN', fx: 'close', text: 'Before the first stone was cut. Something we never prepared for.' },
  { id: 'op-10', at: A3(62.2), slot: 1.8, speaker: 'MAREN', fx: 'close', text: 'We confronted it, but', cut: true },
]);
/** The torn line goes with the static at the tear. */
export const TEAR_AT = A3(64.0);

/** The title card. */
export const TITLE = Object.freeze({ text: 'THE LANTERN', sub: 'I · THE UNDERSPIRE' });
/** What the console's screen and the cradle's tag read (render/openingView.js draws them once). The replay's quiet facts. */
export const SCREEN = Object.freeze({ head: 'CRADLE 01', rows: Object.freeze(['LINE 62 M', 'PAYLOAD 1', 'RETURN 0']), tag: 'CRADLE 01 · PAYLOAD 1 · RETURN 0' });

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

/** Catmull-Rom of four scalars at u in 0..1 between b and c. */
function cr(a, b, c, d, u) {
  const u2 = u * u;
  const u3 = u2 * u;
  return 0.5 * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u2 + (-a + 3 * b - 3 * c + d) * u3);
}

// ---- the snapshot --------------------------------------------------------------------------------------------------------------
export function newOpeningSnapshot() {
  const drones = [];
  for (let i = 0; i < 4; i++) drones.push({ on: true, x: 0, y: 0, z: 0, rot: 0, led: 0, beam: 0, clamped: false });
  return {
    t: 0,
    shot: 0,
    cam: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, fov: 70 },
    vr: { x: 0, y: 0, z: 0, cut: false },
    fade: 1,
    bars: 0,
    dark: 1,
    rays: 0,
    dust: { motes: 0, grit: 0 },
    lantern: { on: 1, x: LANTERN_X, y: 50, z: LANTERN_Z, pay: 0, swayX: 0, swayZ: 0, light: 1, flame: 1, lean: 0, leanX: 1, leanZ: 0, scale: LANTERN_SCALE, range: 14 },
    chainTop: 62,
    collar: { on: true },
    iris: { open: 0 },
    cradle: { on: true, x: CRADLE_X, y: Y_REST, z: CRADLE_Z },
    drones,
    scan: { a: 0, y: 0 },
    line: { on: true, x: CRADLE_X, z: CRADLE_Z, y0: 0, y1: COLLAR.winchY },
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

function resolve(ref, lan, cra, ho, out) {
  if (ref.abs) {
    out[0] = ref.abs[0];
    out[1] = ref.abs[1];
    out[2] = ref.abs[2];
  } else if (ref.rel) {
    out[0] = lan.x + ref.rel[0];
    out[1] = lan.y + ref.rel[1];
    out[2] = lan.z + ref.rel[2];
  } else if (ref.cra) {
    out[0] = cra.x + ref.cra[0];
    out[1] = cra.y + ref.cra[1];
    out[2] = cra.z + ref.cra[2];
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

/** The hero lantern at t (on the cradle's rail hook: position, sway, light, flame). */
function sampleLantern(t, o, cy) {
  o.pay = 0; // no chain pays out now: it hangs on a short chain from the rail hook
  // the sway: a slow pendulum (0.42 Hz) that the ride excites; the landing kicks it and it dies away
  const moving = t > LIFT[0] && t < LAND_AT ? 1 : 0;
  const kick = t > LAND_AT ? 0.09 * Math.exp(-(t - LAND_AT) * 0.55) : 0;
  const clampKick = t > CLAMPS[0] && t < LIFT[0] ? 0.02 * Math.exp(-(t - CLAMPS[0]) * 0.8) : 0;
  const base = 0.006 + 0.018 * moving * smooth(LIFT[0], LIFT[0] + 2.5, t);
  const w = 2 * Math.PI * 0.42;
  o.swayX = (base + kick + clampKick) * Math.sin(w * t + 0.4);
  o.swayZ = (base * 0.6 + kick * 0.35 + clampKick) * Math.sin(w * 0.93 * t + 1.9);
  o.x = LANTERN_X + o.swayX * 0.55;
  o.y = cy + LANTERN_UP;
  o.z = LANTERN_Z + o.swayZ * 0.55;
  o.on = t < LANTERN_OUT_AT ? 1 : 0;
  // the flame: alive (fixed sines, never random), leaning toward the well after the third knock
  const live = 1 + 0.06 * Math.sin(t * 9.7) * Math.sin(t * 2.3 + 0.5) + 0.03 * Math.sin(t * 17.9 + 1.1);
  const fadeIn = smooth(0.2, 1.6, t);
  const dying = t > A3(63.6) ? 1 - smooth(A3(63.6), LANTERN_OUT_AT, t) : 1;
  const flare = 1 + 0.35 * span(t, A3(64.15), A3(64.3), 0.05, 0.25); // it flares as the thing comes for it, then it is gone
  o.flame = o.on ? live * fadeIn * dying * flare : 0;
  // the descent: the light swells a little in the open shaft (it must reach the walls 6-7 m off), and settles near the Threshold
  const reach = 1 + 0.45 * span(t, DESCENT_AT + 1.5, CUT2 - 1.5, 2.2, 3.2);
  o.light = o.on ? (0.25 + 0.75 * fadeIn) * dying * flare * reach * (0.98 + 0.04 * Math.sin(t * 11.3)) : 0;
  o.lean = 0.52 * smooth(A3(50.85), A3(51.7), t) + 0.12 * smooth(A3(56.5), A3(62), t) + 0.05 * Math.sin(t * 3.1) * smooth(A3(51), A3(52), t);
  const wx = WELL[0] - LANTERN_X;
  const wz = WELL[1] - LANTERN_Z;
  const wl = Math.hypot(wx, wz);
  o.leanX = wx / wl;
  o.leanZ = wz / wl;
  o.scale = LANTERN_SCALE;
  // how far its light reaches (m): the station round the cradle; the whole shaft on the way down; the Threshold
  o.range = t < IRIS_AT ? 14 : t < CUT2 ? 19 : 11;
}

/** The four drones at t (cy: the cradle's floor height). */
function sampleDrones(t, out, cy) {
  for (let i = 0; i < 4; i++) {
    const d = out[i];
    const cx = CRADLE_X + CORNER[i][0] * DRONE_OUT;
    const cz = CRADLE_Z + CORNER[i][1] * DRONE_OUT;
    const pad = COLLAR.pads[i];
    const f0 = FLY_AT + 0.25 * i;
    const f1 = f0 + FLY_T;
    const rel = RELEASES[i];
    d.on = t < DRONES_GONE;
    d.clamped = t >= CLAMPS[i] && t < rel;
    if (t < f0) {
      d.x = pad[0];
      d.y = pad[1] + PAD_LIFT;
      d.z = pad[2];
    } else if (t < f1) {
      const u = ease((t - f0) / FLY_T);
      const ty = cy + DRONE_UP;
      d.x = mix(pad[0], cx, u);
      d.y = mix(pad[1] + PAD_LIFT, ty, u) + ARC[i] * Math.sin(Math.PI * u);
      d.z = mix(pad[2], cz, u);
    } else if (t < rel + 0.1) {
      d.x = cx;
      d.y = cy + DRONE_UP;
      d.z = cz;
    } else {
      // the climb home: up the shaft, accelerating to 7 m/s, drifting out a little from the line
      const s = t - rel - 0.1;
      const a = 2.2;
      const vmax = 7;
      const sm = vmax / a;
      const up = s < sm ? 0.5 * a * s * s : 0.5 * a * sm * sm + vmax * (s - sm);
      d.x = cx + CORNER[i][0] * 0.16 * s;
      d.y = cy + DRONE_UP + up;
      d.z = cz + CORNER[i][1] * 0.16 * s;
    }
    // the rotors: spun up on the pads, a surge as each lets go
    d.rot = smooth(SPIN_AT + 0.2 * i, SPIN_AT + 3.0 + 0.2 * i, t) * (1 + 0.15 * smooth(rel, rel + 0.5, t));
    // the lights: the status LED on from the spin-up, the down-light beams from BEAMS_AT; each dies on the climb (a failing driver: it
    // stutters three times and goes)
    const die = LIGHTS_DIE[i];
    const st = t > die - 0.35 && t < die + 0.4 ? 0.55 + 0.45 * (Math.sin(t * 43 + i * 1.7) > 0 ? 1 : -1) : 1;
    const alive = (1 - smooth(die, die + 0.4, t)) * st;
    d.led = (0.3 + 0.7 * smooth(SPIN_AT, SPIN_AT + 1, t)) * alive;
    d.beam = smooth(BEAMS_AT + 0.15 * i, BEAMS_AT + 0.4 + 0.15 * i, t) * alive;
  }
}

/**
 * Fills `out` (newOpeningSnapshot()) with the film at t.
 * @param {number} t seconds
 * @param {{xr?: boolean, handoff?: {x,y,z,yaw,floor?}, skipped?: number}} [opts]  skipped = seconds since a skip landed (fade lift), or -1
 */
export function sampleOpening(t, opts, out) {
  const o = out || newOpeningSnapshot();
  const xr = !!(opts && opts.xr);
  const ho = (opts && opts.handoff) || DEFAULT_HANDOFF;
  t = t < 0 ? 0 : t > DURATION ? DURATION : t;
  o.t = t;
  const si = shotAt(t);
  o.shot = si;
  const cy = cradleY(t);
  const cra = o.cradle;
  cra.on = t < WAKE_AT;
  cra.x = CRADLE_X;
  cra.y = cy;
  cra.z = CRADLE_Z;
  const lan = o.lantern;
  sampleLantern(t, lan, cy);
  o.chainTop = lan.y + 0.43; // the rail hook
  sampleDrones(t, o.drones, cy);
  o.collar.on = t < CUT2;
  o.iris.open = ease((t - IRIS_AT) / IRIS_T);
  const sc = o.scan;
  sc.a = span(t, SCAN_AT, SCAN_AT + SCAN_T, 0.15, 0.25);
  sc.y = cy + 2.6 - 2.6 * smooth(SCAN_AT, SCAN_AT + SCAN_T, t);
  const li = o.line;
  li.on = t < WAKE_AT;
  li.x = CRADLE_X;
  li.z = CRADLE_Z + 0.62; // the spool on the south rail
  li.y0 = cy + 1.15;
  li.y1 = COLLAR.winchY;

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
  // position: Catmull-Rom through the keys (each resolved against the lantern / the cradle / the hand-off at this t)
  let px = 0;
  let py = 0;
  let pz = 0;
  {
    const a = resolve(_k[0][1], lan, cra, ho, _a);
    const b = resolve(_k[1][1], lan, cra, ho, _p);
    const cc = resolve(_k[2][1], lan, cra, ho, _q);
    const d = resolve(_k[3][1], lan, cra, ho, _d);
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
    const a = resolve(k0[2], lan, cra, ho, _p);
    const b = resolve(k1[2], lan, cra, ho, _q);
    const tx = mix(a[0], b[0], v) - px;
    const ty = mix(a[1], b[1], v) - py;
    const tz = mix(a[2], b[2], v) - pz;
    c.yaw = Math.atan2(-tx, -tz);
    c.pitch = Math.atan2(ty, Math.hypot(tx, tz));
  }

  // ---- the headset: the head rides the cradle (vertical, <= 1 m/s), the two cuts and the move home behind black ----
  const vr = o.vr;
  if (t < VR_HOME) {
    const eye = ho.y - (typeof ho.floor === 'number' ? ho.floor : 0);
    vr.x = CRADLE_X;
    vr.y = cy + eye;
    vr.z = CRADLE_Z;
  } else {
    vr.x = ho.x;
    vr.y = ho.y;
    vr.z = ho.z;
  }

  // ---- the frame ----
  let fade = 1 - smooth(0.4, 3.6, t); // up from black
  if (t >= LANTERN_OUT_AT + 0.04) fade = 1; // the lantern is out: black
  if (t >= WAKE_AT) fade = 1 - smooth(A3(78.0), A3(82.5), t); // the waking: the black lifts
  if (xr) for (let i = 0; i < VR_DIPS.length; i++) fade = Math.max(fade, span(t, VR_DIPS[i][0] + 0.45, VR_DIPS[i][1] - 0.45, 0.45, 0.45)); // the descent's cuts, behind black
  const sk = opts && typeof opts.skipped === 'number' && opts.skipped >= 0 ? opts.skipped : -1;
  if (sk >= 0) fade = Math.max(fade, 1 - smooth(0, SKIP_LIFT, sk));
  o.fade = fade;
  o.bars = xr ? 0 : 1 - smooth(WAKE_AT + 1.5, A3(80.5), t);

  // the world: the station lit by its own LEDs (the fill held at half); held dark once the iris opens on the shaft, so the lantern is
  // the key; the window lets the cold in; the door's lamp a little; the waking gives it all back
  let dark = 0.5;
  dark += 0.43 * smooth(IRIS_AT, IRIS_AT + 3.5, t); // the iris opens: the shaft is black
  dark -= 0.2 * span(t, CUT1 + 1.5, CUT1 + 6.5, 2.2, 2.6); // THE WINDOW: the cold, the god rays (held: the dark grade clips the haze to white past this)
  dark -= 0.1 * span(t, 57.1, 63.1, 0.6, 0.4); // the door: its lamp, a little
  dark += 0.04 * smooth(ACT3, ACT3 + 2, t); // the knock: down again
  if (t >= LANTERN_OUT_AT) dark = 1;
  if (t >= WAKE_AT) dark = 1 - 0.55 * smooth(A3(77.3), A3(77.9), t) - 0.45 * smooth(A3(78.6), A3(82.6), t); // the lamp flares, then the rest
  o.dark = clamp01(dark);

  // the level's light shafts and window beams (render/godRays.js, scaled by the game): none at the station and down the shaft (from
  // above a beam is a pale blot, and the lantern must be the only light), the cold pours in at THE WINDOW, a little on the Threshold,
  // and the waking gives them back in full by the hand-off
  let rays = 0.3 * span(t, CUT1 + 2.0, CUT1 + 7.0, 2.0, 3.5) + 0.3 * span(t, CUT2 + 1.0, ACT3 - 0.5, 1.0, 1.0) + 0.14 * span(t, A3(48.5), A3(63.8), 1.0, 0.8);
  if (t >= LANTERN_OUT_AT) rays = 0;
  if (t >= WAKE_AT) rays = smooth(A3(78.4), A3(82.6), t);
  o.rays = clamp01(rays);
  // the dust in the lantern's light (render/openingView.js): motes hang round it whenever it burns; grit falls past it on the way down
  // (the shaft's own, stirred by the rotors' wash), puffs off the ledge at the landing and shakes off the wall at each knock
  const du = o.dust;
  du.motes = lan.on ? smooth(0.6, 3.2, t) * (t > A3(63.6) ? 1 - smooth(A3(63.6), LANTERN_OUT_AT, t) : 1) : 0;
  let grit = 0.85 * span(t, DESCENT_AT + 0.8, LAND_AT - 0.5, 0.9, 1.2);
  grit += 0.8 * (t > LAND_AT ? Math.exp(-(t - LAND_AT) * 1.1) : 0);
  for (let i = 0; i < KNOCKS.length; i++) if (t > KNOCKS[i]) grit += 0.45 * Math.exp(-(t - KNOCKS[i]) * 1.6);
  du.grit = lan.on ? clamp01(grit) : 0;

  // ---- the Mason (BEFORE THE LAMP) ----
  const m = o.mason;
  const mOn = A3(58.9);
  const mLunge = A3(63.95);
  m.on = t >= mOn && t < LANTERN_OUT_AT + 0.05;
  if (m.on) {
    const rise = ease(clamp01((t - mOn) / (mLunge - mOn)));
    const lunge = ease(clamp01((t - mLunge) / (LANTERN_OUT_AT - mLunge)));
    const hx = mix(WELL[0], WELL[0] - 0.6, rise);
    const hy = mix(-17, -9.3, rise); // up to the seal's bars (the grating across the chimney), its eyes between them
    const hz = mix(WELL[1], WELL[1] + 0.2, rise);
    // the lunge: up out of the well and over the lip at the lantern (it stops short of it: the light goes out first). A headset stands
    // 0.6 m behind the lantern, so its lunge stops a metre farther off.
    const tx = lan.x + (xr ? 2.3 : 1.3);
    const ty = lan.y - (xr ? 0.6 : 0.4);
    const tz = lan.z - (xr ? 2.1 : 1.1);
    m.x = mix(hx, tx, lunge);
    m.y = mix(hy, ty, lunge);
    m.z = mix(hz, tz, lunge);
    let fx = lan.x - m.x;
    let fy = lan.y - m.y;
    let fz = lan.z - m.z;
    // facing: toward the lantern, but never straight up (the rig's frame needs a horizontal heading)
    const fl = Math.hypot(fx, fz) || 1;
    fy = Math.max(-0.6, Math.min(0.6, (fy / Math.max(fl, 1e-3)) * 0.35));
    fx /= fl;
    fz /= fl;
    const n = Math.hypot(fx, fy, fz) || 1;
    m.fx = fx / n;
    m.fy = fy / n;
    m.fz = fz / n;
    m.eyes = smooth(A3(59.2), A3(59.75), t) * (0.85 + 0.15 * Math.sin(t * 6.1));
    m.gape = 0.15 + 0.25 * smooth(A3(60.2), A3(62.5), t) + 0.6 * lunge;
    m.lunge = lunge;
  } else {
    m.eyes = 0;
    m.gape = 0;
    m.lunge = 0;
  }

  // ---- the player (the waking) ----
  const p = o.player;
  p.hands = t >= WAKE_AT ? 1 : 0;
  p.lantern = t < A3(78.6) ? 0 : Math.min(1, smooth(A3(78.6), A3(79.0), t) * (1 + 0.28 * span(t, A3(78.95), A3(79.05), 0.3, 0.7)));

  // ---- the title ----
  const ti = o.title;
  ti.a = t < TITLE_AT ? 0 : smooth(TITLE_AT, TITLE_AT + 0.12, t) * (1 - smooth(A3(73.6), A3(75.6), t));
  ti.glow = t < TITLE_AT ? 0 : Math.exp(-(t - TITLE_AT) * 1.4) * (1 - smooth(A3(73.6), A3(75.0), t));
  ti.sub = smooth(A3(68.6), A3(69.6), t) * (1 - smooth(A3(73.2), A3(74.8), t));

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
      if (l.cut && t > TEAR_AT) cap.a = 0; // torn off with the line
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
