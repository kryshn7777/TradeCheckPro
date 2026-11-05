/**
 * THE LANTERN (ABYSSAL TETHER 3D) - RED ROACHES (pure: no three.js, no DOM, no random calls: a seeded generator and integer hashes).
 *
 * "Add tiny super tiny skitterlings. Super optimized. Often spawning near player out of camera like cockroaches in red colour."
 *
 * Ambient dread with a little play (docs/abyssal-tether-3d/plans/ROACHES.md). Not the Skitterling (sim/skitter3d.js, the small red hunter
 * that bites): RED ROACHES never hurt you. They appear OFTEN, near you, OUT OF CAMERA (2-9 m, behind or beside the head, on a floor or a wall
 * face, never inside the view frustum when they appear), run over the surfaces in cockroach bursts (dart, freeze, antenna twitch, turn),
 * scatter from the lantern's light, from your hands, from a stomp or a fast swing, and hide: they reach a crack (the edge of the patch of face
 * they run on, the foot of a thing standing on it) and are gone. A hand or a boot on one squishes it (a dark-red smear that fades). Rarely,
 * when you grab a hold, a short stream of them pours out of a crack in the wall beside your hand (deterministic by seed, section and grab
 * count). More of them the deeper you go and where the dead lie (sim/remainsPlan.js hotspots); none around the spawn and the checkpoints.
 *
 * Budget: a fixed pool of typed arrays (ROACH.pool), O(pool) per frame, ZERO allocations per frame, at most ROACH.raysPerFrame ray casts a
 * frame against the sim's own y-bucketed copy of the level's boxes (built once per level; Level3D.raycast's segmentBox builds four arrays per
 * box it tests, and every double passed into a call that is not inlined is boxed: the hot paths here pass their numbers through typed-array
 * "registers" and the generator returns small integers), a cap per tier, scaled down by the frame-rate governor (level >= 3: none).
 *
 *   const r = new Roaches(bus, { seed })   r.reset(level)   r.setHotspots(remainsPlan)   r.update(dt, ctx)   r.grab(x,y,z)   r.burstAt(x,y,z)
 *   r.clear()   r.state()   makeRoachCtx() -> the context object the glue fills each frame (render/roachView.js roachContext)
 *   Arrays read by the view: pos (xyz), axis (face 0..5 = -x,+x,-y,+y,-z,+z), ang (heading on the face), sz, ph (gait phase), spd, st, seedK, tw (antenna), tmr
 *
 * Bus: 'roach:skitter' {x,y,z,n,speed}  'roach:scatter' {x,y,z,n}  'roach:squish' {x,y,z}  'roach:burst' {x,y,z,n}   listens: 'climb:grab' {x,y,z}
 * (one payload object per event type, reused: listeners read it at once).
 */

export const ROACH_STATE = Object.freeze({ FREE: 0, IDLE: 1, DART: 2, FREEZE: 3, FLEE: 4, HIDE: 5, SMEAR: 6 });
const FREE = 0;
const IDLE = 1;
const DART = 2;
const FREEZE = 3;
const FLEE = 4;
const HIDE = 5;
const SMEAR = 6;
export const ROACH_STATE_NAMES = Object.freeze(['free', 'idle', 'dart', 'freeze', 'flee', 'hide', 'smear']);

export const ROACH = Object.freeze({
  pool: 96, // the hard pool (and the view's instance buffer)
  cap: Object.freeze({ high: 96, quest: 48, low: 32 }), // alive at once per render tier
  govScale: Object.freeze([1, 0.6, 0.35]), // x cap at governor level 0, 1, 2; level >= 3: none
  // wanted near the player per section (S1..S8; deeper sections reuse the last), before the remains bonus
  pop: Object.freeze([6, 8, 10, 12, 14, 16, 19, 22]),
  hotBonus: 0.1, // +10 % per remains hotspot weight within hotRadius ...
  hotMax: 8, // ... up to +80 %
  hotRadius: 9,
  spawnGap: 0.16, // s between two spawns (rate limit); a refill after a scatter takes a few seconds
  retryGap: 0.05, // s after a frame whose spawn attempts all failed
  rMin: 2, // m from the head
  rMax: 9,
  offAngle: 1.25, // rad off the horizontal view axis a candidate is picked at (the frustum test decides)
  fovPad: 0.18, // frustum margin (fraction of the tangents) + body radius
  quiet: 7, // m around the spawn and every checkpoint: nothing spawns there
  raysPerFrame: 2,
  len: 0.034, // m body length at size 1 (the view's model is 1 unit long)
  size: Object.freeze([0.7, 1.3]),
  speed: Object.freeze({ dart: Object.freeze([0.3, 0.85]), flee: Object.freeze([1.0, 1.55]), hide: 0.95 }),
  idle: Object.freeze([0.3, 2.0]),
  dart: Object.freeze([0.12, 0.65]),
  freeze: Object.freeze([0.15, 1.1]),
  life: Object.freeze([7, 18]), // s then it goes to hide
  hideFar: 13, // m from the head: it goes to hide
  dropFar: 20, // m: gone at once
  fear: Object.freeze({ lightNear: 2.0, lightFar: 6.5, lightCos: 0.87, lightMin: 0.15, hand: 0.55, handFast: 1.6, handSpeed: 1.2, body: 1.4, bodySpeed: 1.0, land: 3.2, swing: 4.5, swingSpeed: 4.0 }),
  react: Object.freeze([0.06, 0.2]), // s before a fright turns into a run (+ freezeReact when frozen)
  freezeReact: 0.12,
  calm: 0.6, // s without a threat before a flight ends
  squish: Object.freeze({ hand: 0.09, foot: 0.22, footY: 0.14, footSpeed: 0.3 }),
  smear: 14, // s a smear lies there (shrinking away over the last smearFade)
  smearFade: 4,
  edge: 0.015, // m: the margin of the face a roach keeps off its edges
  territory: 3, // m: a roach runs within this of where it appeared (its face clipped to it; one index query at spawn, none after)
  obstacles: 6, // boxes standing on that patch, kept per roach
  // the crack burst: chance per grab of a hold in S1..S8, cooldown, how many, one every `gap` s, how far the wall may be from the hand
  burst: Object.freeze({ chance: Object.freeze([0, 0.05, 0.08, 0.1, 0.12, 0.14, 0.16, 0.18]), cooldown: 40, n: Object.freeze([5, 9]), gap: 0.07, reach: 0.8 }),
  skitter: Object.freeze({ range: 7, gap: Object.freeze([0.3, 0.7]) }),
  scatterGap: 0.5,
});

// face axis -> the normal's component, its sign, the tangent components (u, v) of the position (0 x, 1 y, 2 z)
const NK = [0, 0, 1, 1, 2, 2];
const NS = [-1, 1, -1, 1, -1, 1];
const UC = [2, 2, 0, 0, 0, 0];
const VC = [1, 1, 2, 2, 1, 1];
const R30 = 1 / 1073741824; // the generator's 30-bit integers -> 0..1
const BUCKET = 2; // m: the index's y buckets
const TAU = 6.283185307179586;

