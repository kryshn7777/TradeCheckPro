/* ABYSSAL TETHER 3D — dresser3d.js
 * Dresser3D — "the Dresser": a 3.2 m Lanternwright mason in a hooded apron, a split saint mask for a face, two long chisel arms
 * and two small hands paying out a measuring line. It walks upright on the shaft's walls (any structural surface: its up is the
 * surface normal) and it never runs. The INVERSE of the Mason: the Mason hunts only while the player is hurt (creature3d.js
 * setHuntGate), the Dresser only while the player is WHOLE, because only whole bodies dress into good blocks ("DRESS THE OLD
 * STONE WITH CARE. IT WAS SOMEONE."). Between the two gates lies the health corridor (docs/abyssal-tether-3d/plans/DRESSER.md).
 *
 * Behaviour (states DORMANT / STALK / MEASURE / CUT / RECOVER / SPOILED / STAGGER):
 *   - It is in play only in the sections whose data says so (section.creature.dresser.active, by[difficulty] overrides).
 *     It enters play out of sight, never closer than T.spawnMin (30 m; T.neverWithin = 22 m is the hard floor), and gives a
 *     T.grace (4 s) before its first measure or reach.
 *   - The gate (setGate(true), game.js; off = it hunts whatever the health, as the tests and ?dresser=always want): it ARMS when
 *     hp >= whole (0.75 Normal / 0.70 Nightmare / 0.65 Abyss) and disarms below whole - T.hysteresis (5 points). Disarmed it is
 *     SPOILED: it stops, turns its mask away and folds its arms (a spoiled body makes poor blocks); it never measures, cuts or
 *     dresses then, and it steps back when you come close.
 *   - STALK: it walks the walls to a vantage point beside you (8-13 m, a three-quarter view of you) and, when you cling to or
 *     stand by a wall, straight for you. If it ever reaches you (T.reach, 1.6 m from its body) while you are whole, it DRESSES
 *     you: caughtPlayer with cause 'dressed'.
 *   - MEASURE (T.measureTime, 3.0 s): with you in sight (head AND feet: it must see the whole of you) within T.measureRange
 *     (16 m) and a rope of yours on a ring it may cut, it pays its line out to that ring and chalks the outline of your body on
 *     the wall beside you. Losing sight of you for T.losGrace (0.25 s), a stagger or the gate cancels it.
 *   - CUT (T.cutTime, 1.0 s of sawing on the line), then the ring is cut: anchor.broken = anchor.cut = true, every rope on it
 *     lets go (TetherSystem.release, reason 'cut') and you fall. Only the targeted ring; at most one ring per T.cutGap (8 s);
 *     never your only anchor while you stand on a floor or ledge; never a ring an objective, a mover or a haul needs.
 *   - STAGGER (T.staggerTime, 2.5 s, once per T.staggerCooldown, 12 s): a grapple shot whose aim ray (bus 'rope:shot') passes
 *     through its body, with nothing solid in front, staggers it and cancels a measure or a cut.
 *   - Far behind you and out of sight (or past the fog) it relocates out of sight near you again: it never pops into view.
 *
 * DOM-free, three.js-free, allocation-free per frame (scratch objects; the rare events allocate their payloads), deterministic
 * with a seed. Runs in Node (tools/abyssal-tether-3d/tests/dresser/*.mjs).
 *
 * Bus events (x, y, z = where the sound comes from): 'dresser:tick' {fast, intensity, hand, distance} (the line, every ~0.6 s,
 * every ~0.25 s while measuring), 'dresser:hum' {distance} (the three-note work-song), 'dresser:measure' {anchorId, hand,
 * distance, ox, oy, oz (the chalk outline)}, 'dresser:saw' {anchorId}, 'dresser:cut' {anchorId, hand, released}, 'dresser:cancel'
 * {reason}, 'dresser:dress', 'dresser:spoiled', 'dresser:whole', 'dresser:stagger', 'dresser:appear'. A cut also emits
 * 'grapple:break' {hand, anchor, x, y, z, cut: true} so the ring sounds and buzzes as a snapped ring does.
 *
 * Output for the view (render/dresserView.js) and audio: `body` {visible, x,y,z (feet on the surface), ux,uy,uz (up),
 * fx,fy,fz (facing, tangent), lx,ly,lz (what the mask looks at), walk (m walked: gait phase), speed, measure / cut / stagger /
 * spoiled (0..1 pose weights), glow, line {on, x,y,z, taut}, outline {on, x,y,z, nx,ny,nz, grow, alpha, seed}}.
 */

import { U, dresserMode } from './config3d.js';

export { dresserMode }; // the URL switch (?dresser=off|always|on; ?hunt=always leaves it out): config3d.js
import { isStructural, boxSurface } from './creature3d.js';

const TAU = Math.PI * 2;
const FAR = 99999;

export const DRESSER_STATES = Object.freeze({
  DORMANT: 'DORMANT',
  STALK: 'STALK',
  MEASURE: 'MEASURE',
  CUT: 'CUT',
  RECOVER: 'RECOVER',
  SPOILED: 'SPOILED',
  STAGGER: 'STAGGER',
});
const S = DRESSER_STATES;

/** Tuning (metres, seconds). Per-difficulty numbers are in DRESSER_DIFF. */
export const DRESSER_TUNING = {
  height: 3.2, // feet to the top of the hood
  eye: 2.9, // its slit eyes, along its up from the feet
  reach: 1.6, // dresses you when you are this close to its body (feet-to-head axis) while you are whole
  bodyRadius: 0.5, // the body for a grapple shot (+ shotPad)
  shotPad: 0.35,
  measureRange: 16, // starts a measure only this close (its eyes to you)
  measureKeep: 20, // a measure in progress holds while you stay this close
  standOff: 11, // stops walking this close (with you in sight)
  vantage: [8, 13], // the distance band of a vantage point from you
  measureTime: 3.0,
  cutTime: 1.0,
  cutGap: 8, // at most one ring per this many seconds (hard floor; DRESSER_DIFF.rearm also waits before a new measure)
  recoverTime: 2.0,
  staggerTime: 2.5,
  staggerCooldown: 12,
  grace: 4, // after entering play / a respawn: no measure, no reach
  spawnMin: 30, // enters play at least this far from you (out of sight when it can)
  spawnMax: 44,
  neverWithin: 22, // hard floor of every entry / relocation
  relocateMin: 22, // a relocation (out of your sight, from out of your sight) lands this far ...
  relocateMax: 36, // ... to this far, preferring a spot from which it sees you
  viewCos: Math.cos((62 * Math.PI) / 180), // outside this cone around the player's view it is unseen (with setView)
  relocateFar: 40, // beyond this and out of sight it relocates near you
  relocateFog: 64, // beyond this it relocates even in sight (the haze hides it)
  losGrace: 0.25, // s without sight of the whole of you before a measure / cut is cancelled
  hysteresis: 0.05, // armed at hp >= whole, disarmed below whole - hysteresis
  surfaceSearch: 1.6, // m: the walk snaps the feet to a structural surface within this
  normalRate: 3.5, // 1/s: its up eases to the surface normal (corners)
  turnRate: 1.4, // rad/s: its facing turns at most this fast
  footClear: 0.35, // m: no solid within this of its shins / chest / head along its body
  spoiledNear: 7, // m: a spoiled Dresser closer than this steps back
  leaveMax: 10, // s: leaving a section it walks away at most this long before it leaves play
  tick: { gap: 0.6, jitter: 0.32, fast: 0.24, fastJitter: 0.1 },
  hum: { min: 9, max: 16 },
  vantageEvery: 0.6, // s between vantage re-picks
  hopAfter: 8, // s unable to measure you (no sight, out of range) before it hops to another wall (only out of your sight)
};
const T = DRESSER_TUNING;

/**
 * Per difficulty: `whole` = the hp (0..1) at which it starts hunting, `walk` m/s, `rearm` s after a cut before a new measure may
 * start (so cuts are at least rearm + 4 s apart, never less than T.cutGap).
 */
export const DRESSER_DIFF = {
  normal: { whole: 0.75, walk: 1.2, rearm: 10 },
  nightmare: { whole: 0.7, walk: 1.45, rearm: 6 },
  abyss: { whole: 0.65, walk: 1.7, rearm: 4 },
};

/** Vantage samples on its own face around the point nearest you: pairs (along the face's first, second tangent axis), metres. */
const FACE_SAMPLES = [0, 9, 0, -9, 0, 12, 0, -12, 3, 8, 3, -8, -2, 9, -2, -9, 5, 6, 5, -6, 0, 6, 0, -6];

