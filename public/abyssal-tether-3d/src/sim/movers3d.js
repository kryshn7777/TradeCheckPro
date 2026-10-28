/* ABYSSAL TETHER 3D — movers3d.js
 * Movers-lite (docs/abyssal-tether-3d/plans/LEVEL_FUN_PLAN.md item 7, phase P4 "machines"): the smallest subset of
 * ENGINE_EXTENSIONS E13 (movers) / E14 (dynamic sets) / E15 (moving anchors). Two closed-form kinds whose pose is a pure
 * function of the run clock t, so the game, the bots' look-ahead (which rewinds the clock) and an input replay agree
 * without any mover state:
 *   pendulum  a chain cage: pivot (x, y, z), horizontal swing direction `dir` {x, z}, amp (rad), period (s), phase (0..1
 *             of a period). θ(t) = amp · sin(2π (t / period + phase)). A carried anchor keeps its rest offset from the
 *             pivot (authored where it hangs at θ = 0), turned by θ about the horizontal axis across the swing.
 *   orbit     a ring on a gear's rim: centre (x, y, z), `u` / `v` (unit vectors: the rim point at α = 0 and at α = 90°; the
 *             gear's axis is u × v), radius, period, phase, spin (+1 / −1). α(t) = 2π · spin · (t / period + phase). A
 *             carried anchor rides the rim at α. `housing` h: the rim point is hidden (in the wall: not targetable, a hook
 *             arriving there falls off, a line on it is pulled off, TetherSystem) while cos α < h.
 * Level data: `movers: [{ id, kind, ..., carry: { anchors: [ids] }, parts, by: { [difficulty]: {...} } }]` (variant
 * filtered like every list; `by[difficulty]` overrides the knobs: period × 1 / 0.9 / 0.8 and the amplitude that keeps the
 * carried anchors at or under `maxSpeed`, 1.5 m/s: CONTRACT rule 5, a rope the player chose may carry them that fast along
 * a smooth sine, never a rotation of the view). Level3D (buildMovers) marks the carried anchors `dynamic`, keeps them out
 * of its Y index (anchorsNear appends them) and poses them at t = 0; Objectives3D owns a Movers3D with the difficulty's
 * knobs and poses them every fixed step with its run clock, before the next physics step. Every anchor has vx / vy / vz
 * (0 when it does not move): Rope3D.pull takes the velocity relative to its anchor.
 * Pure: no imports (game.js loads it with the core sim modules), no allocation per pose.
 */

const TAU = Math.PI * 2;
/** CONTRACT rule 5 / LEVEL_FUN_PLAN item 7: no carried anchor moves faster than this (m/s). */
export const MOVER_MAX_SPEED = 1.5;
export const MOVER_KINDS = Object.freeze(['pendulum', 'orbit']);

function num(v, fallback) {
  return typeof v === 'number' && isFinite(v) ? v : fallback;
}

function inVariant(o, variant) {
  if (Array.isArray(o.onlyIn) && o.onlyIn.length > 0 && o.onlyIn.indexOf(variant) < 0) return false;
  return !(Array.isArray(o.omitIn) && o.omitIn.indexOf(variant) >= 0);
}

function unit(o, fx, fy, fz) {
  let x = o ? num(o.x, fx) : fx;
  let y = o ? num(o.y, fy) : fy;
  let z = o ? num(o.z, fz) : fz;
  const l = Math.hypot(x, y, z);
  if (l < 1e-9) {
    x = fx;
    y = fy;
    z = fz;
  } else {
    x /= l;
    y /= l;
    z /= l;
  }
  return { x, y, z };
}

/**
 * A clean mover from its level data entry with the `by[key]` knobs applied (key = the difficulty, or the level variant).
 * Returns null for an unknown kind. Shape: { id, kind, k (0 pendulum, 1 orbit), x, y, z, amp, period, phase, spin, radius,
 * housing, maxSpeed, d {x, z} and c {x, z} (pendulum: the swing and the cross axis), u, v (orbit), anchors: [ids], parts }.
 */