/** The face (0..5) of box `s` that the point lies on: the nearest of its six planes. */
export function faceAxisOf(s, x, y, z) {
  let best = 0;
  let bd = Math.abs(x - s.minX);
  let d = Math.abs(x - s.maxX);
  if (d < bd) (bd = d), (best = 1);
  d = Math.abs(y - s.minY);
  if (d < bd) (bd = d), (best = 2);
  d = Math.abs(y - s.maxY);
  if (d < bd) (bd = d), (best = 3);
  d = Math.abs(z - s.minZ);
  if (d < bd) (bd = d), (best = 4);
  d = Math.abs(z - s.maxZ);
  if (d < bd) best = 5;
  return best;
}

/** Integer hash -> a 30-bit integer (a small integer: no boxing). */
export function hashU(n) {
  let h = n | 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 2;
}

/** Integer hash -> 0..1 (counters and seeds: the variation is designed, never random). */
export function hash01(n) {
  return hashU(n) * R30;
}

/**
 * Is the point inside the view frustum of the head (with a margin)? head: {x,y,z, fx,fy,fz (forward), rx,ry,rz (right), ux,uy,uz (up),
 * tanH, tanV (half-angle tangents)}. `pad` (m) widens it by a body radius. Pure.
 */
export function inView(head, x, y, z, margin = ROACH.fovPad, pad = 0.05) {
  const dx = x - head.x;
  const dy = y - head.y;
  const dz = z - head.z;
  const fz = dx * head.fx + dy * head.fy + dz * head.fz;
  if (fz <= -pad) return false;
  const fx = dx * head.rx + dy * head.ry + dz * head.rz;
  const fy = dx * head.ux + dy * head.uy + dz * head.uz;
  const zz = fz > 0 ? fz : 0;
  return Math.abs(fx) <= zz * head.tanH * (1 + margin) + pad && Math.abs(fy) <= zz * head.tanV * (1 + margin) + pad;
}

/** The context the glue fills every frame (one object, reused). */
export function makeRoachCtx() {
  return {
    on: false, // playing, the setting on, no cutscene
    tier: 'quest',
    gov: 0,
    head: { x: 0.5, y: 0.5, z: 0.5, fx: 0.5, fy: 0.5, fz: -1.5, rx: 1.5, ry: 0.5, rz: 0.5, ux: 0.5, uy: 1.5, uz: 0.5, tanH: 1.5, tanV: 0.8 },
    lantern: { x: 0.5, y: 0.5, z: 0.5, ax: 0.5, ay: 0.5, az: -1.5, k: 1.5 },
    hands: [
      { x: 0.5, y: 0.5, z: 0.5, ok: false },
      { x: 0.5, y: 0.5, z: 0.5, ok: false },
    ],
    body: { x: 0.5, y: 0.5, z: 0.5, vx: 0.5, vy: 0.5, vz: 0.5, grounded: false, footY: 0.5, landed: false },
  };
  // (the literals are fractional so every field starts as a double: no shape change on the first frame)
}

export class Roaches {
  /** @param {{on:Function, emit:Function}|null} bus @param {{seed?:number}} [opts] */
  constructor(bus, opts) {
    const P = ROACH.pool;
    this.bus = bus || null;
    this.seed = ((opts && opts.seed) >>> 0) || 0x7a11c0;
    this.level = null;
    this.pos = new Float32Array(P * 3);
    this.axis = new Uint8Array(P);
    this.solid = new Array(P).fill(null);
    this.ang = new Float32Array(P);
    this.spd = new Float32Array(P);
    this.tgt = new Float32Array(P);
    this.tmr = new Float32Array(P);
    this.st = new Uint8Array(P);
    this.ph = new Float32Array(P);
    this.seedK = new Float32Array(P); // 0..1 per roach (the view's colour and twitch)
    this.sz = new Float32Array(P);
    this.age = new Float32Array(P);
    this.life = new Float32Array(P);
    this.react = new Float32Array(P);
    this.calmT = new Float32Array(P);
    this.tw = new Float32Array(P); // antenna excitement 0..1
    this.thr = new Float32Array(P * 3); // the threat it runs from
    this.burstK = new Uint8Array(P); // came out of a crack (does not count as a scatter)
    this.terr = new Float32Array(P * 4); // the patch of the face it runs on: u0, u1, v0, v1
    this.obs = new Float32Array(P * ROACH.obstacles * 6); // boxes standing on that patch
    this.obsN = new Uint8Array(P);
    this.t = 0;
    this.frame = 0;
    this.alive = 0; // roaches (smears not counted)
    this.smears = 0;
    this.cap = 0;
    this.target = 0;
    this.section = 0;
    this.hot = 0;
    this.enabled = true;
    this.popMul = 1; // tuning: x the wanted population (the stress test pins it at the cap)
    this.raysThisFrame = 0;
    this.stats = { spawns: 0, attempts: 0, rays: 0, squished: 0, bursts: 0, hidden: 0, dropped: 0, scatters: 0, skitters: 0 };
    this.audit = null; // tests: an array that receives a record per spawn
    this._r = this.seed | 0;
    this._nextSpawn = 0;
    this._hotT = 0;
    this._hotPts = null;
    this._hotW = null;
    this._quiet = new Float32Array(0);
    this._prevHand = new Float32Array(6);
    this._handOk = new Uint8Array(2);
    this._handSpd = new Float32Array(2);
    this._skitT = 0.5;
    this._skitN = 0;
    this._scat = new Float64Array(4); // n, sum x, y, z of this frame's new runners
    this._lastScatter = -9;
    this._grabs = 0;
    this._lastBurst = -1e9;
    // typed-array "registers": numbers into and out of the helpers without boxing
    this._dt = new Float64Array(1);
    this._pt = new Float64Array(3); // a point (_solidAt, _inQuiet, _inViewPt, _place)
    this._qb = new Float64Array(6); // a box (_query)
    this._ra = new Float64Array(7); // a ray: origin, unit direction, length (_ray)
    this._rh = new Float64Array(4); // its hit: t, x, y, z
    this._rs = null; // ... the box it hit
    this._rax = 0; // ... the face it entered by
    this._pa = new Float64Array(1); // the heading for _place
    this._c3 = new Float64Array(3);
    // the level's boxes, y-bucketed (built by _index)
    this._refs = [];
    this._bx = new Float64Array(0);
    this._bStart = new Int32Array(1);
    this._bItems = new Int32Array(0);
    this._bBase = 0;
    this._bCount = 0;
    this._stamp = new Uint32Array(0);
    this._stampN = 0;
    this._qr = new Int32Array(0);
    this._decorN = -1;
    this._idxT = 0;
    // the pending crack burst
    this._bq = { stage: 0, k: 0, solid: null, axis: 0, n: 0, left: 0, forced: false };
    this._bf = new Float64Array(12); // x, y, z (the hand), bestD, hx, hy, hz (the wall), t, cx, cy, cz (the crack), dir
    // one payload per event type (listeners read it at once)
    this._evSkit = { x: 0.5, y: 0.5, z: 0.5, n: 0, speed: 0.5 };
    this._evScat = { x: 0.5, y: 0.5, z: 0.5, n: 0 };
    this._evSquish = { x: 0.5, y: 0.5, z: 0.5 };
    this._evBurst = { x: 0.5, y: 0.5, z: 0.5, n: 0 };
    this._off = null;
    if (bus && typeof bus.on === 'function') {
      this._off = bus.on('climb:grab', (e) => {
        if (e && typeof e.x === 'number') this.grab(e.x, e.y, e.z);
      });
    }
  }

  /** The next 30-bit integer of the seeded generator (mulberry32; a small integer, never boxed): x R30 for 0..1. */
  _rnd() {
    this._r = (this._r + 0x6d2b79f5) | 0;
    let t = this._r;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 2;
  }