/** Walk detour angles (rad) tried in turn when the straight step is refused. */
const DETOURS = [0.6, -0.6, 1.2, -1.2, 1.8, -1.8];

const DEFAULTS = { active: false, walkMul: 1, measureRange: T.measureRange };

function num(v, fallback) {
  return typeof v === 'number' && isFinite(v) ? v : fallback;
}
function len3(x, y, z) {
  return Math.sqrt(x * x + y * y + z * z);
}

/** Segment p0→p1 against box b (allocation-free slab test): entry parameter in [0,1] or -1. */
const _sl = { t0: 0, t1: 1 };
function slab(o, d, mn, mx) {
  if (Math.abs(d) < 1e-12) return o >= mn && o <= mx;
  let ta = (mn - o) / d;
  let tb = (mx - o) / d;
  if (ta > tb) {
    const tmp = ta;
    ta = tb;
    tb = tmp;
  }
  if (ta > _sl.t0) _sl.t0 = ta;
  if (tb < _sl.t1) _sl.t1 = tb;
  return _sl.t0 <= _sl.t1;
}
function segmentBox(x0, y0, z0, x1, y1, z1, b) {
  _sl.t0 = 0;
  _sl.t1 = 1;
  if (!slab(x0, x1 - x0, b.minX, b.maxX)) return -1;
  if (!slab(y0, y1 - y0, b.minY, b.maxY)) return -1;
  if (!slab(z0, z1 - z0, b.minZ, b.maxZ)) return -1;
  return _sl.t0;
}

/** Squared distance between segments p0→p1 and q0→q1 (allocation-free; clamped closest points). */
function segSegDist2(p0x, p0y, p0z, p1x, p1y, p1z, q0x, q0y, q0z, q1x, q1y, q1z) {
  const ux = p1x - p0x;
  const uy = p1y - p0y;
  const uz = p1z - p0z;
  const vx = q1x - q0x;
  const vy = q1y - q0y;
  const vz = q1z - q0z;
  const wx = p0x - q0x;
  const wy = p0y - q0y;
  const wz = p0z - q0z;
  const a = ux * ux + uy * uy + uz * uz;
  const b = ux * vx + uy * vy + uz * vz;
  const c = vx * vx + vy * vy + vz * vz;
  const d = ux * wx + uy * wy + uz * wz;
  const e = vx * wx + vy * wy + vz * wz;
  const den = a * c - b * b;
  let s = den > 1e-12 ? U.clamp((b * e - c * d) / den, 0, 1) : 0;
  let t = c > 1e-12 ? (b * s + e) / c : 0;
  if (t < 0) {
    t = 0;
    s = a > 1e-12 ? U.clamp(-d / a, 0, 1) : 0;
  } else if (t > 1) {
    t = 1;
    s = a > 1e-12 ? U.clamp((b - d) / a, 0, 1) : 0;
  }
  const dx = wx + ux * s - vx * t;
  const dy = wy + uy * s - vy * t;
  const dz = wz + uz * s - vz * t;
  return dx * dx + dy * dy + dz * dz;
}

/** May the Dresser cut this ring? Never one an objective (seal key, haul, winch), a mover or a hidden housing needs. */
export function cuttable(a) {
  if (!a || a.broken || a.hidden || a.dynamic || a.haul) return false;
  if (a.mount === 'mover') return false;
  if (a.sealKey !== undefined && a.sealKey !== null) return false;
  return true;
}

export class Dresser3D {
  /**
   * @param {Level3D} level
   * @param {object} diff   DIFFICULTY[key] (config3d.js); diff.creature.enabled === false (Sandbox, the menu) keeps it out
   * @param {EventBus} bus
   * @param {{seed?:number, tethers?:object}} [options]  deterministic seed; tethers = the run's TetherSystem (which ropes
   *   hold which rings; a cut releases them). Without tethers it never measures (nothing to cut).
   */
  constructor(level, diff, bus, options) {
    this.level = level || null;
    this.diff = diff || {};
    this.bus = bus || null;
    this.tethers = (options && options.tethers) || null;
    const cd = this.diff.creature || {};
    this.enabled = cd.enabled !== false && !!level;
    this.tuneKey = DRESSER_DIFF[this.diff.key] ? this.diff.key : 'normal';
    this.k = DRESSER_DIFF[this.tuneKey];
    this.seed = options && isFinite(options.seed) ? options.seed | 0 : (Math.random() * 1e9) | 0;
    this._rand = U.rng(this.seed);
    this._gate = false; // setGate: armed only while the player is whole (off: hunts whatever the health)
    this._rival = false; // setRival: the Mason has the player's scent
    this.hp = 1;
    this._solids = [];
    this._surf = { x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, solid: null };
    this._tmp = { x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0 };
    this._hit = { t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, solid: null };
    this._best = { x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, score: -FAR, ok: false, solid: null };
    this._solid = null; // the structural solid it stands on
    this._tgt = { x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, ok: false, approach: false };
    this._view = { ok: false, x: 0, y: 0, z: 0, fx: 0, fy: 0, fz: -1 };
    this._px = 0;
    this._py = 0;
    this._pz = 0;
    this.body = {
      visible: false,
      x: 0,
      y: 0,
      z: 0,
      ux: 0,
      uy: 1,
      uz: 0,
      fx: 0,
      fy: 0,
      fz: 1,
      lx: 0,
      ly: 0,
      lz: 0,
      walk: 0,
      speed: 0,
      measure: 0,
      cut: 0,
      stagger: 0,
      spoiled: 0,
      glow: 0.3,
      tick: 0, // counts the line's ticks (the view jolts the hands on each)
      line: { on: false, x: 0, y: 0, z: 0, taut: 0 },
      outline: { on: false, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 1, grow: 0, alpha: 0, seed: 0 },
      state: S.DORMANT,
    };
    this._tickP = { x: 0, y: 0, z: 0, fast: false, intensity: 0.5, hand: null, distance: FAR };
    this._humP = { x: 0, y: 0, z: 0, distance: FAR, note: 0 };
    this._offs = [];
    if (this.bus && typeof this.bus.on === 'function') {
      this._offs.push(this.bus.on('rope:shot', (p) => this._onShot(p)));
    }
    this.sectionIndex = -1;
    this.cfg = Object.assign({}, DEFAULTS);
    this.reset(null);
  }

  /** Unsubscribes from the bus (the game builds one per run). */
  destroy() {
    for (const off of this._offs) if (typeof off === 'function') off();
    this._offs.length = 0;
  }

  /** The health gate: on = it hunts only while the player is whole (game.js); off = whatever the health (tests, ?dresser=always). */
  setGate(on) {
    this._gate = !!on;
    this._whole = !this._gate || this.hp >= this.whole;
    this.armed = this._whole && !(this._gate && this._rival);
  }

  /** The player's health 0..1 (Health3D.hp), every frame. */
  setHp(hp) {
    this.hp = num(hp, 1);
  }

  /**
   * The Mason has the player (its hunt gate armed, it is still withdrawing, or it makes its staged S4 pass): every frame (game.js).
   * While on it does not hunt and it leaves play (back out of sight >= 30 m away once it is off).
   */
  setRival(on) {
    this._rival = !!on;
  }

  /** The run's TetherSystem (late binding). */
  setTethers(t) {
    this.tethers = t || null;
  }

  /** The hp at which it starts hunting on this difficulty (section data may override per difficulty). */
  get whole() {
    const w = this.cfg.wholeBy && this.cfg.wholeBy[this.tuneKey];
    return num(w, this.k.whole);
  }

  /** In play and hunting you (whole, not spoiled / staggered): the chalk health text reads this. */
  get hunting() {
    return this.inPlay && this.armed && this.player != null && (this.state === S.MEASURE || this.state === S.CUT || ((this.state === S.STALK || this.state === S.RECOVER) && this.sees && this.distance < 28));
  }

  /** A measure or a cut is under way (the hand whose rope it targets: targetHand). */
  get measuring() {
    return this.inPlay && (this.state === S.MEASURE || this.state === S.CUT);
  }