export function normalizeMover(raw, key) {
  if (!raw || typeof raw.id !== 'string') return null;
  const o = Object.assign({}, raw, raw.by && key && raw.by[key] ? raw.by[key] : null);
  const k = MOVER_KINDS.indexOf(o.kind);
  if (k < 0) return null;
  const m = {
    id: o.id,
    kind: o.kind,
    k,
    x: num(o.x, 0),
    y: num(o.y, 0),
    z: num(o.z, 0),
    amp: num(o.amp, 0.1),
    period: Math.max(0.5, num(o.period, 8)),
    phase: num(o.phase, 0),
    spin: num(o.spin, 1) < 0 ? -1 : 1,
    radius: Math.max(0, num(o.radius, 1)),
    housing: num(o.housing, -2),
    maxSpeed: num(o.maxSpeed, MOVER_MAX_SPEED),
    d: null,
    c: null,
    u: null,
    v: null,
    anchors: o.carry && Array.isArray(o.carry.anchors) ? o.carry.anchors.filter((s) => typeof s === 'string') : [],
    parts: typeof o.parts === 'string' ? o.parts : null,
    length: num(o.length, 0),
  };
  if (k === 0) {
    const d = unit({ x: o.dir ? o.dir.x : 1, y: 0, z: o.dir ? o.dir.z : 0 }, 1, 0, 0);
    m.d = { x: d.x, z: d.z };
    m.c = { x: -d.z, z: d.x }; // d × up: the horizontal axis the cage turns about
  } else {
    const u = unit(o.u, 1, 0, 0);
    let v = unit(o.v, 0, 1, 0);
    // v made perpendicular to u (Gram-Schmidt)
    const uv = u.x * v.x + u.y * v.y + u.z * v.z;
    v = unit({ x: v.x - uv * u.x, y: v.y - uv * u.y, z: v.z - uv * u.z }, 0, 1, 0);
    m.u = u;
    m.v = v;
  }
  return m;
}

/** The mover's angle at time t: θ (pendulum, rad off the plumb line) or α (orbit, rad round the rim from u). */
export function moverAngle(m, t) {
  const c = t / m.period + m.phase;
  if (m.k === 0) return m.amp * Math.sin(TAU * c);
  return TAU * m.spin * c;
}

/** d(angle)/dt at time t. */
export function moverRate(m, t) {
  if (m.k === 0) return (m.amp * TAU * Math.cos(TAU * (t / m.period + m.phase))) / m.period;
  return (TAU * m.spin) / m.period;
}

/**
 * The rest offset of a carried anchor (its authored position minus the pivot / centre) in the mover's own frame:
 * pendulum [along the swing, up, across]; orbit [the angle on the rim (rad, from u), 0, 0] (the anchor rides the rim).
 */
export function carryOffset(m, ax, ay, az) {
  const ox = ax - m.x;
  const oy = ay - m.y;
  const oz = az - m.z;
  if (m.k === 0) return [ox * m.d.x + oz * m.d.z, oy, ox * m.c.x + oz * m.c.z];
  const pu = ox * m.u.x + oy * m.u.y + oz * m.u.z;
  const pv = ox * m.v.x + oy * m.v.y + oz * m.v.z;
  return [Math.atan2(pv, pu), 0, 0];
}

/**
 * Writes the pose of a carried point at time t into `out` (x, y, z, vx, vy, vz, hidden). `o0..o2` = its carryOffset.
 * Allocation-free.
 */
export function posePoint(m, o0, o1, o2, t, out) {
  const a = moverAngle(m, t);
  const w = moverRate(m, t);
  if (m.k === 0) {
    const s = Math.sin(a);
    const c = Math.cos(a);
    const along = o0 * c - o1 * s; // along the swing direction
    const up = o0 * s + o1 * c;
    const vAlong = w * (-o0 * s - o1 * c);
    const vUp = w * (o0 * c - o1 * s);
    out.x = m.x + m.d.x * along + m.c.x * o2;
    out.y = m.y + up;
    out.z = m.z + m.d.z * along + m.c.z * o2;
    out.vx = m.d.x * vAlong;
    out.vy = vUp;
    out.vz = m.d.z * vAlong;
    out.hidden = false;
    return out;
  }
  const b = a + o0;
  const cb = Math.cos(b);
  const sb = Math.sin(b);
  const R = m.radius;
  out.x = m.x + R * (cb * m.u.x + sb * m.v.x);
  out.y = m.y + R * (cb * m.u.y + sb * m.v.y);
  out.z = m.z + R * (cb * m.u.z + sb * m.v.z);
  const k = R * w;
  out.vx = k * (-sb * m.u.x + cb * m.v.x);
  out.vy = k * (-sb * m.u.y + cb * m.v.y);
  out.vz = k * (-sb * m.u.z + cb * m.v.z);
  out.hidden = cb < m.housing;
  return out;
}

