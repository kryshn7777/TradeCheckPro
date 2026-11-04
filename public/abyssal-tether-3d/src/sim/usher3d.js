/* ABYSSAL TETHER 3D — usher3d.js
 * Usher3D — "the Usher" of Chapter II · LAMPHOLD, and its big brother the Head Usher ("the Doorman"): a collared man whose throat
 * goes on, a torch for a ring. It ANSWERS BELLS. It never reads the player (no position, no velocity): it hears TOLLS (a bell, a
 * machine's notch, a gong, the Great Bell, a brass ring biting, a crash), turns its ring to where the toll is (plus the toll's
 * velocity x the time it will take), draws a sphere of cold light there, and strikes the sphere. You are in danger only while
 * you stand in the sphere of a toll you made. It is never "killed" (docs/abyssal-tether-3d/plans/CHAPTER_II_DIRECTION.md §3.2-3.8).
 *
 * States (the document's §3.7 table; timers Normal / Nightmare / Abyss):
 *   OFF      not in play (relocating, left); hears nothing.
 *   STAND    Idle; a toll -> LISTEN; the Round's order (command walk / snuffAt) -> WALK.
 *   WALK     along the authored walk graph (a polyline, <= 40 nodes) at 1.2 / 1.45 / 1.7 m/s; never leaves it, never climbs.
 *   SNUFF    the Round at a cluster: a 2.0 m sphere on the cluster for 1.6 / 1.5 / 1.5 s, then the ring dips (0.35 s, lethal
 *            in the sphere, 'usher:snuff').
 *   LISTEN   a toll was heard: hold 2.5 / 2.2 / 2.0 s, a pale wide sphere (3.0; Head 4.4 m); a newer toll re-aims (the hold
 *            resets to 0.6 s, the whole LISTEN capped at 6 s); at the end COIL if the aim is in reach, else SEARCH.
 *   SEARCH   a toll beyond reach: an ordinary Usher walks the graph toward it (COIL once the toll is within reach - 1 m, a newer
 *            toll -> LISTEN, 12 s without progress -> STAND); the Head Usher does not walk: his throat pays out to full
 *            reach and SAGS SHORT (`sagShort`), the aim clamped to reach.
 *   COIL     2.0 / 1.7 / 1.5 s (never < 1.5 s): the sphere tightens to the lethal radius (1.8; Head 2.6 m); the last 0.4 s is
 *            COMMIT (aim frozen, gold). Lunge scrubbed 0 -> 0.525 s and held. A toll heard now is QUEUED (the telegraph
 *            never moves once it is on).
 *   WHIP     0.35 / 0.30 / 0.25 s: lethal inside the sphere; 'usher:whip' + 'usher:blow' at its start.
 *   RECOIL   3.0 / 2.5 / 2.0 s: the guaranteed safe window; cannot COIL; a toll is queued and answered after it (a full LISTEN).
 *   PARKED   the Round's: a WHIP whose aim was a bell in reach (kind 'bell', ordinary Usher) keeps striking that bell, one
 *            Recoil + Listen + Coil + Whip (7.85 / 6.7 / 5.75 s) per strike, N = 3 / 2 / 1 strikes, then the Round resumes; a
 *            toll elsewhere ends it (after the recoil). `state` reads PARKED from the first strike's whip on, `phase` the
 *            machine underneath (RECOIL / LISTEN / COIL / WHIP). A toll at the parked bell is its own echo and is ignored.
 *   SEATED   the Evening's end: terminal until reset().
 * Head Usher only: PULPIT (scripted, deaf, throat coiled), COLLAR (3.0 s, the collar falls, stretch 1 -> ~2.4), SWEEP (12 s, two
 * arcs of the tip at 6 m/s snuffing the stalls; the tip is lethal; 'usher:snuff' every 0.25 s along it), RELOCATE (waits while
 * `seen`, then appears at the new station), REACH (per phase 16/18/20, 24/26/28, 32/34/36 m: command('phase', 'B'|'C1'|'C2'));
 * `stretch` = reach / 6.75 (<= 5.5).
 *
 * Fairness (§3.8): telegraph >= 1.5 s on every difficulty (COIL alone); a strike only ever aimed at a TOLL; the sphere's centre
 * never moves in the last 0.4 s; nothing is lethal during the first `grace` s after reset() (3.0; Abyss 2.0) unless
 * command('enter'); `harmless` (Sandbox) draws everything and kills nothing.
 *
 * Pure, DOM-free, three.js-free, deterministic (no randomness at all), allocation-free per step (the objects returned by the
 * getters are reused: copy what you keep; the events allocate their small payloads when they fire). Runs in Node
 * (tools/abyssal-tether-3d/tests/creature/usher3d.mjs).
 *
 * Bus in:  'toll:emit' { x, y, z, loud, kind, src, vx?, vy?, vz?, park? }  (see TollBus for the masking the game applies first)
 * Bus out (x, y, z = where the sound / sphere is; `at` = the Usher's own clock, exact):
 *   'usher:listen' {id,x,y,z (the Usher), ax,ay,az (the aim)}  'usher:coil' {id,x,y,z,r,t}  'usher:commit' {id,x,y,z,r}
 *   'usher:whip' {id,x,y,z,r,lethal}  'usher:blow' {id,x,y,z,r,lethal}  'usher:park' {id,x,y,z (the bell)}  'usher:recoil' {id,x,y,z}
 *   'usher:seat' {id}  'usher:snuff' {id,x,y,z,r}  also 'usher:collar' {id,x,y,z}, 'usher:relocate' {id,x,y,z}.
 * Conventions: yaw = atan2(dx, dz) (0 faces +z); the Head Usher's `pos` is the throat base (the collar); reach is measured from `pos`.
 */

const EPS = 1e-9;
const TAU = Math.PI * 2;
const PATH_MAX = 40;

export const USHER_STATES = Object.freeze({
  OFF: 'OFF',
  STAND: 'STAND',
  WALK: 'WALK',
  SNUFF: 'SNUFF',
  LISTEN: 'LISTEN',
  SEARCH: 'SEARCH',
  COIL: 'COIL',
  WHIP: 'WHIP',
  RECOIL: 'RECOIL',
  PARKED: 'PARKED',
  SEATED: 'SEATED',
  PULPIT: 'PULPIT',
  COLLAR: 'COLLAR',
  SWEEP: 'SWEEP',
  RELOCATE: 'RELOCATE',
});
const S = USHER_STATES;

/** The toll table (§3.3): loudness and the Normal hearing range of an ordinary Usher (the Head Usher hears 1.5x). */
export const TOLL_KINDS = Object.freeze({
  bell: Object.freeze({ loud: 1, range: 60 }), // bell:ring
  machine: Object.freeze({ loud: 0.7, range: 42 }), // objective:progress with noise (haul, pull, winch ratchet)
  gong: Object.freeze({ loud: 0.8, range: 48 }), // cage / lift gong, pawl clunk, gong plate
  great: Object.freeze({ loud: 1, range: Infinity }), // evening:stroke (the whole Well)
  ring: Object.freeze({ loud: 0.35, range: 18 }), // brass ring bite (grapple:attach with the toll flag)
  crash: Object.freeze({ loud: 0.6, range: 36 }), // front:crash
});