  reset(player) {
    this.state = S.DORMANT;
    this.stateTime = 0;
    this.inPlay = false;
    this._whole = !this._gate || this.hp >= this.whole;
    this.armed = this._whole && !(this._gate && this._rival);
    this.t = 0;
    this.x = 0;
    this.y = -1e5;
    this.z = 0;
    this.nx = 0; // smoothed up (the surface normal it stands on)
    this.ny = 1;
    this.nz = 0;
    this.snx = 0; // raw surface normal
    this.sny = 1;
    this.snz = 0;
    this.fx = 0; // facing (unit, tangent to the surface)
    this.fy = 0;
    this.fz = 1;
    this.distance = FAR;
    this.sees = false;
    this.caughtPlayer = false;
    this.caughtCause = '';
    this.player = null;
    this._graceT = T.grace;
    this._spawnT = 0;
    this._lastCut = -1e9;
    this._staggerCd = 0;
    this._losLost = 0;
    this._vantT = 0;
    this._tickT = 0.5;
    this._humT = T.hum.min * 0.5;
    this._leaving = false;
    this._leaveT = 0;
    this._stuckT = 0;
    this._progD = FAR;
    this._azBias = 0;
    this._outlineT = 0;
    this._outlineWipe = false;
    this._relocT = 0;
    this._detourSign = 1;
    this._badT = 0;
    this.target = null; // the anchor being measured / cut
    this.targetHand = null;
    this.stats = { spawns: 0, relocations: 0, measures: 0, cuts: 0, cancels: 0, staggers: 0, dresses: 0, spoils: 0, minSpawnDist: FAR, minEntryDist: FAR, minRelocDist: FAR };
    this.lastCancel = '';
    const b = this.body;
    b.visible = false;
    b.walk = 0;
    b.speed = 0;
    b.measure = 0;
    b.cut = 0;
    b.stagger = 0;
    b.spoiled = 0;
    b.line.on = false;
    b.outline.on = false;
    b.outline.alpha = 0;
    b.state = S.DORMANT;
    if (player && this.level && this.level.sections) {
      const i = this.level.sectionIndexAt(player.y);
      this.setSection(i, this.level.sections[i], player);
    }
  }

  /** The section's Dresser config on this difficulty: section.creature.dresser with its by[difficulty] laid over. */
  _cfgOf(sec) {
    const c = Object.assign({}, DEFAULTS);
    const d = sec && sec.creature && sec.creature.dresser;
    if (d && typeof d === 'object') Object.assign(c, d);
    const by = c.by && c.by[this.tuneKey];
    if (by) Object.assign(c, by);
    c.active = this.enabled && c.active === true;
    return c;
  }

  setSection(index, section, player) {
    const lv = this.level;
    const sec = section || (lv && lv.sections && lv.sections[index]) || null;
    this.sectionIndex = index;
    this.cfg = this._cfgOf(sec);
    if (this.cfg.active) {
      this._leaving = false;
      if (!this.inPlay) this._spawnT = 0; // enters play on the next update (out of sight, >= spawnMin away)
    } else if (this.inPlay) {
      this._leaving = true; // walks away and leaves play out of sight (never a pop in view)
      this._leaveT = 0;
      this._cancel('leave');
    }
    if (player) this._setPlayer(player);
  }

  /** A respawn (full health): out of play, re-enters out of sight with the grace; the run's cut rings are restored by Level3D.reset. */
  onRespawn(player) {
    const keepGate = this._gate;
    const hp = this.hp;
    const cfgSec = this.sectionIndex;
    this.reset(null);
    this._gate = keepGate;
    this.hp = hp;
    this._whole = !this._gate || this.hp >= this.whole;
    this.armed = this._whole && !(this._gate && this._rival);
    if (player && this.level && this.level.sections) {
      const i = this.level.sectionIndexAt(player.y);
      this.setSection(i, this.level.sections[i], player);
    } else this.sectionIndex = cfgSec;
  }

  _setPlayer(p) {
    this.player = p;
    this._px = p.x;
    this._py = p.y;
    this._pz = p.z;
  }

  // ===========================================================================
  // Update
  // ===========================================================================

  update(dt, player, time) {
    void time;
    const b = this.body;
    if (!this.enabled || !player) {
      b.visible = false;
      return;
    }
    dt = U.clamp(num(dt, 0), 0, 0.1);
    this.t += dt;
    this._setPlayer(player);
    // the gate (hysteresis: whole at hp >= whole, no longer below whole - hysteresis); and it never hunts while the Mason has
    // your scent (setRival): the two gates never overlap, so only one big creature is ever after you (and in view)
    const whole = this.whole;
    let w = this._whole;
    if (!this._gate) w = true;
    else if (!w && this.hp >= whole - 1e-9) w = true;
    else if (w && this.hp < whole - T.hysteresis - 1e-9) w = false;
    this._whole = w;
    const armed = w && !(this._gate && this._rival);
    if (armed !== this.armed) {
      this.armed = armed;
      if (this.inPlay && !this._leaving) {
        if (!armed) this._spoil();
        else {
          this._emit('dresser:whole', { x: this.x, y: this.y, z: this.z, distance: this.distance });
          if (this.state === S.SPOILED) this._setState(S.STALK);
        }
      }
    }
    // the Mason has your scent: it gives you up to it and leaves (out of your sight), back when the scent is gone
    const yields = this._gate && this._rival;
    if (yields && this.inPlay && !this._leaving) {
      this._leaving = true;
      this._leaveT = 0;
      this._cancel('rival');
    }
    if (!this.inPlay) {
      b.visible = false;
      this._fadeOutline(dt);
      if (this.cfg.active && !this._leaving && !yields && player.alive !== false) {
        this._spawnT -= dt;
        if (this._spawnT <= 0) {
          if (this._enterPlay(player, 'spawn')) this._emit('dresser:appear', { x: this.x, y: this.y, z: this.z, distance: this.distance });
          else this._spawnT = 0.5;
        }
      }
      return;
    }
    this.stateTime += dt;
    this.body.speed = 0; // set by whatever walks this frame
    if (this._graceT > 0) this._graceT -= dt;
    if (this._staggerCd > 0) this._staggerCd -= dt;
    this._measureDist(player);
    this.sees = this._seesWhole(player);

    if (this._leaving) {
      this._leaveStep(dt);
    } else {
      // far behind (out of sight) or past the haze: relocate out of sight near the player (keeps its state)
      if (this._relocT > 0) this._relocT -= dt;
      if (this._relocT <= 0 && this.state !== S.MEASURE && this.state !== S.CUT && (this.distance > T.relocateFog || (this.distance > T.relocateFar && !this.sees))) {
        this._relocT = 0.5;
        this._enterPlay(player, 'relocate');
      }
      switch (this.state) {
        case S.STALK:
          this._stalk(dt, player);
          break;
        case S.MEASURE:
          this._measureStep(dt, player);
          break;
        case S.CUT:
          this._cutStep(dt, player);
          break;
        case S.RECOVER:
          this._turnToward(dt, player);
          if (this.stateTime >= T.recoverTime) this._setState(this.armed ? S.STALK : S.SPOILED);
          break;
        case S.SPOILED:
          this._spoiledStep(dt);
          break;
        case S.STAGGER:
          if (this.stateTime >= T.staggerTime) this._setState(this.armed ? S.RECOVER : S.SPOILED);
          break;
        default:
          this._setState(this.armed ? S.STALK : S.SPOILED);
      }
      this._checkReach(player);
    }
    this._updateOutline(dt, player);
    this._sounds(dt, player);
    this._writeBody(dt, player);
  }

  // ===========================================================================
  // States
  // ===========================================================================

  _setState(s) {
    if (this.state === s) return;
    this.state = s;
    this.stateTime = 0;
    this.body.state = s;
  }

  _spoil() {
    if (this.state === S.MEASURE || this.state === S.CUT) this._cancel('spoiled');
    this.stats.spoils++;
    if (this.state !== S.STAGGER) this._setState(S.SPOILED);
    this._emit('dresser:spoiled', { x: this.x + this.nx * T.eye, y: this.y + this.ny * T.eye, z: this.z + this.nz * T.eye, distance: this.distance });
  }