/** The highest speed a carried point (offset o0, o1: its distance from the turning axis) ever reaches (closed form). */
export function pointMaxSpeed(m, o0, o1) {
  if (m.k === 0) return Math.hypot(o0, o1) * ((m.amp * TAU) / m.period);
  return (m.radius * TAU) / m.period;
}

/**
 * Seconds from t until a rim point (offset o0) slides into the housing (Infinity: it never hides; 0: hidden now). The bots
 * fire at the winch ring only when it stays out long enough (verify/bot.mjs `exposed`).
 */
export function exposedFor(m, o0, t) {
  if (m.k !== 1 || !(m.housing > -1)) return Infinity;
  if (m.housing >= 1) return 0;
  const ah = Math.acos(m.housing); // visible while |β| < ah (β wrapped to (−π, π])
  let b = (moverAngle(m, t) + o0) % TAU;
  if (b > Math.PI) b -= TAU;
  if (b <= -Math.PI) b += TAU;
  if (!(Math.abs(b) < ah)) return 0;
  const w = TAU / m.period;
  return m.spin < 0 ? (b + ah) / w : (ah - b) / w;
}

/** Seconds from t until a hidden rim point comes out of the housing (0 when it is out now). */
export function hiddenFor(m, o0, t) {
  if (m.k !== 1 || !(m.housing > -1) || m.housing >= 1) return 0;
  const ah = Math.acos(m.housing);
  let b = (moverAngle(m, t) + o0) % TAU;
  if (b > Math.PI) b -= TAU;
  if (b <= -Math.PI) b += TAU;
  if (Math.abs(b) < ah) return 0;
  const w = TAU / m.period;
  // spin −1: β falls toward +ah from above (through π); spin +1: β rises toward −ah
  const gap = m.spin < 0 ? (b > 0 ? b - ah : b + TAU - ah) : b < 0 ? -ah - b : TAU - ah - b;
  return gap / w;
}

/**
 * Level3D: the movers of a level variant (normalised with the variant's own knobs, the t = 0 pose), the anchors they carry
 * marked dynamic, each anchor's rest offset and the volume it sweeps (an AABB the dressing keeps clear of). `byId` = the
 * level's anchors by id. Returns [{ id, raw, m, anchors: [anchor], offs: [[o0, o1, o2]], sweep: box }].
 */
export function buildMovers(list, variant, byId) {
  const out = [];
  if (!Array.isArray(list)) return out;
  for (const raw of list) {
    if (!raw || typeof raw.id !== 'string' || !inVariant(raw, variant)) continue;
    const m = normalizeMover(raw, variant);
    if (!m) continue;
    const anchors = [];
    const offs = [];
    for (const id of m.anchors) {
      const a = byId[id];
      if (!a || a.x === undefined || a.minX !== undefined || a.dynamic) continue;
      anchors.push(a);
      offs.push(carryOffset(m, a.x, a.y, a.z));
      a.dynamic = true;
      a.mover = out.length;
    }
    // the volume it sweeps: the pivot / centre and every carried point over a whole cycle (16 samples), 1.2 m around
    let minX = m.x;
    let maxX = m.x;
    let minY = m.y;
    let maxY = m.y;
    let minZ = m.z;
    let maxZ = m.z;
    const q = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, hidden: false };
    const pts = offs.length ? offs : [[0, -m.length, 0]];
    for (const o of pts) {
      for (let i = 0; i < 16; i++) {
        posePoint(m, o[0], o[1], o[2], (m.period * i) / 16, q);
        if (q.x < minX) minX = q.x;
        if (q.x > maxX) maxX = q.x;
        if (q.y < minY) minY = q.y;
        if (q.y > maxY) maxY = q.y;
        if (q.z < minZ) minZ = q.z;
        if (q.z > maxZ) maxZ = q.z;
      }
    }
    const pad = m.k === 0 ? 1.4 : 0.6;
    const sweep = { minX: minX - pad, minY: minY - (m.k === 0 ? 1.4 : pad), minZ: minZ - pad, maxX: maxX + pad, maxY: maxY + pad, maxZ: maxZ + pad };
    out.push({ id: m.id, raw, m, anchors, offs, sweep });
  }
  return out;
}