  reset(level) {
    this.level = level || null;
    this._r = this.seed | 0;
    this.clear();
    this.t = 0;
    this.frame = 0;
    this._grabs = 0;
    this._lastBurst = -1e9;
    this._nextSpawn = 0;
    this._skitT = 0.5;
    this._skitN = 0;
    for (const k of Object.keys(this.stats)) this.stats[k] = 0;
    const q = [];
    if (level) {
      if (level.spawn) q.push(level.spawn.x, level.spawn.y, level.spawn.z);
      for (const s of level.sections || []) if (s.checkpoint) q.push(s.checkpoint.x, s.checkpoint.y, s.checkpoint.z);
    }
    this._quiet = new Float32Array(q);
    this._hotPts = null;
    this._hotW = null;
    this.hot = 0;
    this._index();
  }

  /**
   * The level's boxes (its solids, the seal plates, the fixtures, the colliding dressing) copied into a y-bucketed index: bounds in one
   * Float64Array, the buckets as offsets into one Int32Array. Rebuilt when the dressing's colliders arrive (they come after the level view
   * dresses it). `active` is read live from the box itself.
   */
  _index() {
    const L = this.level;
    const refs = [];
    if (L) for (const list of [L.solids, L.sealSolids, L.fixtureSolids, L.decorSolids]) if (list) for (const s of list) refs.push(s);
    this._decorN = L && L.decorSolids ? L.decorSolids.length : 0;
    const n = refs.length;
    const bx = new Float64Array(n * 6);
    let lo = Infinity;
    let hi = -Infinity;
    for (let j = 0; j < n; j++) {
      const s = refs[j];
      bx[j * 6] = s.minX;
      bx[j * 6 + 1] = s.minY;
      bx[j * 6 + 2] = s.minZ;
      bx[j * 6 + 3] = s.maxX;
      bx[j * 6 + 4] = s.maxY;
      bx[j * 6 + 5] = s.maxZ;
      if (s.minY < lo) lo = s.minY;
      if (s.maxY > hi) hi = s.maxY;
    }
    if (!n) lo = hi = 0;
    const base = Math.floor(lo / BUCKET);
    const count = Math.floor(hi / BUCKET) - base + 1;
    const cnt = new Int32Array(count + 1);
    for (let j = 0; j < n; j++) for (let b = Math.floor(bx[j * 6 + 1] / BUCKET) - base; b <= Math.floor(bx[j * 6 + 4] / BUCKET) - base; b++) cnt[b + 1]++;
    for (let b = 0; b < count; b++) cnt[b + 1] += cnt[b];
    const items = new Int32Array(cnt[count]);
    const fill = cnt.slice(0, count);
    for (let j = 0; j < n; j++) for (let b = Math.floor(bx[j * 6 + 1] / BUCKET) - base; b <= Math.floor(bx[j * 6 + 4] / BUCKET) - base; b++) items[fill[b]++] = j;
    this._refs = refs;
    this._bx = bx;
    this._bStart = cnt;
    this._bItems = items;
    this._bBase = base;
    this._bCount = count;
    this._stamp = new Uint32Array(n);
    this._stampN = 0;
    this._qr = new Int32Array(Math.max(1, n));
  }

  /** The active boxes overlapping the box in this._qb -> their indices in this._qr; returns how many. */
  _query() {
    const qb = this._qb;
    const bx = this._bx;
    const count = this._bCount;
    if (!count) return 0;
    let b0 = Math.floor(qb[1] / BUCKET) - this._bBase;
    let b1 = Math.floor(qb[4] / BUCKET) - this._bBase;
    if (b1 < 0 || b0 >= count) return 0;
    if (b0 < 0) b0 = 0;
    if (b1 >= count) b1 = count - 1;
    this._stampN = (this._stampN + 1) >>> 0;
    if (this._stampN === 0) {
      this._stamp.fill(0);
      this._stampN = 1;
    }
    const sn = this._stampN;
    const items = this._bItems;
    const start = this._bStart;
    const stamp = this._stamp;
    const out = this._qr;
    const refs = this._refs;
    let n = 0;
    for (let b = b0; b <= b1; b++) {
      for (let k = start[b]; k < start[b + 1]; k++) {
        const j = items[k];
        if (stamp[j] === sn) continue;
        stamp[j] = sn;
        const o = j * 6;
        if (bx[o] > qb[3] || bx[o + 3] < qb[0] || bx[o + 1] > qb[4] || bx[o + 4] < qb[1] || bx[o + 2] > qb[5] || bx[o + 5] < qb[2]) continue;
        if (refs[j].active === false) continue;
        out[n++] = j;
      }
    }
    return n;
  }

  /** Is the point in this._pt strictly inside an active box? */
  _solidAt() {
    const p = this._pt;
    const qb = this._qb;
    qb[0] = p[0] - 0.001;
    qb[1] = p[1] - 0.001;
    qb[2] = p[2] - 0.001;
    qb[3] = p[0] + 0.001;
    qb[4] = p[1] + 0.001;
    qb[5] = p[2] + 0.001;
    const n = this._query();
    const bx = this._bx;
    for (let k = 0; k < n; k++) {
      const o = this._qr[k] * 6;
      if (p[0] > bx[o] && p[0] < bx[o + 3] && p[1] > bx[o + 1] && p[1] < bx[o + 4] && p[2] > bx[o + 2] && p[2] < bx[o + 5]) return true;
    }
    return false;
  }

  /** Is the point in this._pt within ROACH.quiet of the spawn or a checkpoint? */
  _inQuiet() {
    const p = this._pt;
    const q = this._quiet;
    const r2 = ROACH.quiet * ROACH.quiet;
    for (let i = 0; i < q.length; i += 3) {
      const dx = q[i] - p[0];
      const dy = q[i + 1] - p[1];
      const dz = q[i + 2] - p[2];
      if (dx * dx + dy * dy + dz * dz < r2) return true;
    }
    return false;
  }

  /** inView() for the point in this._pt. */
  _inViewPt(head) {
    const p = this._pt;
    const pad = 0.05;
    const m = 1 + ROACH.fovPad;
    const dx = p[0] - head.x;
    const dy = p[1] - head.y;
    const dz = p[2] - head.z;
    const fz = dx * head.fx + dy * head.fy + dz * head.fz;
    if (fz <= -pad) return false;
    const fx = dx * head.rx + dy * head.ry + dz * head.rz;
    const fy = dx * head.ux + dy * head.uy + dz * head.uz;
    const zz = fz > 0 ? fz : 0;
    return Math.abs(fx) <= zz * head.tanH * m + pad && Math.abs(fy) <= zz * head.tanV * m + pad;
  }