  _stalk(dt, player) {
    this._vantT -= dt;
    if (this._vantT <= 0 || !this._tgt.ok) {
      this._vantT = T.vantageEvery;
      this._pickVantage(player);
    }
    const tg = this._tgt;
    let moved = 0;
    const stand = !tg.approach && this.sees && this.distance <= T.standOff;
    if (tg.ok && !stand) {
      moved = this._walk(dt, tg.x, tg.y, tg.z, this.k.walk * num(this.cfg.walkMul, 1));
      // progress watch: a walk that gets nowhere (or a spot from which it cannot measure you) for 3 s re-picks with another
      // bias; stuck out of your sight it hops to another wall (also out of your sight)
      const d = len3(tg.x - this.x, tg.y - this.y, tg.z - this.z);
      const good = tg.approach || (this.sees && this.distance <= num(this.cfg.measureRange, T.measureRange));
      if (d < this._progD - 0.4) {
        this._progD = d;
        this._stuckT = 0;
      } else if (d > 0.6 || !good) this._stuckT += dt;
      if (this._stuckT > 3) {
        this._stuckT = 0;
        this._progD = FAR;
        this._azBias += 1.9;
        this._vantT = 0;
        // stuck where it cannot see you: it hops (out of your sight only) to a wall that reaches you
        if (!this.sees && this._relocT <= 0) {
          this._relocT = 0.5;
          this._enterPlay(player, 'relocate');
        }
      }
    } else {
      this._stuckT = 0;
      this._progD = FAR;
    }
    if (moved < 1e-4) this._turnToward(dt, player);
    this.body.speed = dt > 0 ? moved / dt : 0;
    // wandering where it cannot measure you for long (a slab between, a wall that does not reach you): it hops when unseen
    const useful = this.sees && this.distance <= num(this.cfg.measureRange, T.measureRange);
    this._badT = useful ? 0 : this._badT + dt;
    if (this._badT > T.hopAfter && this._relocT <= 0) {
      this._relocT = 0.5;
      if (this._enterPlay(player, 'relocate')) this._badT = 0;
    }
    this._tryMeasure(player);
  }

  _tryMeasure(player) {
    if (!this.armed || this._graceT > 0 || player.alive === false || !this.sees) return;
    if (this.distance > num(this.cfg.measureRange, T.measureRange)) return;
    if (this.t - this._lastCut < Math.max(this.k.rearm, T.cutGap - T.measureTime - T.cutTime)) return;
    const pick = this._pickTarget(player);
    if (!pick) return;
    this.target = pick;
    this._measureStart = this.t;
    this._losLost = 0;
    this.stats.measures++;
    this._setState(S.MEASURE);
    this._placeOutline(player, true);
    const o = this.body.outline;
    this._emit('dresser:measure', {
      x: o.on ? o.x : this.x,
      y: o.on ? o.y : this.y,
      z: o.on ? o.z : this.z,
      anchorId: pick.id,
      hand: this.targetHand,
      distance: this.distance,
      ox: o.x,
      oy: o.y,
      oz: o.z,
      dx: this.x,
      dy: this.y,
      dz: this.z,
    });
  }

  /** The ring it means to cut: the loaded rope's ring (the higher tension; else the latest), if it may cut it. Sets targetHand. */
  _pickTarget(player) {
    const th = this.tethers && this.tethers.hands;
    if (!th) return null;
    let n = 0;
    let best = null;
    let bestT = -1;
    let hand = null;
    for (let k = 0; k < 2; k++) {
      const h = k === 0 ? 'left' : 'right';
      const st = th[h];
      const rope = st && st.rope;
      if (!rope || !rope.attached || !rope.anchor) continue;
      n++;
      const a = rope.anchor;
      if (!cuttable(a)) continue;
      const ten = num(rope.tension, 0) + num(st.attachTime, 0) * 1e-3;
      if (ten > bestT) {
        bestT = ten;
        best = a;
        hand = h;
      }
    }
    if (!best) return null;
    if (player.grounded && n <= 1) return null; // never your only anchor while you stand on something
    this.targetHand = hand;
    return best;
  }

  /** Common checks while measuring / cutting: false (and cancelled) when the cut must not go on. */
  _holdMeasure(dt, player) {
    const a = this.target;
    if (!this.armed) {
      this._spoil();
      return false;
    }
    let why = '';
    if (!a || a.broken) why = 'ring';
    else if (player.alive === false) why = 'dead';
    else if (this.distance > T.measureKeep) why = 'range';
    else if (!this.sees) {
      this._losLost += dt;
      if (this._losLost >= T.losGrace) why = 'sight';
    } else this._losLost = 0;
    if (!why) return true;
    this._cancel(why);
    return false;
  }

  _measureStep(dt, player) {
    this._turnToward(dt, player);
    if (!this._holdMeasure(dt, player)) return;
    if (this.t - this._measureStart >= T.measureTime - 1e-9) {
      this._setState(S.CUT);
      this._cutStart = this.t;
      const a = this.target;
      this._emit('dresser:saw', { x: a.x, y: a.y, z: a.z, anchorId: a.id, hand: this.targetHand, distance: this.distance, dx: this.x, dy: this.y, dz: this.z });
    }
  }

  _cutStep(dt, player) {
    this._turnToward(dt, player);
    if (!this._holdMeasure(dt, player)) return;
    if (this.t - this._cutStart < T.cutTime - 1e-9) return;
    const a = this.target;
    // the rules at the moment of the cut: the ring gap, and never the only anchor of a player standing on something
    let n = 0;
    const th = this.tethers && this.tethers.hands;
    if (th) for (const h of ['left', 'right']) if (th[h] && th[h].rope && th[h].rope.attached) n++;
    const holds = th && ((th.left && th.left.rope && th.left.rope.anchor === a) || (th.right && th.right.rope && th.right.rope.anchor === a));
    if (player.grounded && n <= 1 && holds) return this._cancel('grounded');
    if (this.t - this._lastCut < T.cutGap) return this._cancel('gap');
    this._doCut(a, player);
    this._setState(S.RECOVER);
  }

  _doCut(a, player) {
    a.broken = true;
    a.cut = true;
    this._lastCut = this.t;
    this.stats.cuts++;
    let released = 0;
    let hand = null;
    const ts = this.tethers;
    if (ts && ts.hands) {
      for (const h of ['left', 'right']) {
        const st = ts.hands[h];
        if (st && st.rope && st.rope.attached && st.rope.anchor === a) {
          if (typeof ts.release === 'function') ts.release(player, h, 'cut');
          else st.rope.detach();
          released++;
          hand = h;
        }
      }
    }
    this.target = null;
    this._emit('grapple:break', { hand, anchor: a, x: a.x, y: a.y, z: a.z, cut: true });
    this._emit('dresser:cut', { anchorId: a.id, hand, released, x: a.x, y: a.y, z: a.z, distance: this.distance });
    this._outlineT = 0; // the outline stays on the wall a while, then fades
    this._outlineWipe = false;
  }

  _cancel(reason) {
    const was = this.state === S.MEASURE || this.state === S.CUT;
    this.target = null;
    this._losLost = 0;
    if (!was) return;
    this.stats.cancels++;
    this.lastCancel = reason;
    this._emit('dresser:cancel', { reason, x: this.x, y: this.y, z: this.z, distance: this.distance });
    if (reason !== 'spoiled' && reason !== 'stagger' && reason !== 'leave' && reason !== 'rival') this._setState(S.RECOVER);
    this._outlineWipe = true; // a cancelled outline is wiped at once
  }

  _spoiledStep(dt) {
    // it stands, mask turned away; you coming close makes it step back along its wall
    if (this.distance < T.spoiledNear) {
      const ax = this.x - this._px;
      const ay = this.y - this._py;
      const az = this.z - this._pz;
      const l = len3(ax, ay, az) || 1;
      const moved = this._walk(dt, this.x + (ax / l) * 4, this.y + (ay / l) * 4, this.z + (az / l) * 4, this.k.walk * 0.6);
      this.body.speed = dt > 0 ? moved / dt : 0;
    } else this.body.speed = 0;
  }

  _leaveStep(dt) {
    this._leaveT += dt;
    // gone once you cannot see it (behind masonry, outside your view, far), at the latest after T.leaveMax
    if (!this.sees || this.distance > 30 || this._leaveT > T.leaveMax || this._hidden(this.x, this.y, this.z, this.nx, this.ny, this.nz)) {
      this._leavePlay();
      return;
    }
    const ax = this.x - this._px;
    const az = this.z - this._pz;
    const l = Math.hypot(ax, az) || 1;
    const moved = this._walk(dt, this.x + (ax / l) * 5, this.y + 3, this.z + (az / l) * 5, this.k.walk);
    this.body.speed = dt > 0 ? moved / dt : 0;
    if (this.state !== S.SPOILED && this.state !== S.STAGGER) this._setState(S.SPOILED);
  }

  _leavePlay() {
    this.inPlay = false;
    this._leaving = false;
    this.target = null;
    this.body.visible = false;
    this.body.line.on = false;
    this._setState(S.DORMANT);
  }