/** Poses the carried anchors of `movers` (Level3D.movers entries, or Movers3D.list) at time t. */
export function poseAll(movers, t, q) {
  for (let i = 0; i < movers.length; i++) {
    const e = movers[i];
    const m = e.m;
    for (let j = 0; j < e.anchors.length; j++) {
      const a = e.anchors[j];
      const o = e.offs[j];
      posePoint(m, o[0], o[1], o[2], t, q);
      a.x = q.x;
      a.y = q.y;
      a.z = q.z;
      a.vx = q.vx;
      a.vy = q.vy;
      a.vz = q.vz;
      a.hidden = q.hidden;
    }
  }
}

/**
 * The movers of a run with the difficulty's knobs (Objectives3D owns one): pose(t) writes every carried anchor; queries for
 * the bots and the view. ≤ 8 movers, ≤ a few anchors each: O(anchors) per pose, no allocation.
 */
export class Movers3D {
  /**
   * @param {Level3D} level  its `movers` (buildMovers)
   * @param {object} [diff]  DIFFICULTY preset (`key` picks the `by` knobs; Sandbox has none: the level variant's)
   */
  constructor(level, diff) {
    const base = (level && level.movers) || [];
    const key = diff && diff.key && base.some((e) => e.raw.by && e.raw.by[diff.key]) ? diff.key : (level && level.variant) || 'normal';
    this.list = base.map((e) => ({ id: e.id, m: normalizeMover(e.raw, key) || e.m, anchors: e.anchors, offs: e.offs, sweep: e.sweep }));
    this._q = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, hidden: false };
    this.t = 0;
  }

  get count() {
    return this.list.length;
  }

  /** Every carried anchor to its pose at time t (x, y, z, vx, vy, vz, hidden). */
  pose(t) {
    this.t = t;
    poseAll(this.list, t, this._q);
  }

  /** The mover entry carrying anchor `a` (or null). */
  entryOf(a) {
    if (!a || !a.dynamic) return null;
    for (let i = 0; i < this.list.length; i++) if (this.list[i].anchors.indexOf(a) >= 0) return this.list[i];
    return null;
  }

  byId(id) {
    for (let i = 0; i < this.list.length; i++) if (this.list[i].id === id) return this.list[i];
    return null;
  }

  /** Seconds from t until anchor `a` slides into its housing (Infinity for a pendulum or a static anchor). */
  exposedFor(a, t) {
    const e = this.entryOf(a);
    if (!e) return Infinity;
    return exposedFor(e.m, e.offs[e.anchors.indexOf(a)][0], t);
  }

  /** Seconds from t until a hidden anchor `a` comes out again (0 when it is out). */
  hiddenFor(a, t) {
    const e = this.entryOf(a);
    if (!e) return 0;
    return hiddenFor(e.m, e.offs[e.anchors.indexOf(a)][0], t);
  }

  /** The fastest any carried anchor ever moves (m/s, closed form). */
  maxSpeed() {
    let v = 0;
    for (const e of this.list) for (const o of e.offs) v = Math.max(v, pointMaxSpeed(e.m, o[0], o[1]));
    return v;
  }

  /** The angle of mover entry i at time t (the view turns its parts by it). */
  angle(i, t) {
    return moverAngle(this.list[i].m, t);
  }
}