/** Per difficulty (§3.7 / §3.8). headReach: the Head Usher's reach per phase (B / C1 / C2). */
export const USHER_DIFF = Object.freeze({
  normal: Object.freeze({
    hearMul: 1,
    listen: 2.5,
    coil: 2.0,
    whip: 0.35,
    recoil: 3.0,
    snuffWarn: 1.6,
    walk: 1.2,
    reach: 4.5,
    headReach: Object.freeze({ B: 16, C1: 24, C2: 32 }),
    parkStrikes: 3,
    grace: 3.0,
    leafCrashToll: false,
  }),
  nightmare: Object.freeze({
    hearMul: 1.1,
    listen: 2.2,
    coil: 1.7,
    whip: 0.3,
    recoil: 2.5,
    snuffWarn: 1.5,
    walk: 1.45,
    reach: 5.0,
    headReach: Object.freeze({ B: 18, C1: 26, C2: 34 }),
    parkStrikes: 2,
    grace: 3.0,
    leafCrashToll: true,
  }),
  abyss: Object.freeze({
    hearMul: 1.2,
    listen: 2.0,
    coil: 1.5,
    whip: 0.25,
    recoil: 2.0,
    snuffWarn: 1.5,
    walk: 1.7,
    reach: 5.5,
    headReach: Object.freeze({ B: 20, C1: 28, C2: 36 }),
    parkStrikes: 1,
    grace: 2.0,
    leafCrashToll: true,
  }),
});

const byDiff = (f) => ({ normal: USHER_DIFF.normal[f], nightmare: USHER_DIFF.nightmare[f], abyss: USHER_DIFF.abyss[f] });
const byPhase = (p) => ({ normal: USHER_DIFF.normal.headReach[p], nightmare: USHER_DIFF.nightmare.headReach[p], abyss: USHER_DIFF.abyss.headReach[p] });

/** Every number of §3.7 / §3.8 in one place (metres, seconds). The per-difficulty ones are also in USHER_DIFF. */
export const USHER_TUNING = {
  // the torch (§3.4)
  listenR: 3.0, // pale, wide sphere in LISTEN / SEARCH
  headListenR: 4.4,
  lethalR: 1.8, // COIL tightens to it; WHIP is lethal inside it
  headLethalR: 2.6,
  snuffR: 2.0, // the Round's SNUFF sphere (and the Head Usher's sweeping tip)
  snuffDip: 0.35, // the ring dips: lethal in the sphere for this long
  // timers
  coilMin: 1.5, // COIL is never shorter than this on any difficulty
  commit: 0.4, // the last part of COIL: aim frozen, gold
  reaim: 0.6, // a newer toll in LISTEN resets the hold to this
  listenCap: 6.0, // a LISTEN lasts at most this long however many tolls re-aim it
  searchGiveUp: 12, // SEARCH: seconds without progress -> STAND
  searchMargin: 1.0, // an ordinary Usher starts COIL once the toll is within reach - this
  searchProgress: 0.25, // m closer to the toll that counts as progress
  listen: byDiff('listen'),
  coil: byDiff('coil'),
  whip: byDiff('whip'),
  recoil: byDiff('recoil'),
  snuffWarn: byDiff('snuffWarn'),
  grace: byDiff('grace'), // no lethal sphere this long after reset() unless command('enter')
  parkStrikes: byDiff('parkStrikes'),
  walk: byDiff('walk'), // m/s along the graph (ordinary Ushers)
  // reach (§3.8): ordinary, and the Head Usher per phase (from the collar)
  reach: { common: byDiff('reach'), head: { B: byPhase('B'), C1: byPhase('C1'), C2: byPhase('C2') } },
  // hearing (§3.3): the Head Usher hears 1.5x; Nightmare / Abyss x1.1 / x1.2 (rounded to the table's 66 / 46 / 20 and 72 / 50 / 22)
  hear: { headMul: 1.5, mul: byDiff('hearMul') },
  // masking (§3.3): a louder toll within 10 m hides a quieter one for 1.0 s
  mask: { radius: 10, time: 1.0 },
  // the Head Usher's throat and scripts (§3.7)
  head: { scale: 1.8, throat: 6.75, stretchMax: 5.5, stretchRate: 2.0, collarTime: 3.0, collarStretch: 2.4, sweepTime: 12, sweepTip: 6, sweepTick: 0.25, sweepRadius: 14, sweepInner: 0.7, turn: 1.5 },
  turn: 3.0, // rad/s the ordinary Usher turns its ring
  // the Lunge clip is scrubbed (§3.11): COIL 0 -> 0.525 s, WHIP 0.525 -> 0.78 s, RECOIL 0.78 -> 1.5 s
  lunge: { coilEnd: 0.525, whipEnd: 0.78, recoilEnd: 1.5 },
  sitTime: 3.0,
  // the rope telegraph (E11): an anchor within the sphere + this buzzes
  buzzPad: 4.0,
  parkEcho: 3.0, // a bell toll within this of the parked bell is the Usher's own blow
};
const T = USHER_TUNING;

function num(v, d) {
  return typeof v === 'number' && isFinite(v) ? v : d;
}
function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}
function smooth(x) {
  x = clamp(x, 0, 1);
  return x * x * (3 - 2 * x);
}
function wrapPi(a) {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
}
function tollLoud(toll) {
  const k = TOLL_KINDS[toll.kind];
  return num(toll.loud, k ? k.loud : 0);
}

/**
 * Does an Usher at (ux, uy, uz) hear this toll? The range is the toll kind's (TOLL_KINDS) x the difficulty's hearing (rounded:
 * 60 / 66 / 72, 42 / 46 / 50, 18 / 20 / 22 m) x 1.5 for the Head Usher x `hearing` (default 1); 3D distance, inclusive. A toll of
 * unknown kind needs a `range` (its Normal range) or hears as 60 m x its loudness. The Great Bell is heard everywhere.
 * @param {{x:number,y:number,z:number,kind?:string,loud?:number,range?:number}} toll
 */
export function tollHeard(toll, ux, uy, uz, head, difficulty, hearing) {
  if (!toll) return false;
  const kind = TOLL_KINDS[toll.kind];
  const loud = tollLoud(toll);
  if (!(loud > 0)) return false;
  const dm = USHER_DIFF[difficulty] || USHER_DIFF.normal;
  let range = kind ? kind.range : num(toll.range, 60 * loud);
  if (range !== Infinity) {
    range = Math.round(range * dm.hearMul);
    if (head) range *= T.hear.headMul;
    range *= num(hearing, 1);
  }
  const dx = num(toll.x, 0) - ux;
  const dy = num(toll.y, 0) - uy;
  const dz = num(toll.z, 0) - uz;
  return dx * dx + dy * dy + dz * dz <= range * range;
}

const BUS_CAP = 16;
/**
 * Masking (§3.3): "a louder event within 10 m of a quieter toll hides it for 1.0 s" (a crash hides a chime). The game passes every
 * toll through emit(toll, now) and puts it on the EventBus ('toll:emit') only if it returns true. A toll is masked when a
 * strictly louder AUDIBLE toll within 10 m (3D) was emitted less than 1.0 s earlier; masked tolls mask nothing. Fixed memory.
 */
export class TollBus {
  constructor() {
    this._t = new Float64Array(BUS_CAP);
    this._x = new Float64Array(BUS_CAP);
    this._y = new Float64Array(BUS_CAP);
    this._z = new Float64Array(BUS_CAP);
    this._l = new Float64Array(BUS_CAP);
    this._n = 0;
    this._i = 0;
  }