  /** Reach: it dresses a whole player its body touches (T.reach from the feet-to-head axis). */
  _checkReach(player) {
    if (!this.armed || this._graceT > 0 || player.alive === false || this.caughtPlayer) return;
    if (this.state === S.STAGGER || this.state === S.SPOILED) return;
    const H = T.height * 0.92;
    const d2 = segSegDist2(this.x, this.y, this.z, this.x + this.nx * H, this.y + this.ny * H, this.z + this.nz * H, player.x, player.y - 0.3, player.z, player.x, player.y + 1.0, player.z);
    if (d2 > T.reach * T.reach) return;
    this.caughtPlayer = true;
    this.caughtCause = 'dressed';
    this.stats.dresses++;
    this._cancel('dress');
    this._setState(S.RECOVER);
    this._emit('dresser:dress', { x: player.x, y: player.y, z: player.z, distance: Math.sqrt(d2) });
  }

  // ===========================================================================
  // The grapple shot (bus 'rope:shot'): a ray through its body staggers it
  // ===========================================================================

  _onShot(p) {
    if (!this.inPlay || !p || this._staggerCd > 0 || this.state === S.STAGGER) return;
    const ox = num(p.ox, NaN);
    const oy = num(p.oy, NaN);
    const oz = num(p.oz, NaN);
    const dx = num(p.dx, 0);
    const dy = num(p.dy, 0);
    const dz = num(p.dz, 0);
    const range = Math.max(1, num(p.range, 30));
    if (!isFinite(ox + oy + oz) || !(len3(dx, dy, dz) > 0.5)) return;
    const H = T.height;
    const r = T.bodyRadius + T.shotPad;
    const ex = ox + dx * range;
    const ey = oy + dy * range;
    const ez = oz + dz * range;
    const d2 = segSegDist2(this.x + this.nx * 0.4, this.y + this.ny * 0.4, this.z + this.nz * 0.4, this.x + this.nx * H, this.y + this.ny * H, this.z + this.nz * H, ox, oy, oz, ex, ey, ez);
    if (d2 > r * r) return;
    // the first thing on the line must be the Dresser, not a wall in front of it
    const cx = this.x + this.nx * H * 0.6 - ox;
    const cy = this.y + this.ny * H * 0.6 - oy;
    const cz = this.z + this.nz * H * 0.6 - oz;
    const along = cx * dx + cy * dy + cz * dz;
    if (along < 0.3) return;
    const lv = this.level;
    if (lv && typeof lv.segmentBlocked === 'function' && along > 1.5) {
      const t = along - 1.0;
      if (lv.segmentBlocked(ox, oy, oz, ox + dx * t, oy + dy * t, oz + dz * t, 0.05)) return;
    }
    this._staggerCd = T.staggerCooldown;
    this.stats.staggers++;
    this._cancel('stagger');
    this._setState(S.STAGGER);
    this._emit('dresser:stagger', { x: this.x + this.nx * 2, y: this.y + this.ny * 2, z: this.z + this.nz * 2, distance: this.distance, hand: p.hand || null });
  }

  // ===========================================================================
  // Entering play: out of sight, never close
  // ===========================================================================

  /**
   * Places it on a wall out of the player's sight. mode 'spawn' (entering play): T.spawnMin..T.spawnMax away, hidden when any
   * candidate is; mode 'relocate' (far behind, or stuck where it cannot see you): T.relocateMin..T.relocateMax away, only where
   * you cannot see it (nor where it stood), preferring a spot from which it sees you. Never within T.neverWithin. Returns false
   * when no spot was found (retried later).
   */
  _enterPlay(player, mode) {
    const reloc = mode === 'relocate';
    const minD = reloc ? T.relocateMin : T.spawnMin;
    const maxD = reloc ? T.relocateMax : T.spawnMax;
    const lv = this.level;
    if (!lv || typeof lv.querySolids !== 'function') return false;
    if (reloc && this.inPlay && !this._hidden(this.x, this.y, this.z, this.nx, this.ny, this.nz)) return false; // never vanish in view
    const sec = lv.sections && lv.sections[this.sectionIndex];
    const yLo = sec ? sec.yBottom - 18 : -Infinity;
    const yHi = sec ? sec.yTop + 6 : Infinity;
    const best = this._best;
    best.ok = false;
    best.score = -FAR;
    for (let k = 0; k < 48; k++) {
      const y = U.clamp(reloc ? player.y - 14 + this._rand() * 24 : player.y - 28 + this._rand() * 42, yLo, yHi);
      const az = this._rand() * TAU;
      if (!this._rayWall(player.x, y, player.z, az, 70)) continue;
      const h = this._hit;
      if (h.ny > 0.7 || h.ny < -0.7) continue;
      if (!this._columnClear(h.x, h.y, h.z, h.nx, h.ny, h.nz)) continue;
      const d = len3(h.x + h.nx * 1.6 - player.x, h.y + h.ny * 1.6 - player.y, h.z + h.nz * 1.6 - player.z);
      if (d < minD || d > maxD) continue;
      // every part of it at least minD from you (its eyes too)
      const ex = h.x + h.nx * T.eye;
      const ey = h.y + h.ny * T.eye;
      const ez = h.z + h.nz * T.eye;
      if (len3(ex - player.x, ey - player.y - 0.4, ez - player.z) < minD) continue;
      const hidden = this._hidden(h.x, h.y, h.z, h.nx, h.ny, h.nz);
      if (reloc && !hidden) continue; // a relocation is never seen
      let score = (hidden ? 100 : 0) - Math.abs(d - (reloc ? minD + 2 : 34)) + this._rand() * 0.5;
      if (reloc && !this._blocked(ex, ey, ez, player.x, player.y + 1.2, player.z) && !this._blocked(ex, ey, ez, player.x, player.y - 0.3, player.z)) score += 50;
      // a face that reaches within your measuring range (it can walk to a vantage on it)
      if (this._faceReach(player, h.solid, h.nx, h.ny, h.nz) < T.measureRange - 2) score += 20;
      if (score > best.score) {
        best.score = score;
        best.ok = true;
        best.x = h.x;
        best.y = h.y;
        best.z = h.z;
        best.nx = h.nx;
        best.ny = h.ny;
        best.nz = h.nz;
        best.solid = h.solid;
      }
    }
    if (!best.ok) return false;
    this._solid = best.solid;
    this.x = best.x;
    this.y = best.y;
    this.z = best.z;
    this.nx = this.snx = best.nx;
    this.ny = this.sny = best.ny;
    this.nz = this.snz = best.nz;
    this._faceToward(player.x, player.y, player.z, true);
    this._measureDist(player);
    if (this.distance < this.stats.minSpawnDist) this.stats.minSpawnDist = this.distance;
    if (reloc) {
      this.stats.relocations++;
      if (this.distance < this.stats.minRelocDist) this.stats.minRelocDist = this.distance;
    } else {
      this.stats.spawns++;
      if (this.distance < this.stats.minEntryDist) this.stats.minEntryDist = this.distance;
    }
    this._tgt.ok = false;
    this._vantT = 0;
    this._stuckT = 0;
    this._progD = FAR;
    if (!reloc) {
      this.inPlay = true;
      this._graceT = T.grace;
      this.body.walk = 0;
      this._setState(this.armed ? S.STALK : S.SPOILED);
    } else if (this.state === S.MEASURE || this.state === S.CUT) this._cancel('relocate');
    this.body.visible = true;
    return true;
  }

  /** Distance from the player to the nearest point of a face (solid + outward normal), its eyes' height above it: how close it gets there. */
  _faceReach(player, f, nx, ny, nz) {
    if (!f) return FAR;
    const ax = Math.abs(nx) > 0.5 ? 0 : Math.abs(ny) > 0.5 ? 1 : 2;
    const x = ax === 0 ? (nx > 0 ? f.maxX : f.minX) : U.clamp(player.x, f.minX + 0.4, f.maxX - 0.4);
    const y = ax === 1 ? (ny > 0 ? f.maxY : f.minY) : U.clamp(player.y, f.minY + 0.4, f.maxY - 0.4);
    const z = ax === 2 ? (nz > 0 ? f.maxZ : f.minZ) : U.clamp(player.z, f.minZ + 0.4, f.maxZ - 0.4);
    return len3(x + nx * 2 - player.x, y + ny * 2 - player.y, z + nz * 2 - player.z);
  }