  /**
   * One ray cast (counted against the frame's budget) along this._ra = (origin, unit direction, length): the nearest active box and the face
   * it entered by (the slab axis; a ray that starts inside a box hits it at t = 0 on its nearest face). The hit: this._rh (t, x, y, z),
   * this._rs (the box), this._rax (the face). False on a miss or when the budget is spent.
   */
  _ray() {
    if (this.raysThisFrame >= ROACH.raysPerFrame) return false;
    this.raysThisFrame++;
    this.stats.rays++;
    const a = this._ra;
    const ox = a[0];
    const oy = a[1];
    const oz = a[2];
    const dx = a[3];
    const dy = a[4];
    const dz = a[5];
    const maxD = a[6];
    const ex = ox + dx * maxD;
    const ey = oy + dy * maxD;
    const ez = oz + dz * maxD;
    const qb = this._qb;
    qb[0] = ox < ex ? ox : ex;
    qb[1] = oy < ey ? oy : ey;
    qb[2] = oz < ez ? oz : ez;
    qb[3] = ox < ex ? ex : ox;
    qb[4] = oy < ey ? ey : oy;
    qb[5] = oz < ez ? ez : oz;
    const n = this._query();
    const bx = this._bx;
    let bestT = Infinity;
    let best = -1;
    let bestAx = 0;
    for (let k = 0; k < n; k++) {
      const j = this._qr[k];
      const o = j * 6;
      let t0 = 0;
      let t1 = maxD;
      let ax = -1;
      let ok = true;
      for (let c = 0; c < 3 && ok; c++) {
        const oc = c === 0 ? ox : c === 1 ? oy : oz;
        const d = c === 0 ? dx : c === 1 ? dy : dz;
        const mn = bx[o + c];
        const mx = bx[o + 3 + c];
        if (d > -1e-12 && d < 1e-12) {
          if (oc < mn || oc > mx) ok = false;
          continue;
        }
        let ta = (mn - oc) / d;
        let tb = (mx - oc) / d;
        if (ta > tb) {
          const tmp = ta;
          ta = tb;
          tb = tmp;
        }
        if (ta > t0) {
          t0 = ta;
          ax = c * 2 + (d > 0 ? 0 : 1); // entering through the min face (-c) when moving +, the max face (+c) when moving -
        }
        if (tb < t1) t1 = tb;
        if (t0 > t1) ok = false;
      }
      if (!ok || t0 >= bestT) continue;
      bestT = t0;
      best = j;
      bestAx = ax;
    }
    if (best < 0) return false;
    const h = this._rh;
    h[0] = bestT;
    h[1] = ox + dx * bestT;
    h[2] = oy + dy * bestT;
    h[3] = oz + dz * bestT;
    this._rs = this._refs[best];
    this._rax = bestAx >= 0 ? bestAx : faceAxisOf(this._rs, h[1], h[2], h[3]);
    return true;
  }

  _free() {
    const st = this.st;
    for (let i = 0; i < st.length; i++) if (st[i] === FREE) return i;
    return -1;
  }

  /** Places a roach (slot i) on face `axis` of `solid` at this._pt (snapped onto the plane), heading this._pa[0]. */
  _place(i, solid, axis, state) {
    const k = NK[axis];
    const off = NS[axis] * 0.003;
    const p = this._pt;
    const o = i * 3;
    this.pos[o] = k === 0 ? (NS[axis] > 0 ? solid.maxX : solid.minX) + off : p[0];
    this.pos[o + 1] = k === 1 ? (NS[axis] > 0 ? solid.maxY : solid.minY) + off : p[1];
    this.pos[o + 2] = k === 2 ? (NS[axis] > 0 ? solid.maxZ : solid.minZ) + off : p[2];
    this.axis[i] = axis;
    this.solid[i] = solid;
    this.st[i] = state;
    this.ang[i] = this._pa[0];
    this.spd[i] = 0;
    this.tgt[i] = 0;
    this.tmr[i] = 0;
    this.ph[i] = this._rnd() * R30 * TAU;
    this.seedK[i] = this._rnd() * R30;
    this.sz[i] = ROACH.size[0] + (ROACH.size[1] - ROACH.size[0]) * this._rnd() * R30;
    this.age[i] = 0;
    this.life[i] = ROACH.life[0] + (ROACH.life[1] - ROACH.life[0]) * this._rnd() * R30;
    this.react[i] = 0;
    this.calmT[i] = 0;
    this.tw[i] = 0.3;
    this.burstK[i] = 0;
    this._territory(i);
    this._enter(i, state);
    this.stats.spawns++;
  }

  /**
   * The patch of its face a roach may run on: the face clipped to +-ROACH.territory around where it appeared (bounds in face coords), and
   * the few boxes standing on that patch (one index query now, plain arithmetic every frame after: the foot of such a box is a crack too).
   */
  _territory(i) {
    const a = this.axis[i];
    const s = this.solid[i];
    const o = i * 3;
    const u = UC[a];
    const v = VC[a];
    const k = NK[a];
    const R = ROACH.territory;
    const e = ROACH.edge;
    const sMin = u === 0 ? s.minX : u === 1 ? s.minY : s.minZ;
    const sMax = u === 0 ? s.maxX : u === 1 ? s.maxY : s.maxZ;
    const tMin = v === 0 ? s.minX : v === 1 ? s.minY : s.minZ;
    const tMax = v === 0 ? s.maxX : v === 1 ? s.maxY : s.maxZ;
    const pu = this.pos[o + u];
    const pv = this.pos[o + v];
    const tb = i * 4;
    this.terr[tb] = Math.max(sMin + e, pu - R);
    this.terr[tb + 1] = Math.min(sMax - e, pu + R);
    this.terr[tb + 2] = Math.max(tMin + e, pv - R);
    this.terr[tb + 3] = Math.min(tMax - e, pv + R);
    // the slab just off the face (from the face out to 25 mm), over the patch
    const n0 = this.pos[o + k] - NS[a] * 0.002;
    const n1 = n0 + NS[a] * 0.027;
    const qb = this._qb;
    qb[k] = n0 < n1 ? n0 : n1;
    qb[k + 3] = n0 < n1 ? n1 : n0;
    qb[u] = this.terr[tb];
    qb[u + 3] = this.terr[tb + 1];
    qb[v] = this.terr[tb + 2];
    qb[v + 3] = this.terr[tb + 3];
    const cnt = this._query();
    const M = ROACH.obstacles;
    const bx = this._bx;
    let n = 0;
    for (let q = 0; q < cnt && n < M; q++) {
      const j = this._qr[q];
      if (this._refs[j] === s) continue;
      const ob = (i * M + n) * 6;
      for (let c = 0; c < 6; c++) this.obs[ob + c] = bx[j * 6 + c];
      n++;
    }
    this.obsN[i] = n;
  }

  /** Does a box standing on its patch cover the point just off the face where roach i is? */
  _blocked(i) {
    const n = this.obsN[i];
    if (!n) return false;
    const o = i * 3;
    const a = this.axis[i];
    const k = NK[a];
    const ns = NS[a] * 0.012;
    const x = this.pos[o] + (k === 0 ? ns : 0);
    const y = this.pos[o + 1] + (k === 1 ? ns : 0);
    const z = this.pos[o + 2] + (k === 2 ? ns : 0);
    const M = ROACH.obstacles;
    const b = this.obs;
    for (let j = 0; j < n; j++) {
      const ob = (i * M + j) * 6;
      if (x > b[ob] && x < b[ob + 3] && y > b[ob + 1] && y < b[ob + 4] && z > b[ob + 2] && z < b[ob + 5]) return true;
    }
    return false;
  }