  /** Would this toll be masked right now? (no side effects) */
  isMasked(toll, now) {
    const loud = tollLoud(toll);
    const x = num(toll.x, 0);
    const y = num(toll.y, 0);
    const z = num(toll.z, 0);
    const r2 = T.mask.radius * T.mask.radius;
    for (let j = 0; j < this._n; j++) {
      const age = now - this._t[j];
      if (age < 0 || age >= T.mask.time || this._l[j] <= loud) continue;
      const dx = this._x[j] - x;
      const dy = this._y[j] - y;
      const dz = this._z[j] - z;
      if (dx * dx + dy * dy + dz * dz <= r2) return true;
    }
    return false;
  }

  /** @returns {boolean} true if the toll is audible (and is remembered for masking), false if a louder one hides it. */
  emit(toll, now) {
    if (!toll) return false;
    now = num(now, 0);
    if (this.isMasked(toll, now)) return false;
    const i = this._i;
    this._t[i] = now;
    this._x[i] = num(toll.x, 0);
    this._y[i] = num(toll.y, 0);
    this._z[i] = num(toll.z, 0);
    this._l[i] = tollLoud(toll);
    this._i = (i + 1) % BUS_CAP;
    if (this._n < BUS_CAP) this._n++;
    return true;
  }

  reset() {
    this._n = 0;
    this._i = 0;
  }
}

/** The fields that make a snapshot (everything else is derived or constant). */
const SNAP = [
  't', 'stateT', '_s', '_parked', '_parkArm', '_strikes', 'bx', 'by', 'bz', 'x', 'y', 'z', 'yaw', 'stx', 'sty', 'stz', 'styaw',
  'reach', '_reachMode', '_phase', '_dk', 'hearing', 'harmless', 'entered', 'seen', 'sagShort', 'ax', 'ay', 'az', 'son', 'sr', 'sst',
  'holdLeft', 'tollAge', 'tx', 'ty', 'tz', 'tvx', 'tvy', 'tvz', 'tBell', 'hasQ', 'qx', 'qy', 'qz', 'qvx', 'qvy', 'qvz', 'qBell',
  'committed', '_dip', '_ps', '_ws', '_wk', '_job', '_jS', '_jx', '_jy', '_jz', '_srchBest', '_srchT', '_srchCoil', '_stretch', 'snuffs',
  '_tipNext', '_rd', 'swx', 'swy', 'swz', 'swR', 'swR2', 'swA0', 'rlx', 'rly', 'rlz', 'rlyaw',
];

export class Usher3D {
  /**
   * @param {{id?:string|number, head?:boolean, x?:number, y?:number, z?:number, yaw?:number, difficulty?:string,
   *   bus?:{on:Function,emit:Function}, reach?:number, hearing?:number}} [o]
   */
  constructor(o) {
    o = o || {};
    this.id = o.id === undefined ? 'usher' : o.id;
    this.head = !!o.head;
    this.bus = o.bus || null;
    this.hearing = num(o.hearing, 1);
    this._dk = USHER_DIFF[o.difficulty] ? o.difficulty : 'normal';
    this.k = USHER_DIFF[this._dk];
    this.harmless = o.difficulty === 'sandbox'; // drawn, never lethal
    this._phase = 'B';
    this._reachMode = 0; // 0 by difficulty, 1 by phase (head), 2 explicit
    this.reach = 0;
    if (typeof o.reach === 'number' && isFinite(o.reach) && o.reach > 0) {
      this.reach = o.reach;
      this._reachMode = 2;
    } else this.reach = this._defaultReach();
    this.stx = num(o.x, 0);
    this.sty = num(o.y, 0);
    this.stz = num(o.z, 0);
    this.styaw = num(o.yaw, 0);
    this._pn = new Float64Array(PATH_MAX * 3);
    this._pc = new Float64Array(PATH_MAX);
    this._pcount = 0;
    this._plen = 0;
    this._pd = 0;
    this.seen = false; // the Head Usher's relocation waits while the player can see him (setSeen)
    this.swx = 0; // the sweep geometry (command 'sweep')
    this.swy = 0;
    this.swz = 0;
    this.swR = T.head.sweepRadius;
    this.swR2 = T.head.sweepRadius * T.head.sweepInner;
    this.swA0 = 0;
    this._sweepSet = false;
    this.rlx = 0; // the relocation target
    this.rly = 0;
    this.rlz = 0;
    this.rlyaw = 0;
    this._oAim = { x: 0, y: 0, z: 0 };
    this._oPos = { x: 0, y: 0, z: 0 };
    this._oSphere = { x: 0, y: 0, z: 0, r: 0, stage: 'listen', lethal: false };
    this._oAnim = { clip: 'Idle', t: 0 };
    this._offs = [];
    if (this.bus && typeof this.bus.on === 'function') {
      const off = this.bus.on('toll:emit', (p) => {
        this.hear(p);
      });
      this._offs.push(off);
    }
    this.reset();
  }

  /** Unsubscribes from the bus. */
  destroy() {
    for (const off of this._offs) if (typeof off === 'function') off();
    this._offs.length = 0;
  }

  // ---- state in the open ------------------------------------------------------------------------------------------------
  /** One of USHER_STATES. PARKED while the Round's Usher is working a bell (see `phase` for the machine underneath). */
  get state() {
    return this._parked ? S.PARKED : this._s;
  }
  /** The machine underneath: LISTEN / COIL / WHIP / RECOIL during PARKED, otherwise the same as `state`. */
  get phase() {
    return this._s;
  }
  /** Seconds since reset() (the Usher's own clock; the `at` of the events). */
  get time() {
    return this.t;
  }
  /** In play (not OFF / SEATED). */
  get inPlay() {
    return this._s !== S.OFF && this._s !== S.SEATED;
  }
  /** How many snuffs it has done since reset() (the membrane brightens +10 % per cluster). */
  get snuffCount() {
    return this.snuffs;
  }
  /** Strikes struck at the parked bell so far. */
  get strikes() {
    return this._strikes;
  }
  /** The point the torch sphere is centred on (led by the toll's velocity, clamped to reach), or null. Reused object. */
  get aim() {
    if (!this.son) return null;
    const a = this._oAim;
    a.x = this.ax;
    a.y = this.ay;
    a.z = this.az;
    return a;
  }
  /** What the view draws and the game tests: { x, y, z, r, stage: 'listen'|'coil'|'commit'|'whip'|'snuff', lethal } | null. Reused. */
  get sphere() {
    if (!this.son) return null;
    const s = this._oSphere;
    s.x = this.ax;
    s.y = this.ay;
    s.z = this.az;
    s.r = this.sr;
    s.stage = this.sst;
    s.lethal = this._lethalPhase() && this._armed();
    return s;
  }
  /** Head only: throat length factor (reach / 6.75, <= 5.5), eased; 1 for ordinary Ushers. */
  get stretch() {
    return this.head ? this._stretch : 1;
  }
  /** Current position {x,y,z}. Reused. */
  get pos() {
    const p = this._oPos;
    p.x = this.x;
    p.y = this.y;
    p.z = this.z;
    return p;
  }
  /** { clip: 'Idle'|'Listen'|'Walk'|'Lunge'|'Sit', t } — Lunge scrubbed 0 -> 0.525 s through COIL, 0.525 -> 0.78 in WHIP, -> 1.5 in RECOIL. Reused. */
  get anim() {
    const a = this._oAnim;
    const L = T.lunge;
    switch (this._s) {
      case S.LISTEN:
        a.clip = 'Listen';
        a.t = this.stateT;
        break;
      case S.SEARCH:
        a.clip = !this.head && this._pcount >= 2 && Math.abs(this._ws - this._ps) > 1e-6 ? 'Walk' : 'Listen';
        a.t = this.stateT;
        break;
      case S.WALK:
        a.clip = 'Walk';
        a.t = this.stateT;
        break;
      case S.COIL: {
        const pre = this._coil() - T.commit;
        a.clip = 'Lunge';
        a.t = L.coilEnd * smooth(this.stateT / pre);
        break;
      }
      case S.WHIP:
        a.clip = 'Lunge';
        a.t = L.coilEnd + (L.whipEnd - L.coilEnd) * clamp(this.stateT / this.k.whip, 0, 1);
        break;
      case S.RECOIL:
        a.clip = 'Lunge';
        a.t = L.whipEnd + (L.recoilEnd - L.whipEnd) * clamp(this.stateT / this.k.recoil, 0, 1);
        break;
      case S.SNUFF:
        if (this._dip) {
          a.clip = 'Lunge';
          a.t = L.coilEnd + (L.whipEnd - L.coilEnd) * clamp((this.stateT - this.k.snuffWarn) / T.snuffDip, 0, 1);
        } else {
          a.clip = 'Listen';
          a.t = this.stateT;
        }
        break;
      case S.SWEEP:
        a.clip = 'Listen';
        a.t = this.stateT;
        break;
      case S.SEATED:
        a.clip = 'Sit';
        a.t = Math.min(this.stateT, T.sitTime);
        break;
      default:
        a.clip = 'Idle';
        a.t = this.t;
    }
    return a;
  }