  /**
   * The player's eyes (setView, game.js: the head camera) cannot see a Dresser standing at (x,y,z) on up n: its chest and its
   * eyes are both behind masonry, or both outside the view cone (T.viewCos). Without a view (tests, bots) only masonry hides it.
   */
  _hidden(x, y, z, nx, ny, nz) {
    const v = this._view;
    const hx = v.ok ? v.x : this._px;
    const hy = v.ok ? v.y : this._py + 1.2;
    const hz = v.ok ? v.z : this._pz;
    for (let k = 0; k < 2; k++) {
      const h = k === 0 ? 1.6 : T.eye;
      const px = x + nx * h;
      const py = y + ny * h;
      const pz = z + nz * h;
      if (this._blocked(hx, hy, hz, px, py, pz)) continue;
      if (v.ok) {
        const dx = px - hx;
        const dy = py - hy;
        const dz = pz - hz;
        const l = len3(dx, dy, dz) || 1;
        if ((dx * v.fx + dy * v.fy + dz * v.fz) / l < T.viewCos) continue;
      }
      return false;
    }
    return true;
  }

  /** The player's head camera this frame: position and unit forward (game.js); optional. */
  setView(x, y, z, fx, fy, fz) {
    const v = this._view;
    const l = len3(fx, fy, fz);
    v.ok = isFinite(x + y + z) && l > 0.5;
    if (!v.ok) return;
    v.x = x;
    v.y = y;
    v.z = z;
    v.fx = fx / l;
    v.fy = fy / l;
    v.fz = fz / l;
  }

  // ===========================================================================
  // Steering on the walls
  // ===========================================================================

