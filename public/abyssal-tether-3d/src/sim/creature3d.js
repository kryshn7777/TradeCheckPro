/* ABYSSAL TETHER 3D — creature3d.js
 * Creature3D — "the Mason": a colossal organism fused with the shaft's
 * masonry, a column of stone-and-iron blocks hauled along the WALLS by hooked
 * lattice-girder limbs, led by a blunt crown of pale sensory fronds.
 *
 * Port of the 2D creature (public/abyssal-tether/js/creature.js) to metres and
 * full 3D (+Y up, the descent goes toward -Y):
 *   1. Behaviour — the same state machine (DORMANT, DISTANT, OBSERVING,
 *      APPROACHING, PURSUING, BURST, ATTACK, RECOVERING) driven by the section's
 *      `creature` config and a stamina budget, so pressure arrives in waves.
 *      It hunts by sound: go still and it stops to listen (pits glowing), then
 *      creeps in; move while it listens and it hears you. It stalks at a
 *      "menace" distance, lunges with a telegraphed wind-up (near misses when you
 *      get away) and — new for VR — grows bolder the longer you STALL in place
 *      (hanging, swaying, looking around): stall ~15 s on Normal, ~10 s on
 *      Nightmare, ~6 s on Abyss and it commits.
 *   2. Surface-following crawl — the head clings to the nearest structural
 *      surface (shaft walls, pillars, large masonry) at a hug height, its
 *      velocity projected onto the wall's tangent plane, so it creeps down and
 *      around the shaft; within reach of the player it swings OFF the wall at
 *      them. A breadcrumb trail of head positions + surface normals lets the
 *      20-segment body follow exactly where the head went (and retract along it
 *      when the head backs off). Ten independent limbs plant hooks on nearby
 *      solids and step when over-stretched (`creature:step` for audio).
 *      Masonry in the way (a gallery floor, a buttress) is crawled around via
 *      its nearest rim; a target straight out from the surface (the underside
 *      of a pillar) makes it let go; a stuck guard frees it, or — only when the
 *      player is > 28 m away — relocates it out of sight (gaps under ~3.5 m
 *      between big slabs are too tight for its girth).
 *   3. Output for the renderer/audio: `body` (spine, surface normals, limbs,
 *      crown state) and `audio`.
 *
 * DOM-free, three.js-free, allocation-free per frame (preallocated typed arrays
 * and scratch objects), deterministic with a seed — runs in Node for tuning.
 *
 * CONTRACT §4 plus documented additions (all optional for consumers):
 *   body.scale    Float32Array(SEG) taper per spine point (1 = shoulders)
 *   body.head     {x,y,z, fx,fy,fz, ux,uy,uz} crown origin (reared back during
 *                 the wind-up), facing and dorsal up
 *   body.focus    {x,y,z, amount}  where the fronds point (the player) and how hard
 *   body.limbs[i] also carries seg, side, reach, lift (0..1 while stepping), weight
 *   body.visible  false while it is far away (dormant) — the view hides it
 *   body.jitter   0..1 plate jitter (BURST / ATTACK), body.listen 0..1 listen pulse
 *   stats         {bursts, attacks, hits, nearMisses, retreats, listens, stallLunges, relocations}
 *   stallTime     seconds the player has been stalling (not progressing)
 *   burstReason   'heard' | 'stall' | 'commit' | 'surge' | 'gate' | attack cause
 *   creature:burst  payload also has {z, commit, reason}; creature:attack has {z, windup, distance, cause}
 *   creature:strike {x,y,z, hit, distance, cause, reason} when a lunge lands / misses
 *   All event payloads carry world z as well as x, y.
 * Section data: creature.spawnOffsetY is read as metres ABOVE the player
 * (sign-agnostic), clamped to 28–80 m (beyond ~70 m the out-of-sight rubber
 * band closes the gap at catch-up speed anyway). Sighting trigger data:
 * {x,y,z} path centre, {dx,dy,dz} or dir ±1 path direction, span (m), duration (s).
 */

import { U } from './config3d.js';

const TAU = Math.PI * 2;
const FAR = 99999;

/** Spine points head → tail (head crown, 18 masonry blocks, tail). */
export const SEG = 20;

export const CREATURE_STATES = Object.freeze({
  DORMANT: 'DORMANT',
  DISTANT: 'DISTANT',
  OBSERVING: 'OBSERVING',
  APPROACHING: 'APPROACHING',
  PURSUING: 'PURSUING',
  BURST: 'BURST',
  ATTACK: 'ATTACK',
  RECOVERING: 'RECOVERING',
});
const S = CREATURE_STATES;

// -----------------------------------------------------------------------------
// Tuning (metres, seconds). Speeds are Normal baselines scaled at runtime by
// diff.creature.speed × mode profile × section.speedMul. Tuned against HUMAN VR
// pacing with the Node pursuit sim (see the creature agent report).
// -----------------------------------------------------------------------------
export const CREATURE_TUNING = {
  segments: SEG,
  spacing: 1.5, // link length at the shoulders (m); tapers toward the tail with `taper`
  taperTail: 0.45, // scale lost from shoulders to tail
  hug: 1.45, // head height above the wall surface while crawling
  minClear: 1.0, // the head never gets closer than this to any solid surface
  surfaceSearch: 10, // how far (m) the head looks for a structural surface to cling to
  adhesionRate: 5, // 1/s pull back to the hug height
  normalRate: 5, // 1/s smoothing of the clinging surface normal
  structuralSize: 6, // any solid this large (m) in two directions counts as crawlable masonry
  trailStep: 0.3, // breadcrumb spacing (m)
  weave: 0.32, // sideways weave while crawling (fraction of speed) → a sinuous trail
  weaveLength: 22, // weave wavelength along the path (m)
  arch: 0.65, // the body arches off the wall mid-length (m)
  bodyReach: 4.5, // m: how far a block looks for the wall it lies on
  bodyRate: 9, // 1/s: how fast a block's height settles to the wall
  bodyMaxFix: 0.7, // m: the most a block is moved by the wall fit
  bodyClear: 0.55, // m x scale: the radius of a block that no solid may enter
  bodyPushRate: 11, // 1/s: how fast the push out of a solid is applied (eased)
  // The body's axes are locked: each link may turn at most bodyTurn rad/s (head end) .. bodyTurnTail (tail end) against the last frame, and each
  // block's up at bodyUpTurn, so a head that dithers round a player standing close never whips the body about.
  bodyTurn: 3.4,
  bodyTurnTail: 2.0,
  bodyUpTurn: 3.0,
  trailCap: 360, // breadcrumbs kept (≈ 108 m ≥ 4× the body)
  speed: { recover: 6.5, observe: 1.1 },
  steerRate: 3.2, // 1/s — velocity eases toward the desired velocity (no instant turns)
  burstSteerRate: 6.5,
  catchUpStart: 38, // vertical gap (m) beyond which it is surely out of sight → closes faster
  catchUpGain: 1.1, // extra m/s per metre of gap beyond catchUpStart
  catchUpMax: 30,
  introTime: 10, // first entry into the hunt: this long without catch-up, approaching slower —
  introSpeed: 0.6, // heard (scraping, steps far overhead) well before it is seen
  maxModeSpeed: 1.1, // cap on mode profile × section speedMul
  pursueRange: 38, // APPROACHING → PURSUING
  loseRange: 56, // PURSUING → APPROACHING
  swingNear: 8, // distance below which the head fully leaves the wall for the player
  swingFar: 21,
  burstMax: 60, // surges never start farther than this
  burstDurMin: 0.9,
  burstDurMax: 1.3,
  engageMul: 2.5, // attack wind-up starts inside killRadius × this
  strikeMul: 1.6, // the lunge connects only if the player is within killRadius × this
  windup: 0.75, // max telegraph (s); per-difficulty values live in DIFF_TUNE
  windupMin: 0.35,
  strikeTime: 0.16,
  postStrike: 0.45,
  rear: 1.3, // crown rears back this far during the wind-up (m)
  drainBurst: 0.24,
  drainBurstEntry: 0.1,
  drainLunge: 0.18,
  regenObserve: 0.08,
  recoverTo: 0.62,
  observeMin: 0.8,
  observeMax: 1.6,
  listenCooldown: 2.5,
  stillSpeed: 1.0, // player speed (m/s) below which they count as "still" (silent)
  stillDebounce: 0.35,
  moveSpeed: 2.4, // player speed that counts as "making noise" while it listens
  stallRadius: 4.5, // staying within this radius = not progressing (stalling)
  stallStart: 3.5, // stall time (s) before it starts to press closer
  graceRespawn: 3.5,
  graceSection: 2.5,
  stepInterval: 0.055, // creature:step rate limit (s)
  sightingDuration: 8.5,
  spawnAboveMin: 28,
  spawnAboveMax: 80,
  farBelowMin: 85,
  farBelowMax: 135,
  // Annoyed: a grapple shot whose aim line passes through its body (not the small variants). It is angry for `dur` seconds at
  // `mul` x its speed, the first `burstDur` seconds at `burstMul` x; it can be provoked again `cooldown` s after the last time.
  // Dread: the first time it comes into pursuit range it may stop and stare (a low call, the crown locked on you) for `dur` s, then surge at
  // you. `chance` per sighting window, at most once per `cooldown` s, from `min`..`max` m away. Lead: it aims where you WILL be (seconds ahead of
  // your velocity, at most `leadMax` m), so a swing does not shake it off.
  stare: { chance: 0.55, cooldown: 28, min: 14, max: 40, durMin: 1.5, durMax: 2.6 },
  lead: 0.5,
  leadMax: 5,
  annoy: { dur: 3, mul: 1.5, burstDur: 0.3, burstMul: 6, cooldown: 20, radius: 2.2, pad: 0.35 },
};
const T = CREATURE_TUNING;

/**
 * Per-difficulty hunting tuning (Normal / Nightmare / Abyss), metres and seconds.
 *   approach/pursue/burst  m/s (far / near / surge)
 *   menace     stalking distance it presses to while you keep moving
 *   holdBack   fraction of your speed it follows at when inside `menace`
 *   listenDelay/listenDur  stillness before it stops to listen / how long
 *   creep      m/s it closes on a player who stays silent after it listened
 *   windup     attack telegraph (s);  windupAdv  m/s it keeps coming meanwhile
 *   snap       when it HEARS you (or loses patience) the crown snaps toward you
 *              and it holds this long before surging (a reaction window)
 *   burstRate  surges per minute; commit = chance a surge near you is a lunge
 *   heardCommit  chance that hearing you move (while it listens) ends in a lunge
 *   drain/regen  stamina per second (pursuing / recovering), recoverMin (s)
 *   stallCommit  stalling this long (s) makes it commit a lunge
 */
export const DIFF_TUNE = {
  normal: {
    approach: 7.5, pursue: 5.2, burst: 14, menace: 15, holdBack: 0.5,
    listenDelay: 1.6, listenDur: 2.0, creep: 0.72, windup: 0.75, windupAdv: 4.2, snap: 0.45,
    burstRate: 1.6, commit: 0.45, heardCommit: 0.4, drain: 0.045, regen: 0.15, recoverMin: 3.0, maxGap: 75, stallCommit: 13.5,
  },
  nightmare: {
    approach: 8.4, pursue: 6.4, burst: 16, menace: 13, holdBack: 0.6,
    listenDelay: 1.3, listenDur: 1.6, creep: 0.8, windup: 0.65, windupAdv: 5.2, snap: 0.3,
    burstRate: 2.1, commit: 0.55, heardCommit: 0.65, drain: 0.045, regen: 0.18, recoverMin: 2.5, maxGap: 72, stallCommit: 9,
  },
  abyss: {
    approach: 9.8, pursue: 8.2, burst: 18.5, menace: 11, holdBack: 0.7,
    listenDelay: 0.8, listenDur: 1.1, creep: 1.15, windup: 0.5, windupAdv: 7, snap: 0.15,
    burstRate: 2.6, commit: 0.65, heardCommit: 1, drain: 0.04, regen: 0.2, recoverMin: 2.0, maxGap: 68, stallCommit: 5,
  },
};
/** The config3d.js values each DIFF_TUNE row was tuned with (config edits scale relative to these). */
const DIFF_REF = {
  normal: { speed: 1.0, staminaDrain: 1.0, staminaRegen: 1.0 },
  nightmare: { speed: 1.18, staminaDrain: 0.9, staminaRegen: 1.25 },
  abyss: { speed: 1.34, staminaDrain: 0.8, staminaRegen: 1.5 },
};

/**
 * Per-instance variants of the same sim (WP-SKITTER). `skitterling` is the Ossuary Column's little kin: same rules, same rig,
 * 0.45 scale, EXACTLY 4.5x the big creature's approach / pursue / burst / creep / wind-up-advance speeds (DIFF_TUNE x mode x
 * section, see _applyScaling), a wind-up 1.5x shorter and a shorter reach so it stays fair, and a hit that costs health instead
 * of killing outright (`hitDamage`, fraction of full hp per difficulty).
 */
export const CREATURE_VARIANTS = {
  skitterling: {
    scale: 0.45,
    speedMul: 4.5, // x the Mason's pursuit / crawl / burst speeds (a third of the original 1.5x design speed per notch: 4.5 = 3x it)
    // Nightmare and Abyss: 5x the original 1.5x design speed (7.5x the Mason's); the other difficulties keep speedMul
    speedMulBy: { nightmare: 7.5, abyss: 7.5 },
    windupMul: 1 / 1.5,
    killRadiusMul: 0.62,
    steerMul: 1.5,
    hitDamage: { normal: 0.26, nightmare: 0.32, abyss: 0.4 },
  },
};

/** Per-mode behaviour profiles (multipliers on DIFF_TUNE). */
export const CREATURE_MODES = {
  dormant: { speed: 0.5, burst: 0, listen: 1, recover: 1, observe: 1, creep: 1, menace: 1, commit: 0, stall: 1 },
  sighting: { speed: 0.5, burst: 0, listen: 1, recover: 1, observe: 1, creep: 1, menace: 1, commit: 0, stall: 1 },
  stalk: { speed: 0.93, burst: 0.65, listen: 1.05, recover: 1.15, observe: 1.25, creep: 1.0, menace: 1.0, commit: 0.8, stall: 1.08 },
  hunt: { speed: 1.0, burst: 1.0, listen: 1.0, recover: 1.0, observe: 1.0, creep: 1.0, menace: 1.0, commit: 1.0, stall: 1.0 },
  frenzy: { speed: 1.04, burst: 1.6, listen: 0.95, recover: 0.8, observe: 0.7, creep: 1.0, menace: 0.95, commit: 1.15, stall: 0.95 },
  // Escape is relentless: it closes from 24 m of vertical gap (not 38) and a
  // retreat only pauses it, no higher than 12 m over you, instead of withdrawing
  // up the throat (24 keeps careful Normal play surviving: creature/pacing.mjs).
  escape: { speed: 1.08, burst: 1.3, listen: 0.95, recover: 0.7, observe: 0.55, creep: 1.0, menace: 0.95, commit: 1.25, stall: 0.92, catchUpStart: 24, holdOnRecover: true },
};
const MODES = CREATURE_MODES;
const LETHAL_MODES = { stalk: true, hunt: true, frenzy: true, escape: true };
const SECTION_DEFAULTS = { mode: 'dormant', lethal: false, speedMul: 1, burstRate: 0, spawnOffsetY: 45 };

/** Sensory-glow level per state (pits brighten when it listens / strikes). */
const GLOW = { DORMANT: 0.1, DISTANT: 0.2, OBSERVING: 0.95, APPROACHING: 0.35, PURSUING: 0.45, BURST: 0.6, ATTACK: 1, RECOVERING: 0.1 };
/** How strongly the fronds turn toward the player per state. */
const FOCUS = { DORMANT: 0, DISTANT: 0.1, OBSERVING: 0.6, APPROACHING: 0.15, PURSUING: 0.25, BURST: 0.4, ATTACK: 0.2, RECOVERING: 0 };
/** Fastest turn of the crown's facing (deg/s -> rad/s) and of its dorsal roll: the unbounded easing produced one-frame flips at the corners. */
const HEAD_TURN_MAX = (280 * Math.PI) / 180;
const HEAD_ROLL_MAX = (300 * Math.PI) / 180;
/** Frond unfurl per state (1 = fully spread; the wind-up FLARES the crown past it). */
const UNFURL = { DORMANT: 0.5, DISTANT: 0.8, OBSERVING: 1.15, APPROACHING: 0.95, PURSUING: 0.95, BURST: 0.7, ATTACK: 1.6, RECOVERING: 0.6 };
/** Agitation (audio intensity) per state, before speed is mixed in. */
const AGITATION = { DORMANT: 0.12, DISTANT: 0.25, OBSERVING: 0.4, APPROACHING: 0.55, PURSUING: 0.7, BURST: 1, ATTACK: 1, RECOVERING: 0.35 };

// Limb layout: [spine index, side (+1 right / -1 left), reach (m), forward bias, weight].
// Irregular and front-weighted (independent limbs, not one pair per block):
// front limbs are longer, reach further ahead and land harder (louder steps).
const LIMBS = [
  [2, 1, 8.6, 0.4, 1],
  [3, -1, 8.3, 0.36, 1],
  [4, 1, 7.9, 0.28, 0.9],
  [6, -1, 7.5, 0.22, 0.9],
  [7, 1, 7.1, 0.14, 0.8],
  [9, -1, 6.8, 0.08, 0.8],
  [10, 1, 6.4, 0.02, 0.7],
  [12, -1, 6.1, -0.02, 0.7],
  [14, 1, 5.7, -0.08, 0.55],
  [15, -1, 5.4, -0.12, 0.55],
];

// -----------------------------------------------------------------------------
// Small helpers
// -----------------------------------------------------------------------------
// Math.hypot is a varargs builtin that allocates in V8's optimised code; these inline.
function len2(x, y) {
  return Math.sqrt(x * x + y * y);
}
function len3(x, y, z) {
  return Math.sqrt(x * x + y * y + z * z);
}
function num(v, fallback) {
  return typeof v === 'number' && isFinite(v) ? v : fallback;
}
function hash(n) {
  let x = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}