  // ---- configuration ----------------------------------------------------------------------------------------------------
  _defaultReach() {
    return this.head ? this.k.headReach[this._phase] || this.k.headReach.B : this.k.reach;
  }
  setReach(r) {
    if (typeof r === 'number' && isFinite(r) && r > 0) {
      this.reach = r;
      this._reachMode = 2;
    }
  }
  setDifficulty(key) {
    this.harmless = key === 'sandbox';
    const dk = USHER_DIFF[key] ? key : 'normal';
    this._dk = dk;
    this.k = USHER_DIFF[dk];
    if (this._reachMode < 2) this.reach = this._defaultReach();
  }
  /** Sandbox: everything is drawn, nothing is lethal. */
  setHarmless(on) {
    this.harmless = !!on;
  }
  /** The Head Usher's relocation waits while the player can see him. */
  setSeen(on) {
    this.seen = !!on;
  }
  /** Moves the Usher to a station (and makes it the station reset() / 'enter' return to). Stations should lie on the walk graph. */
  setStation(x, y, z, yaw) {
    this.stx = this.x = num(x, 0);
    this.sty = this.y = num(y, 0);
    this.stz = this.z = num(z, 0);
    if (yaw !== undefined) this.styaw = this.yaw = num(yaw, 0);
    this._ps = this._pcount >= 2 ? this._project(this.x, this.y, this.z) : 0;
  }
  /** The walk graph: a polyline [{x,y,z}] of at most 40 nodes. The Usher is snapped to its nearest point. */
  setPath(nodes) {
    const n = Math.min(PATH_MAX, nodes && nodes.length ? nodes.length : 0);
    this._pcount = n;
    let acc = 0;
    for (let i = 0; i < n; i++) {
      const p = nodes[i];
      this._pn[i * 3] = num(p.x, 0);
      this._pn[i * 3 + 1] = num(p.y, 0);
      this._pn[i * 3 + 2] = num(p.z, 0);
      if (i > 0) {
        const dx = this._pn[i * 3] - this._pn[i * 3 - 3];
        const dy = this._pn[i * 3 + 1] - this._pn[i * 3 - 2];
        const dz = this._pn[i * 3 + 2] - this._pn[i * 3 - 1];
        acc += Math.sqrt(dx * dx + dy * dy + dz * dz);
      }
      this._pc[i] = acc;
    }
    this._plen = acc;
    if (n >= 2) {
      this._ps = this._project(this.x, this.y, this.z);
      this._pointAt(this._ps);
    } else this._ps = 0;
    return n;
  }
  /** Arc length (m) of the walk graph. */
  get pathLength() {
    return this._plen;
  }

  /**
   * The Round / Head scripts (§3.6). Returns whether it was accepted.
   *   'walk' arg: node index | {x,y,z}   walk the graph to there (resumed after any interruption)
   *   'snuffAt' arg: {x,y,z}             walk to the cluster, then SNUFF it (sphere 2.0 m, warn 1.6 / 1.5 / 1.5 s, then the dip)
   *   'collar'                           Head: COLLAR (3.0 s) -> SWEEP (12 s) -> STAND
   *   'sweep' arg: {x,y,z,r,r2,a0}       Head: the sweep's centre, outer / inner radius, start angle; starts it at once unless COLLAR is running
   *   'pulpit'                           Head: PULPIT (scripted, deaf, throat coiled)
   *   'phase' arg: 'B'|'C1'|'C2'         Head: the reach of that phase on this difficulty
   *   'seat'                             SEATED (terminal until reset())
   *   'relocate' arg: {x,y,z,yaw?}       OFF-screen move to a new station, only while not `seen`
   *   'enter'                            in play at its station, armed now (no grace)
   *   'leave'                            OFF (not in play)
   *   'stand'                            drop what it is doing and STAND
   *   'seen' arg: boolean                same as setSeen
   */
  command(name, arg) {
    if (this._s === S.SEATED) return false;
    let ok = true;
    switch (name) {
      case 'walk': {
        if (this._s === S.OFF) return false;
        if (arg === undefined || arg === null) return false;
        this._job = 1;
        this._jS = this._targetS(arg);
        break;
      }
      case 'snuffAt': {
        if (this._s === S.OFF || !arg) return false;
        this._job = 2;
        this._jx = num(arg.x, this.x);
        this._jy = num(arg.y, this.y);
        this._jz = num(arg.z, this.z);
        this._jS = this._pcount >= 2 ? this._project(this._jx, this._jy, this._jz) : 0;
        break;
      }
      case 'collar':
        if (!this.head || this._s === S.OFF) return false;
        this._clearBusy();
        this._beginCollar();
        break;
      case 'sweep': {
        if (!this.head) return false;
        const a = arg || {};
        this.swx = num(a.x, this.x);
        this.swy = num(a.y, this.y);
        this.swz = num(a.z, this.z);
        this.swR = num(a.r, T.head.sweepRadius);
        this.swR2 = num(a.r2, this.swR * T.head.sweepInner);
        this.swA0 = num(a.a0, 0);
        this._sweepSet = true;
        if (this._s !== S.COLLAR && this._s !== S.OFF) {
          this._clearBusy();
          this._beginSweep();
        }
        break;
      }
      case 'pulpit':
        if (!this.head) return false;
        this._clearBusy();
        this._s = S.PULPIT;
        this.stateT = 0;
        this._stretch = 1; // the throat coiled
        break;
      case 'phase':
        if (!this.head || !this.k.headReach[arg]) return false;
        this._phase = arg;
        this._reachMode = 1;
        this.reach = this.k.headReach[arg];
        break;
      case 'seat':
        this._beginSeated();
        break;
      case 'relocate': {
        if (this._s === S.OFF) return false;
        const a = arg || {};
        this.rlx = num(a.x, this.stx);
        this.rly = num(a.y, this.sty);
        this.rlz = num(a.z, this.stz);
        this.rlyaw = num(a.yaw, this.styaw);
        this._clearBusy();
        this._s = S.RELOCATE;
        this.stateT = 0;
        break;
      }
      case 'enter':
        this.entered = true;
        if (this._s === S.OFF) {
          this.x = this.stx;
          this.y = this.sty;
          this.z = this.stz;
          this.yaw = this.styaw;
          this._ps = this._pcount >= 2 ? this._project(this.x, this.y, this.z) : 0;
          this._s = S.STAND;
          this.stateT = 0;
        }
        break;
      case 'leave':
        this._clearBusy();
        this._job = 0;
        this._s = S.OFF;
        this.stateT = 0;
        break;
      case 'stand':
        if (this._s === S.OFF) return false;
        this._clearBusy();
        this._job = 0;
        this._s = S.STAND;
        this.stateT = 0;
        break;
      case 'seen':
        this.seen = !!arg;
        break;
      default:
        ok = false;
    }
    if (ok) {
      if ((name === 'walk' || name === 'snuffAt') && (this._s === S.STAND || this._s === S.WALK)) this._startJob();
      else if (this._s === S.STAND || this._s === S.WALK || this._s === S.RELOCATE) this._settle();
    }
    return ok;
  }