  _enter(i, state) {
    this.st[i] = state;
    if (state === IDLE) {
      this.tmr[i] = ROACH.idle[0] + (ROACH.idle[1] - ROACH.idle[0]) * this._rnd() * R30;
      this.tgt[i] = 0;
    } else if (state === DART) {
      this.tmr[i] = ROACH.dart[0] + (ROACH.dart[1] - ROACH.dart[0]) * this._rnd() * R30;
      this.tgt[i] = ROACH.speed.dart[0] + (ROACH.speed.dart[1] - ROACH.speed.dart[0]) * this._rnd() * R30;
    } else if (state === FREEZE) {
      this.tmr[i] = ROACH.freeze[0] + (ROACH.freeze[1] - ROACH.freeze[0]) * this._rnd() * R30;
      this.tgt[i] = 0;
      this.tw[i] = 1;
    } else if (state === FLEE) {
      this.tgt[i] = ROACH.speed.flee[0] + (ROACH.speed.flee[1] - ROACH.speed.flee[0]) * this._rnd() * R30;
      this.calmT[i] = ROACH.calm;
      this.tw[i] = 1;
    } else if (state === HIDE) {
      this.tgt[i] = ROACH.speed.hide;
      // toward the nearest edge of its patch (the crack it slips into)
      const a = this.axis[i];
      const tb = i * 4;
      const u = this.pos[i * 3 + UC[a]];
      const v = this.pos[i * 3 + VC[a]];
      const du0 = u - this.terr[tb];
      const du1 = this.terr[tb + 1] - u;
      const dv0 = v - this.terr[tb + 2];
      const dv1 = this.terr[tb + 3] - v;
      let base = Math.PI;
      let m = du0;
      if (du1 < m) (m = du1), (base = 0);
      if (dv0 < m) (m = dv0), (base = -Math.PI / 2);
      if (dv1 < m) base = Math.PI / 2;
      this.ang[i] = base + (this._rnd() * R30 - 0.5) * 0.9;
    } else if (state === SMEAR) {
      this.tmr[i] = ROACH.smear;
      this.spd[i] = 0;
      this.tgt[i] = 0;
      this.tw[i] = 0;
    }
  }

  _kill(i) {
    this.st[i] = FREE;
    this.solid[i] = null;
  }

  _squish(i) {
    this._enter(i, SMEAR);
    this.stats.squished++;
    const e = this._evSquish;
    e.x = this.pos[i * 3];
    e.y = this.pos[i * 3 + 1];
    e.z = this.pos[i * 3 + 2];
    if (this.bus) this.bus.emit('roach:squish', e);
  }

  /** Remains (sim/remainsPlan.js plan { skeletons, stains }) as hotspots: a skeleton weighs 2, a stain 1. */
  setHotspots(plan) {
    const sk = (plan && plan.skeletons) || [];
    const st = (plan && plan.stains) || [];
    const n = sk.length + st.length;
    this._hotPts = new Float32Array(n * 3);
    this._hotW = new Float32Array(n);
    let i = 0;
    for (const list of [sk, st]) {
      for (const s of list) {
        this._hotPts[i * 3] = s.x;
        this._hotPts[i * 3 + 1] = s.y;
        this._hotPts[i * 3 + 2] = s.z;
        this._hotW[i++] = list === sk ? 2 : 1;
      }
    }
    this._hotT = 0;
  }

  get hasHotspots() {
    return !!this._hotPts;
  }

  /** Everything gone at once (the setting off, a respawn, a cutscene). */
  clear() {
    this.st.fill(FREE);
    for (let i = 0; i < this.solid.length; i++) this.solid[i] = null;
    this.alive = 0;
    this.smears = 0;
    this._bq.stage = 0;
    this._bq.left = 0;
    this._bq.solid = null;
    this._handOk[0] = this._handOk[1] = 0;
  }

  destroy() {
    if (this._off) this._off();
    this._off = null;
    this.clear();
  }

  /** A hold was grabbed at (x,y,z): rarely, a stream of them pours out of a crack beside it (deterministic). */
  grab(x, y, z) {
    if (!this.level || !this.enabled) return false;
    this._grabs++;
    const si = this.level.sectionIndexAt ? this.level.sectionIndexAt(y) : 0;
    const ch = ROACH.burst.chance[Math.min(Math.max(si, 0), ROACH.burst.chance.length - 1)];
    if (this.t - this._lastBurst < ROACH.burst.cooldown || this._bq.stage) return false;
    if (hash01((this.seed ^ Math.imul(this._grabs, 0x9e3779b1) ^ Math.imul(si + 1, 0x85ebca6b)) | 0) >= ch) return false;
    return this.burstAt(x, y, z, false);
  }

  /** Queues a crack burst beside (x,y,z) (debug: forced, ignores the chance and the cooldown but not the quiet zones). */
  burstAt(x, y, z, forced = true) {
    if (!this.level || this._bq.stage) return false;
    this._pt[0] = x;
    this._pt[1] = y;
    this._pt[2] = z;
    if (this._inQuiet()) return false;
    const b = this._bq;
    const f = this._bf;
    b.stage = 1;
    b.k = 0;
    b.solid = null;
    b.forced = !!forced;
    f[0] = x;
    f[1] = y;
    f[2] = z;
    f[3] = Infinity;
    f[11] = this._rnd() * R30 * TAU;
    this._lastBurst = this.t;
    return true;
  }

  /** The burst's state machine: stage 1 looks for the wall (6 short rays within the frame budget), stage 2 lets them out one by one. */
  _updateBurst() {
    const b = this._bq;
    const f = this._bf;
    if (b.stage === 1) {
      while (b.k < 6 && this.raysThisFrame < ROACH.raysPerFrame) {
        // four horizontal directions, then down and up (a hold on a ledge top / underside)
        const k = b.k++;
        const a = f[11] + (k * Math.PI) / 2;
        const dx = k < 4 ? Math.cos(a) : 0;
        const dy = k < 4 ? 0 : k === 4 ? -1 : 1;
        const dz = k < 4 ? Math.sin(a) : 0;
        const ra = this._ra;
        ra[0] = f[0] - dx * 0.25;
        ra[1] = f[1] - dy * 0.25;
        ra[2] = f[2] - dz * 0.25;
        ra[3] = dx;
        ra[4] = dy;
        ra[5] = dz;
        ra[6] = ROACH.burst.reach + 0.25;
        if (!this._ray()) continue;
        const d = this._rh[0] + (NK[this._rax] !== 1 ? 0 : 0.5); // a wall beside the hand first
        if (d < f[3]) {
          f[3] = d;
          b.solid = this._rs;
          b.axis = this._rax;
          f[4] = this._rh[1];
          f[5] = this._rh[2];
          f[6] = this._rh[3];
        }
      }
      if (b.k < 6) return;
      if (!b.solid) {
        b.stage = 0;
        return;
      }
      // the crack: on that face, 0.4-0.9 m to one side of the hand, a little above, kept inside the face
      const s = b.solid;
      const a = b.axis;
      const u = UC[a];
      const v = VC[a];
      const c = this._c3;
      c[0] = f[4];
      c[1] = f[5];
      c[2] = f[6];
      const side = this._rnd() * R30 < 0.5 ? -1 : 1;
      const du = side * (0.4 + this._rnd() * R30 * 0.5);
      const dv = NK[a] === 1 ? (this._rnd() * R30 - 0.5) * 0.8 : 0.1 + this._rnd() * R30 * 0.4;
      const m = 0.05;
      const uLo = u === 0 ? s.minX : u === 1 ? s.minY : s.minZ;
      const uHi = u === 0 ? s.maxX : u === 1 ? s.maxY : s.maxZ;
      const vLo = v === 0 ? s.minX : v === 1 ? s.minY : s.minZ;
      const vHi = v === 0 ? s.maxX : v === 1 ? s.maxY : s.maxZ;
      c[u] = Math.min(uHi - m, Math.max(uLo + m, c[u] + du));
      c[v] = Math.min(vHi - m, Math.max(vLo + m, c[v] + dv));
      f[8] = c[0];
      f[9] = c[1];
      f[10] = c[2];
      f[11] = side > 0 ? 0 : Math.PI; // they pour out away from the hand, along the face
      const room = Math.max(0, this.cap - this.alive);
      b.n = Math.min(room, Math.round(ROACH.burst.n[0] + (ROACH.burst.n[1] - ROACH.burst.n[0]) * this._rnd() * R30));
      b.left = b.n;
      f[7] = 0;
      this._pt[0] = c[0];
      this._pt[1] = c[1];
      this._pt[2] = c[2];
      if (b.n <= 0 || this._inQuiet()) {
        b.stage = 0;
        b.solid = null;
        return;
      }
      b.stage = 2;
      this.stats.bursts++;
      const e = this._evBurst;
      e.x = c[0];
      e.y = c[1];
      e.z = c[2];
      e.n = b.n;
      if (this.bus) this.bus.emit('roach:burst', e);
      return;
    }
    if (b.stage === 2) {
      f[7] -= this._dt[0];
      while (b.left > 0 && f[7] <= 0) {
        const i = this._free();
        if (i < 0 || this.alive >= this.cap) {
          b.left = 0;
          break;
        }
        const k = b.n - b.left;
        const fan = (hashU((this.seed + k * 7919 + this.stats.bursts * 104729) & 0x3fffffff) * R30 - 0.5) * 2.2; // +-63 deg
        this._pt[0] = f[8];
        this._pt[1] = f[9];
        this._pt[2] = f[10];
        this._pa[0] = f[11] + fan;
        this._place(i, b.solid, b.axis, FLEE);
        this.burstK[i] = 1;
        this.calmT[i] = 0.4 + this._rnd() * R30 * 0.8;
        const tp = i * 3;
        // the threat is the crack itself: away from it along the face
        this.thr[tp] = f[8];
        this.thr[tp + 1] = f[9];
        this.thr[tp + 2] = f[10];
        this.alive++;
        b.left--;
        f[7] += ROACH.burst.gap;
      }
      if (b.left <= 0) {
        b.stage = 0;
        b.solid = null;
      }
    }
  }