/** Smooth 1D value noise in [-1, 1]. */
function noise1(x, seed) {
  const s = (seed | 0) * 1013;
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  const a = hash(i + s) * 2 - 1;
  const b = hash(i + 1 + s) * 2 - 1;
  return a + (b - a) * u;
}
function taperAt(i) {
  const t = i / (SEG - 1);
  return 1 - T.taperTail * Math.pow(U.smoothstep(0.06, 1, t), 1.25);
}
/** Second-largest extent of a box: large in two directions = a slab of masonry, not a ledge or beam. */
function midDim(s) {
  const a = s.maxX - s.minX;
  const b = s.maxY - s.minY;
  const c = s.maxZ - s.minZ;
  return Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
}
/** Masonry it can cling to and crawl over: walls, pillars, any large block (not ledges, bridges, beams). */
export function isStructural(s) {
  if (s.active === false || s.kind === 'crumble' || s.kind === 'grate' || s.kind === 'bridge') return false;
  return s.kind === 'wall' || s.kind === 'pillar' || midDim(s) >= T.structuralSize;
}
/** One slab of the segment-vs-box test; updates _seg.t0/_seg.t1, returns false when the slab misses. */
const _seg = { t0: 0, t1: 1 };
function slab(o, d, mn, mx) {
  if (Math.abs(d) < 1e-12) return o >= mn && o <= mx;
  let ta = (mn - o) / d;
  let tb = (mx - o) / d;
  if (ta > tb) {
    const tmp = ta;
    ta = tb;
    tb = tmp;
  }
  if (ta > _seg.t0) _seg.t0 = ta;
  if (tb < _seg.t1) _seg.t1 = tb;
  return _seg.t0 <= _seg.t1;
}
/** Segment p0→p1 against box b (allocation-free): entry parameter in [0,1] or -1. */
function segmentBox(x0, y0, z0, x1, y1, z1, b) {
  _seg.t0 = 0;
  _seg.t1 = 1;
  if (!slab(x0, x1 - x0, b.minX, b.maxX)) return -1;
  if (!slab(y0, y1 - y0, b.minY, b.maxY)) return -1;
  if (!slab(z0, z1 - z0, b.minZ, b.maxZ)) return -1;
  return _seg.t0;
}

/**
 * Closest point on the SURFACE of box b to p (also when p is inside) and the
 * outward normal there. Returns the signed distance (negative inside).
 */
export function boxSurface(b, px, py, pz, o) {
  const cx = px < b.minX ? b.minX : px > b.maxX ? b.maxX : px;
  const cy = py < b.minY ? b.minY : py > b.maxY ? b.maxY : py;
  const cz = pz < b.minZ ? b.minZ : pz > b.maxZ ? b.maxZ : pz;
  const dx = px - cx;
  const dy = py - cy;
  const dz = pz - cz;
  const d2 = dx * dx + dy * dy + dz * dz;
  if (d2 > 1e-12) {
    const d = Math.sqrt(d2);
    o.x = cx;
    o.y = cy;
    o.z = cz;
    o.nx = dx / d;
    o.ny = dy / d;
    o.nz = dz / d;
    return d;
  }
  // Inside: the nearest face.
  let best = px - b.minX;
  let face = 0;
  let v = b.maxX - px;
  if (v < best) {
    best = v;
    face = 1;
  }
  v = py - b.minY;
  if (v < best) {
    best = v;
    face = 2;
  }
  v = b.maxY - py;
  if (v < best) {
    best = v;
    face = 3;
  }
  v = pz - b.minZ;
  if (v < best) {
    best = v;
    face = 4;
  }
  v = b.maxZ - pz;
  if (v < best) {
    best = v;
    face = 5;
  }
  o.x = px;
  o.y = py;
  o.z = pz;
  o.nx = 0;
  o.ny = 0;
  o.nz = 0;
  if (face === 0) {
    o.x = b.minX;
    o.nx = -1;
  } else if (face === 1) {
    o.x = b.maxX;
    o.nx = 1;
  } else if (face === 2) {
    o.y = b.minY;
    o.ny = -1;
  } else if (face === 3) {
    o.y = b.maxY;
    o.ny = 1;
  } else if (face === 4) {
    o.z = b.minZ;
    o.nz = -1;
  } else {
    o.z = b.maxZ;
    o.nz = 1;
  }
  return -best;
}

// -----------------------------------------------------------------------------
// Bus wiring: one set of listeners per bus, dispatching to the most recently
// constructed creature (the Game builds a new creature per run on a long-lived
// bus, so per-instance subscriptions would leak and double-fire).
// -----------------------------------------------------------------------------
const busLinks = typeof WeakMap === 'function' ? new WeakMap() : null;
function linkBus(bus, creature) {
  if (!bus || typeof bus.on !== 'function' || !busLinks) return;
  let link = busLinks.get(bus);
  if (!link) {
    link = { creature: null };
    bus.on('trigger:sighting', (p) => {
      if (link.creature) link.creature._onSightingTrigger(p);
    });
    bus.on('trigger:call', () => {
      if (link.creature) link.creature._onCallTrigger();
    });
    bus.on('rope:shot', (p) => {
      if (link.creature) link.creature._onShot(p);
    });
    busLinks.set(bus, link);
  }
  link.creature = creature;
}

function makeLimb(def, i, rand, sc) {
  const p = () => ({ x: 0, y: 0, z: 0 });
  return {
    seg: def[0],
    side: def[1],
    reach: def[2] * sc,
    fwd: def[3],
    weight: def[4],
    partner: i ^ 1,
    hip: p(), // attach point on the body (contract)
    foot: p(), // current foot (contract)
    planted: false, // contract
    lift: 0, // 0..1 while stepping
    // internal
    d: p(), // desired foothold this frame
    u: p(), // body up at the hip
    o: p(), // step start
    t: p(), // step target
    step: -1, // step progress 0..1, -1 when not stepping
    dur: 0.25,
    gripTimer: 0,
    sway: rand() * TAU,
  };
}