  _targetS(arg) {
    if (this._pcount < 2) return 0;
    if (typeof arg === 'number') return this._pc[clamp(arg | 0, 0, this._pcount - 1)];
    return this._project(num(arg.x, this.x), num(arg.y, this.y), num(arg.z, this.z));
  }
  /** Drops everything in flight (sphere, queue, park, search); keeps the Round's pending order. */
  _clearBusy() {
    this.son = false;
    this.sagShort = false;
    this.hasQ = false;
    this._parked = false;
    this._parkArm = false;
    this._strikes = 0;
    this.committed = false;
    this._dip = false;
  }
  _settle() {
    for (let i = 0; i < 8 && this._fire(); i++) {
      /* chained transitions */
    }
  }

  // ---- reset / snapshot ---------------------------------------------------------------------------------------------------
  /** Back to the station, STAND, the 3 s grace running (a wake). Configuration (path, station, reach, difficulty) is kept. */
  reset() {
    this.t = 0;
    this.stateT = 0;
    this._s = S.STAND;
    this._parked = false;
    this._parkArm = false;
    this._strikes = 0;
    this.bx = this.by = this.bz = 0;
    this.x = this.stx;
    this.y = this.sty;
    this.z = this.stz;
    this.yaw = this.styaw;
    this.entered = false;
    this.sagShort = false;
    this.ax = this.ay = this.az = 0;
    this.son = false;
    this.sr = 0;
    this.sst = 'listen';
    this.holdLeft = 0;
    this.tollAge = 0;
    this.tx = this.ty = this.tz = this.tvx = this.tvy = this.tvz = 0;
    this.tBell = false;
    this.hasQ = false;
    this.qx = this.qy = this.qz = this.qvx = this.qvy = this.qvz = 0;
    this.qBell = false;
    this.committed = false;
    this._dip = false;
    this._ps = this._pcount >= 2 ? this._project(this.x, this.y, this.z) : 0;
    this._ws = this._ps;
    this._wk = 0;
    this._job = 0;
    this._jS = 0;
    this._jx = this._jy = this._jz = 0;
    this._srchBest = 0;
    this._srchT = 0;
    this._srchCoil = false;
    this._stretch = this._stretchTarget();
    this.snuffs = 0;
    this._tipNext = 1;
    this._rd = 0;
    this._rax = this._ray = this._raz = 0;
  }

  /** A plain JSON-able object (the path included) from which restore() resumes exactly. */
  snapshot() {
    const o = { id: this.id, head: this.head };
    for (let i = 0; i < SNAP.length; i++) o[SNAP[i]] = this[SNAP[i]];
    const path = [];
    for (let i = 0; i < this._pcount; i++) path.push([this._pn[i * 3], this._pn[i * 3 + 1], this._pn[i * 3 + 2]]);
    o.path = path;
    o.sweepSet = this._sweepSet;
    return o;
  }

  restore(s) {
    if (!s || typeof s !== 'object') return;
    for (let i = 0; i < SNAP.length; i++) if (s[SNAP[i]] !== undefined) this[SNAP[i]] = s[SNAP[i]];
    if (s.id !== undefined) this.id = s.id;
    if (s.head !== undefined) this.head = !!s.head;
    this._sweepSet = !!s.sweepSet;
    this._dk = USHER_DIFF[this._dk] ? this._dk : 'normal';
    this.k = USHER_DIFF[this._dk];
    const p = Array.isArray(s.path) ? s.path : [];
    const n = Math.min(PATH_MAX, p.length);
    this._pcount = n;
    let acc = 0;
    for (let i = 0; i < n; i++) {
      this._pn[i * 3] = p[i][0];
      this._pn[i * 3 + 1] = p[i][1];
      this._pn[i * 3 + 2] = p[i][2];
      if (i > 0) {
        const dx = this._pn[i * 3] - this._pn[i * 3 - 3];
        const dy = this._pn[i * 3 + 1] - this._pn[i * 3 - 2];
        const dz = this._pn[i * 3 + 2] - this._pn[i * 3 - 1];
        acc += Math.sqrt(dx * dx + dy * dy + dz * dz);
      }
      this._pc[i] = acc;
    }
    this._plen = acc;
  }

  // ---- hearing --------------------------------------------------------------------------------------------------------------
  /**
   * A toll reaches the Usher (the bus calls this on 'toll:emit'). Returns whether it was answered or queued.
   * @param {{x:number,y:number,z:number,kind?:string,loud?:number,vx?:number,vy?:number,vz?:number,src?:*,park?:boolean}} toll
   */
  hear(toll) {
    if (!toll) return false;
    const s = this._s;
    if (s === S.OFF || s === S.SEATED || s === S.PULPIT || s === S.COLLAR || s === S.SWEEP || s === S.RELOCATE) return false;
    if (toll.src !== undefined && toll.src !== null && toll.src === this.id) return false; // its own
    if (!tollHeard(toll, this.x, this.y, this.z, this.head, this._dk, this.hearing)) return false;
    if (this._parkArm && toll.kind === 'bell') {
      const dx = num(toll.x, 0) - this.bx;
      const dy = num(toll.y, 0) - this.by;
      const dz = num(toll.z, 0) - this.bz;
      if (dx * dx + dy * dy + dz * dz <= T.parkEcho * T.parkEcho) return false; // the parked bell's own ring
    }
    switch (s) {
      case S.LISTEN:
        this._takeToll(toll);
        this._reaim();
        break;
      case S.COIL:
      case S.WHIP:
      case S.RECOIL:
      case S.SNUFF:
        this.hasQ = true;
        this.qx = num(toll.x, 0);
        this.qy = num(toll.y, 0);
        this.qz = num(toll.z, 0);
        this.qvx = num(toll.vx, 0);
        this.qvy = num(toll.vy, 0);
        this.qvz = num(toll.vz, 0);
        this.qBell = !this.head && toll.kind === 'bell' && toll.park !== false;
        break;
      default: // STAND, WALK, SEARCH
        this._takeToll(toll);
        this._beginListen(false);
    }
    return true;
  }