  /** One spawn attempt (one ray): a floor or a wall 2-9 m away, behind or beside the head, never in view. Returns the slot or -1. */
  _trySpawn(ctx) {
    const H = ctx.head;
    this.stats.attempts++;
    // the horizontal view axis (looking straight down / up: any)
    let fx = H.fx;
    let fz = H.fz;
    const fl = Math.sqrt(fx * fx + fz * fz);
    if (fl < 0.2) {
      fx = 0;
      fz = -1;
    } else {
      fx /= fl;
      fz /= fl;
    }
    const yaw = Math.atan2(fx, fz);
    const side = this._rnd() * R30 < 0.5 ? -1 : 1;
    const a = yaw + side * (ROACH.offAngle + this._rnd() * R30 * (Math.PI - ROACH.offAngle));
    const dx = Math.sin(a);
    const dz = Math.cos(a);
    const r = ROACH.rMin + (ROACH.rMax - ROACH.rMin) * Math.pow(this._rnd() * R30, 1.2);
    const p = this._pt;
    const ra = this._ra;
    if (this._rnd() * R30 < 0.6) {
      // a floor: straight down from a point beside / behind you
      p[0] = H.x + dx * r;
      p[1] = H.y + 0.4;
      p[2] = H.z + dz * r;
      if (this._solidAt()) return -1;
      ra[0] = p[0];
      ra[1] = p[1];
      ra[2] = p[2];
      ra[3] = 0;
      ra[4] = -1;
      ra[5] = 0;
      ra[6] = 7;
      if (!this._ray() || this._rax !== 3) return -1;
    } else {
      // a wall: across from your chest / knees
      p[0] = H.x;
      p[1] = H.y - 0.3 - this._rnd() * R30 * 1.4;
      p[2] = H.z;
      if (this._solidAt()) return -1;
      ra[0] = p[0];
      ra[1] = p[1];
      ra[2] = p[2];
      ra[3] = dx;
      ra[4] = 0;
      ra[5] = dz;
      ra[6] = ROACH.rMax;
      if (!this._ray() || NK[this._rax] === 1 || this._rh[0] < ROACH.rMin) return -1;
    }
    const s = this._rs;
    const ax = this._rax;
    const h = this._rh;
    const u = UC[ax];
    const v = VC[ax];
    const m = 0.05;
    const hu = h[1 + u];
    const hv = h[1 + v];
    const uLo = u === 0 ? s.minX : u === 1 ? s.minY : s.minZ;
    const uHi = u === 0 ? s.maxX : u === 1 ? s.maxY : s.maxZ;
    const vLo = v === 0 ? s.minX : v === 1 ? s.minY : s.minZ;
    const vHi = v === 0 ? s.maxX : v === 1 ? s.maxY : s.maxZ;
    if (hu < uLo + m || hu > uHi - m || hv < vLo + m || hv > vHi - m) return -1;
    const nk = NK[ax];
    const ns = NS[ax];
    p[0] = h[1] + (nk === 0 ? ns * 0.003 : 0);
    p[1] = h[2] + (nk === 1 ? ns * 0.003 : 0);
    p[2] = h[3] + (nk === 2 ? ns * 0.003 : 0);
    const ddx = p[0] - H.x;
    const ddy = p[1] - H.y;
    const ddz = p[2] - H.z;
    const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
    if (d2 < ROACH.rMin * ROACH.rMin || d2 > ROACH.rMax * ROACH.rMax) return -1;
    if (this._inViewPt(H)) return -1; // never pops into view
    if (this._inQuiet()) return -1;
    // something stands on that spot
    p[nk] += ns * 0.012;
    const blocked = this._solidAt();
    p[nk] -= ns * 0.012;
    if (blocked) return -1;
    const i = this._free();
    if (i < 0) return -1;
    // half of them are already on the move (you catch one scuttling off), the rest sit and twitch
    const moving = this._rnd() * R30 < 0.5;
    // the heading on the face: away from the head (projected) for a mover, any for a sitter
    const awayU = (u === 0 ? ddx : u === 1 ? ddy : ddz) || 1e-3;
    const awayV = v === 0 ? ddx : v === 1 ? ddy : ddz;
    this._pa[0] = moving ? Math.atan2(awayV, awayU) + (this._rnd() * R30 - 0.5) * 1.6 : this._rnd() * R30 * TAU;
    this._place(i, s, ax, moving ? DART : IDLE);
    this.alive++;
    if (this.audit) this.audit.push({ i, x: p[0], y: p[1], z: p[2], axis: ax, solid: s, inView: inView(H, p[0], p[1], p[2]), t: this.t, head: { ...H } });
    return i;
  }

  /** The remains density near the head (a sum of hotspot weights within hotRadius), refreshed every 0.5 s. */
  _updateHot(H) {
    this._hotT -= this._dt[0];
    if (this._hotT > 0 || !this._hotPts) return;
    this._hotT = 0.5;
    const p = this._hotPts;
    const w = this._hotW;
    const r2 = ROACH.hotRadius * ROACH.hotRadius;
    let s = 0;
    for (let i = 0, j = 0; i < w.length; i++, j += 3) {
      const dx = p[j] - H.x;
      const dy = p[j + 1] - H.y;
      const dz = p[j + 2] - H.z;
      if (dx * dx + dy * dy + dz * dz < r2) s += w[i];
    }
    this.hot = s;
  }