// =============================================================================
// Creature3D
// =============================================================================
export class Creature3D {
  /**
   * @param {Level3D} level
   * @param {object} diff   DIFFICULTY[key] (config3d.js)
   * @param {EventBus} bus
   * @param {{seed?:number, variant?:string}} [options]  deterministic seed (tooling); random by default; variant = a
   *   CREATURE_VARIANTS key (WP-SKITTER: smaller, 4.5x faster, hits for damage; it never listens to the sighting / call triggers)
   */
  constructor(level, diff, bus, options) {
    this.variant = options && CREATURE_VARIANTS[options.variant] ? options.variant : '';
    this.v = this.variant ? CREATURE_VARIANTS[this.variant] : null;
    const sc = this.v ? this.v.scale : 1;
    this._scale = sc;
    this._hug = T.hug * sc;
    this._minClear = T.minClear * (0.45 + 0.55 * sc);
    this._arch = T.arch * sc;
    this._rearMax = T.rear * sc;
    this._spacing = T.spacing * sc;
    this.level = level || null;
    this.diff = diff || {};
    this.bus = bus || null;
    const cd = this.diff.creature || {};
    this.cfg = {
      enabled: cd.enabled !== false && !!level,
      speed: Math.max(0, num(cd.speed, 1)),
      aggression: Math.max(0.5, num(cd.aggression, 1)),
      staminaDrain: Math.max(0.05, num(cd.staminaDrain, 1)),
      staminaRegen: Math.max(0.05, num(cd.staminaRegen, 1)),
      killRadius: Math.max(0.8, num(cd.killRadius, 2.6) * (this.v ? this.v.killRadiusMul : 1)),
    };
    /** false in sandbox (diff.creature.enabled === false): never appears, never kills, silent. */
    this.active = this.cfg.enabled;
    let key = DIFF_TUNE[this.diff.key] ? this.diff.key : null;
    if (!key) key = this.cfg.aggression < 1.15 ? 'normal' : this.cfg.aggression < 1.45 ? 'nightmare' : 'abyss';
    this.tuneKey = key;
    const ref = DIFF_REF[key];
    this.cfg.speedRatio = ref.speed > 0 ? this.cfg.speed / ref.speed : 1;
    this.cfg.staminaDrain /= ref.staminaDrain;
    this.cfg.staminaRegen /= ref.staminaRegen;
    /** Effective hunting tuning for the current difficulty × mode × section. */
    this.k = Object.assign({ burstRate: 0, commit: 0 }, DIFF_TUNE[key]);
    this.seed = options && isFinite(options.seed) ? options.seed | 0 : (Math.random() * 1e9) | 0;
    this._rand = U.rng(this.seed);

    // ---- body (preallocated) ----
    this._segOff = new Float64Array(SEG); // arc length from the head
    this.body = {
      spine: new Float32Array(SEG * 3),
      up: new Float32Array(SEG * 3),
      scale: new Float32Array(SEG),
      limbs: LIMBS.map((def, i) => makeLimb(def, i, this._rand, this._scale)),
      size: sc, // 1 = the Mason; the renderer scales the rig by this
      frondOpen: 0.3,
      glow: 0.1,
      lunge: 0,
      head: { x: 0, y: 0, z: 0, fx: 0, fy: -1, fz: 0, ux: 0, uy: 0, uz: 1 },
      focus: { x: 0, y: 0, z: 0, amount: 0 },
      visible: false,
      jitter: 0,
      listen: 0,
      time: 0,
    };
    let off = 0;
    for (let i = 0; i < SEG; i++) {
      this.body.scale[i] = taperAt(i);
      if (i > 0) off += this._spacing * 0.5 * (taperAt(i - 1) + taperAt(i));
      this._segOff[i] = off;
    }
    this.bodyLength = off;
    this._trail = new Float64Array(T.trailCap * 3);
    this._trailN = new Float64Array(T.trailCap * 3);
    this._tHead = -1;
    this._tCount = 0;

    this.audio = { x: 0, y: 0, z: 0, distance: FAR, intensity: 0, movement: 0, state: S.DORMANT };
    this.attack = { phase: null, t: 0, windup: 0.5, sx: 0, sy: 0, sz: 0, lx: 0, ly: 0, lz: 0, hit: false, cause: '' };
    this._solids = [];
    this._grip = [];
    this._surf = { x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0 };
    this._surf2 = { x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0 };
    this._bodySolids = []; // scratch of the per-block wall fit
    this._bs = { x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0 };
    this._ba = { x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0 };
    this._bodyLift = new Float32Array(SEG * 3); // eased wall-fit offset of each block (m, a vector: a normal that flips must not jump the block)
    this._bdir = new Float32Array(SEG * 3); // each link's direction last frame (the locked body axes)
    this._bup = new Float32Array(SEG * 3); // each block's up last frame
    this._bReady = false;
    this._bsrc = new Float32Array(SEG * 3); // the spine as the trail laid it (the lock reads the links from here)
    this._bpush = new Float32Array(SEG * 3); // eased push-out of each block (m)
    this._surfTmp = { x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0 };
    this._hit = { t: 0, az: 0 };

    if (!this.v) linkBus(this.bus, this); // variants ignore the sighting / call triggers
    this.reset(null);
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /** Full reset for a new run. Configures itself for the player's section when a player is given. */
  reset(player) {
    this.state = S.DORMANT;
    this.stateTime = 0;
    this.stateDur = 0;
    this.stamina = 1;
    this.x = 0;
    this.y = 0;
    this.z = 0;
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
    this.speed = 0;
    this.hx = 0; // smoothed heading (unit)
    this.hy = -1;
    this.hz = 0;
    this.nx = 0; // smoothed normal of the surface it clings to
    this.ny = 0;
    this.nz = 1;
    this._upx = 0; // the crown's dorsal up: continuous (see _headUp), not the raw normal
    this._upy = 1;
    this._upz = 0;
    this._upReady = false;
    this._bodyDt = 0;
    this._belowSign = 1; // -1: this one entered from below (skitterling slot 2)
    this.staring = false; // the dread stare (see _tryStare)
    this._stareCd = 0;
    this._annoyT = -1; // seconds since it was provoked (-1: calm)
    this._annoyCd = 0; // seconds until it can be provoked again
    this.annoyCount = 0;
    this.onSurface = false;
    this.distance = FAR;
    this.lethal = false;
    this.caughtPlayer = false;
    this.hitPlayer = false;
    this.sighting = null;
    this.sightingDone = false;
    this.inPlay = false;
    this.victory = null;
    this.nearMiss = 0;
    this.listening = false;
    this.creeping = false;
    this.burstCommit = false;
    this.burstReason = '';
    this.grace = 0;
    this.mode = 'dormant';
    this.profile = MODES.dormant;
    this.sectionIndex = -1;
    this.sectionCfg = Object.assign({}, SECTION_DEFAULTS);
    this.az = this._rand() * TAU; // route: which wall (azimuth around the player) it comes down
    this._hugT = 0;
    this._hugX = 0;
    this._hugY = 0;
    this._hugZ = 0;
    this._hugOK = false;
    this._hugPX = NaN;
    this._hugPY = NaN;
    this._hugPZ = NaN;
    this.stillTime = 0;
    this._listenedThisStill = false;
    this.stallTime = 0;
    this._stallX = NaN;
    this._stallY = 0;
    this._stallZ = 0;
    this.playerSpeed = 0;
    this._px = 0;
    this._py = 0;
    this._pz = 0;
    this._pvx = 0;
    this._pvy = 0;
    this._pvz = 0;
    this._t = 0;
    this.time = 0;
    this._stepCd = 0;
    this._hitch = 1;
    this._weave = this._rand() * TAU;
    this._stickEff = 1;
    this._ox = 0;
    this._oy = 0;
    this._oz = 0;
    this._freeT = 0; // watchdog: seconds of free (non-clinging) movement left
    this._lungeFails = 0;
    this._relTries = [40, 30, 24, 18, 12, 6, 0, -8, -16];
    this._dP = new Float64Array(3); // detour scratch
    this._dQ = new Float64Array(3);
    this._dMn = new Float64Array(3);
    this._dMx = new Float64Array(3);
    this._dG = new Float64Array(3);
    this._dtx = 0; // detour goal (around a blocking slab)
    this._dty = 0;
    this._dtz = 0;
    this._wdT = 0;
    this._wdD = FAR;
    this._stuck = 0;
    this._hitchLeft = 0;
    this._hitchTimer = 2 + this._rand() * 3;
    this.burstTimer = 5;
    this.listenCd = 0;
    this.routeTimer = 8 + this._rand() * 8;
    this.callTimer = 14 + this._rand() * 16;
    this._ambTimer = 10 + this._rand() * 10;
    this._ambSteps = 0;
    this._ambStepTimer = 0;
    this._ambCallTimer = 25 + this._rand() * 20;
    this._answerTimer = 0;
    this._farBelow = T.farBelowMin + this._rand() * (T.farBelowMax - T.farBelowMin);
    this._farAz = this._rand() * TAU;
    this._sightTrigger = null;
    this._sightAuto = -1;
    this._introT = 0; // > 0: the slow first approach of a hunt (T.introTime)
    this._glow = 0.1;
    this._unfurl = 0.6;
    this._jitter = 0;
    this._lunge = 0;
    this._rear = 0;
    this.attack.phase = null;
    this.stats = { bursts: 0, attacks: 0, hits: 0, nearMisses: 0, retreats: 0, listens: 0, stallLunges: 0, relocations: 0, stares: 0 };
    this._applyScaling(SECTION_DEFAULTS);
    this._tHead = -1;
    this._tCount = 0;
    const lv = this.level;
    const ref = player || (lv && lv.spawn) || { x: 0, y: 0, z: 0 };
    this._placeFar(ref);
    if (player && lv && lv.sections && lv.sections.length) {
      const i = lv.sectionIndexAt(player.y);
      this.setSection(i, lv.sections[i], player);
    }
    this._updateAudio(player);
    this._writeBodyFlags();
  }

  /**
   * Applies a section's `creature` config. Lethal modes bring it into play from
   * above (spawnOffsetY, metres ABOVE the player whatever its sign) if it is
   * not already hunting; non-lethal modes keep it far away. Re-applying the
   * current section is harmless.
   */
  setSection(index, section, player) {
    const lv = this.level;
    const sec = section || (lv && lv.sections && lv.sections[index]) || null;
    const c = Object.assign({}, SECTION_DEFAULTS, sec && sec.creature);
    const mode = MODES[c.mode] ? c.mode : 'dormant';
    const prevIndex = this.sectionIndex;
    this.sectionIndex = index;
    if (!this.active) {
      this.mode = mode;
      return;
    }
    if (this.victory) return;
    const lethalMode = LETHAL_MODES[mode] === true;
    // Climbing back above the hunt does not shake it off: keep hunting.
    if (!lethalMode && this.inPlay && index < prevIndex) return;

    this.mode = mode;
    this.profile = MODES[mode];
    this.sectionCfg = c;
    this._applyScaling(c);
    if (lethalMode) {
      this.lethal = c.lethal === true;
      if (!this.inPlay) {
        this._enterPlay(player, this._spawnAbove(c.spawnOffsetY), T.graceSection, c.spawnBelow === true);
        this._introT = T.introTime; // respawns / warps clear it (onRespawn)
      }
    } else {
      this.lethal = false;
      if (this.inPlay) this._leavePlay();
      this._sightTrigger = null;
      this._sightAuto = -1;
      if (mode === 'sighting' && !this.sightingDone) {
        const trig = sec && Array.isArray(sec.triggers) ? sec.triggers.find((t) => t && t.name === 'sighting') : null;
        this._sightTrigger = trig || null;
        if (!trig) this._sightAuto = 1.5;
        this._setState(S.DISTANT);
      } else {
        this._setState(mode === 'sighting' ? S.DISTANT : S.DORMANT);
      }
      if (player && !this.sighting) this._placeFar(player);
    }
  }

  /** Respawn: reposition 40–55 m above the player, ≥3.5 s grace, APPROACHING. */
  onRespawn(player) {
    if (!this.active || !player) return;
    this.caughtPlayer = false;
    this.attack.phase = null;
    this.nearMiss = 0;
    this.stillTime = 0;
    this.stallTime = 0;
    this._stallX = NaN;
    this.listening = false;
    this._introT = 0;
    this._annoyT = -1;
    this._annoyCd = 0;
    if (this.victory) return;
    const lv = this.level;
    const i = lv.sectionIndexAt(player.y);
    const sec = lv.sections[i];
    const mode = sec && sec.creature && MODES[sec.creature.mode] ? sec.creature.mode : 'dormant';
    this.sectionIndex = -1;
    if (LETHAL_MODES[mode]) {
      this.inPlay = true;
      this.setSection(i, sec, player);
      this._enterPlay(player, 40 + this._rand() * 15, T.graceRespawn);
      this.stamina = 0.9;
    } else {
      this.inPlay = false;
      this.setSection(i, sec, player);
    }
  }

  /**
   * Victory: charge the chamber gate from outside, slam it (cannot kill), then
   * retreat. The slam face is the side of the gate facing away from the goal.
   * @param {{minX,minY,minZ,maxX,maxY,maxZ}} [gate]
   */
  onVictory(gate) {
    if (!this.active) return;
    const lv = this.level;
    const g = gate || (lv && lv.gate) || null;
    const goal = lv && lv.goal ? lv.goal : null;
    let gx = this.x;
    let gy = this.y - 15;
    let gz = this.z;
    let ox = 0; // outward normal of the struck face (points away from the chamber)
    let oy = 1;
    let oz = 0;
    if (g && isFinite(g.minX)) {
      const cx = (g.minX + g.maxX) / 2;
      const cy = (g.minY + g.maxY) / 2;
      const cz = (g.minZ + g.maxZ) / 2;
      const qx = goal ? (goal.minX + goal.maxX) / 2 : this._px;
      const qy = goal ? (goal.minY + goal.maxY) / 2 : this._py;
      const qz = goal ? (goal.minZ + goal.maxZ) / 2 : this._pz;
      // The gate's thinnest axis is its normal.
      const ex = g.maxX - g.minX;
      const ey = g.maxY - g.minY;
      const ez = g.maxZ - g.minZ;
      ox = 0;
      oy = 0;
      oz = 0;
      if (ey <= ex && ey <= ez) oy = cy - qy >= 0 ? 1 : -1;
      else if (ex <= ez) ox = cx - qx >= 0 ? 1 : -1;
      else oz = cz - qz >= 0 ? 1 : -1;
      gx = cx + ox * ex * 0.5;
      gy = cy + oy * ey * 0.5;
      gz = cz + oz * ez * 0.5;
    }
    this.lethal = false;
    this.caughtPlayer = false;
    this.grace = 1e9;
    this.listening = false;
    this.creeping = false;
    this.attack.phase = null;
    this.victory = { phase: 'charge', t: 0, hits: 0, gx, gy, gz, ox, oy, oz };
    if (!this.inPlay || len3(this.x - gx, this.y - gy, this.z - gz) > 56) {
      // Bring it in from just out of sight so the slam lands while the player is still there.
      this.inPlay = true;
      this.x = gx + ox * 13;
      this.y = gy + oy * 13 + 30;
      this.z = gz + oz * 13;
      this._clampToBounds();
      this.vx = 0;
      this.vy = -10;
      this.vz = 0;
      this._findSurface(this.x, this.y, this.z, T.surfaceSearch * 2, this._surf);
      this._layBody(0, -1, 0);
    }
    this.stateDur = 1.6;
    this.burstCommit = false;
    this.burstReason = 'gate';
    this._setState(S.BURST);
    this.stats.bursts++;
    this._emit('creature:burst', { x: this.x, y: this.y, z: this.z, distance: this.distance });
  }

  // ===========================================================================
  // Update
  // ===========================================================================

  /**
   * Advances behaviour, crawl, body, limbs and crown. Call once per frame while playing.
   * @param {number} dt      frame delta (s), capped internally at 0.1
   * @param {Player3D} player
   * @param {number} [time]  run time (s), kept for reference
   */
  update(dt, player, time) {
    if (!(dt > 0)) return;
    if (dt > 0.1) dt = 0.1;
    this._bodyDt = dt;
    this._t += dt;
    if (this._annoyCd > 0) this._annoyCd -= dt;
    if (this._stareCd > 0) this._stareCd -= dt;
    if (this._annoyT >= 0) {
      this._annoyT += dt;
      if (this._annoyT >= T.annoy.dur) this._annoyT = -1;
    }
    if (typeof time === 'number' && isFinite(time)) this.time = time;
    this.nearMiss = Math.max(0, this.nearMiss - dt * 1.1);
    if (!this.active) {
      this._quiet();
      this._writeBodyFlags();
      return;
    }
    if (!player) {
      this._updateAudio(null);
      return;
    }
    this._px = player.x;
    this._py = player.y;
    this._pz = player.z;
    this._pvx = player.vx || 0;
    this._pvy = player.vy || 0;
    this._pvz = player.vz || 0;
    const alive = player.alive !== false;
    const pv = len3(this._pvx, this._pvy, this._pvz);
    this.playerSpeed = pv;
    if (alive && pv < T.stillSpeed) this.stillTime += dt;
    else {
      this.stillTime = 0;
      this._listenedThisStill = false;
    }
    this._updateStall(dt, player, alive);

    // Self-configure if the game has not told us about the section yet.
    const lv = this.level;
    if (!this.victory && lv && lv.sections && lv.sections.length) {
      const si = lv.sectionIndexAt(player.y);
      if (si !== this.sectionIndex) this.setSection(si, lv.sections[si], player);
    }

    this.stateTime += dt;
    this._stepCd -= dt;

    if (this.victory) this._updateVictory(dt, player);
    else if (this.inPlay) this._updateHunt(dt, player);
    else if (this.mode === 'sighting') this._updateSighting(dt, player);
    else this._updateDormant(dt, player);

    this.speed = len3(this.vx, this.vy, this.vz);
    if (this.inPlay || this.sighting) {
      this.distance = len3(player.x - this.x, player.y - this.y, player.z - this.z);
      this._updateHeading(dt);
      this._updateTrail();
      this._updateSpine();
      this._updateLimbs(dt, player);
      this._updateCrown(dt);
    }
    this._updateAudio(player);
    this._writeBodyFlags();
  }

  // ---- stall tracking ---------------------------------------------------------------

  /** Time the player has stayed inside a small radius (hanging, swaying, looking around). */
  _updateStall(dt, player, alive) {
    if (!alive) {
      this.stallTime = 0;
      this._stallX = NaN;
      return;
    }
    const dx = player.x - this._stallX;
    const dy = player.y - this._stallY;
    const dz = player.z - this._stallZ;
    if (!(dx * dx + dy * dy + dz * dz < T.stallRadius * T.stallRadius)) {
      this._stallX = player.x;
      this._stallY = player.y;
      this._stallZ = player.z;
      this.stallTime = 0;
    } else {
      this.stallTime += dt;
    }
  }

  // ---- hunting (stalk / hunt / frenzy / escape) -------------------------------------

  _updateHunt(dt, player) {
    const K = this.k;
    const alive = player.alive !== false;
    const dist = len3(player.x - this.x, player.y - this.y, player.z - this.z);
    const below = this.y - player.y; // > 0: the player is below it
    this.distance = dist;
    this.grace = Math.max(0, this.grace - dt);
    this.listenCd -= dt;
    this.burstTimer -= dt;
    this.routeTimer -= dt;
    this.callTimer -= dt;
    if (this._introT > 0) this._introT -= dt;
    this._tickHitch(dt);

    // Hard rubber band: never let it fall hopelessly far behind (it is out of sight there).
    if (below > K.maxGap) this._shift(0, K.maxGap - below, 0);
    else if (-below > K.maxGap) this._shift(0, -below - K.maxGap, 0);

    const engage = this.cfg.killRadius * T.engageMul;
    const canAttack = this.lethal && alive && this.grace <= 0;
    const still = alive && this.stillTime > T.stillDebounce;
    const moving = alive && this.playerSpeed > T.moveSpeed;
    const stalled = canAttack && this.stallTime >= K.stallCommit;
    const st = this.state;
    if (st !== S.APPROACHING) this.creeping = false;

    if (!alive && (st === S.APPROACHING || st === S.PURSUING || st === S.BURST)) {
      this._enterObserve(2.5, false); // hangs over the fallen, fronds searching
    } else {
      switch (st) {
        case S.APPROACHING:
        case S.PURSUING:
          if (this.creeping) {
            // Closing on a silent player after listening.
            if (moving) {
              this.creeping = false;
              this._heard(dist);
            } else if (canAttack && dist < engage) this._startAttack('creep');
            else if (stalled && this.stamina > 0.15) this._stallLunge();
            break;
          }
          if (st === S.PURSUING) this._drain(K.drain * dt);
          if (canAttack && dist < engage && !still) this._startAttack('contact');
          else if (stalled && this.stamina > 0.15 && dist < T.burstMax) this._stallLunge();
          else if (this.stamina <= 0) this._setState(S.RECOVERING);
          else if (this._shouldListen(dist, alive)) this._enterObserve(K.listenDur, true);
          else if (still && this.stillTime >= K.listenDelay + K.listenDur && dist <= this._menace() + 3) {
            // Already listened recently: go straight to creeping in.
            this.creeping = true;
            if (st !== S.APPROACHING) this._setState(S.APPROACHING);
          } else if (this.burstTimer <= 0 && !still && this.stamina > 0.3) this._tryBurst(dist);
          else {
            if (st === S.APPROACHING && dist < T.pursueRange) {
              if (!this._tryStare(dist)) this._setState(S.PURSUING);
            } else if (st === S.PURSUING && dist > T.loseRange) this._setState(S.APPROACHING);
            if (this.routeTimer <= 0) this._maybeChangeRoute(player, below);
            if (this.callTimer <= 0) this._ambientCall(dist);
          }
          break;
        case S.BURST: {
          this._drain(T.drainBurst * dt);
          let end = this.stateTime >= this.stateDur;
          if (this.burstCommit) {
            if (canAttack && dist < engage) {
              this._startAttack('lunge');
              break;
            }
            if (!canAttack && dist < engage * 1.6) end = true;
          } else if (dist <= this._menace() * 0.9) end = true; // pressure surge stops short
          if (end) {
            if (this.burstCommit) this._lungeFails++; // never got in reach (see _watchdog)
            if (this.stamina <= 0) this._setState(S.RECOVERING);
            else this._setState(dist < T.pursueRange ? S.PURSUING : S.APPROACHING);
          }
          break;
        }
        case S.OBSERVING:
          this._regen(T.regenObserve * dt);
          if (this.listening && moving && this.stateTime > 0.25) {
            this.listening = false;
            this._heard(dist); // it heard you move
          } else if (stalled && !this.listening && this.stamina > 0.15 && dist < T.burstMax) {
            this._stallLunge();
          } else if (this.stateTime >= this.stateDur) {
            if (!alive) this.stateDur += 1;
            else if (this.listening && still) {
              // Silence held: it creeps in, slow and certain.
              this.listening = false;
              this.creeping = true;
              this._setState(S.APPROACHING);
            } else if (this.staring) {
              // The stare is over: it comes for you in a surge.
              this.staring = false;
              this.stats.stares++;
              if (this.stamina > 0.3 && dist < T.burstMax) this._startBurst(false, 'stare');
              else this._setState(dist < T.pursueRange ? S.PURSUING : S.APPROACHING);
            } else {
              this.listening = false;
              this._setState(dist < T.pursueRange ? S.PURSUING : S.APPROACHING);
            }
          }
          break;
        case S.ATTACK:
          this._updateAttack(dt, player);
          return; // the attack drives its own movement
        case S.RECOVERING:
          this._regen(K.regen * dt);
          if (this.stateTime >= this.stateDur && this.stamina >= T.recoverTo) {
            const dur = (T.observeMin + this._rand() * (T.observeMax - T.observeMin)) * this.profile.observe;
            this._enterObserve(dur, false);
          }
          break;
        default:
          this._setState(S.APPROACHING);
      }
    }
    if (this.state === S.ATTACK) return; // the wind-up starts moving next frame
    this._watchdog(dt, player, dist);
    this._steerHunt(dt, player, dist, below);
  }

  /**
   * Stuck guard for arbitrary level geometry: if it wants to close in but has
   * made no progress for a while, it lets go of the masonry for a moment; if it
   * is still stuck (wrong side of a wall, a dead-end recess) it relocates —
   * always out of sight — onto the shaft wall above the player.
   */
  _watchdog(dt, player, dist) {
    if (this._freeT > 0) this._freeT -= dt;
    const st = this.state;
    const approaching = (st === S.APPROACHING || st === S.PURSUING || st === S.BURST) && !this.creeping;
    if (this._lungeFails >= 2) {
      // Committed lunges keep falling short (something solid in the way).
      this._lungeFails = 0;
      if (dist > 28 || this._losBlocked(player)) {
        this.stats.relocations = (this.stats.relocations || 0) + 1;
        this._relocate(player);
      } else this._freeT = 2.5;
      return;
    }
    this._wdT += dt;
    if (this._wdT < 1.5) return;
    const gained = this._wdD - dist;
    this._wdT = 0;
    this._wdD = dist;
    // Close but with masonry between (above a floor you are under) counts as far.
    const blocked = approaching && this._losBlocked(player);
    const wants = approaching && (dist > this._menace() + 6 || blocked);
    if (!wants || gained > 1) {
      this._stuck = Math.max(0, this._stuck - 1.5);
      return;
    }
    this._stuck += 1.5;
    if (this._stuck <= 1.5 && len3(this.x - this._hugX, this.y - this._hugY, this.z - this._hugZ) < 5) {
      // Parked on its route wall with you out of reach (an open hall): take the
      // structure nearest to you instead.
      this.az = this._nearestWallAz(player.x, player.y, player.z);
      this._hugT = 0;
      return;
    }
    if (this._stuck >= 3 && this._stuck < 7.5) this._freeT = 2.5;
    else if (this._stuck >= 7.5 && (dist > 28 || blocked)) {
      this._stuck = 0;
      this.stats.relocations = (this.stats.relocations || 0) + 1;
      this._relocate(player);
    }
  }

  /** Solid masonry between the head and the player (level.segmentBlocked, active solids). */
  _losBlocked(player) {
    const lv = this.level;
    if (!lv || typeof lv.segmentBlocked !== 'function') return false;
    const px = player ? player.x : this._px;
    const py = player ? player.y : this._py;
    const pz = player ? player.z : this._pz;
    return lv.segmentBlocked(this.x, this.y, this.z, px, py, pz, 1.5);
  }


  /**
   * Out-of-sight reposition onto the wall nearest the player, ~40 m above
   * (keeps state and stamina). Tries lower heights when that spot is buried
   * in masonry (a different shaft above, a roof slab).
   */
  _relocate(player) {
    // Prefer a clear spot on a wall high above you from which you are in
    // reach (nothing solid between); otherwise any clear spot.
    const tries = this._relTries;
    tries[0] = (38 + this._rand() * 10) * this._belowSign;
    let found = false;
    let fx = 0;
    let fy = 0;
    let fz = 0;
    let fallback = false;
    const az0 = this._nearestWallAz(player.x, player.y + tries[0], player.z);
    for (let k = 0; k < tries.length && !found; k++) {
      const y = player.y + (k === 0 ? tries[0] : tries[k] * this._belowSign);
      for (let j = 0; j < 8 && !found; j++) {
        const az = az0 + (j === 0 ? 0 : (j % 2 ? 1 : -1) * Math.ceil(j / 2) * (Math.PI / 4));
        if (!this._rayWall(player.x, y, player.z, az, 80)) continue;
        const h = this._hit;
        this.x = player.x + Math.cos(az) * (h.t - this._hug);
        this.z = player.z + Math.sin(az) * (h.t - this._hug);
        this.y = y;
        this._clampToBounds();
        if (!this._clearAt(this.x, this.y, this.z)) continue;
        if (!fallback) {
          fallback = true;
          fx = this.x;
          fy = this.y;
          fz = this.z;
        }
        if (!this._losBlocked(player)) {
          found = true;
          this.az = az;
        }
      }
    }
    if (!found) {
      if (fallback) {
        this.x = fx;
        this.y = fy;
        this.z = fz;
      } else {
        this.x = player.x;
        this.y = player.y + tries[0];
        this.z = player.z;
        this._clampToBounds();
      }
    }
    this.vx = 0;
    this.vy = -4;
    this.vz = 0;
    if (this._findSurface(this.x, this.y, this.z, T.surfaceSearch * 2, this._surf) < Infinity) {
      this.nx = this._surf.nx;
      this.ny = this._surf.ny;
      this.nz = this._surf.nz;
    }
    this._hugT = 0;
    this._wdD = FAR;
    this._layBody(0, -1, 0);
  }


  /** Effective stalking distance: it presses closer the longer the player stalls. */
  _menace() {
    const K = this.k;
    const bold = U.smoothstep(T.stallStart, K.stallCommit, this.stallTime);
    return K.menace * (1 - 0.5 * bold);
  }

  /** Speed multiplier of the annoyed state: burstMul for the first burstDur s, then mul until dur, else 1. */
  get annoyMul() {
    const t = this._annoyT;
    const A = T.annoy;
    if (t < 0 || t >= A.dur) return 1;
    return t < A.burstDur ? A.burstMul : A.mul;
  }

  /** Provoked and still angry (the view / audio can read it). */
  get annoyed() {
    return this._annoyT >= 0;
  }

  /**
   * A grapple was fired (bus 'rope:shot': the aim ray, normalised, and the hook's range). When the ray passes through the body it
   * is annoyed: faster for a few seconds, a surge at the start, and it comes for the player. At most once per `cooldown` seconds.
   */
  _onShot(p) {
    if (this.v || !this.active || !this.inPlay || this.victory || this._annoyCd > 0 || !p) return;
    const A = T.annoy;
    const sp = this.body.spine;
    const range = Math.max(1, num(p.range, 30));
    const ox = num(p.ox, NaN);
    const oy = num(p.oy, NaN);
    const oz = num(p.oz, NaN);
    const dx = num(p.dx, 0);
    const dy = num(p.dy, 0);
    const dz = num(p.dz, 0);
    if (!isFinite(ox + oy + oz) || !(len3(dx, dy, dz) > 0.5)) return;
    let bestT = -1;
    for (let i = 0; i < SEG; i++) {
      const cx = sp[i * 3] - ox;
      const cy = sp[i * 3 + 1] - oy;
      const cz = sp[i * 3 + 2] - oz;
      const t = U.clamp(cx * dx + cy * dy + cz * dz, 0, range);
      const ex = cx - dx * t;
      const ey = cy - dy * t;
      const ez = cz - dz * t;
      const r = A.radius * this.body.scale[i] * this._scale + A.pad;
      if (ex * ex + ey * ey + ez * ez <= r * r && (bestT < 0 || t < bestT)) bestT = t;
    }
    if (bestT < 0) return;
    const lv = this.level;
    // the first thing on the line must be the creature, not a wall in front of it
    if (lv && typeof lv.segmentBlocked === 'function' && bestT > 1.5) {
      const t = bestT - 1.0;
      if (lv.segmentBlocked(ox, oy, oz, ox + dx * t, oy + dy * t, oz + dz * t, 0.05)) return;
    }
    this._annoyCd = A.cooldown;
    this._annoyT = 0;
    this.annoyCount++;
    this.listening = false;
    this.creeping = false;
    if (this.state === S.OBSERVING || this.state === S.APPROACHING) this._setState(S.PURSUING);
    const dist = len3(this._px - this.x, this._py - this.y, this._pz - this.z);
    this._emit('creature:annoyed', { x: this.x, y: this.y, z: this.z, distance: dist, dur: A.dur, burstDur: A.burstDur, count: this.annoyCount });
    this._emit('creature:call', { x: this.x, y: this.y, z: this.z, distance: dist, intensity: 1, annoyed: true });
  }

  /**
   * First sight of you inside pursuit range: sometimes it stops dead and stares (a low call, the crown locked on you), then surges.
   * Mason only, lethal hunts only, rarely (cooldown), never when you are close. Returns true when it started to stare.
   */
  _tryStare(dist) {
    const S_ = T.stare;
    if (this.v || !this.lethal || this._stareCd > 0 || dist < S_.min || dist > S_.max || this.stamina < 0.5) return false;
    this._stareCd = S_.cooldown;
    if (this._rand() >= S_.chance) return false;
    this.listening = false;
    this.creeping = false;
    this._enterObserve(S_.durMin + this._rand() * (S_.durMax - S_.durMin), false);
    this.staring = true;
    this._emit('creature:stare', { x: this.x, y: this.y, z: this.z, distance: dist });
    this._emit('creature:call', { x: this.x, y: this.y, z: this.z, distance: dist, intensity: 0.8, stare: true });
    return true;
  }

  /** It heard the player move: lunge if it has the strength, else give chase. */
  _heard(dist) {
    if (this.stamina > 0.3 && dist < T.burstMax && this._rand() < this.k.heardCommit) this._startBurst(true, 'heard');
    else this._setState(S.PURSUING);
  }

  /** The player has stalled too long: it commits. */
  _stallLunge() {
    this.stats.stallLunges++;
    this.listening = false;
    this._startBurst(true, 'stall');
  }

  /** Burst timer fired: a lunge when it is already close, a pressure surge when far. */
  _tryBurst(dist) {
    const K = this.k;
    const m = this._menace();
    if (dist <= m * 1.35) {
      if (this._rand() < K.commit) this._startBurst(true, 'commit');
      else this.burstTimer = 2 + this._rand() * 3; // hesitates; tries again soon
    } else if (dist >= m + 8 && dist < T.burstMax) {
      this._startBurst(false, 'surge');
    } else {
      this.burstTimer = 1.5;
    }
  }

  _shouldListen(dist, alive) {
    const K = this.k;
    return (
      alive &&
      this.stillTime >= K.listenDelay &&
      !this._listenedThisStill &&
      this.listenCd <= 0 &&
      dist <= this._menace() + 3 &&
      dist > this.cfg.killRadius * T.engageMul
    );
  }

  _steerHunt(dt, player, dist, below) {
    const K = this.k;
    this._scanHugIfNeeded(dt, player);
    const swing = 1 - U.smoothstep(T.swingNear, T.swingFar, dist);
    let tx = U.lerp(this._hugX, player.x, swing);
    let ty = U.lerp(this._hugY, player.y, swing);
    let tz = U.lerp(this._hugZ, player.z, swing);
    let stick = 1 - swing;
    let speed = 0;
    let rate = T.steerRate;
    const noise = this._noise();
    const still = player.alive !== false && this.stillTime > T.stillDebounce;
    const intro = this._introT > 0;
    const cuStart = this.profile.catchUpStart || T.catchUpStart;
    const catchUp = !intro && below > cuStart ? Math.min(T.catchUpMax, (below - cuStart) * T.catchUpGain) : 0;
    switch (this.state) {
      case S.APPROACHING:
      case S.PURSUING: {
        if (this.creeping) {
          // Slow, deliberate, steady: the predator closing on silence.
          speed = this.k.creep * (0.85 + 0.25 * (noise - 0.66));
          tx = player.x;
          ty = player.y;
          tz = player.z;
          stick = Math.min(stick, 0.6);
          rate = 2.5;
          break;
        }
        const base = this.state === S.PURSUING ? K.pursue : K.approach;
        speed = base * noise * this._hitch * (intro ? T.introSpeed : 1) + catchUp;
        // Stalking distance: it presses to `menace`, not into you, unless it
        // commits to a lunge or has listened to your silence.
        const m = this._menace();
        if (dist < m + 6) {
          if (still) {
            // Hovers at the edge of the light while deciding whether you are there.
            speed = Math.min(speed, T.speed.observe * (0.5 + 0.5 * noise) + Math.max(0, dist - m) * 0.8);
          } else {
            // Follow your AWAY component (swinging around it does not pull it in),
            // easing back out to `menace` when it is inside it.
            const dl = Math.max(dist, 0.01);
            const away = (this._pvx * (player.x - this.x) + this._pvy * (player.y - this.y) + this._pvz * (player.z - this.z)) / dl;
            const f = U.lerp(K.holdBack, 1.05, U.clamp((dist - m) / 6, 0, 1));
            speed = Math.min(speed, Math.max(0, Math.max(0, away) * f + (dist - m) * 0.8));
            if (dist < m * 0.75) {
              // You came at it: it gives ground (still stalking, not committed).
              tx = this.x - ((player.x - this.x) / dl) * 5;
              ty = this.y - ((player.y - this.y) / dl) * 5;
              tz = this.z - ((player.z - this.z) / dl) * 5;
              speed = Math.min(K.pursue, (m * 0.75 - dist) * 2 + 1.6);
              stick = 1;
            }
          }
        }
        if (!this.lethal) {
          // Non-lethal hunting (data-driven): it looms but holds off.
          const hold = Math.max(m, this.cfg.killRadius * T.engageMul * 1.6);
          speed *= U.clamp((dist - hold * 0.75) / (hold * 0.25), 0, 1);
        }
        break;
      }
      case S.BURST: {
        speed = K.burst * (0.85 + 0.25 * noise) + catchUp;
        // Heard you / lost patience: the crown snaps toward you first (a beat to react).
        if (this._snapping() && this.stateTime < K.snap) speed = 0.4;
        rate = T.burstSteerRate;
        const s = Math.max(swing, this.burstCommit ? 0.85 : 0.55);
        tx = U.lerp(this._hugX, player.x, s);
        ty = U.lerp(this._hugY, player.y, s);
        tz = U.lerp(this._hugZ, player.z, s);
        stick = 1 - s;
        break;
      }
      case S.OBSERVING: {
        // Hesitates: holds on the wall, sways, drifts a little toward the sound.
        speed = T.speed.observe * (0.5 + noise * 0.5);
        const sw = Math.sin(this._t * 0.7 + this.seed) * 1.6;
        tx = this.x + U.clamp(player.x - this.x, -2.4, 2.4) + this._tanX() * sw;
        ty = this.y + U.clamp(player.y - this.y, -2.4, 2.4);
        tz = this.z + U.clamp(player.z - this.z, -2.4, 2.4) + this._tanZ() * sw;
        stick = Math.max(stick, 0.7);
        rate = 2;
        break;
      }
      case S.RECOVERING: {
        // Withdraws upward along the masonry, slowing as it goes (escape: it
        // only pauses, holding no higher than 12 m over you).
        const k = 1 - U.smoothstep(0, Math.max(this.stateDur, 0.5) * 1.2, this.stateTime);
        speed = (T.speed.recover * k + 0.9) * Math.max(0.6, this.speedScale);
        tx = U.lerp(this.x, this._hugX, 0.3);
        ty = this.profile.holdOnRecover ? Math.min(this.y, player.y + 12) : this.y + 17;
        tz = U.lerp(this.z, this._hugZ, 0.3);
        stick = 1;
        rate = 2.2;
        if (!this.onSurface) {
          // Left hanging in the void after a lunge: haul back to the wall first.
          tx = this._hugX;
          ty = this._hugY + 8;
          tz = this._hugZ;
          speed = Math.max(speed, T.speed.recover);
        }
        break;
      }
      default:
        speed = 0;
    }
    if (!this.v && this.lethal && !this.creeping) {
      // It aims where you will be: a swing across the shaft does not shake it off.
      const w = this.state === S.BURST ? Math.max(swing, this.burstCommit ? 0.85 : 0.55) : this.state === S.PURSUING || this.state === S.APPROACHING ? swing : 0;
      if (w > 0.05) {
        const lead = U.clamp(dist / Math.max(8, this.speed + 6), 0, 1) * T.lead;
        let lx = this._pvx * lead;
        let ly = this._pvy * lead;
        let lz = this._pvz * lead;
        const ll = len3(lx, ly, lz);
        if (ll > T.leadMax) {
          const f = T.leadMax / ll;
          lx *= f;
          ly *= f;
          lz *= f;
        }
        tx += lx * w;
        ty += ly * w;
        tz += lz * w;
      }
    }
    if (speed > 0.5 && this._detour(tx, ty, tz)) {
      tx = this._dtx;
      ty = this._dty;
      tz = this._dtz;
      stick = Math.max(stick, 0.8);
    }
    this._weaveStep(dt, stick);
    this._moveToward(tx, ty, tz, speed, rate, dt, stick);
    this._surfaceStep(dt, stick);
  }

  /**
   * Masonry between the head and where it wants to go (a gallery floor, a
   * buttress, a stair step): instead of pressing into it, crawl to its nearest
   * FREE rim and over. Writes the detour goal to _dtx/_dty/_dtz; false when the
   * way is clear (or boxed in — the stuck guard takes over).
   */
  _detour(tx, ty, tz) {
    if (!this._detourOnce(tx, ty, tz)) return false;
    // The way to that rim may itself be blocked (a stair step in the corner):
    // one more pass, toward the rim.
    const gx = this._dtx;
    const gy = this._dty;
    const gz = this._dtz;
    if (!this._detourOnce(gx, gy, gz)) {
      this._dtx = gx;
      this._dty = gy;
      this._dtz = gz;
    }
    return true;
  }

  _detourOnce(tx, ty, tz) {
    const lv = this.level;
    if (!lv || typeof lv.querySolids !== 'function') return false;
    let dx = tx - this.x;
    let dy = ty - this.y;
    let dz = tz - this.z;
    const dl = len3(dx, dy, dz);
    if (dl < 1) return false;
    const L = Math.min(dl, 14);
    dx /= dl;
    dy /= dl;
    dz /= dl;
    const ex = this.x + dx * L;
    const ey = this.y + dy * L;
    const ez = this.z + dz * L;
    const list = lv.querySolids(Math.min(this.x, ex), Math.min(this.y, ey), Math.min(this.z, ez), Math.max(this.x, ex), Math.max(this.y, ey), Math.max(this.z, ez), this._solids);
    let best = null;
    let tBest = 2;
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (b.active === false) continue;
      const t = segmentBox(this.x, this.y, this.z, ex, ey, ez, b);
      if (t > 1e-4 && t < tBest) {
        tBest = t;
        best = b;
      }
    }
    if (!best) return false;
    // Entry face: the box face the path meets first.
    const px = this.x + dx * L * tBest;
    const py = this.y + dy * L * tBest;
    const pz = this.z + dz * L * tBest;
    const fx = Math.min(Math.abs(px - best.minX), Math.abs(px - best.maxX));
    const fy = Math.min(Math.abs(py - best.minY), Math.abs(py - best.maxY));
    const fz = Math.min(Math.abs(pz - best.minZ), Math.abs(pz - best.maxZ));
    const axis = fx <= fy && fx <= fz ? 0 : fy <= fz ? 1 : 2;
    const P = this._dP;
    const Q = this._dQ;
    const mn = this._dMn;
    const mx = this._dMx;
    P[0] = this.x;
    P[1] = this.y;
    P[2] = this.z;
    Q[0] = tx;
    Q[1] = ty;
    Q[2] = tz;
    mn[0] = best.minX;
    mn[1] = best.minY;
    mn[2] = best.minZ;
    mx[0] = best.maxX;
    mx[1] = best.maxY;
    mx[2] = best.maxZ;
    // In-plane axes (a, c) of that face. Candidate rims: the four edges, at the
    // point nearest the head and the point nearest the target. A rim only
    // counts when there is room beyond it on BOTH sides of the slab (a floor
    // jammed against a wall has no way round on that side): the free rim with
    // the shortest path head → rim → target wins.
    const a = axis === 0 ? 1 : 0;
    const c = axis === 2 ? 1 : 2;
    const m = this._hug + 1.5;
    const headSide = P[axis] >= (mn[axis] + mx[axis]) * 0.5 ? mx[axis] + this._hug : mn[axis] - this._hug;
    const farSide = Q[axis] < mn[axis] ? mn[axis] - this._hug : Q[axis] > mx[axis] ? mx[axis] + this._hug : headSide;
    const G = this._dG;
    let bestCost = Infinity;
    let ba = 0;
    let bc = 0;
    for (let e = 0; e < 4; e++) {
      for (let s = 0; s < 2; s++) {
        const R = s === 0 ? P : Q;
        let ga;
        let gc;
        if (e < 2) {
          ga = e === 0 ? mn[a] - m : mx[a] + m;
          gc = U.clamp(R[c], mn[c], mx[c]);
        } else {
          ga = U.clamp(R[a], mn[a], mx[a]);
          gc = e === 2 ? mn[c] - m : mx[c] + m;
        }
        G[a] = ga;
        G[c] = gc;
        G[axis] = headSide;
        const d1 = len3(G[0] - P[0], G[1] - P[1], G[2] - P[2]);
        const d2 = len3(Q[0] - G[0], Q[1] - G[1], Q[2] - G[2]);
        // A rim whose way on to the target runs straight back through the same
        // slab (over the top of a landing when you are underneath it) only
        // looks short: last resort.
        const cost = d1 + d2 + (segmentBox(G[0], G[1], G[2], Q[0], Q[1], Q[2], best) >= 0 ? 1000 : 0);
        if (cost >= bestCost) continue;
        if (!this._clearAt(G[0], G[1], G[2])) continue;
        // …and only a rim it can reach from here: not one on the far side of a wall.
        if (typeof lv.segmentBlocked === 'function' && lv.segmentBlocked(P[0], P[1], P[2], G[0], G[1], G[2], 0)) continue;
        G[axis] = farSide;
        if (!this._clearAt(G[0], G[1], G[2])) continue;
        bestCost = cost;
        ba = ga;
        bc = gc;
      }
    }
    if (bestCost === Infinity) return false; // boxed in: the stuck guard takes over
    G[a] = ba;
    G[c] = bc;
    G[axis] = headSide;
    // Reached the rim on this side: go round it to the far side.
    if (len3(G[0] - P[0], G[1] - P[1], G[2] - P[2]) < 2.5) G[axis] = farSide;
    this._dtx = G[0];
    this._dty = G[1];
    this._dtz = G[2];
    return true;
  }