  _takeToll(toll) {
    this.tx = num(toll.x, 0);
    this.ty = num(toll.y, 0);
    this.tz = num(toll.z, 0);
    this.tvx = num(toll.vx, 0);
    this.tvy = num(toll.vy, 0);
    this.tvz = num(toll.vz, 0);
    this.tBell = !this.head && toll.kind === 'bell' && toll.park !== false;
  }

  _coil() {
    return Math.max(T.coilMin, this.k.coil);
  }
  _listenR() {
    return this.head ? T.headListenR : T.listenR;
  }
  _lethalR() {
    return this.head ? T.headLethalR : T.lethalR;
  }
  _speed() {
    return this.head ? 0 : this.k.walk;
  }
  _armed() {
    return !this.harmless && (this.entered || this.t >= this.k.grace);
  }
  _lethalPhase() {
    const s = this._s;
    return s === S.WHIP || s === S.SWEEP || (s === S.SNUFF && this._dip);
  }

  /**
   * The aim: the toll's source plus its velocity x `lead` (the time until the whip), clamped to reach from `pos`.
   * Sets ax/ay/az, `_rd` (distance of the unclamped aim), `sagShort`; returns whether the unclamped aim is in reach.
   */
  _aimFrom(lead) {
    const rx = this.tx + this.tvx * lead;
    const ry = this.ty + this.tvy * lead;
    const rz = this.tz + this.tvz * lead;
    const dx = rx - this.x;
    const dy = ry - this.y;
    const dz = rz - this.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    this._rd = d;
    this._rax = rx;
    this._ray = ry;
    this._raz = rz;
    if (d <= this.reach) {
      this.ax = rx;
      this.ay = ry;
      this.az = rz;
      this.sagShort = false;
      return true;
    }
    const f = this.reach / d;
    this.ax = this.x + dx * f;
    this.ay = this.y + dy * f;
    this.az = this.z + dz * f;
    this.sagShort = true;
    return false;
  }

  // ---- state entries ---------------------------------------------------------------------------------------------------------
  _beginListen(keepPark) {
    this._s = S.LISTEN;
    this.stateT = 0;
    this.tollAge = 0;
    this.holdLeft = this.k.listen;
    this.committed = false;
    this._dip = false;
    if (!keepPark) {
      this._parked = false;
      this._parkArm = false;
      this._strikes = 0;
    }
    this.son = true;
    this.sst = 'listen';
    this.sr = this._listenR();
    this._aimFrom(this.holdLeft + this._coil());
    this._emitListen();
  }
  /** A newer toll in LISTEN (the active toll is already replaced): the hold resets to 0.6 s, the whole LISTEN capped at 6 s. */
  _reaim() {
    this._parked = false; // a toll elsewhere ends the parking
    this._parkArm = false;
    this._strikes = 0;
    this.tollAge = 0;
    this.holdLeft = Math.min(T.reaim, Math.max(0, T.listenCap - this.stateT));
    this._aimFrom(this.holdLeft + this._coil());
    this._emitListen();
  }
  _emitListen() {
    if (this.bus) this.bus.emit('usher:listen', { id: this.id, x: this.x, y: this.y, z: this.z, ax: this.ax, ay: this.ay, az: this.az, at: this.t });
  }
  _listenFromQueue() {
    this.tx = this.qx;
    this.ty = this.qy;
    this.tz = this.qz;
    this.tvx = this.qvx;
    this.tvy = this.qvy;
    this.tvz = this.qvz;
    this.tBell = this.qBell;
    this.hasQ = false;
    this._beginListen(false);
  }
  _endListen() {
    this._aimFrom(this.tollAge + this._coil());
    if (this._rd <= this.reach + EPS) this._beginCoil();
    else this._beginSearch();
  }
  _beginSearch() {
    this._s = S.SEARCH;
    this.stateT = 0;
    this._srchT = 0;
    this._srchCoil = false;
    this.son = true;
    this.sst = 'listen';
    this.sr = this._listenR();
    this._searchAim();
    this._srchBest = this._rd;
  }
  _searchAim() {
    this._aimFrom(this.tollAge + this._coil());
    const lim = this.head ? this.reach : this.reach - T.searchMargin;
    if (this._rd <= lim) this._srchCoil = true;
    if (!this.head && this._pcount >= 2) this._ws = this._project(this._rax, this._ray, this._raz);
    else this._ws = this._ps;
  }
  _beginCoil() {
    this._s = S.COIL;
    this.stateT = 0;
    this.committed = false;
    this.son = true;
    this.sst = 'coil';
    this.sr = this._listenR();
    this.sagShort = false;
    this._parkArm = this.tBell;
    if (this._parkArm) {
      this.bx = this.tx;
      this.by = this.ty;
      this.bz = this.tz;
    }
    if (this.bus) this.bus.emit('usher:coil', { id: this.id, x: this.ax, y: this.ay, z: this.az, r: this._lethalR(), t: this._coil(), at: this.t });
  }
  _beginWhip() {
    this._s = S.WHIP;
    this.stateT = 0;
    this.sst = 'whip';
    this.sr = this._lethalR();
    if (this.bus) {
      const lethal = this._armed();
      this.bus.emit('usher:whip', { id: this.id, x: this.ax, y: this.ay, z: this.az, r: this.sr, lethal, at: this.t });
      this.bus.emit('usher:blow', { id: this.id, x: this.ax, y: this.ay, z: this.az, r: this.sr, lethal, at: this.t });
    }
  }
  _endWhip() {
    if (this._parkArm) {
      this._strikes++;
      if (!this._parked) {
        this._parked = true;
        if (this.bus) this.bus.emit('usher:park', { id: this.id, x: this.bx, y: this.by, z: this.bz, at: this.t });
      }
    } else {
      this._parked = false;
      this._strikes = 0;
    }
    this._beginRecoil();
  }
  _beginRecoil() {
    this._s = S.RECOIL;
    this.stateT = 0;
    this.son = false;
    this.sagShort = false;
    this.committed = false;
    if (this.bus) this.bus.emit('usher:recoil', { id: this.id, x: this.x, y: this.y, z: this.z, at: this.t });
  }
  _endRecoil() {
    if (this._parked) {
      if (this.hasQ) this._listenFromQueue(); // a toll elsewhere: the parking ends
      else if (this._strikes < this.k.parkStrikes) this._beginListen(true); // strike the same bell again
      else {
        this._parked = false;
        this._parkArm = false;
        this._strikes = 0;
        this._resume(); // the Round resumes
      }
    } else this._afterBusy();
  }
  /** After a RECOIL / SNUFF: a queued toll is answered (a full LISTEN), else back to STAND (and the Round's order). */
  _afterBusy() {
    if (this.hasQ) this._listenFromQueue();
    else this._resume();
  }
  _resume() {
    this._s = S.STAND;
    this.stateT = 0;
    this.son = false;
    this.sagShort = false;
    this.committed = false;
    this._dip = false;
  }
  _startJob() {
    if (!this._job) return;
    const sp = this._speed();
    const near = this._pcount < 2 || sp <= 0 || Math.abs(this._jS - this._ps) < 1e-6;
    const job = this._job;
    if (near) {
      this._job = 0;
      if (job === 2) this._beginSnuff(this._jx, this._jy, this._jz);
      else this._s = S.STAND;
      return;
    }
    this._s = S.WALK;
    this._wk = job;
    this._ws = this._jS;
    this.stateT = 0;
    this.son = false;
  }
  _beginSnuff(x, y, z) {
    this._s = S.SNUFF;
    this.stateT = 0;
    this._dip = false;
    this.ax = x;
    this.ay = y;
    this.az = z;
    this.son = true;
    this.sst = 'snuff';
    this.sr = T.snuffR;
    this.sagShort = false;
  }
  _beginCollar() {
    this._s = S.COLLAR;
    this.stateT = 0;
    if (this.bus) this.bus.emit('usher:collar', { id: this.id, x: this.x, y: this.y, z: this.z, at: this.t });
  }
  _beginSweep() {
    if (!this._sweepSet) {
      this.swx = this.x;
      this.swy = this.y;
      this.swz = this.z;
    }
    this._s = S.SWEEP;
    this.stateT = 0;
    this._tipNext = 1;
    this.son = true;
    this.sst = 'snuff';
    this.sr = T.snuffR;
    this._sweepTip();
  }
  _beginSeated() {
    this._clearBusy();
    this._job = 0;
    this._s = S.SEATED;
    this.stateT = 0;
    if (this.bus) this.bus.emit('usher:seat', { id: this.id, at: this.t });
  }