  /**
   * One frame. ctx: makeRoachCtx() filled by the glue. Allocation-free.
   */
  update(dt, ctx) {
    this.raysThisFrame = 0;
    if (!ctx || !ctx.on || !this.enabled || !this.level || ctx.gov >= 3) {
      if (this.alive || this.smears || this._bq.stage) this.clear();
      this.cap = 0;
      this.target = 0;
      return;
    }
    dt = dt > 0 ? (dt > 0.1 ? 0.1 : dt) : 0;
    this._dt[0] = dt;
    this.t += dt;
    this.frame++;
    const H = ctx.head;
    // the dressing's colliders arrive after the level view dressed it: re-index then (checked once a second)
    this._idxT -= dt;
    if (this._idxT <= 0) {
      this._idxT = 1;
      const dn = this.level.decorSolids ? this.level.decorSolids.length : 0;
      if (dn !== this._decorN) this._index();
    }
    const capT = ROACH.cap[ctx.tier] || ROACH.cap.quest;
    const gs = ROACH.govScale[ctx.gov > 0 ? ctx.gov | 0 : 0];
    this.cap = Math.min(ROACH.pool, Math.floor(capT * gs));
    // the section at the head (Level3D.sectionIndexAt, inline)
    const secs = this.level.sections;
    let si = 0;
    if (secs && secs.length && H.y < secs[0].yBottom) {
      si = secs.length - 1;
      for (let k = 1; k < secs.length; k++) {
        if (H.y >= secs[k].yBottom) {
          si = k;
          break;
        }
      }
    }
    this.section = si;
    this._updateHot(H);
    const pop = ROACH.pop[si < ROACH.pop.length ? si : ROACH.pop.length - 1];
    const hot = this.hot < ROACH.hotMax ? this.hot : ROACH.hotMax;
    this.target = Math.min(this.cap, Math.round(pop * this.popMul * (1 + ROACH.hotBonus * hot)));

    // the hands: speed from the last frame
    const hands = ctx.hands;
    for (let k = 0; k < 2; k++) {
      const hd = hands[k];
      const o = k * 3;
      if (hd && hd.ok) {
        if (this._handOk[k] && dt > 0) {
          const dx = hd.x - this._prevHand[o];
          const dy = hd.y - this._prevHand[o + 1];
          const dz = hd.z - this._prevHand[o + 2];
          this._handSpd[k] = Math.sqrt(dx * dx + dy * dy + dz * dz) / dt;
        } else this._handSpd[k] = 0;
        this._prevHand[o] = hd.x;
        this._prevHand[o + 1] = hd.y;
        this._prevHand[o + 2] = hd.z;
        this._handOk[k] = 1;
      } else {
        this._handOk[k] = 0;
        this._handSpd[k] = 0;
      }
    }
    const B = ctx.body;
    const bSpd = Math.sqrt(B.vx * B.vx + B.vy * B.vy + B.vz * B.vz);
    const L = ctx.lantern;
    const F = ROACH.fear;
    const lightOn = L.k > F.lightMin;
    const lNear = F.lightNear * L.k;
    const lFar = F.lightFar * L.k;
    const S = ROACH.squish;

    let alive = 0;
    let smears = 0;
    const sc = this._scat;
    sc[0] = sc[1] = sc[2] = sc[3] = 0;
    let skN = 0;
    let skD = Infinity;
    let skI = -1;
    const P = ROACH.pool;
    const pos = this.pos;
    const t = this.t;
    for (let i = 0; i < P; i++) {
      const st = this.st[i];
      if (st === FREE) continue;
      const o = i * 3;
      if (st === SMEAR) {
        this.tmr[i] -= dt;
        if (this.tmr[i] <= 0) this._kill(i);
        else smears++;
        continue;
      }
      const x = pos[o];
      const y = pos[o + 1];
      const z = pos[o + 2];
      const hx = x - H.x;
      const hy = y - H.y;
      const hz = z - H.z;
      const hd2 = hx * hx + hy * hy + hz * hz;
      if (hd2 > ROACH.dropFar * ROACH.dropFar || this.solid[i].active === false) {
        this._kill(i); // far behind you, or its ledge crumbled / its seal opened
        this.stats.dropped++;
        continue;
      }
      this.age[i] += dt;
      const ax = this.axis[i];

      // ---- squish: a palm on it, a boot on it
      let squish = false;
      let threat = 0; // 0 none, 1 a hand (k in thrK), 2 the body, 3 the lantern
      let thrK = 0;
      for (let k = 0; k < 2 && !squish; k++) {
        if (!this._handOk[k]) continue;
        const hd = hands[k];
        const dx = x - hd.x;
        const dy = y - hd.y;
        const dz = z - hd.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < S.hand * S.hand) squish = true;
        else if (d2 < F.hand * F.hand || (d2 < F.handFast * F.handFast && this._handSpd[k] > F.handSpeed)) {
          threat = 1;
          thrK = k;
        }
      }
      if (!squish && ax === 3 && B.grounded) {
        const dx = x - B.x;
        const dz = z - B.z;
        const dh2 = dx * dx + dz * dz;
        const dy = y - B.footY;
        if (dy < S.footY && dy > -S.footY && dh2 < S.foot * S.foot && (bSpd > S.footSpeed || B.landed)) squish = true;
      }
      if (squish) {
        this._squish(i);
        smears++;
        continue;
      }
      // ---- fright: the body moving close, a landing, a fast swing, the lantern's light
      if (!threat) {
        const dx = x - B.x;
        const dy = y - B.y;
        const dz = z - B.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if ((d2 < F.body * F.body && bSpd > F.bodySpeed) || (B.landed && d2 < F.land * F.land) || (bSpd > F.swingSpeed && d2 < F.swing * F.swing)) threat = 2;
      }
      if (!threat && lightOn) {
        const dx = x - L.x;
        const dy = y - L.y;
        const dz = z - L.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < lFar * lFar) {
          const d = Math.sqrt(d2) || 1e-3;
          if (d < lNear || (dx * L.ax + dy * L.ay + dz * L.az) / d > F.lightCos) threat = 3;
        }
      }
      let s = st;
      if (threat) {
        const src = threat === 1 ? hands[thrK] : threat === 2 ? B : L;
        this.thr[o] = src.x;
        this.thr[o + 1] = src.y;
        this.thr[o + 2] = src.z;
        if (s === FLEE) this.calmT[i] = ROACH.calm;
        else {
          // a moment to react (longer when frozen): a quick hand can still catch one
          if (this.react[i] <= 0) this.react[i] = ROACH.react[0] + (ROACH.react[1] - ROACH.react[0]) * this._rnd() * R30 + (s === FREEZE ? ROACH.freezeReact : 0);
          this.react[i] -= dt;
          if (this.react[i] <= 0) {
            this.react[i] = 0;
            this._enter(i, FLEE);
            s = FLEE;
            if (!this.burstK[i]) {
              sc[0] += 1;
              sc[1] += x;
              sc[2] += y;
              sc[3] += z;
            }
          }
        }
      } else if (this.react[i] > 0) this.react[i] = 0;