  /**
   * Crawling bodies do not travel in straight lines: a slow sideways weave
   * along the wall (perpendicular to the motion, in the wall's tangent plane)
   * gives the trail — and so the 20-block body — a sinuous S.
   */
  _weaveStep(dt, stick) {
    const sp = this.speed;
    if (!(sp > 0.3) || stick < 0.4 || !this.onSurface) return;
    this._weave += (sp * dt * TAU) / T.weaveLength;
    // side = n × v̂ (in the tangent plane, across the motion)
    const vx = this.vx / sp;
    const vy = this.vy / sp;
    const vz = this.vz / sp;
    let sx = this.ny * vz - this.nz * vy;
    let sy = this.nz * vx - this.nx * vz;
    let sz = this.nx * vy - this.ny * vx;
    const sl = len3(sx, sy, sz);
    if (sl < 1e-3) return;
    const a = Math.cos(this._weave) * T.weave * sp * stick * (1 - Math.exp(-6 * dt));
    sx /= sl;
    sy /= sl;
    sz /= sl;
    this.vx += sx * a;
    this.vy += sy * a;
    this.vz += sz * a;
  }

  /** Horizontal tangent of the wall it clings to (for side-to-side sway). */
  _tanX() {
    const l = len2(this.nx, this.nz);
    return l > 1e-3 ? -this.nz / l : 1;
  }
  _tanZ() {
    const l = len2(this.nx, this.nz);
    return l > 1e-3 ? this.nx / l : 0;
  }

  _maybeChangeRoute(player, below) {
    this.routeTimer = 7 + this._rand() * 9;
    if (Math.abs(below) < 20) return; // never while it is reaching for you
    // 70%: come down the wall nearest the player; otherwise somewhere else entirely.
    const near = this._nearestWallAz(player.x, player.y, player.z);
    this.az = this._rand() < 0.7 ? near : near + Math.PI * (0.5 + this._rand());
    this._hugT = 0;
  }

  // ---- attack ----------------------------------------------------------------------

  _startAttack(cause) {
    if (this._losBlocked(null)) {
      // Masonry between you (it is above the floor you hang under): no strike
      // through stone — it hunts for a way round instead (see _watchdog).
      this._lungeFails++;
      this.creeping = false;
      this._setState(S.PURSUING);
      return;
    }
    const a = this.attack;
    a.cause = cause || 'contact';
    if (cause !== 'lunge') this.burstReason = cause || 'contact';
    this._lungeFails = 0;
    a.phase = 'windup';
    a.t = 0;
    a.hit = false;
    a.windup = U.clamp(this.k.windup, T.windupMin, T.windup);
    // The wind-up is a coil, not a continuation of the surge: shed momentum so
    // the telegraph is honest and a player moving away really can escape.
    const sp = len3(this.vx, this.vy, this.vz);
    const cap = this.k.windupAdv * 0.5;
    if (sp > cap) {
      this.vx *= cap / sp;
      this.vy *= cap / sp;
      this.vz *= cap / sp;
    }
    this.stats.attacks++;
    this._setState(S.ATTACK);
    this._emit('creature:attack', { x: this.x, y: this.y, z: this.z, windup: a.windup, distance: this.distance, cause: a.cause });
  }

  _updateAttack(dt, player) {
    const a = this.attack;
    if (!a.phase) {
      this._setState(S.RECOVERING);
      return;
    }
    a.t += dt;
    if (a.phase === 'windup') {
      // Committed, telegraphed advance while the crown flares. Moving away
      // fast enough during this window turns the lunge into a near miss.
      this._moveToward(player.x, player.y, player.z, this.k.windupAdv, 6, dt, 0);
      this._surfaceStep(dt, 0);
      if (a.t >= a.windup) this._strike(player);
    } else if (a.phase === 'strike') {
      const k = Math.min(1, a.t / T.strikeTime);
      const e = 1 - (1 - k) * (1 - k);
      const nx = U.lerp(a.sx, a.lx, e);
      const ny = U.lerp(a.sy, a.ly, e);
      const nz = U.lerp(a.sz, a.lz, e);
      this.vx = (nx - this.x) / dt;
      this.vy = (ny - this.y) / dt;
      this.vz = (nz - this.z) / dt;
      this.x = nx;
      this.y = ny;
      this.z = nz;
      if (a.t >= T.strikeTime) {
        a.phase = 'recoil';
        a.t = 0;
      }
    } else {
      this._moveToward(a.sx, a.sy + 2.8, a.sz, 10, 4, dt, 0.3);
      this._surfaceStep(dt, 0.3);
      if (a.t >= T.postStrike) {
        a.phase = null;
        this._setState(S.RECOVERING);
      }
    }
  }