  // ---- the step -------------------------------------------------------------------------------------------------------------------
  /** Advances the machine by dt seconds (any size: timers are met exactly, the step is cut at every boundary). */
  step(dt) {
    if (!(dt > 0)) return;
    let rem = dt;
    for (let g = 0; g < 128 && rem > 1e-12; g++) {
      const left = this._left();
      let d = left < rem ? left : rem;
      if (d <= 1e-12) {
        if (this._fire()) continue;
        d = rem; // nothing due after all: never stall
      }
      this._adv(d);
      rem -= d;
      for (let i = 0; i < 16 && this._fire(); i++) {
        /* chained transitions */
      }
    }
  }

  /** Seconds until the current state's next boundary (Infinity: open-ended). */
  _left() {
    const sp = this._speed();
    switch (this._s) {
      case S.LISTEN:
        return this.holdLeft;
      case S.COIL:
        return this.committed ? this._coil() - this.stateT : this._coil() - T.commit - this.stateT;
      case S.WHIP:
        return this.k.whip - this.stateT;
      case S.RECOIL:
        return this.k.recoil - this.stateT;
      case S.SNUFF:
        return (this._dip ? this.k.snuffWarn + T.snuffDip : this.k.snuffWarn) - this.stateT;
      case S.COLLAR:
        return T.head.collarTime - this.stateT;
      case S.SWEEP: {
        const next = this._tipNext * T.head.sweepTick;
        return Math.min(next, T.head.sweepTime) - this.stateT;
      }
      case S.WALK:
        return sp > 0 ? Math.abs(this._ws - this._ps) / sp : Infinity;
      case S.SEARCH: {
        let l = T.searchGiveUp - this._srchT;
        if (!this.head && this._pcount >= 2 && sp > 0) {
          const w = Math.abs(this._ws - this._ps);
          if (w > EPS) l = Math.min(l, w / sp);
        }
        return l;
      }
      case S.STAND:
        return this._job ? 0 : Infinity;
      case S.RELOCATE:
        return this.seen ? Infinity : 0;
      default:
        return Infinity;
    }
  }

  /** Advances time by d within the current state (continuous motion only; boundaries are handled by _fire). */
  _adv(d) {
    this.t += d;
    this.stateT += d;
    this.tollAge += d;
    switch (this._s) {
      case S.LISTEN:
        this.holdLeft = this.holdLeft > d ? this.holdLeft - d : 0;
        this._face(d);
        break;
      case S.COIL: {
        const pre = this._coil() - T.commit;
        if (!this.committed) this.sr = this._listenR() + (this._lethalR() - this._listenR()) * smooth(this.stateT / pre);
        this._face(d);
        break;
      }
      case S.WHIP:
      case S.SNUFF:
        this._face(d);
        break;
      case S.WALK:
        this._moveAlong(this._ws, this._speed() * d, d);
        break;
      case S.SEARCH: {
        if (!this.head && this._pcount >= 2) this._moveAlong(this._ws, this._speed() * d, d);
        else this._face(d);
        this._searchAim();
        if (this._srchBest - this._rd >= T.searchProgress) {
          this._srchBest = this._rd;
          this._srchT = 0;
        } else this._srchT += d;
        break;
      }
      case S.SWEEP:
        this._sweepTip();
        this._face(d);
        break;
      default:
        break;
    }
    if (this.head) {
      const tg = this._stretchTarget();
      this._stretch += (tg - this._stretch) * (1 - Math.exp(-T.head.stretchRate * d));
    }
  }

  /** Does one due transition / milestone; true if something happened (call again). */
  _fire() {
    switch (this._s) {
      case S.LISTEN:
        if (this.holdLeft <= EPS) {
          this._endListen();
          return true;
        }
        return false;
      case S.SEARCH:
        if (this._srchCoil) {
          this._beginCoil();
          return true;
        }
        if (this._srchT >= T.searchGiveUp - EPS) {
          this._resume();
          return true;
        }
        return false;
      case S.COIL: {
        const pre = this._coil() - T.commit;
        if (!this.committed && this.stateT >= pre - EPS) {
          this.committed = true;
          this.sst = 'commit';
          this.sr = this._lethalR();
          if (this.bus) this.bus.emit('usher:commit', { id: this.id, x: this.ax, y: this.ay, z: this.az, r: this.sr, at: this.t });
          return true;
        }
        if (this.committed && this._coil() - this.stateT <= EPS) {
          this._beginWhip();
          return true;
        }
        return false;
      }
      case S.WHIP:
        if (this.k.whip - this.stateT <= EPS) {
          this._endWhip();
          return true;
        }
        return false;
      case S.RECOIL:
        if (this.k.recoil - this.stateT <= EPS) {
          this._endRecoil();
          return true;
        }
        return false;
      case S.SNUFF: {
        const warn = this.k.snuffWarn;
        if (!this._dip && this.stateT >= warn - EPS) {
          this._dip = true;
          this.snuffs++;
          if (this.bus) this.bus.emit('usher:snuff', { id: this.id, x: this.ax, y: this.ay, z: this.az, r: this.sr, at: this.t });
          return true;
        }
        if (this._dip && this.stateT >= warn + T.snuffDip - EPS) {
          this._dip = false;
          this._afterBusy();
          return true;
        }
        return false;
      }
      case S.WALK:
        if (Math.abs(this._ws - this._ps) <= EPS || this._speed() <= 0) {
          const kind = this._wk;
          this._job = 0;
          if (kind === 2) this._beginSnuff(this._jx, this._jy, this._jz);
          else {
            this._s = S.STAND;
            this.stateT = 0;
          }
          return true;
        }
        return false;
      case S.STAND:
        if (this._job) {
          this._startJob();
          return true;
        }
        return false;
      case S.COLLAR:
        if (T.head.collarTime - this.stateT <= EPS) {
          this._beginSweep();
          return true;
        }
        return false;
      case S.SWEEP: {
        const next = this._tipNext * T.head.sweepTick;
        if (next <= T.head.sweepTime + EPS && this.stateT >= next - EPS) {
          this._tipNext++;
          if (this.bus) this.bus.emit('usher:snuff', { id: this.id, x: this.ax, y: this.ay, z: this.az, r: this.sr, at: this.t });
          return true;
        }
        if (T.head.sweepTime - this.stateT <= EPS) {
          this._resume();
          return true;
        }
        return false;
      }
      case S.RELOCATE:
        if (!this.seen) {
          this.x = this.rlx;
          this.y = this.rly;
          this.z = this.rlz;
          this.yaw = this.rlyaw;
          this.stx = this.x;
          this.sty = this.y;
          this.stz = this.z;
          this.styaw = this.yaw;
          this._ps = this._pcount >= 2 ? this._project(this.x, this.y, this.z) : 0;
          this._resume();
          if (this.bus) this.bus.emit('usher:relocate', { id: this.id, x: this.x, y: this.y, z: this.z, at: this.t });
          return true;
        }
        return false;
      default:
        return false;
    }
  }