      // ---- the state machine
      this.tmr[i] -= dt;
      if (s === IDLE) {
        if (this.tmr[i] <= 0) {
          this._enter(i, DART);
          this.ang[i] += (this._rnd() * R30 - 0.5) * 2.4;
        }
        s = this.st[i];
      } else if (s === DART || s === FREEZE) {
        if (this.tmr[i] <= 0) {
          if (s === DART && this._rnd() * R30 < 0.6) this._enter(i, FREEZE);
          else {
            this._enter(i, DART);
            this.ang[i] += (this._rnd() * R30 < 0.5 ? -1 : 1) * (0.5 + this._rnd() * R30 * 1.6);
          }
        }
        s = this.st[i];
      } else if (s === FLEE) {
        this.calmT[i] -= dt;
        if (this.calmT[i] <= 0) {
          this._enter(i, this._rnd() * R30 < 0.7 || this.burstK[i] ? HIDE : FREEZE);
          s = this.st[i];
        } else {
          // away from the threat, along the face (a threat straight above / below the face: the way it was going)
          const au = pos[o + UC[ax]] - this.thr[o + UC[ax]];
          const av = pos[o + VC[ax]] - this.thr[o + VC[ax]];
          if (au * au + av * av > 0.0004) {
            const want = Math.atan2(av, au) + Math.sin(t * 9 + this.seedK[i] * 40) * 0.35;
            let da = want - this.ang[i];
            da -= Math.round(da / TAU) * TAU;
            this.ang[i] += da * (1 - Math.exp(-dt * 14));
          }
        }
      }
      if (s !== FLEE && s !== HIDE && (this.age[i] > this.life[i] || hd2 > ROACH.hideFar * ROACH.hideFar)) {
        this._enter(i, HIDE);
        s = HIDE;
      }
      // over the cap (the governor stepped up, the tier changed): the extras go and hide
      if (alive >= this.cap && s !== HIDE) {
        this._enter(i, HIDE);
        s = HIDE;
      }

      // ---- motion on its patch of the face
      const tg = this.tgt[i];
      let sp = this.spd[i];
      if (tg <= 0) sp = 0; // a cockroach stops dead
      else sp += (tg - sp) * (1 - Math.exp(-dt * 18));
      this.spd[i] = sp;
      if (s === DART) this.ang[i] += Math.sin(t * 13 + this.seedK[i] * 61) * 1.6 * dt; // the wobble of a run
      this.tw[i] += ((s === FREEZE || s === FLEE ? 1 : s === IDLE ? 0.5 : 0.25) - this.tw[i]) * (1 - Math.exp(-dt * 6));
      if (sp > 0) {
        const len = ROACH.len * this.sz[i];
        this.ph[i] = (this.ph[i] + (sp * dt * TAU) / (len * 0.9)) % (TAU * 1000);
        const uc = o + UC[ax];
        const vc = o + VC[ax];
        const tb = i * 4;
        const u0 = this.terr[tb];
        const u1 = this.terr[tb + 1];
        const v0 = this.terr[tb + 2];
        const v1 = this.terr[tb + 3];
        let u = pos[uc] + Math.cos(this.ang[i]) * sp * dt;
        let v = pos[vc] + Math.sin(this.ang[i]) * sp * dt;
        let edged = 0;
        if (u < u0 || u > u1) {
          u = u < u0 ? u0 : u1;
          edged |= 1;
        }
        if (v < v0 || v > v1) {
          v = v < v0 ? v0 : v1;
          edged |= 2;
        }
        if (edged && s === HIDE) {
          this._kill(i); // in the crack: gone
          this.stats.hidden++;
          continue;
        }
        const pu = pos[uc];
        const pv = pos[vc];
        pos[uc] = u;
        pos[vc] = v;
        // a thing standing on the face: the foot of it is a crack too
        if (this._blocked(i)) {
          if (s === HIDE) {
            this._kill(i);
            this.stats.hidden++;
            continue;
          }
          pos[uc] = pu;
          pos[vc] = pv;
          edged |= 3;
        }
        if (edged) {
          // turn back from the edge (a flight slides along it)
          if (edged & 1) this.ang[i] = Math.PI - this.ang[i];
          if (edged & 2) this.ang[i] = -this.ang[i];
          this.ang[i] += (this._rnd() * R30 - 0.5) * 0.8;
          if (s === DART && this._rnd() * R30 < 0.5) this._enter(i, FREEZE);
        }
      }
      alive++;
      // the nearest runner within earshot
      if (sp > 0.2 && hd2 < ROACH.skitter.range * ROACH.skitter.range) {
        skN++;
        if (hd2 < skD) {
          skD = hd2;
          skI = i;
        }
      }
    }
    this.alive = alive;
    this.smears = smears;

    // ---- events: a scatter, the ticking of the nearest runner
    if (sc[0] >= 2 && t - this._lastScatter > ROACH.scatterGap) {
      this._lastScatter = t;
      this.stats.scatters++;
      const e = this._evScat;
      e.x = sc[1] / sc[0];
      e.y = sc[2] / sc[0];
      e.z = sc[3] / sc[0];
      e.n = sc[0] | 0;
      if (this.bus) this.bus.emit('roach:scatter', e);
    }
    this._skitT -= dt;
    if (this._skitT <= 0 && skI >= 0) {
      this._skitN++;
      const g = ROACH.skitter.gap;
      this._skitT = g[0] + (g[1] - g[0]) * hashU((this.seed ^ Math.imul(this._skitN, 0x9e3779b1)) & 0x3fffffff) * R30;
      this.stats.skitters++;
      const e = this._evSkit;
      e.x = pos[skI * 3];
      e.y = pos[skI * 3 + 1];
      e.z = pos[skI * 3 + 2];
      e.n = skN;
      e.speed = this.spd[skI];
      if (this.bus) this.bus.emit('roach:skitter', e);
    }

    // ---- the crack burst, then the refill (rate-limited, within the ray budget)
    if (this._bq.stage) this._updateBurst();
    if (this.alive + this.smears < P && this.alive < this.target && t >= this._nextSpawn) {
      let got = false;
      for (let k = 0; k < 4 && this.raysThisFrame < ROACH.raysPerFrame; k++) {
        if (this._trySpawn(ctx) >= 0) {
          got = true;
          break;
        }
      }
      this._nextSpawn = t + (got ? ROACH.spawnGap : ROACH.retryGap); // nowhere to put one right now: look again a little later
    }
  }

  /** Puts one roach on face `axis` of `solid` at (x,y,z) heading `ang` (tests, debug). Returns the slot or -1. */
  placeAt(solid, axis, x, y, z, state = IDLE, ang = 0) {
    const i = this._free();
    if (i < 0 || !solid) return -1;
    this._pt[0] = x;
    this._pt[1] = y;
    this._pt[2] = z;
    this._pa[0] = ang;
    this._place(i, solid, axis, state);
    if (state !== SMEAR) this.alive++;
    return i;
  }

  /** A snapshot for the debug API and the tests. */
  state() {
    const by = { idle: 0, dart: 0, freeze: 0, flee: 0, hide: 0, smear: 0 };
    for (let i = 0; i < ROACH.pool; i++) {
      const s = this.st[i];
      if (s !== FREE) by[ROACH_STATE_NAMES[s]]++;
    }
    return { enabled: this.enabled, alive: this.alive, smears: this.smears, cap: this.cap, target: this.target, section: this.section, hot: this.hot, by, burst: this._bq.stage, stats: { ...this.stats } };
  }
}