  _strike(player) {
    const a = this.attack;
    const dx = player.x - this.x;
    const dy = player.y - this.y;
    const dz = player.z - this.z;
    const d = len3(dx, dy, dz) || 1;
    // A stall lunge has had all the time it needed to study you: it reaches further.
    const reach = this.cfg.killRadius * T.strikeMul * (this.burstReason === 'stall' ? 1.25 : 1);
    const hit = this.lethal && player.alive !== false && this.grace <= 0 && d <= reach;
    a.sx = this.x;
    a.sy = this.y;
    a.sz = this.z;
    if (hit) {
      a.lx = player.x;
      a.ly = player.y;
      a.lz = player.z;
      if (this.v) this.hitPlayer = true; // variants hurt (game applies hitDamage); only the Mason kills outright
      else this.caughtPlayer = true;
      this.stats.hits++;
    } else {
      let ext = Math.min(d, reach + 1.6);
      // Never lunge through masonry: stop short of the first solid on the way.
      const lv = this.level;
      if (lv && typeof lv.querySolids === 'function') {
        const ex = this.x + (dx / d) * ext;
        const ey = this.y + (dy / d) * ext;
        const ez = this.z + (dz / d) * ext;
        const list = lv.querySolids(Math.min(this.x, ex), Math.min(this.y, ey), Math.min(this.z, ez), Math.max(this.x, ex), Math.max(this.y, ey), Math.max(this.z, ez), this._solids);
        let tMin = 1;
        for (let i = 0; i < list.length; i++) {
          if (list[i].active === false) continue;
          const t = segmentBox(this.x, this.y, this.z, ex, ey, ez, list[i]);
          if (t > 0 && t < tMin) tMin = t;
        }
        if (tMin < 1) ext = Math.max(0, tMin * ext - 0.8);
      }
      a.lx = this.x + (dx / d) * ext;
      a.ly = this.y + (dy / d) * ext;
      a.lz = this.z + (dz / d) * ext;
      this.nearMiss = d < reach * 2.2 ? 1 : 0.6;
      this.stats.nearMisses++;
    }
    a.hit = hit;
    a.phase = 'strike';
    a.t = 0;
    this._drain(T.drainLunge);
    const md = len3(player.x - a.lx, player.y - a.ly, player.z - a.lz);
    this._emit('creature:strike', { x: a.lx, y: a.ly, z: a.lz, hit, distance: md, cause: a.cause, reason: this.burstReason });
    this._emitStep(a.lx, a.ly, a.lz, 1, md, true);
  }

  // ---- victory ---------------------------------------------------------------------

  _updateVictory(dt, player) {
    const v = this.victory;
    v.t += dt;
    this.distance = len3(player.x - this.x, player.y - this.y, player.z - this.z);
    if (v.phase === 'charge') {
      const tx = v.gx + v.ox * 1.1;
      const ty = v.gy + v.oy * 1.1;
      const tz = v.gz + v.oz * 1.1;
      this._moveToward(tx, ty, tz, 38, 7, dt, 0);
      // Hit no earlier than 0.35 s: LevelView's gate takes about that long to drop,
      // so the creature strikes iron that is already down.
      if ((v.t >= 0.35 && len3(tx - this.x, ty - this.y, tz - this.z) < 2) || v.t > 1.5) {
        v.phase = 'slam';
        v.t = 0;
        this.vx *= -0.25;
        this.vy *= -0.25;
        this.vz *= -0.25;
        this._setState(S.ATTACK);
        this._emit('creature:attack', { x: this.x, y: this.y, z: this.z, gate: true, distance: this.distance });
        this._emitStep(v.gx, v.gy, v.gz, 1, this.distance, true);
        this.nearMiss = 1;
        v.hits = 1;
      }
    } else if (v.phase === 'slam') {
      // Recoil off the grating, crown thrashing (shake across the struck face).
      const shake = Math.sin(v.t * 20) * 0.55;
      const px = Math.abs(v.oy) > 0.5 ? 1 : 0;
      const py = Math.abs(v.oy) > 0.5 ? 0 : 1;
      this._moveToward(v.gx + v.ox * 3.6 + px * shake, v.gy + v.oy * 3.6 + py * shake, v.gz + v.oz * 3.6, 6.5, 5, dt, 0);
      if (v.hits === 1 && v.t >= 0.9) {
        // A second blow: it is still thrashing at the bars when the player turns round.
        v.hits = 2;
        this._emit('creature:attack', { x: this.x, y: this.y, z: this.z, gate: true, distance: this.distance });
        this._emitStep(v.gx, v.gy, v.gz, 1, this.distance, true);
        this.nearMiss = 1;
      }
      // Withdraws only as the victory panel comes up (Game VICTORY_DELAY 2.8 s).
      if (v.t > 1.8) {
        v.phase = 'retreat';
        v.t = 0;
        this.stateDur = 3;
        this._setState(S.RECOVERING);
      }
    } else {
      this._scanHugIfNeeded(dt, player);
      this._moveToward(this._hugX, this.y + 16, this._hugZ, U.lerp(8, 2.4, U.clamp(v.t / 4, 0, 1)), 2, dt, 1);
      this._surfaceStep(dt, 1);
    }
  }

  // ---- dormant / sighting (far away, unseen) -------------------------------------------

  _placeFar(ref) {
    const lv = this.level;
    const b = lv && lv.bounds ? lv.bounds : null;
    const cx = b ? (b.minX + b.maxX) / 2 : num(ref && ref.x, 0);
    const cz = b ? (b.minZ + b.maxZ) / 2 : num(ref && ref.z, 0);
    const r = b ? Math.max(b.maxX - b.minX, b.maxZ - b.minZ) * 0.5 + 18 : 40;
    // Out beyond the shaft walls, deep below: only rare, distant sounds come from it.
    this.x = cx + Math.cos(this._farAz) * r;
    this.z = cz + Math.sin(this._farAz) * r;
    this.y = num(ref && ref.y, 0) - this._farBelow;
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
  }

  _updateDormant(dt, player) {
    this._farBelow = U.clamp(this._farBelow + noise1(this._t * 0.05, this.seed) * 1.6 * dt, T.farBelowMin, T.farBelowMax);
    this._farAz += noise1(this._t * 0.03, this.seed + 5) * 0.02 * dt;
    this._placeFar(player);
    this.distance = len3(player.x - this.x, player.y - this.y, player.z - this.z);
    this._ambientSounds(dt);
  }

  _ambientSounds(dt) {
    this._ambTimer -= dt;
    if (this._ambTimer <= 0) {
      this._ambTimer = 13 + this._rand() * 14;
      this._ambSteps = 2 + ((this._rand() * 3) | 0);
      this._ambStepTimer = 0;
    }
    if (this._ambSteps > 0) {
      this._ambStepTimer -= dt;
      if (this._ambStepTimer <= 0) {
        this._ambSteps--;
        this._ambStepTimer = 0.25 + this._rand() * 0.45;
        const j = 12;
        this._emitStep(
          this.x + (this._rand() - 0.5) * j,
          this.y + (this._rand() - 0.5) * j,
          this.z + (this._rand() - 0.5) * j,
          0.25 + this._rand() * 0.3,
          this.distance,
          true,
        );
      }
    }
    this._ambCallTimer -= dt;
    if (this._ambCallTimer <= 0) {
      this._ambCallTimer = 35 + this._rand() * 35;
      if (this._rand() < 0.5) this._farAz += Math.PI * (0.5 + this._rand()); // the next sound comes from elsewhere
      this._emit('creature:call', { x: this.x, y: this.y, z: this.z, distance: this.distance, intensity: 0.3 + this._rand() * 0.2 });
    }
  }

  _updateSighting(dt, player) {
    if (!this.sighting && !this.sightingDone) {
      const trig = this._sightTrigger;
      if (trig) {
        // Fallback in case the trigger event was never delivered (descent = -y).
        if (player.y <= num(trig.y, -Infinity) - 6) this._beginSighting(trig.data, player);
      } else if (this._sightAuto > 0) {
        this._sightAuto -= dt;
        if (this._sightAuto <= 0) this._beginSighting(null, player);
      }
    }
    const s = this.sighting;
    if (s) {
      s.t += dt;
      const k = s.t / s.duration;
      const want = k >= 0.4 && k < 0.62 ? S.OBSERVING : S.DISTANT;
      if (this.state !== want) this._setState(want);
      // Crawls along its far path, stopping mid-way to turn its crown toward you.
      const u = this._crossU(k) - 0.5;
      const tx = s.x + s.dx * u * s.span;
      const ty = s.y + s.dy * u * s.span;
      const tz = s.z + s.dz * u * s.span;
      this.vx = (tx - this.x) / dt;
      this.vy = (ty - this.y) / dt;
      this.vz = (tz - this.z) / dt;
      this.x = tx;
      this.y = ty;
      this.z = tz;
      // The path runs along a far wall: lie on it (dorsal side out, limbs gripping).
      if (this._findSurface(tx, ty, tz, T.surfaceSearch, this._surf) < Infinity) {
        const kn = 1 - Math.exp(-T.normalRate * dt);
        this.nx += (this._surf.nx - this.nx) * kn;
        this.ny += (this._surf.ny - this.ny) * kn;
        this.nz += (this._surf.nz - this.nz) * kn;
        const nl = len3(this.nx, this.ny, this.nz) || 1;
        this.nx /= nl;
        this.ny /= nl;
        this.nz /= nl;
        this.onSurface = true;
      }
      this.distance = len3(player.x - this.x, player.y - this.y, player.z - this.z);
      if (s.t >= s.duration) {
        this.sighting = null;
        this.sightingDone = true;
        this._answerTimer = 2.8; // …and something answers.
        this._setState(S.DISTANT);
        this._placeFar(player);
      }
      return;
    }
    if (this._answerTimer > 0) {
      this._answerTimer -= dt;
      if (this._answerTimer <= 0) {
        this._emit('creature:call', { x: this.x, y: this.y, z: this.z, distance: this.distance, intensity: 0.55 });
      }
    }
    this._updateDormant(dt, player);
  }

  /** Crossing progress with a mid-way pause (it stops, turns, "looks"). */
  _crossU(k) {
    if (k < 0.4) return (k / 0.4) * 0.46;
    if (k < 0.62) return 0.46 + ((k - 0.4) / 0.22) * 0.05;
    return 0.51 + ((k - 0.62) / 0.38) * 0.49;
  }

  /**
   * The far crossing. Trigger data (all optional): {x,y,z} centre of the path
   * (default: shaft centre 55 m below the player), {dx,dy,dz} path direction or
   * dir ±1 along X, span (m, default ~1.6× the shaft width), duration (s).
   */
  _beginSighting(data, player) {
    if (!this.active || this.inPlay || this.sighting || this.sightingDone) return;
    const lv = this.level;
    const b = lv && lv.bounds ? lv.bounds : null;
    const d = data || {};
    const x = num(d.x, b ? (b.minX + b.maxX) / 2 : num(player && player.x, 0));
    const y = num(d.y, num(player && player.y, this._py) - 55);
    const z = num(d.z, b ? (b.minZ + b.maxZ) / 2 : num(player && player.z, 0));
    let dx = num(d.dx, NaN);
    let dy = num(d.dy, 0);
    let dz = num(d.dz, 0);
    if (!isFinite(dx)) {
      if (d.dir === 1 || d.dir === -1) {
        dx = d.dir;
        dz = 0;
      } else {
        const a = this._rand() * TAU;
        dx = Math.cos(a);
        dz = Math.sin(a);
      }
      dy = 0;
    }
    const dl = len3(dx, dy, dz) || 1;
    dx /= dl;
    dy /= dl;
    dz /= dl;
    const width = b ? Math.max(b.maxX - b.minX, b.maxZ - b.minZ) : 40;
    const span = Math.max(10, num(d.span, Math.min(width * 1.6, 90)));
    const duration = Math.max(3, num(d.duration, T.sightingDuration));
    this.sighting = { x, y, z, dx, dy, dz, span, t: 0, duration, dir: dx >= 0 ? 1 : -1 };
    this.x = x - dx * span * 0.5;
    this.y = y - dy * span * 0.5;
    this.z = z - dz * span * 0.5;
    this.vx = dx * (span / duration);
    this.vy = dy * (span / duration);
    this.vz = dz * (span / duration);
    this.hx = dx;
    this.hy = dy;
    this.hz = dz;
    this.nx = 0;
    this.ny = 1;
    this.nz = 0;
    if (this._findSurface(this.x, this.y, this.z, T.surfaceSearch, this._surf) < Infinity) {
      this.nx = this._surf.nx;
      this.ny = this._surf.ny;
      this.nz = this._surf.nz;
    }
    this._layBody(dx, dy, dz);
    this._setState(S.DISTANT);
    this._emit('creature:sighting', { x, y, z, duration });
  }

  _onSightingTrigger(payload) {
    const p = payload || {};
    this._beginSighting(p.data, { x: num(p.x, this._px), y: num(p.y, this._py), z: num(p.z, this._pz) });
  }

  _onCallTrigger() {
    if (!this.active || this.victory) return;
    this._emit('creature:call', { x: this.x, y: this.y, z: this.z, distance: this.distance, intensity: 0.8 });
  }

  _ambientCall(dist) {
    this.callTimer = 14 + this._rand() * 18;
    if (dist < 20) return; // close up, silence is worse
    this._emit('creature:call', { x: this.x, y: this.y, z: this.z, distance: dist, intensity: 0.5 + this._rand() * 0.3 });
  }

  // ---- state helpers ---------------------------------------------------------------------

  _setState(to) {
    if (this.state === to) return;
    const from = this.state;
    if (to !== S.OBSERVING) this.staring = false;
    this.state = to;
    this.stateTime = 0;
    this.audio.state = to;
    if (to === S.RECOVERING) {
      if (!this.victory) this.stateDur = this.k.recoverMin;
      this.listening = false;
      this.stats.retreats++;
    }
    this._emit('creature:state', { from, to, x: this.x, y: this.y, z: this.z, distance: this.distance });
    if (to === S.RECOVERING) this._emit('creature:retreat', { x: this.x, y: this.y, z: this.z, distance: this.distance });
  }

  _enterObserve(dur, listening) {
    this.listening = listening;
    this.stateDur = dur;
    if (listening) {
      this.listenCd = T.listenCooldown;
      this._listenedThisStill = true;
      this.stats.listens++;
    } else if (this._rand() < 0.4) {
      this.az += Math.PI * (0.35 + this._rand() * 0.5) * (this._rand() < 0.5 ? -1 : 1); // uncertainty: it changes its route
      this._hugT = 0;
    }
    if (this.state === S.OBSERVING) this.stateTime = 0;
    else this._setState(S.OBSERVING);
  }

  /**
   * A surge. `commit` = a real lunge at you (ends in a telegraphed ATTACK if it
   * gets in range); otherwise a pressure surge that stops short at the
   * stalking distance — loud and frightening, but it does not strike.
   */
  _startBurst(commit, reason) {
    this.burstCommit = !!commit;
    this.burstReason = reason || (commit ? 'commit' : 'surge');
    this.creeping = false;
    this.stateDur = T.burstDurMin + this._rand() * (T.burstDurMax - T.burstDurMin);
    if (this.burstCommit) {
      // A committed lunge carries on until it is in reach — across open voids
      // too (it launches itself off the masonry at you) — within reason.
      const need = (this.distance - this.cfg.killRadius * T.engageMul) / Math.max(1, this.k.burst) + 0.5;
      this.stateDur = U.clamp(Math.max(this.stateDur, need), this.stateDur, 3.5);
    }
    if (this._snapping()) this.stateDur += this.k.snap;
    this._drain(T.drainBurstEntry);
    this._scheduleBurst();
    this.stats.bursts++;
    this._setState(S.BURST);
    this._emit('creature:burst', { x: this.x, y: this.y, z: this.z, distance: this.distance, commit: this.burstCommit, reason: this.burstReason, snap: this._snapping() ? this.k.snap : 0 });
  }

  /** Bursts that open with the crown snapping toward you (see DIFF_TUNE.snap). */
  _snapping() {
    return this.burstReason === 'heard' || this.burstReason === 'stall';
  }

  _scheduleBurst() {
    const rate = this.k.burstRate;
    this.burstTimer = rate > 0 ? Math.max(3, ((0.6 + this._rand() * 0.8) * 60) / rate) : 1e9;
  }

  _drain(amount) {
    this.stamina = Math.max(0, this.stamina - amount * this.cfg.staminaDrain);
  }

  _regen(amount) {
    this.stamina = Math.min(1, this.stamina + amount * this.cfg.staminaRegen);
  }

  _applyScaling(c) {
    const prof = this.profile || MODES.hunt;
    const D = DIFF_TUNE[this.tuneKey] || DIFF_TUNE.normal;
    const k = this.k;
    // Section speedMul stacks on the mode profile. Speed-ups are applied at half
    // strength and the product is capped so data tweaks can never make a
    // difficulty unescapable (the pursuit sims are very sensitive to this).
    const sm = U.clamp(num(c.speedMul, 1), 0.5, 1.6);
    const secEff = sm > 1 ? 1 + (sm - 1) * 0.5 : Math.max(0.75, sm);
    const mEff = Math.min(prof.speed * secEff, Math.max(prof.speed, T.maxModeSpeed));
    const vs = this.v ? (this.v.speedMulBy && this.v.speedMulBy[this.tuneKey] != null ? this.v.speedMulBy[this.tuneKey] : this.v.speedMul) : 1;
    const spd = this.cfg.speedRatio * mEff * vs;
    this.speedScale = spd;
    k.approach = D.approach * spd;
    k.pursue = D.pursue * spd;
    k.burst = D.burst * spd;
    k.windupAdv = D.windupAdv * spd;
    k.creep = D.creep * prof.creep * this.cfg.speedRatio * vs;
    k.menace = D.menace * prof.menace;
    k.holdBack = D.holdBack;
    k.listenDelay = D.listenDelay * prof.listen;
    k.listenDur = D.listenDur * prof.listen;
    k.windup = D.windup * (this.v ? this.v.windupMul : 1);
    k.snap = D.snap;
    // section.burstRate (if given) scales relative to a nominal 2.6 surges/min.
    const secBurst = num(c.burstRate, 0) > 0 ? U.clamp(c.burstRate / 2.6, 0.5, 2) : 1;
    k.burstRate = D.burstRate * prof.burst * secBurst;
    k.commit = Math.min(0.95, D.commit * prof.commit);
    k.heardCommit = D.heardCommit;
    k.drain = D.drain;
    k.regen = D.regen;
    k.recoverMin = D.recoverMin * prof.recover;
    k.maxGap = D.maxGap;
    k.stallCommit = D.stallCommit * prof.stall;
  }

  /** spawnOffsetY → metres above the player (sign-agnostic, clamped to a sane range). */
  _spawnAbove(v) {
    return U.clamp(Math.abs(num(v, SECTION_DEFAULTS.spawnOffsetY)), T.spawnAboveMin, T.spawnAboveMax);
  }