  // ---- motion -----------------------------------------------------------------------------------------------------------------------
  _stretchTarget() {
    if (!this.head || this._s === S.PULPIT) return 1;
    return clamp(this.reach / T.head.throat, 1, T.head.stretchMax);
  }
  _turnTo(target, d) {
    const diff = wrapPi(target - this.yaw);
    const m = (this.head ? T.head.turn : T.turn) * d;
    this.yaw = wrapPi(diff > m ? this.yaw + m : diff < -m ? this.yaw - m : target);
  }
  /** The ring turns toward the aim. */
  _face(d) {
    const dx = this.ax - this.x;
    const dz = this.az - this.z;
    if (dx * dx + dz * dz < 0.0025) return;
    this._turnTo(Math.atan2(dx, dz), d);
  }
  _moveAlong(target, dist, d) {
    const diff = target - this._ps;
    const step = diff > dist ? dist : diff < -dist ? -dist : diff;
    if (step === 0) return;
    this._ps += step;
    const ox = this.x;
    const oz = this.z;
    this._pointAt(this._ps);
    const dx = this.x - ox;
    const dz = this.z - oz;
    if (dx * dx + dz * dz > 1e-12) this._turnTo(Math.atan2(dx, dz), d);
  }
  _pointAt(s) {
    const n = this._pcount;
    if (n < 2) return;
    const pc = this._pc;
    const pn = this._pn;
    if (s < 0) s = 0;
    else if (s > this._plen) s = this._plen;
    let i = 0;
    while (i < n - 2 && pc[i + 1] < s) i++;
    const l = pc[i + 1] - pc[i];
    const f = l > 1e-9 ? (s - pc[i]) / l : 0;
    const a = i * 3;
    const b = a + 3;
    this.x = pn[a] + (pn[b] - pn[a]) * f;
    this.y = pn[a + 1] + (pn[b + 1] - pn[a + 1]) * f;
    this.z = pn[a + 2] + (pn[b + 2] - pn[a + 2]) * f;
  }
  /** Arc length of the point of the walk graph nearest (px, py, pz) (3D); `_pd` = that distance. */
  _project(px, py, pz) {
    const n = this._pcount;
    if (n < 2) return 0;
    const pn = this._pn;
    const pc = this._pc;
    let best = Infinity;
    let bs = 0;
    for (let i = 0; i < n - 1; i++) {
      const a = i * 3;
      const b = a + 3;
      const ex = pn[b] - pn[a];
      const ey = pn[b + 1] - pn[a + 1];
      const ez = pn[b + 2] - pn[a + 2];
      const l2 = ex * ex + ey * ey + ez * ez;
      let f = l2 > 1e-12 ? ((px - pn[a]) * ex + (py - pn[a + 1]) * ey + (pz - pn[a + 2]) * ez) / l2 : 0;
      f = f < 0 ? 0 : f > 1 ? 1 : f;
      const qx = pn[a] + ex * f - px;
      const qy = pn[a + 1] + ey * f - py;
      const qz = pn[a + 2] + ez * f - pz;
      const d2 = qx * qx + qy * qy + qz * qz;
      if (d2 < best) {
        best = d2;
        bs = pc[i] + Math.sqrt(l2) * f;
      }
    }
    this._pd = Math.sqrt(best);
    return bs;
  }
  /** The sweep tip, closed form: arc 1 at the outer radius at 6 m/s, a U-turn blending inward, arc 2 back at 6 m/s. */
  _sweepTip() {
    const H = T.head;
    const half = H.sweepTime / 2;
    const u = clamp(this.stateT, 0, H.sweepTime);
    const R = this.swR;
    const R2 = this.swR2;
    const ang = u <= half ? this.swA0 + (H.sweepTip / R) * u : this.swA0 + (H.sweepTip / R) * half - (H.sweepTip / R2) * (u - half);
    const rad = R + (R2 - R) * smooth((u - (half - 0.5)) / 1.0);
    this.ax = this.swx + Math.sin(ang) * rad;
    this.ay = this.swy;
    this.az = this.swz + Math.cos(ang) * rad;
  }

  // ---- what the game asks -------------------------------------------------------------------------------------------------------------
  /** Is this point inside the lethal sphere right now? Only during WHIP, a SNUFF dip and the Head Usher's SWEEP tip; never in the grace, never when harmless. */
  lethalAt(x, y, z) {
    if (!this.son || !this._lethalPhase() || !this._armed()) return false;
    const dx = x - this.ax;
    const dy = y - this.ay;
    const dz = z - this.az;
    return dx * dx + dy * dy + dz * dz <= this.sr * this.sr;
  }

  /**
   * The rope telegraph (E11): 0..1 buzz for the hand whose anchor is at (ax, ay, az): zero farther than the sphere + 4 m,
   * rising from LISTEN (0.2) through COIL (0.35 -> 0.9, 1 at COMMIT), 1 in the WHIP, falling off outside the sphere.
   */
  telegraph(ax, ay, az) {
    if (!this.son) return 0;
    const dx = ax - this.ax;
    const dy = ay - this.ay;
    const dz = az - this.az;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > this.sr + T.buzzPad) return 0;
    let base = 0;
    switch (this._s) {
      case S.LISTEN:
      case S.SEARCH:
        base = 0.2;
        break;
      case S.COIL:
        base = this.committed ? 1 : 0.35 + 0.55 * clamp(this.stateT / (this._coil() - T.commit), 0, 1);
        break;
      case S.WHIP:
      case S.SWEEP:
        base = 1;
        break;
      case S.SNUFF:
        base = this._dip ? 1 : 0.3 + 0.7 * clamp(this.stateT / this.k.snuffWarn, 0, 1);
        break;
      default:
        base = 0;
    }
    const prox = d <= this.sr ? 1 : 1 - (0.5 * (d - this.sr)) / T.buzzPad;
    return base * prox;
  }
}