  /** Where it walks: a wall point beside the player at a vantage distance, or (the player by a wall) the player's own wall. */
  _pickVantage(player) {
    const tg = this._tgt;
    const s = this._surf;
    // you cling to / stand by a structural surface: it comes for you along it
    if (this._findSurface(player.x, player.y + 0.3, player.z, 2.4, s) < 2.4 && Math.abs(s.ny) < 0.7) {
      tg.ok = true;
      tg.approach = true;
      tg.x = s.x;
      tg.y = s.y;
      tg.z = s.z;
      tg.nx = s.nx;
      tg.ny = s.ny;
      tg.nz = s.nz;
      return;
    }
    tg.approach = false;
    const best = this._best;
    best.ok = false;
    best.score = -FAR;
    // 1. its own face (reachable): points around the face point nearest you
    const f = this._solid;
    if (f && isStructural(f)) {
      const ax = Math.abs(this.snx) > 0.5 ? 0 : Math.abs(this.sny) > 0.5 ? 1 : 2;
      for (let k = 0; k < FACE_SAMPLES.length; k += 2) {
        const da = FACE_SAMPLES[k];
        const db = FACE_SAMPLES[k + 1];
        // tangent axes: for a vertical face a = y, b = the horizontal one; else x / z
        let x = player.x;
        let y = player.y + 1.2;
        let z = player.z;
        if (ax === 0) {
          x = this.snx > 0 ? f.maxX : f.minX;
          y += da;
          z += db;
        } else if (ax === 2) {
          z = this.snz > 0 ? f.maxZ : f.minZ;
          y += da;
          x += db;
        } else {
          y = this.sny > 0 ? f.maxY : f.minY;
          x += da;
          z += db;
        }
        x = ax === 0 ? x : U.clamp(x, f.minX + 0.4, f.maxX - 0.4);
        y = ax === 1 ? y : U.clamp(y, f.minY + 0.4, f.maxY - 0.4);
        z = ax === 2 ? z : U.clamp(z, f.minZ + 0.4, f.maxZ - 0.4);
        this._scoreVantage(player, x, y, z, this.snx, this.sny, this.snz, 0);
      }
    }
    // 2. other walls round you (the walk may not get there: the progress watch hops when it is out of your sight)
    const base = Math.atan2(this.z - player.z, this.x - player.x) + this._azBias;
    for (let k = 0; k < 12; k++) {
      const off = k === 0 ? 0 : (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.5;
      const yo = k % 3 === 0 ? 1.6 : k % 3 === 1 ? 4 : -0.8; // level with you, a little above, a little below
      if (!this._rayWall(player.x, player.y + yo, player.z, base + off, 40)) continue;
      const h = this._hit;
      if (h.ny > 0.7 || h.ny < -0.7) continue;
      this._scoreVantage(player, h.x, h.y, h.z, h.nx, h.ny, h.nz, h.solid === f ? 0 : 6);
    }
    if (!best.ok) {
      tg.ok = false;
      return;
    }
    tg.ok = true;
    tg.x = best.x;
    tg.y = best.y;
    tg.z = best.z;
    tg.nx = best.nx;
    tg.ny = best.ny;
    tg.nz = best.nz;
    this.vantageScore = best.score;
  }

  /** Scores one vantage candidate into this._best (distance band, a three-quarter view, sight of the whole of you, walking). */
  _scoreVantage(player, x, y, z, nx, ny, nz, penalty) {
    if (!this._columnClear(x, y, z, nx, ny, nz)) return;
    const vx = player.x - (x + nx * 2);
    const vy = player.y - (y + ny * 2);
    const vz = player.z - (z + nz * 2);
    const d = len3(vx, vy, vz) || 1;
    const cosA = (vx * nx + vy * ny + vz * nz) / d; // 1 = you straight out along its up
    let score = -penalty - Math.max(0, T.vantage[0] - d) * 2 - Math.max(0, d - T.vantage[1]) * 1.5;
    score -= Math.max(0, cosA - 0.82) * 12; // a three-quarter view of you, not you straight overhead
    score -= len3(x - this.x, y - this.y, z - this.z) * 0.12; // the least walking
    const ex = x + nx * T.eye;
    const ey = y + ny * T.eye;
    const ez = z + nz * T.eye;
    if (this._blocked(ex, ey, ez, player.x, player.y + 1.2, player.z) || this._blocked(ex, ey, ez, player.x, player.y - 0.3, player.z)) score -= 20;
    const best = this._best;
    if (score > best.score) {
      best.score = score;
      best.ok = true;
      best.x = x;
      best.y = y;
      best.z = z;
      best.nx = nx;
      best.ny = ny;
      best.nz = nz;
    }
  }

  /**
   * One walking step toward (tx,ty,tz) along the surface it stands on: the move is projected onto its tangent plane, then the
   * feet snap to the nearest structural surface (corners hand it to the next wall; its up eases round). A step into the air or
   * into masonry is refused. Returns the distance walked.
   */
  _walk(dt, tx, ty, tz, speed) {
    let dx = tx - this.x;
    let dy = ty - this.y;
    let dz = tz - this.z;
    const dn = dx * this.snx + dy * this.sny + dz * this.snz;
    dx -= this.snx * dn;
    dy -= this.sny * dn;
    dz -= this.snz * dn;
    const l = len3(dx, dy, dz);
    if (l < 0.15) return 0;
    const step = Math.min(l, speed * dt);
    let ux = dx / l;
    let uy = dy / l;
    let uz = dz / l;
    // straight on, else the first detour that moves (a pillar, a statue, a buttress in the way), on the side it last took
    let ok = this._stepOk(ux, uy, uz, step);
    for (let k = 0; !ok && k < DETOURS.length; k++) {
      const a = DETOURS[k] * this._detourSign;
      const c = Math.cos(a);
      const sn = Math.sin(a);
      const cx = this.sny * (dz / l) - this.snz * (dy / l);
      const cy = this.snz * (dx / l) - this.snx * (dz / l);
      const cz = this.snx * (dy / l) - this.sny * (dx / l);
      ux = (dx / l) * c + cx * sn;
      uy = (dy / l) * c + cy * sn;
      uz = (dz / l) * c + cz * sn;
      ok = this._stepOk(ux, uy, uz, step);
      if (ok && k > 1) this._detourSign = a > 0 ? 1 : -1;
    }
    if (!ok) {
      this._detourSign = -this._detourSign;
      return 0;
    }
    const s = this._surf;
    const moved = len3(s.x - this.x, s.y - this.y, s.z - this.z);
    this._solid = s.solid;
    this.x = s.x;
    this.y = s.y;
    this.z = s.z;
    this.snx = s.nx;
    this.sny = s.ny;
    this.snz = s.nz;
    this._easeNormal(dt);
    // facing: along the walk
    this._faceDir(ux, uy, uz, dt);
    this.body.walk += moved;
    return moved;
  }

  /** Can it step `step` m along tangent u? (feet snap to a structural surface, its body column clear): the result in this._surf. */
  _stepOk(ux, uy, uz, step) {
    const nx = this.x + ux * step;
    const ny = this.y + uy * step;
    const nz = this.z + uz * step;
    const s = this._surf;
    const d = this._findSurface(nx + this.snx * 0.3, ny + this.sny * 0.3, nz + this.snz * 0.3, T.surfaceSearch, s);
    if (!(d < T.surfaceSearch)) return false;
    const B = this._columnBlocker(s.x, s.y, s.z, s.nx, s.ny, s.nz);
    if (!B) return true;
    // an inner corner (another wall across its way): it turns onto that wall, its feet a body's width out from the old one
    const q = this._tmp;
    boxSurface(B, s.x, s.y, s.z, q);
    const ox = s.nx;
    const oy = s.ny;
    const oz = s.nz;
    if (ox * q.nx + oy * q.ny + oz * q.nz > 0.3) return false; // not a corner: a step up / down against the same orientation
    const push = T.footClear + 0.12;
    const fx = q.x + ox * push;
    const fy = q.y + oy * push;
    const fz = q.z + oz * push;
    if (len3(fx - this.x, fy - this.y, fz - this.z) > 1.2) return false;
    if (this._columnBlocker(fx, fy, fz, q.nx, q.ny, q.nz)) return false;
    s.x = fx;
    s.y = fy;
    s.z = fz;
    s.nx = q.nx;
    s.ny = q.ny;
    s.nz = q.nz;
    s.solid = B;
    return true;
  }

  /** The first structural solid in the way of its body column standing on (x,y,z) along up n, or null. */
  _columnBlocker(x, y, z, nx, ny, nz) {
    const lv = this.level;
    if (!lv || typeof lv.querySolids !== 'function') return null;
    const r = T.footClear;
    for (let k = 0; k < 3; k++) {
      const h = k === 0 ? 0.6 : k === 1 ? 1.8 : 2.9;
      const cx = x + nx * h;
      const cy = y + ny * h;
      const cz = z + nz * h;
      const list = lv.querySolids(cx - r, cy - r, cz - r, cx + r, cy + r, cz + r, this._solids);
      for (let i = 0; i < list.length; i++) {
        const b = list[i];
        if (b.active === false || !isStructural(b)) continue;
        if (U.sphereBox(cx, cy, cz, r, b)) return b;
      }
    }
    return null;
  }

  _easeNormal(dt) {
    const k = 1 - Math.exp(-T.normalRate * dt);
    let nx = this.nx + (this.snx - this.nx) * k;
    let ny = this.ny + (this.sny - this.ny) * k;
    let nz = this.nz + (this.snz - this.nz) * k;
    const l = len3(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    this.nx = nx;
    this.ny = ny;
    this.nz = nz;
  }

  /** Turns its facing (tangent to the surface) toward the player at the turn rate. */
  _turnToward(dt, player) {
    this._easeNormal(dt);
    const dx = player.x - this.x;
    const dy = player.y + 0.5 - this.y;
    const dz = player.z - this.z;
    this._faceDir(dx, dy, dz, dt);
  }

  _faceToward(x, y, z, snap) {
    this._faceDir(x - this.x, y - this.y, z - this.z, snap ? 1e3 : 0);
  }

  /** Eases the facing toward direction d projected on the tangent plane (keeps it when d is along the up). */
  _faceDir(dx, dy, dz, dt) {
    const nx = this.nx;
    const ny = this.ny;
    const nz = this.nz;
    const dn = dx * nx + dy * ny + dz * nz;
    let tx = dx - nx * dn;
    let ty = dy - ny * dn;
    let tz = dz - nz * dn;
    const tl = len3(tx, ty, tz);
    // re-orthogonalise the current facing against the (eased) up
    const fn = this.fx * nx + this.fy * ny + this.fz * nz;
    let fx = this.fx - nx * fn;
    let fy = this.fy - ny * fn;
    let fz = this.fz - nz * fn;
    let fl = len3(fx, fy, fz);
    if (fl < 1e-4) {
      // degenerate: any tangent (prefer one that points down the world's -Y side of the wall)
      fx = -nx * ny;
      fy = 1 - ny * ny;
      fz = -nz * ny;
      fl = len3(fx, fy, fz);
      if (fl < 1e-4) {
        fx = 1;
        fy = 0;
        fz = 0;
        fl = 1;
      }
    }
    fx /= fl;
    fy /= fl;
    fz /= fl;
    if (tl > 0.1 * len3(dx, dy, dz) && tl > 1e-3) {
      tx /= tl;
      ty /= tl;
      tz /= tl;
      const c = U.clamp(fx * tx + fy * ty + fz * tz, -1, 1);
      const ang = Math.acos(c);
      const maxA = T.turnRate * dt;
      if (ang <= maxA || ang < 1e-4) {
        fx = tx;
        fy = ty;
        fz = tz;
      } else {
        // rotate f toward t about the up by maxA (slerp in the tangent plane)
        const k = maxA / ang;
        const s0 = Math.sin((1 - k) * ang);
        const s1 = Math.sin(k * ang);
        const si = Math.sin(ang) || 1;
        if (ang > 3.1) {
          // opposite: turn about the up
          const cx = ny * fz - nz * fy;
          const cy = nz * fx - nx * fz;
          const cz = nx * fy - ny * fx;
          const cs = Math.cos(maxA);
          const sn = Math.sin(maxA);
          fx = fx * cs + cx * sn;
          fy = fy * cs + cy * sn;
          fz = fz * cs + cz * sn;
        } else {
          fx = (fx * s0 + tx * s1) / si;
          fy = (fy * s0 + ty * s1) / si;
          fz = (fz * s0 + tz * s1) / si;
        }
        const l2 = len3(fx, fy, fz) || 1;
        fx /= l2;
        fy /= l2;
        fz /= l2;
      }
    }
    this.fx = fx;
    this.fy = fy;
    this.fz = fz;
  }

  // ===========================================================================
  // Sight, distance, surfaces (the Mason's structural-surface rules: creature3d.js isStructural / boxSurface)
  // ===========================================================================

  _measureDist(player) {
    const ex = this.x + this.nx * T.eye;
    const ey = this.y + this.ny * T.eye;
    const ez = this.z + this.nz * T.eye;
    this.distance = len3(player.x - ex, player.y + 0.4 - ey, player.z - ez);
  }

  _blocked(x0, y0, z0, x1, y1, z1) {
    const lv = this.level;
    return !!(lv && typeof lv.segmentBlocked === 'function' && lv.segmentBlocked(x0, y0, z0, x1, y1, z1, 0.35));
  }

  /** It must see the WHOLE of you: your head and your feet, from its eyes. */
  _seesWhole(player) {
    if (this.distance > T.relocateFog) return false;
    const ex = this.x + this.nx * T.eye;
    const ey = this.y + this.ny * T.eye;
    const ez = this.z + this.nz * T.eye;
    if (this._blocked(ex, ey, ez, player.x, player.y + 1.2, player.z)) return false;
    return !this._blocked(ex, ey, ez, player.x, player.y - 0.3, player.z);
  }

  /** Nearest structural surface within `radius` (point + outward normal into o); the distance or Infinity. */
  _findSurface(px, py, pz, radius, o) {
    const lv = this.level;
    if (!lv || typeof lv.querySolids !== 'function') return Infinity;
    const list = lv.querySolids(px - radius, py - radius, pz - radius, px + radius, py + radius, pz + radius, this._solids);
    const tmp = this._tmp;
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
        o.solid = s;
      }
    }
    return found ? best : Infinity;
  }