  _enterPlay(player, above, grace, below = false) {
    this._belowSign = below ? -1 : 1; // a skitterling that comes up from below stays below when it relocates (see _relocate)
    const lv = this.level;
    const sp = lv && lv.spawn ? lv.spawn : { x: 0, y: 0, z: 0 };
    const px = player ? player.x : num(sp.x, 0);
    const py = player ? player.y : num(sp.y, 0);
    const pz = player ? player.z : num(sp.z, 0);
    let y = py + this._belowSign * Math.max(T.spawnAboveMin * 0.5, num(above, 45));
    const b = lv && lv.bounds;
    if (this._belowSign < 0 && b && y < b.minY + 8) {
      // no shaft left below the player (the last stretch): this one comes from above after all
      this._belowSign = 1;
      y = py + Math.max(T.spawnAboveMin * 0.5, num(above, 45));
    }
    const near = this._nearestWallAz(px, y, pz);
    this.az = this._rand() < 0.65 ? near : near + Math.PI * (0.5 + this._rand());
    // Start on that wall, high above.
    const ok = this._wallPointAt(px, y, pz, this.az);
    if (ok) {
      const h = this._hit;
      this.x = px + Math.cos(h.az) * (h.t - this._hug);
      this.y = y;
      this.z = pz + Math.sin(h.az) * (h.t - this._hug);
    } else {
      this.x = px;
      this.y = y;
      this.z = pz;
    }
    this._clampToBounds();
    this.vx = 0;
    this.vy = -6 * this._belowSign;
    this.vz = 0;
    this.hx = 0;
    this.hy = -this._belowSign; // it faces the way it came: down from above, up from below
    this.hz = 0;
    if (this._findSurface(this.x, this.y, this.z, T.surfaceSearch * 2, this._surf) < Infinity) {
      this.nx = this._surf.nx;
      this.ny = this._surf.ny;
      this.nz = this._surf.nz;
    } else {
      this.nx = -Math.cos(this.az);
      this.ny = 0;
      this.nz = -Math.sin(this.az);
    }
    this._layBody(0, -this._belowSign, 0);
    this.inPlay = true;
    this.lethal = this.sectionCfg.lethal === true && LETHAL_MODES[this.mode] === true;
    this.sighting = null;
    this.stamina = 1;
    this.grace = grace;
    this._scheduleBurst();
    this.burstTimer = Math.max(this.burstTimer * 0.5, 4);
    this.listenCd = 0;
    this.creeping = false;
    this.burstCommit = false;
    this.attack.phase = null;
    this.listening = false;
    this.stateDur = 0;
    this._hugT = 0;
    this._setState(S.APPROACHING);
    this._updateSpine();
    this._updateCrown(0);
  }

  _leavePlay() {
    this.inPlay = false;
    this.lethal = false;
    this.attack.phase = null;
    this.listening = false;
    this.creeping = false;
  }

  _quiet() {
    const a = this.audio;
    a.intensity = 0;
    a.movement = 0;
    a.distance = FAR;
    a.state = this.state;
    this.distance = FAR;
  }

  // ===========================================================================
  // Crawl: steering, surface following, walls
  // ===========================================================================

  /**
   * Steers the head toward (tx,ty,tz) at `speed`, easing velocity at `rate`
   * (1/s). `stick` 0..1: how much of the motion is constrained to the tangent
   * plane of the wall it clings to (1 = crawls along the wall, 0 = free).
   */
  _moveToward(tx, ty, tz, speed, rate, dt, stick) {
    const am = this.annoyMul;
    if (am !== 1) {
      speed *= am;
      rate *= Math.min(3, 1 + 0.5 * (am - 1)); // the surge is felt: it also accelerates harder
    }
    const dx = tx - this.x;
    const dy = ty - this.y;
    const dz = tz - this.z;
    const dl = len3(dx, dy, dz);
    let dvx = 0;
    let dvy = 0;
    let dvz = 0;
    this._ox = this.x;
    this._oy = this.y;
    this._oz = this.z;
    // A target straight out in front of the surface (the underside of a pillar,
    // a ledge it cannot crawl around) means letting go; so does the watchdog.
    if (this._freeT > 0) stick = 0;
    else if (stick > 0 && this.onSurface && dl > 1e-3) {
      stick *= 1 - U.smoothstep(0.55, 0.85, (dx * this.nx + dy * this.ny + dz * this.nz) / dl);
    }
    this._stickEff = stick;
    if (dl > 0.02 && speed > 0) {
      const s = Math.min(speed, dl * 3); // arrive softly instead of overshooting
      dvx = (dx / dl) * s;
      dvy = (dy / dl) * s;
      dvz = (dz / dl) * s;
      if (stick > 0 && this.onSurface) {
        // Crawl: the same speed, redirected along the wall's tangent plane.
        const n = dvx * this.nx + dvy * this.ny + dvz * this.nz;
        let ax = dvx - this.nx * n;
        let ay = dvy - this.ny * n;
        let az = dvz - this.nz * n;
        let al = len3(ax, ay, az);
        if (al < s * 0.15) {
          // Target straight through the wall/void: go around (consistent side).
          ax += this._tanX() * s * 0.5;
          az += this._tanZ() * s * 0.5;
          ay -= s * 0.2;
          al = len3(ax, ay, az);
        }
        const k = al > 1e-6 ? s / al : 0;
        dvx = U.lerp(dvx, ax * k, stick);
        dvy = U.lerp(dvy, ay * k, stick);
        dvz = U.lerp(dvz, az * k, stick);
      }
    }
    const k = 1 - Math.exp(-rate * dt);
    this.vx += (dvx - this.vx) * k;
    this.vy += (dvy - this.vy) * k;
    this.vz += (dvz - this.vz) * k;
    if (!isFinite(this.vx) || !isFinite(this.vy) || !isFinite(this.vz)) {
      this.vx = 0;
      this.vy = 0;
      this.vz = 0;
    }
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.z += this.vz * dt;
  }

  /**
   * After moving: cling to the nearest structural surface at the hug height
   * (weighted by `stick`), keep clear of every solid (crawling over ledges
   * rather than through them) and stay inside the level bounds.
   */
  _surfaceStep(dt, stickIn) {
    const stick = Math.min(stickIn, this._stickEff);
    const sf = this._surf;
    const d = this._findSurface(this.x, this.y, this.z, T.surfaceSearch, sf);
    this.onSurface = d < Infinity;
    if (this.onSurface) {
      const kn = 1 - Math.exp(-T.normalRate * dt);
      this.nx += (sf.nx - this.nx) * kn;
      this.ny += (sf.ny - this.ny) * kn;
      this.nz += (sf.nz - this.nz) * kn;
      const nl = len3(this.nx, this.ny, this.nz);
      if (nl > 1e-6) {
        this.nx /= nl;
        this.ny /= nl;
        this.nz /= nl;
      } else {
        this.nx = sf.nx;
        this.ny = sf.ny;
        this.nz = sf.nz;
      }
      if (stick > 0) {
        const err = (this._hug - d) * Math.min(1, T.adhesionRate * dt) * stick;
        this.x += sf.nx * err;
        this.y += sf.ny * err;
        this.z += sf.nz * err;
        const vn = this.vx * sf.nx + this.vy * sf.ny + this.vz * sf.nz;
        const kv = Math.min(1, 8 * dt) * stick;
        this.vx -= sf.nx * vn * kv;
        this.vy -= sf.ny * vn * kv;
        this.vz -= sf.nz * vn * kv;
      }
    }
    this._keepClear();
    this._clampToBounds();
  }

  /** Nearest structural surface within `radius`; writes point+normal into o. Returns the distance or Infinity. */
  _findSurface(px, py, pz, radius, o) {
    const lv = this.level;
    if (!lv || typeof lv.querySolids !== 'function') return Infinity;
    const list = lv.querySolids(px - radius, py - radius, pz - radius, px + radius, py + radius, pz + radius, this._solids);
    const tmp = this._surfTmp;
    let best = radius;
    let found = false;
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (!isStructural(s)) continue;
      const d = boxSurface(s, px, py, pz, tmp);
      const ad = d < 0 ? 0 : d;
      if (ad < best) {
        best = ad;
        found = true;
        o.x = tmp.x;
        o.y = tmp.y;
        o.z = tmp.z;
        o.nx = tmp.nx;
        o.ny = tmp.ny;
        o.nz = tmp.nz;
      }
    }
    return found ? best : Infinity;
  }

  /**
   * Keeps the head out of every active solid (minClear). Blocked by a ledge it
   * slides toward the ledge's nearer edge, so it climbs around platforms.
   */
  _keepClear() {
    const lv = this.level;
    if (!lv || typeof lv.querySolids !== 'function') return;
    const r = this._minClear;
    const list = lv.querySolids(this.x - r, this.y - r, this.z - r, this.x + r, this.y + r, this.z + r, this._solids);
    const o = this._surf2;
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (s.active === false) continue;
      let d = boxSurface(s, this.x, this.y, this.z, o);
      if (d >= r) continue;
      if (d < 0 && boxSurface(s, this._ox, this._oy, this._oz, o) > 0) {
        // Tunnelled in this step (a fast surge): back out on the side it came from.
        this.x = o.x;
        this.y = o.y;
        this.z = o.z;
        d = 0;
      }
      const push = r - d;
      this.x += o.nx * push;
      this.y += o.ny * push;
      this.z += o.nz * push;
      const vn = this.vx * o.nx + this.vy * o.ny + this.vz * o.nz;
      if (vn < 0) {
        this.vx -= o.nx * vn;
        this.vy -= o.ny * vn;
        this.vz -= o.nz * vn;
        if (!isStructural(s)) {
          // Slide around the obstacle toward its nearer edge (in the face plane).
          const cx = (s.minX + s.maxX) * 0.5;
          const cz = (s.minZ + s.maxZ) * 0.5;
          let sx = this.x - cx;
          let sz = this.z - cz;
          const sn = sx * o.nx + sz * o.nz;
          sx -= o.nx * sn;
          sz -= o.nz * sn;
          const sl = len2(sx, sz);
          if (sl > 1e-3) {
            this.vx += (sx / sl) * -vn;
            this.vz += (sz / sl) * -vn;
          } else {
            this.vy += -vn; // dead centre under/over it: go up and around
          }
        }
      }
    }
  }

  /** Is the point at least minClear away from every active solid? */
  _clearAt(x, y, z) {
    const lv = this.level;
    if (!lv || typeof lv.querySolids !== 'function') return true;
    const r = this._minClear;
    const list = lv.querySolids(x - r, y - r, z - r, x + r, y + r, z + r, this._solids);
    const o = this._surf2;
    for (let i = 0; i < list.length; i++) {
      if (list[i].active !== false && boxSurface(list[i], x, y, z, o) < r) return false;
    }
    return true;
  }

  _clampToBounds() {
    const lv = this.level;
    const b = lv && lv.bounds;
    if (!b) return;
    // While hunting it keeps to the shaft itself (level.shaftAt): it does not
    // wander out through a window onto a side hall's sill.
    if (this.inPlay && !this.victory && typeof lv.shaftAt === 'function') {
      const sh = lv.shaftAt(this.y);
      if (sh && this._px >= sh.minX && this._px <= sh.maxX && this._pz >= sh.minZ && this._pz <= sh.maxZ) {
        const sm = 2;
        if (this.x < sh.minX - sm) {
          this.x = sh.minX - sm;
          if (this.vx < 0) this.vx = 0;
        } else if (this.x > sh.maxX + sm) {
          this.x = sh.maxX + sm;
          if (this.vx > 0) this.vx = 0;
        }
        if (this.z < sh.minZ - sm) {
          this.z = sh.minZ - sm;
          if (this.vz < 0) this.vz = 0;
        } else if (this.z > sh.maxZ + sm) {
          this.z = sh.maxZ + sm;
          if (this.vz > 0) this.vz = 0;
        }
      }
    }
    const m = 3;
    if (this.x < b.minX - m) {
      this.x = b.minX - m;
      if (this.vx < 0) this.vx = 0;
    } else if (this.x > b.maxX + m) {
      this.x = b.maxX + m;
      if (this.vx > 0) this.vx = 0;
    }
    if (this.z < b.minZ - m) {
      this.z = b.minZ - m;
      if (this.vz < 0) this.vz = 0;
    } else if (this.z > b.maxZ + m) {
      this.z = b.maxZ + m;
      if (this.vz > 0) this.vz = 0;
    }
    if (isFinite(b.maxY) && this.y > b.maxY + 120) this.y = b.maxY + 120;
  }

  /**
   * Horizontal ray from (ox,oy,oz) at azimuth `az` against structural solids
   * only (ledges and bridges do not count as the wall). Writes this._hit.
   */
  _rayWall(ox, oy, oz, az, maxDist) {
    const lv = this.level;
    if (!lv || typeof lv.querySolids !== 'function') return false;
    const dx = Math.cos(az);
    const dz = Math.sin(az);
    // Stay with the shaft's own walls (level.shaftAt): a ray out through an
    // opening into a side hall would lead it away from the descent.
    const sh = typeof lv.shaftAt === 'function' ? lv.shaftAt(oy) : null;
    if (sh && ox >= sh.minX && ox <= sh.maxX && oz >= sh.minZ && oz <= sh.maxZ) {
      const tx = dx > 1e-6 ? (sh.maxX - ox) / dx : dx < -1e-6 ? (sh.minX - ox) / dx : Infinity;
      const tz = dz > 1e-6 ? (sh.maxZ - oz) / dz : dz < -1e-6 ? (sh.minZ - oz) / dz : Infinity;
      maxDist = Math.min(maxDist, Math.min(tx, tz) + 3.5);
    }
    const x1 = ox + dx * maxDist;
    const z1 = oz + dz * maxDist;
    const list = lv.querySolids(Math.min(ox, x1), oy - 0.5, Math.min(oz, z1), Math.max(ox, x1), oy + 0.5, Math.max(oz, z1), this._solids);
    let best = 2;
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (!isStructural(s)) continue;
      const t = segmentBox(ox, oy, oz, x1, oy, z1, s);
      if (t > 1e-4 && t < best) best = t;
    }
    if (best > 1) return false;
    this._hit.t = best * maxDist;
    this._hit.az = az;
    return true;
  }

  /** Wall point at height y around (px,pz) closest to azimuth az (tries neighbours). */
  _wallPointAt(px, y, pz, az) {
    for (let k = 0; k < 9; k++) {
      const a = az + (k === 0 ? 0 : (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.38);
      if (this._rayWall(px, y, pz, a, 80)) return true;
    }
    return false;
  }

  /** Azimuth (around the point) of the nearest structural wall. */
  _nearestWallAz(px, py, pz) {
    let bestT = Infinity;
    let bestA = this.az;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * TAU + 0.2;
      if (this._rayWall(px, py, pz, a, 80) && this._hit.t < bestT) {
        bestT = this._hit.t;
        bestA = a;
      }
    }
    return bestA;
  }

  /** Where it means to be when crawling: on its route wall, at the player's height. */
  _scanHugIfNeeded(dt, player) {
    this._hugT -= dt;
    const moved = len3(player.x - this._hugPX, player.y - this._hugPY, player.z - this._hugPZ);
    if (this._hugT > 0 && moved < 2.5) return;
    this._hugT = 0.3;
    this._hugPX = player.x;
    this._hugPY = player.y;
    this._hugPZ = player.z;
    if (this._wallPointAt(player.x, player.y, player.z, this.az)) {
      const h = this._hit;
      const r = Math.max(0, h.t - this._hug);
      this._hugX = player.x + Math.cos(h.az) * r;
      this._hugY = player.y;
      this._hugZ = player.z + Math.sin(h.az) * r;
      this._hugOK = true;
      return;
    }
    const sf = this._surf2;
    if (this._findSurface(player.x, player.y, player.z, 40, sf) < Infinity) {
      this._hugX = sf.x + sf.nx * this._hug;
      this._hugY = player.y;
      this._hugZ = sf.z + sf.nz * this._hug;
      this._hugOK = true;
      return;
    }
    this._hugX = player.x;
    this._hugY = player.y;
    this._hugZ = player.z;
    this._hugOK = false;
  }

  /** Smooth, irregular speed modulation (never constant): ~0.66..1.34. */
  _noise() {
    const t = this._t;
    return 1 + 0.24 * noise1(t * 0.6, this.seed) + 0.1 * noise1(t * 2.1, this.seed + 17);
  }

  /** Occasional hitches: limbs re-grip and the whole mass pauses for a beat. */
  _tickHitch(dt) {
    if (this._hitchLeft > 0) {
      this._hitchLeft -= dt;
      this._hitch = U.approach(this._hitch, 0.3, dt * 6);
    } else {
      this._hitch = U.approach(this._hitch, 1, dt * 3);
      this._hitchTimer -= dt;
      if (this._hitchTimer <= 0) {
        this._hitchTimer = 2 + this._rand() * 3.5;
        this._hitchLeft = 0.2 + this._rand() * 0.3;
      }
    }
  }

  /** Moves the whole body rigidly (the out-of-sight rubber band). */
  _shift(dx, dy, dz) {
    this.x += dx;
    this.y += dy;
    this.z += dz;
    const tr = this._trail;
    for (let i = 0; i < T.trailCap; i++) {
      tr[i * 3] += dx;
      tr[i * 3 + 1] += dy;
      tr[i * 3 + 2] += dz;
    }
    const sp = this.body.spine;
    for (let i = 0; i < SEG; i++) {
      sp[i * 3] += dx;
      sp[i * 3 + 1] += dy;
      sp[i * 3 + 2] += dz;
    }
    const limbs = this.body.limbs;
    for (let i = 0; i < limbs.length; i++) {
      const L = limbs[i];
      L.foot.x += dx;
      L.foot.y += dy;
      L.foot.z += dz;
      L.o.x += dx;
      L.o.y += dy;
      L.o.z += dz;
      L.t.x += dx;
      L.t.y += dy;
      L.t.z += dz;
    }
  }

  // ===========================================================================
  // Body: heading, breadcrumb trail, spine, limbs, crown
  // ===========================================================================

  _updateHeading(dt) {
    let tx;
    let ty;
    let tz;
    {
      // Its way of travel at speed, its look at you when it is slow: a blend, not a switch at 1.2 m/s (a head that dithers round a player
      // standing close crossed that line back and forth and turned to the velocity and to you in turn).
      const dx = this._px - this.x;
      const dy = this._py - this.y;
      const dz = this._pz - this.z;
      const d = len3(dx, dy, dz) || 1;
      const wv = this.speed > 0.05 ? U.smoothstep(0.6, 3.0, this.speed) : 0;
      tx = U.lerp(dx / d, this.speed > 0.05 ? this.vx / this.speed : 0, wv);
      ty = U.lerp(dy / d, this.speed > 0.05 ? this.vy / this.speed : 0, wv);
      tz = U.lerp(dz / d, this.speed > 0.05 ? this.vz / this.speed : 0, wv);
    }
    // While it watches (sighting pause / observing) the crown turns to the player.
    if (this.state === S.OBSERVING && this.sighting) {
      const dx = this._px - this.x;
      const dy = this._py - this.y;
      const dz = this._pz - this.z;
      const d = len3(dx, dy, dz) || 1;
      tx = U.lerp(tx, dx / d, 0.8);
      ty = U.lerp(ty, dy / d, 0.8);
      tz = U.lerp(tz, dz / d, 0.8);
    }
    // Turn toward the target along the arc, never through the chord: the eased angle is capped (HEAD_TURN_MAX deg/s) and a target
    // behind the crown (the chord would collapse to zero) turns about the dorsal up instead of snapping.
    // close to the player the crown turns more slowly and more evenly: it dithers round someone standing near, and a fast crown whips the body
    const nearK = this.inPlay ? 1 - U.smoothstep(8, 16, this.distance) : 0;
    const k = 1 - Math.exp(-(4 - 1.6 * nearK) * dt);
    let tl = len3(tx, ty, tz);
    if (tl < 1e-6) {
      tx = this.hx;
      ty = this.hy;
      tz = this.hz;
      tl = 1;
    }
    tx /= tl;
    ty /= tl;
    tz /= tl;
    const cosA = U.clamp(this.hx * tx + this.hy * ty + this.hz * tz, -1, 1);
    const ang = Math.acos(cosA);
    if (ang > 1e-4 && dt > 0) {
      const step = Math.min(ang * k, HEAD_TURN_MAX * (1 - 0.4 * nearK) * dt);
      // the turn axis: h x t, or the dorsal up when they are (nearly) opposite
      let ax = this.hy * tz - this.hz * ty;
      let ay = this.hz * tx - this.hx * tz;
      let az = this.hx * ty - this.hy * tx;
      let al = len3(ax, ay, az);
      if (al < 1e-3) {
        ax = this._upReady ? this._upx : this.nx;
        ay = this._upReady ? this._upy : this.ny;
        az = this._upReady ? this._upz : this.nz;
        const d = ax * this.hx + ay * this.hy + az * this.hz;
        ax -= this.hx * d;
        ay -= this.hy * d;
        az -= this.hz * d;
        al = len3(ax, ay, az);
        if (al < 1e-3) {
          ax = Math.abs(this.hy) < 0.9 ? 0 : 1;
          ay = Math.abs(this.hy) < 0.9 ? 1 : 0;
          az = 0;
          const d2 = ax * this.hx + ay * this.hy + az * this.hz;
          ax -= this.hx * d2;
          ay -= this.hy * d2;
          az -= this.hz * d2;
          al = len3(ax, ay, az) || 1;
        }
      }
      ax /= al;
      ay /= al;
      az /= al;
      // Rodrigues: rotate h about the axis by `step`
      const c = Math.cos(step);
      const sn = Math.sin(step);
      const dot = ax * this.hx + ay * this.hy + az * this.hz;
      const cx = ay * this.hz - az * this.hy;
      const cy = az * this.hx - ax * this.hz;
      const cz = ax * this.hy - ay * this.hx;
      this.hx = this.hx * c + cx * sn + ax * dot * (1 - c);
      this.hy = this.hy * c + cy * sn + ay * dot * (1 - c);
      this.hz = this.hz * c + cz * sn + az * dot * (1 - c);
    }
    const l = len3(this.hx, this.hy, this.hz);
    if (l < 1e-4) {
      this.hx = 0;
      this.hy = -1;
      this.hz = 0;
    } else {
      this.hx /= l;
      this.hy /= l;
      this.hz /= l;
    }
  }

  /**
   * The crown's dorsal up for the body frames: the clinging normal made perpendicular to the facing, kept CONTINUOUS. Where the normal is
   * (nearly) along the facing (it runs at a wall, a floor or a ceiling: the corner of two surfaces) the perpendicular part is noise and
   * used to flip the head's roll by up to 150 deg in one frame: there the last up is kept (parallel transported to the new facing), the
   * normal's say fades in with how well-defined it is, and the up turns toward it at a capped rate.
   */
  _headUp() {
    const dt = this._bodyDt;
    this._bodyDt = 0; // one smoothing step per update (_writeBodyFlags runs more than once on some paths)
    const fx = this.hx;
    const fy = this.hy;
    const fz = this.hz;
    // the normal perpendicular to the facing
    let nx = this.nx;
    let ny = this.ny;
    let nz = this.nz;
    const dn = nx * fx + ny * fy + nz * fz;
    nx -= fx * dn;
    ny -= fy * dn;
    nz -= fz * dn;
    const nl = len3(nx, ny, nz);
    if (!this._upReady) {
      if (nl > 1e-3) {
        this._upx = nx / nl;
        this._upy = ny / nl;
        this._upz = nz / nl;
        this._upReady = true;
      } else if (!(this._upx || this._upy || this._upz)) this._upy = 1;
    }
    // the last up, perpendicular to the (new) facing
    let px = this._upx;
    let py = this._upy;
    let pz = this._upz;
    const dp = px * fx + py * fy + pz * fz;
    px -= fx * dp;
    py -= fy * dp;
    pz -= fz * dp;
    let pl = len3(px, py, pz);
    if (pl < 1e-3) {
      px = Math.abs(fy) < 0.9 ? 0 : 1;
      py = Math.abs(fy) < 0.9 ? 1 : 0;
      pz = 0;
      const d2 = px * fx + py * fy + pz * fz;
      px -= fx * d2;
      py -= fy * d2;
      pz -= fz * d2;
      pl = len3(px, py, pz) || 1;
    }
    px /= pl;
    py /= pl;
    pz /= pl;
    // the target: the normal's direction, weighted by how well defined it is (|n_perp| 0.15 .. 0.5)
    let tx = px;
    let ty = py;
    let tz = pz;
    if (nl > 1e-3) {
      const w = U.smoothstep(0.15, 0.5, nl);
      tx = px * (1 - w) + (nx / nl) * w;
      ty = py * (1 - w) + (ny / nl) * w;
      tz = pz * (1 - w) + (nz / nl) * w;
      const tl = len3(tx, ty, tz);
      if (tl > 1e-4) {
        tx /= tl;
        ty /= tl;
        tz /= tl;
      } else {
        tx = px;
        ty = py;
        tz = pz;
      }
    }
    if (dt > 0) {
      const cosA = U.clamp(px * tx + py * ty + pz * tz, -1, 1);
      const ang = Math.acos(cosA);
      const k = Math.min(1 - Math.exp(-10 * dt), ang > 1e-4 ? (HEAD_ROLL_MAX * dt) / ang : 1);
      px += (tx - px) * k;
      py += (ty - py) * k;
      pz += (tz - pz) * k;
      const l = len3(px, py, pz) || 1;
      px /= l;
      py /= l;
      pz /= l;
    }
    this._upx = px;
    this._upy = py;
    this._upz = pz;
  }

  _trailPush(x, y, z) {
    const cap = T.trailCap;
    this._tHead = (this._tHead + 1) % cap;
    if (this._tCount < cap) this._tCount++;
    const i = this._tHead * 3;
    this._trail[i] = x;
    this._trail[i + 1] = y;
    this._trail[i + 2] = z;
    this._trailN[i] = this.nx;
    this._trailN[i + 1] = this.ny;
    this._trailN[i + 2] = this.nz;
  }

  /** Index (×3) of the k-th newest breadcrumb. */
  _ti(k) {
    const cap = T.trailCap;
    return (((this._tHead - k) % cap) + cap) % cap * 3;
  }

  /**
   * Breadcrumbs: pushed every trailStep of head travel; when the head backs
   * along its own path the newest crumbs are consumed, so the body retracts
   * tail-first along where it came from instead of folding over itself.
   */
  _updateTrail() {
    const tr = this._trail;
    const hx = this.x;
    const hy = this.y;
    const hz = this.z;
    if (this._tCount === 0) this._trailPush(hx, hy, hz);
    while (this._tCount >= 3) {
      const a = this._ti(0);
      const b = this._ti(1);
      const abx = tr[a] - tr[b];
      const aby = tr[a + 1] - tr[b + 1];
      const abz = tr[a + 2] - tr[b + 2];
      const hbx = hx - tr[b];
      const hby = hy - tr[b + 1];
      const hbz = hz - tr[b + 2];
      if (hbx * hbx + hby * hby + hbz * hbz < (abx * abx + aby * aby + abz * abz) * 0.98) {
        this._tHead = (this._tHead - 1 + T.trailCap) % T.trailCap;
        this._tCount--;
      } else break;
    }
    const step = T.trailStep;
    for (let guard = 0; guard < 400; guard++) {
      const a = this._ti(0);
      const dx = hx - tr[a];
      const dy = hy - tr[a + 1];
      const dz = hz - tr[a + 2];
      const d = len3(dx, dy, dz);
      if (d < step) break;
      if (d > 200) {
        this._trailPush(hx, hy, hz); // teleport: no breadcrumb storm
        break;
      }
      this._trailPush(tr[a] + (dx / d) * step, tr[a + 1] + (dy / d) * step, tr[a + 2] + (dz / d) * step);
    }
  }

  /** Lays the trail out straight behind the head (forward = fx,fy,fz). */
  _layBody(fx, fy, fz) {
    this._upReady = false; // a teleport / a re-lay: the dorsal up starts again from the surface
    this._bReady = false; // ... and so do the body's locked axes
    const l = len3(fx, fy, fz) || 1;
    const ux = fx / l;
    const uy = fy / l;
    const uz = fz / l;
    this._tHead = -1;
    this._tCount = 0;
    const n = Math.min(T.trailCap - 1, Math.ceil((this.bodyLength * 1.3) / T.trailStep));
    // Oldest first (far behind) → newest at the head.
    for (let i = n; i >= 0; i--) {
      const back = i * T.trailStep;
      this._trailPush(this.x - ux * back, this.y - uy * back, this.z - uz * back);
    }
    this.hx = ux;
    this.hy = uy;
    this.hz = uz;
    this._updateSpine();
    const limbs = this.body.limbs;
    for (let i = 0; i < limbs.length; i++) {
      const L = limbs[i];
      this._limbFrame(L);
      if (this._findGrip(L)) {
        L.foot.x = L.t.x;
        L.foot.y = L.t.y;
        L.foot.z = L.t.z;
        L.planted = true;
      } else {
        L.foot.x = L.d.x;
        L.foot.y = L.d.y;
        L.foot.z = L.d.z;
        L.planted = false;
      }
      L.step = -1;
      L.lift = 0;
      L.gripTimer = this._rand() * 0.1;
    }
  }

  /** Samples the 20 spine points (and their surface normals) along the trail. */
  _updateSpine() {
    const B = this.body;
    const sp = B.spine;
    const up = B.up;
    const tr = this._trail;
    const tn = this._trailN;
    // Crown: the head, pulled back during the wind-up.
    const rear = this._rear;
    sp[0] = this.x - this.hx * rear;
    sp[1] = this.y - this.hy * rear;
    sp[2] = this.z - this.hz * rear;
    up[0] = this.nx;
    up[1] = this.ny;
    up[2] = this.nz;
    let px = this.x;
    let py = this.y;
    let pz = this.z;
    let pnx = this.nx;
    let pny = this.ny;
    let pnz = this.nz;
    let ldx = -this.hx; // direction of the last piece walked (toward the tail)
    let ldy = -this.hy;
    let ldz = -this.hz;
    let acc = 0;
    let k = 0;
    const count = this._tCount;
    for (let i = 1; i < SEG; i++) {
      const o = this._segOff[i];
      let placed = false;
      while (k < count) {
        const a = this._ti(k);
        const qx = tr[a];
        const qy = tr[a + 1];
        const qz = tr[a + 2];
        const sx = qx - px;
        const sy = qy - py;
        const sz = qz - pz;
        const sl = len3(sx, sy, sz);
        if (sl < 1e-6) {
          k++;
          continue;
        }
        if (acc + sl >= o) {
          const f = (o - acc) / sl;
          sp[i * 3] = px + sx * f;
          sp[i * 3 + 1] = py + sy * f;
          sp[i * 3 + 2] = pz + sz * f;
          up[i * 3] = U.lerp(pnx, tn[a], f);
          up[i * 3 + 1] = U.lerp(pny, tn[a + 1], f);
          up[i * 3 + 2] = U.lerp(pnz, tn[a + 2], f);
          placed = true;
          break;
        }
        acc += sl;
        ldx = sx / sl;
        ldy = sy / sl;
        ldz = sz / sl;
        px = qx;
        py = qy;
        pz = qz;
        pnx = tn[a];
        pny = tn[a + 1];
        pnz = tn[a + 2];
        k++;
      }
      if (!placed) {
        // Trail exhausted: the rest of the body continues straight back.
        const r = o - acc;
        sp[i * 3] = px + ldx * r;
        sp[i * 3 + 1] = py + ldy * r;
        sp[i * 3 + 2] = pz + ldz * r;
        up[i * 3] = pnx;
        up[i * 3 + 1] = pny;
        up[i * 3 + 2] = pnz;
      }
      const ul = len3(up[i * 3], up[i * 3 + 1], up[i * 3 + 2]);
      if (ul > 1e-6) {
        up[i * 3] /= ul;
        up[i * 3 + 1] /= ul;
        up[i * 3 + 2] /= ul;
      } else {
        up[i * 3] = 0;
        up[i * 3 + 1] = 1;
        up[i * 3 + 2] = 0;
      }
      // Where the trail doubles back sharply (lunge recoil) the chord gets short:
      // keep a minimum link so the blocks never telescope into each other.
      if (i >= 2) {
        const want = this._segOff[i] - this._segOff[i - 1];
        const ax = sp[i * 3] - sp[i * 3 - 3];
        const ay = sp[i * 3 + 1] - sp[i * 3 - 2];
        const az = sp[i * 3 + 2] - sp[i * 3 - 1];
        const al = len3(ax, ay, az);
        const minL = want * 0.82;
        if (al < minL && al > 1e-6) {
          sp[i * 3] = sp[i * 3 - 3] + (ax / al) * minL;
          sp[i * 3 + 1] = sp[i * 3 - 2] + (ay / al) * minL;
          sp[i * 3 + 2] = sp[i * 3 - 1] + (az / al) * minL;
        }
      }
    }
    this._lockBody(this._bodyDt || 1 / 60);
    this._conformBody(this._bodyDt || 1 / 60);
    this._lockUps(this._bodyDt || 1 / 60);
    // The column arches off the wall mid-length and slowly heaves (breathing masonry).
    const heave = 1 + 0.18 * Math.sin(this._t * 0.9 + this.seed);
    for (let i = 1; i < SEG; i++) {
      const a = this._arch * heave * Math.sin((Math.PI * i) / (SEG - 1)) * (i < 4 ? i / 4 : 1);
      sp[i * 3] += up[i * 3] * a;
      sp[i * 3 + 1] += up[i * 3 + 1] * a;
      sp[i * 3 + 2] += up[i * 3 + 2] * a;
    }
  }

  /**
   * Locks the body's axes: link i (block i-1 -> block i) keeps its length but may only turn `bodyTurn` rad/s (less toward the tail)
   * from where it pointed last frame. The trail replays every dither of the head (it backs along its own path, the crumbs are eaten and
   * laid again), and a link used to flip by 100s of degrees in a frame when the player stood close and the head swung to and fro.
   */
  _lockBody(dt) {
    const sp = this.body.spine;
    const d = this._bdir;
    if (!this._bReady || !(dt > 0)) {
      for (let i = 1; i < SEG; i++) {
        const vx = sp[i * 3] - sp[i * 3 - 3];
        const vy = sp[i * 3 + 1] - sp[i * 3 - 2];
        const vz = sp[i * 3 + 2] - sp[i * 3 - 1];
        const l = len3(vx, vy, vz) || 1;
        d[i * 3] = vx / l;
        d[i * 3 + 1] = vy / l;
        d[i * 3 + 2] = vz / l;
      }
      this._bReady = true;
      return;
    }
    const src = this._bsrc;
    src.set(sp);
    for (let i = 1; i < SEG; i++) {
      // the link the trail asked for (from the untouched spine: the blocks before this one have already been moved)
      const vx = src[i * 3] - src[i * 3 - 3];
      const vy = src[i * 3 + 1] - src[i * 3 - 2];
      const vz = src[i * 3 + 2] - src[i * 3 - 1];
      const l = len3(vx, vy, vz);
      if (l < 1e-6) {
        sp[i * 3] = sp[i * 3 - 3];
        sp[i * 3 + 1] = sp[i * 3 - 2];
        sp[i * 3 + 2] = sp[i * 3 - 1];
        continue;
      }
      const tx = vx / l;
      const ty = vy / l;
      const tz = vz / l;
      const px = d[i * 3];
      const py = d[i * 3 + 1];
      const pz = d[i * 3 + 2];
      const cosA = U.clamp(px * tx + py * ty + pz * tz, -1, 1);
      const ang = Math.acos(cosA);
      const lim = U.lerp(T.bodyTurn, T.bodyTurnTail, (i - 1) / (SEG - 2)) * dt;
      let nx = tx;
      let ny = ty;
      let nz = tz;
      if (ang > lim) {
        // rotate the last direction toward the wanted one by `lim` (about their common perpendicular, the body's up when they oppose)
        let ax = py * tz - pz * ty;
        let ay = pz * tx - px * tz;
        let az = px * ty - py * tx;
        let al = len3(ax, ay, az);
        if (al < 1e-3) {
          ax = this.body.up[i * 3];
          ay = this.body.up[i * 3 + 1];
          az = this.body.up[i * 3 + 2];
          const dd = ax * px + ay * py + az * pz;
          ax -= px * dd;
          ay -= py * dd;
          az -= pz * dd;
          al = len3(ax, ay, az) || 1;
        }
        ax /= al;
        ay /= al;
        az /= al;
        const c = Math.cos(lim);
        const s = Math.sin(lim);
        const dot = ax * px + ay * py + az * pz;
        nx = px * c + (ay * pz - az * py) * s + ax * dot * (1 - c);
        ny = py * c + (az * px - ax * pz) * s + ay * dot * (1 - c);
        nz = pz * c + (ax * py - ay * px) * s + az * dot * (1 - c);
        const nl = len3(nx, ny, nz) || 1;
        nx /= nl;
        ny /= nl;
        nz /= nl;
      }
      d[i * 3] = nx;
      d[i * 3 + 1] = ny;
      d[i * 3 + 2] = nz;
      sp[i * 3] = sp[i * 3 - 3] + nx * l;
      sp[i * 3 + 1] = sp[i * 3 - 2] + ny * l;
      sp[i * 3 + 2] = sp[i * 3 - 1] + nz * l;
    }
  }

  /** Each block's up may turn only `bodyUpTurn` rad/s: the roll of the body is locked against the trail's normals flipping. */
  _lockUps(dt) {
    const up = this.body.up;
    const u0 = this._bup;
    if (!this._bReady || !(dt > 0)) {
      u0.set(up);
      return;
    }
    const lim = T.bodyUpTurn * dt;
    for (let i = 1; i < SEG; i++) {
      const px = u0[i * 3];
      const py = u0[i * 3 + 1];
      const pz = u0[i * 3 + 2];
      let tx = up[i * 3];
      let ty = up[i * 3 + 1];
      let tz = up[i * 3 + 2];
      const ang = Math.acos(U.clamp(px * tx + py * ty + pz * tz, -1, 1));
      if (ang > lim) {
        // a chord step toward the target, renormalised (the angles are small after the first frame)
        const f = lim / ang;
        tx = px + (tx - px) * f;
        ty = py + (ty - py) * f;
        tz = pz + (tz - pz) * f;
        const l = len3(tx, ty, tz);
        if (l > 1e-6) {
          tx /= l;
          ty /= l;
          tz /= l;
        } else {
          tx = px;
          ty = py;
          tz = pz;
        }
      }
      up[i * 3] = tx;
      up[i * 3 + 1] = ty;
      up[i * 3 + 2] = tz;
      u0[i * 3] = tx;
      u0[i * 3 + 1] = ty;
      u0[i * 3 + 2] = tz;
    }
  }

  /**
   * Lays every block on the wall it is over. The blocks follow the head's trail, which cuts corners: round an outside edge the body
   * ran through the masonry, in an inside corner it hung in the air. Per block: the nearest structural surface sets its height
   * (hug x its scale, eased so nothing pops) and its up vector (blended toward the surface normal), and any solid, the dressing's boxes
   * included, pushes it out to a body radius. The head is untouched (the sim's pursuit, strikes and kills read it only).
   */
  _conformBody(dt) {
    const lv = this.level;
    if (!lv || typeof lv.querySolids !== 'function') return;
    const B = this.body;
    const sp = B.spine;
    const up = B.up;
    const near = T.bodyReach;
    const ke = 1 - Math.exp(-T.bodyRate * dt);
    const ku = 1 - Math.exp(-6 * dt);
    const kp = 1 - Math.exp(-T.bodyPushRate * dt);
    const s = this._bs;
    const a = this._ba;
    const lift = this._bodyLift;
    for (let i = 1; i < SEG; i++) {
      let x = sp[i * 3];
      let y = sp[i * 3 + 1];
      let z = sp[i * 3 + 2];
      const list = lv.querySolids(x - near, y - near, z - near, x + near, y + near, z + near, this._bodySolids);
      let dS = Infinity; // nearest structural surface (signed: negative inside)
      let dA = Infinity; // nearest solid of any kind
      for (let q = 0; q < list.length; q++) {
        const b = list[q];
        if (b.active === false || b.kind === 'grate') continue;
        const d = boxSurface(b, x, y, z, this._surf2);
        if (d < dA) {
          dA = d;
          a.nx = this._surf2.nx;
          a.ny = this._surf2.ny;
          a.nz = this._surf2.nz;
        }
        if (d < dS && isStructural(b)) {
          dS = d;
          s.nx = this._surf2.nx;
          s.ny = this._surf2.ny;
          s.nz = this._surf2.nz;
        }
      }
      let want = 0;
      if (dS < Infinity) {
        // height above the surface it should keep: the hug of its scale; the trail's own height is already close, this fixes the corners
        want = this._hug * B.scale[i];
        let err = want - dS;
        // far from the wall (past an edge, across a void) do not drag the block back: only what the trail got wrong is fixed
        err = U.clamp(err, -T.bodyMaxFix, T.bodyMaxFix);
        lift[i * 3] += (s.nx * err - lift[i * 3]) * ke;
        lift[i * 3 + 1] += (s.ny * err - lift[i * 3 + 1]) * ke;
        lift[i * 3 + 2] += (s.nz * err - lift[i * 3 + 2]) * ke;
        x += lift[i * 3];
        y += lift[i * 3 + 1];
        z += lift[i * 3 + 2];
        const w = 1 - U.smoothstep(want + 1.2, want + 3.5, dS); // near the wall: its normal; far from it: the trail's
        up[i * 3] += (s.nx - up[i * 3]) * ku * w;
        up[i * 3 + 1] += (s.ny - up[i * 3 + 1]) * ku * w;
        up[i * 3 + 2] += (s.nz - up[i * 3 + 2]) * ku * w;
        const ul = len3(up[i * 3], up[i * 3 + 1], up[i * 3 + 2]) || 1;
        up[i * 3] /= ul;
        up[i * 3 + 1] /= ul;
        up[i * 3 + 2] /= ul;
      } else {
        lift[i * 3] *= 1 - ke;
        lift[i * 3 + 1] *= 1 - ke;
        lift[i * 3 + 2] *= 1 - ke;
      }
      // the body radius: nothing of it inside a solid (decor boxes, pillars, ledges); the push is eased (never a jump of a metre in a frame)
      let tpx = 0;
      let tpy = 0;
      let tpz = 0;
      if (dA < Infinity) {
        const r = T.bodyClear * B.scale[i];
        const dNow = dA + lift[i * 3] * a.nx + lift[i * 3 + 1] * a.ny + lift[i * 3 + 2] * a.nz;
        if (dNow < r && dNow > -2 * r) {
          // only a shallow overlap is pushed out (a block deep inside a thick solid is the trail's doing: the head crawls over ledges)
          const push = Math.min(T.bodyMaxFix, r - dNow);
          tpx = a.nx * push;
          tpy = a.ny * push;
          tpz = a.nz * push;
        }
      }
      const bp = this._bpush;
      bp[i * 3] += (tpx - bp[i * 3]) * kp;
      bp[i * 3 + 1] += (tpy - bp[i * 3 + 1]) * kp;
      bp[i * 3 + 2] += (tpz - bp[i * 3 + 2]) * kp;
      x += bp[i * 3];
      y += bp[i * 3 + 1];
      z += bp[i * 3 + 2];
      sp[i * 3] = x;
      sp[i * 3 + 1] = y;
      sp[i * 3 + 2] = z;
    }
  }

  /** Hip, body up and desired foothold for a limb this frame (from the spine). */
  _limbFrame(L) {
    const sp = this.body.spine;
    const upA = this.body.up;
    const i = L.seg;
    let fx = sp[(i - 1) * 3] - sp[(i + 1) * 3];
    let fy = sp[(i - 1) * 3 + 1] - sp[(i + 1) * 3 + 1];
    let fz = sp[(i - 1) * 3 + 2] - sp[(i + 1) * 3 + 2];
    let fl = len3(fx, fy, fz);
    if (fl < 1e-6) {
      fx = this.hx;
      fy = this.hy;
      fz = this.hz;
      fl = 1;
    }
    fx /= fl;
    fy /= fl;
    fz /= fl;
    // Body up, orthogonalised against the spine.
    let ux = upA[i * 3];
    let uy = upA[i * 3 + 1];
    let uz = upA[i * 3 + 2];
    const ud = ux * fx + uy * fy + uz * fz;
    ux -= fx * ud;
    uy -= fy * ud;
    uz -= fz * ud;
    let ul = len3(ux, uy, uz);
    if (ul < 1e-4) {
      // Spine parallel to the normal: any perpendicular.
      ux = Math.abs(fy) < 0.9 ? 0 : 1;
      uy = Math.abs(fy) < 0.9 ? 1 : 0;
      uz = 0;
      const d2 = ux * fx + uy * fy + uz * fz;
      ux -= fx * d2;
      uy -= fy * d2;
      uz -= fz * d2;
      ul = len3(ux, uy, uz) || 1;
    }
    ux /= ul;
    uy /= ul;
    uz /= ul;
    // right = forward × up
    const rx = (fy * uz - fz * uy) * L.side;
    const ry = (fz * ux - fx * uz) * L.side;
    const rz = (fx * uy - fy * ux) * L.side;
    const w = 0.62 * this.body.scale[i];
    L.u.x = ux;
    L.u.y = uy;
    L.u.z = uz;
    L.hip.x = sp[i * 3] + rx * w + ux * 0.1;
    L.hip.y = sp[i * 3 + 1] + ry * w + uy * 0.1;
    L.hip.z = sp[i * 3 + 2] + rz * w + uz * 0.1;
    const R = L.reach;
    const down = this._hug + 0.4;
    L.d.x = L.hip.x + rx * R * 0.6 + fx * R * L.fwd - ux * down;
    L.d.y = L.hip.y + ry * R * 0.6 + fy * R * L.fwd - uy * down;
    L.d.z = L.hip.z + rz * R * 0.6 + fz * R * L.fwd - uz * down;
  }

  _updateLimbs(dt, player) {
    const limbs = this.body.limbs;
    const sp = this.speed;
    const stepDur = U.clamp(0.3 - sp * 0.009, 0.1, 0.3);
    const maxStepping = sp > 8 ? 5 : 3; // a surging body moves more legs at once
    let stepping = 0;
    for (let i = 0; i < limbs.length; i++) if (limbs[i].step >= 0) stepping++;
    for (let i = 0; i < limbs.length; i++) {
      const L = limbs[i];
      this._limbFrame(L);
      if (L.step >= 0) {
        L.step += dt / L.dur;
        if (L.step >= 1) {
          L.step = -1;
          L.lift = 0;
          L.foot.x = L.t.x;
          L.foot.y = L.t.y;
          L.foot.z = L.t.z;
          L.planted = true;
          stepping--;
          const dd = len3(player.x - L.foot.x, player.y - L.foot.y, player.z - L.foot.z);
          this._emitStep(L.foot.x, L.foot.y, L.foot.z, U.clamp(0.3 + sp / 28, 0.25, 1) * L.weight, dd, false);
        } else {
          const s = L.step;
          const e = s * s * (3 - 2 * s);
          const lift = Math.sin(Math.PI * s) * 1.1 * (0.6 + 0.4 * L.weight);
          L.lift = Math.sin(Math.PI * s);
          L.foot.x = U.lerp(L.o.x, L.t.x, e) + L.u.x * lift;
          L.foot.y = U.lerp(L.o.y, L.t.y, e) + L.u.y * lift;
          L.foot.z = U.lerp(L.o.z, L.t.z, e) + L.u.z * lift;
        }
        continue;
      }
      const partnerBusy = limbs[L.partner] && limbs[L.partner].step >= 0;
      if (L.planted) {
        const da = len3(L.foot.x - L.hip.x, L.foot.y - L.hip.y, L.foot.z - L.hip.z);
        const dd = len3(L.foot.x - L.d.x, L.foot.y - L.d.y, L.foot.z - L.d.z);
        if (da > L.reach * 1.5) {
          // Torn free (teleport / violent lunge): re-grip without a sound.
          if (this._findGrip(L)) {
            L.foot.x = L.t.x;
            L.foot.y = L.t.y;
            L.foot.z = L.t.z;
          } else {
            L.planted = false;
          }
        } else if ((da > L.reach * 1.02 || dd > L.reach * 0.6) && stepping < maxStepping && (!partnerBusy || da > L.reach * 1.15)) {
          if (this._findGrip(L)) {
            this._beginStep(L, stepDur);
            stepping++;
          } else {
            L.planted = false;
          }
        }
      } else {
        // Free limb: reaches and gropes toward structure, swaying.
        const sw = Math.sin(this._t * 2.3 + L.sway) * 0.9;
        const k = 1 - Math.exp(-7 * dt);
        L.foot.x += (L.d.x + L.u.x * (sw + 1.2) - L.foot.x) * k;
        L.foot.y += (L.d.y + L.u.y * (sw + 1.2) - L.foot.y) * k;
        L.foot.z += (L.d.z + L.u.z * (sw + 1.2) - L.foot.z) * k;
        L.gripTimer -= dt;
        if (L.gripTimer <= 0) {
          L.gripTimer = 0.15 + this._rand() * 0.2;
          if (stepping < maxStepping && this._findGrip(L)) {
            this._beginStep(L, stepDur);
            stepping++;
          }
        }
      }
    }
  }

  _beginStep(L, dur) {
    L.o.x = L.foot.x;
    L.o.y = L.foot.y;
    L.o.z = L.foot.z;
    L.step = 0;
    L.dur = dur * (0.85 + this._rand() * 0.3);
    L.planted = false;
  }

  /** Finds a foothold on a nearby active solid (closest to the desired point, within reach). */
  _findGrip(L) {
    const lv = this.level;
    if (!lv || typeof lv.querySolids !== 'function') return false;
    const r = L.reach;
    const q = r * 0.8;
    const list = lv.querySolids(L.d.x - q, L.d.y - q, L.d.z - q, L.d.x + q, L.d.y + q, L.d.z + q, this._grip);
    const o = this._surf2;
    const r2 = r * r;
    let best = Infinity;
    let bx = 0;
    let by = 0;
    let bz = 0;
    let bnx = 0;
    let bny = 0;
    let bnz = 0;
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (s.active === false) continue;
      const d = Math.abs(boxSurface(s, L.d.x, L.d.y, L.d.z, o));
      if (d >= best) continue;
      const ax = o.x - L.hip.x;
      const ay = o.y - L.hip.y;
      const az = o.z - L.hip.z;
      if (ax * ax + ay * ay + az * az > r2) continue;
      best = d;
      bx = o.x;
      by = o.y;
      bz = o.z;
      bnx = o.nx;
      bny = o.ny;
      bnz = o.nz;
    }
    if (best === Infinity) return false;
    // Hooks bite a little into the masonry; jitter keeps the gait irregular.
    const j = 0.35;
    L.t.x = bx + (this._rand() - 0.5) * j * (1 - Math.abs(bnx)) - bnx * 0.12;
    L.t.y = by + (this._rand() - 0.5) * j * (1 - Math.abs(bny)) - bny * 0.12;
    L.t.z = bz + (this._rand() - 0.5) * j * (1 - Math.abs(bnz)) - bnz * 0.12;
    return true;
  }

  _updateCrown(dt) {
    const st = this.state;
    let glowTarget = GLOW[st] || 0.2;
    let unfurl = UNFURL[st] || 0.9;
    const a = this.attack;
    const windup = st === S.ATTACK && a.phase === 'windup';
    if (windup) glowTarget = 1;
    if (st === S.BURST && this._snapping() && this.stateTime < this.k.snap) {
      // The snap: the crown flares wide and the pits blaze before it surges.
      glowTarget = 1;
      unfurl = 1.45;
    }
    const k = dt > 0 ? 1 - Math.exp(-6 * dt) : 1;
    this._glow += (glowTarget - this._glow) * k;
    this._unfurl += (unfurl - this._unfurl) * k;
    // Wind-up: the crown rears back and trembles before the lunge (telegraph).
    let rear = 0;
    let lunge = 0;
    if (st === S.ATTACK && a.phase) {
      if (a.phase === 'windup') {
        const wk = U.clamp(a.t / Math.max(a.windup, 0.05), 0, 1);
        rear = this._rearMax * Math.sin(wk * Math.PI * 0.5);
        lunge = wk * 0.8;
      } else if (a.phase === 'strike') lunge = 1;
      else lunge = 1 - U.clamp(a.t / T.postStrike, 0, 1);
    } else if (this.victory && this.victory.phase === 'slam') {
      // Two blows on the bars (slam t 0 and 0.9 s): it draws back between them.
      const vt = this.victory.t;
      lunge = vt < 0.9 ? 1 - 0.6 * Math.sin((Math.PI * vt) / 0.9) : 1;
    }
    this._rear = rear;
    this._lunge += (lunge - this._lunge) * (dt > 0 ? 1 - Math.exp(-14 * dt) : 1);
    const jt = st === S.ATTACK ? 1 : st === S.BURST ? 0.55 : 0;
    this._jitter += (jt - this._jitter) * k;
    if (this.inPlay || this.sighting) {
      // Keep the crown origin in sync with the rear-back.
      const sp = this.body.spine;
      sp[0] = this.x - this.hx * rear;
      sp[1] = this.y - this.hy * rear;
      sp[2] = this.z - this.hz * rear;
    }
  }

  _writeBodyFlags() {
    const B = this.body;
    const t = this._t;
    B.time = t;
    B.visible = this.active && (this.inPlay || !!this.sighting);
    const listenPulse = this.listening ? 0.75 + 0.25 * Math.sin(t * 3.2) : 1;
    const strobe = this.state === S.ATTACK ? 0.8 + 0.2 * Math.sin(t * 38) : 1;
    B.glow = U.clamp(this._glow * listenPulse * strobe, 0, 1);
    B.listen = this.listening ? 0.5 + 0.5 * Math.sin(t * 3.2) : 0;
    B.frondOpen = U.clamp((this._unfurl - 0.4) / 1.2, 0, 1);
    B.lunge = U.clamp(this._lunge, 0, 1);
    B.jitter = U.clamp(this._jitter, 0, 1);
    const h = B.head;
    h.x = B.spine[0];
    h.y = B.spine[1];
    h.z = B.spine[2];
    h.fx = this.hx;
    h.fy = this.hy;
    h.fz = this.hz;
    // Dorsal up: the clinging normal, orthogonalised against the facing, kept continuous (_headUp).
    this._headUp();
    h.ux = this._upx;
    h.uy = this._upy;
    h.uz = this._upz;
    const f = B.focus;
    f.x = this._px;
    f.y = this._py;
    f.z = this._pz;
    f.amount = FOCUS[this.state] || 0;
  }

  // ===========================================================================
  // Events & audio
  // ===========================================================================

  _emit(type, payload) {
    if (!this.active || !this.bus) return;
    if (this.v) {
      // variants share the Mason's sound / haptic / caption hooks, tagged so they can pitch up; no sightings or distant calls
      if (type === 'creature:sighting' || type === 'creature:call') return;
      payload.skit = true;
    }
    this.bus.emit(type, payload);
  }

  _emitStep(x, y, z, intensity, distance, force) {
    if (!force && this._stepCd > 0) return;
    this._stepCd = T.stepInterval;
    this._emit('creature:step', { x, y, z, intensity: U.clamp(this.v ? intensity * 0.6 : intensity, 0, 1), distance });
  }

  _updateAudio(player) {
    const a = this.audio;
    a.state = this.state;
    if (!this.active) {
      this._quiet();
      return;
    }
    a.x = this.x;
    a.y = this.y;
    a.z = this.z;
    a.distance = player ? this.distance : FAR;
    // Agitation (not distance-attenuated: the audio engine applies distance itself).
    const mv = this.inPlay ? U.clamp(this.speed / (this.k.burst * 1.1), 0, 1) : this.sighting ? 0.25 : 0.05;
    a.movement = mv;
    a.intensity = U.clamp((AGITATION[this.state] || 0.2) * (0.75 + 0.25 * mv) + this.nearMiss * 0.2, 0, 1);
  }
}

Creature3D.STATES = S;
Creature3D.TUNING = T;
Creature3D.MODES = MODES;
Creature3D.SEG = SEG;