  /** Horizontal ray from (ox,oy,oz) at azimuth az against structural solids (inside the section's shaft): writes this._hit. */
  _rayWall(ox, oy, oz, az, maxDist) {
    const lv = this.level;
    if (!lv || typeof lv.querySolids !== 'function') return false;
    const dx = Math.cos(az);
    const dz = Math.sin(az);
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
    let bs = null;
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (!isStructural(s)) continue;
      const t = segmentBox(ox, oy, oz, x1, oy, z1, s);
      if (t > 1e-4 && t < best) {
        best = t;
        bs = s;
      }
    }
    if (best > 1 || !bs) return false;
    const h = this._hit;
    h.t = best * maxDist;
    const tmp = this._tmp;
    boxSurface(bs, ox + dx * (h.t - 0.02), oy, oz + dz * (h.t - 0.02), tmp);
    h.x = tmp.x;
    h.y = tmp.y;
    h.z = tmp.z;
    h.nx = tmp.nx;
    h.ny = tmp.ny;
    h.nz = tmp.nz;
    h.solid = bs;
    return true;
  }

  /**
   * Room for its body standing on (x,y,z) along up n: no active solid at its shins, chest or head. `strict` false (a walking
   * step): only the masonry it cannot pass counts (structural solids); it brushes through thin ledges, beams and bridges on the
   * way, but it only ever stops (vantage, entry) where the whole column is clear.
   */
  _columnClear(x, y, z, nx, ny, nz, strict = true) {
    const lv = this.level;
    if (!lv || typeof lv.querySolids !== 'function') return true;
    const r = T.footClear;
    for (let k = 0; k < 3; k++) {
      const h = k === 0 ? 0.6 : k === 1 ? 1.8 : 2.9;
      const cx = x + nx * h;
      const cy = y + ny * h;
      const cz = z + nz * h;
      const list = lv.querySolids(cx - r, cy - r, cz - r, cx + r, cy + r, cz + r, this._solids);
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        if (s.active === false || (!strict && !isStructural(s))) continue;
        if (U.sphereBox(cx, cy, cz, r, s)) return false;
      }
    }
    return true;
  }

  // ===========================================================================
  // The chalk outline of you (on the wall beside you)
  // ===========================================================================

  _placeOutline(player, snap) {
    const o = this.body.outline;
    const s = this._surf;
    let d = this._findSurface(player.x, player.y + 0.4, player.z, 14, s);
    if (!(d < 14) || Math.abs(s.ny) > 0.7) {
      // nothing vertical near you: its own wall, level with you
      d = this._findSurface(this.x, player.y + 0.4, this.z, 4, s);
      if (!(d < 4) || Math.abs(s.ny) > 0.7) {
        if (snap) o.on = false;
        return;
      }
    }
    const tx = s.x + s.nx * 0.025;
    const ty = s.y + s.ny * 0.025;
    const tz = s.z + s.nz * 0.025;
    if (snap || !o.on) {
      o.on = true;
      o.x = tx;
      o.y = ty;
      o.z = tz;
      o.grow = 0;
      o.alpha = 1;
      o.seed = (this._rand() * 1e6) | 0;
      this._outlineT = 0;
      this._outlineWipe = false;
    } else {
      // it tracks you slowly
      const k = 0.02;
      o.x += (tx - o.x) * k;
      o.y += (ty - o.y) * k;
      o.z += (tz - o.z) * k;
    }
    o.nx = s.nx;
    o.ny = s.ny;
    o.nz = s.nz;
  }

  _updateOutline(dt, player) {
    const o = this.body.outline;
    if (this.state === S.MEASURE) {
      this._placeOutline(player, false);
      o.grow = U.clamp((this.t - this._measureStart) / T.measureTime, 0, 1);
      o.alpha = 1;
      return;
    }
    if (this.state === S.CUT) {
      o.grow = 1;
      o.alpha = 1;
      return;
    }
    this._fadeOutline(dt);
  }

  _fadeOutline(dt) {
    const o = this.body.outline;
    if (!o.on) return;
    this._outlineT += dt;
    // after a cut it stays on the wall a while; a cancelled one is wiped at once
    if (this._outlineWipe) o.alpha -= dt / 0.8;
    else if (this._outlineT > 6) o.alpha -= dt / 3;
    if (o.alpha <= 0) {
      o.alpha = 0;
      o.on = false;
    }
  }

  // ===========================================================================
  // Sounds: the line's tick, the hummed work-song
  // ===========================================================================

  _sounds(dt, player) {
    const meas = this.state === S.MEASURE || this.state === S.CUT;
    this._tickT -= dt;
    if (this._tickT <= 0) {
      const tk = T.tick;
      this._tickT = meas ? tk.fast + (this._rand() - 0.5) * 2 * tk.fastJitter : tk.gap + (this._rand() - 0.5) * 2 * tk.jitter;
      if (this.state !== S.STAGGER) {
        const p = this._tickP;
        p.x = this.x + this.nx * 1.7;
        p.y = this.y + this.ny * 1.7;
        p.z = this.z + this.nz * 1.7;
        p.fast = meas;
        p.intensity = meas ? 1 : this.state === S.SPOILED ? 0.35 : 0.6;
        p.hand = meas ? this.targetHand : null;
        p.distance = this.distance;
        this.body.tick++;
        this._emit('dresser:tick', p);
      }
    }
    if (meas || this.state === S.STAGGER) return;
    this._humT -= dt;
    if (this._humT <= 0) {
      this._humT = T.hum.min + this._rand() * (T.hum.max - T.hum.min);
      const p = this._humP;
      p.x = this.x + this.nx * T.eye;
      p.y = this.y + this.ny * T.eye;
      p.z = this.z + this.nz * T.eye;
      p.distance = this.distance;
      p.note = (p.note + 1) % 3;
      this._emit('dresser:hum', p);
    }
    void player;
  }

  // ===========================================================================
  // Output
  // ===========================================================================

  _writeBody(dt, player) {
    const b = this.body;
    b.visible = this.inPlay;
    b.state = this.state;
    b.x = this.x;
    b.y = this.y;
    b.z = this.z;
    b.ux = this.nx;
    b.uy = this.ny;
    b.uz = this.nz;
    b.fx = this.fx;
    b.fy = this.fy;
    b.fz = this.fz;
    b.lx = player.x;
    b.ly = player.y + 0.9;
    b.lz = player.z;
    const st = this.state;
    const k = 1 - Math.exp(-6 * dt);
    b.measure += ((st === S.MEASURE || st === S.CUT ? 1 : 0) - b.measure) * k;
    b.cut += ((st === S.CUT ? 1 : 0) - b.cut) * (1 - Math.exp(-10 * dt));
    b.stagger = st === S.STAGGER ? Math.max(0, 1 - this.stateTime / T.staggerTime) : Math.max(0, b.stagger - dt * 3);
    b.spoiled += ((st === S.SPOILED ? 1 : 0) - b.spoiled) * (1 - Math.exp(-2.5 * dt));
    const glowT = st === S.MEASURE || st === S.CUT ? 1 : st === S.SPOILED ? 0.08 : st === S.STAGGER ? 0.15 : this.armed ? 0.45 : 0.1;
    b.glow += (glowT - b.glow) * (1 - Math.exp(-3 * dt));
    const ln = b.line;
    const a = this.target;
    if ((st === S.MEASURE || st === S.CUT) && a) {
      ln.on = true;
      ln.x = a.x;
      ln.y = a.y;
      ln.z = a.z;
      ln.taut = st === S.CUT ? 1 : U.clamp((this.t - this._measureStart) / 0.6, 0, 1);
    } else {
      ln.on = false;
      ln.taut = 0;
    }
  }

  _emit(type, payload) {
    if (this.bus && typeof this.bus.emit === 'function') this.bus.emit(type, payload);
  }

  // ===========================================================================
  // Debug / tooling (captures, e2e): put it on a wall near the player
  // ===========================================================================

  /**
   * Places it (in play, STALK, the grace spent) on the wall the ray from the player at azimuth `az` (radians, atan2(z, x)) and
   * height `dy` meets, facing the player. Returns the placement or null.
   */
  debugPlace(player, az, dy, state) {
    if (!player) return null;
    this._setPlayer(player);
    if (!this._rayWall(player.x, player.y + num(dy, 1.5), player.z, num(az, 0), 60)) return null;
    const h = this._hit;
    this._solid = h.solid;
    this.x = h.x;
    this.y = h.y;
    this.z = h.z;
    this.nx = this.snx = h.nx;
    this.ny = this.sny = h.ny;
    this.nz = this.snz = h.nz;
    this.inPlay = true;
    this._leaving = false;
    this._graceT = 0;
    this._faceToward(player.x, player.y, player.z, true);
    this._measureDist(player);
    this._tgt.ok = false;
    this._setState(state && S[state] ? S[state] : this.armed ? S.STALK : S.SPOILED);
    this.body.visible = true;
    this._writeBody(0.016, player);
    return { x: this.x, y: this.y, z: this.z, nx: this.nx, ny: this.ny, nz: this.nz, distance: this.distance };
  }

  /** Starts a measure now on the player's loaded ring if it may (tooling); returns the anchor id or null. */
  debugMeasure(player) {
    if (!player || !this.inPlay) return null;
    this._setPlayer(player);
    this._graceT = 0;
    this._lastCut = -1e9;
    this._measureDist(player);
    this.sees = this._seesWhole(player);
    const st = this.state;
    if (st !== S.STALK && st !== S.RECOVER) this._setState(S.STALK);
    this._tryMeasure(player);
    return this.state === S.MEASURE && this.target ? this.target.id : null;
  }
}
