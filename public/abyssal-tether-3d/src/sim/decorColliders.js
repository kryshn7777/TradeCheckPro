/* ABYSSAL TETHER 3D — decorColliders.js
 * Collision for the environment kit parts that project into the open (corbels, buttresses, stair fragments, pipes, ...).
 * They were pure dressing: the player and the rope passed through them. LevelView plans where they stand (seeded, the same on
 * every device and kit tier); this module turns those placements into axis-aligned boxes for the sim:
 *
 *   instanceBoxes(part, elements, out)    the part's compound boxes (data/decor-parts-3d.js, generated from the kit by
 *                                         tools/abyssal-tether-3d/bake/decor_part_boxes.mjs) through the placement matrix
 *   decorColliders(level, placements)     every accepted box, as solid-like objects for Level3D.addDecorColliders
 *
 * Only placements with an axis-aligned frame collide (a part turned by a random angle, like a cog, would need an oriented box),
 * and a placement is dropped as a whole — it stays dressing — when a box could take something away from the player:
 *   - a grapple anchor, a climb grip or edge hold, a checkpoint, the spawn, the goal or the gate within reach of it,
 *   - a hazard right next to it,
 *   - the headroom above a ledge or floor slab (a box there would block a walkway).
 * Pure functions (no three.js, no DOM): Node-testable.
 */
import { DECOR_PARTS } from '../data/decor-parts-3d.js';

const ANCHOR_CLEAR = 1.3; // metres from a grapple anchor to the nearest box face
const CLIMB_CLEAR = 0.3; // from a grip zone or a procedural edge hold (sim/climbEdges.js)
const POINT_CLEAR = 2.0; // from the spawn / a checkpoint / the goal
const HAZARD_CLEAR = 0.4;
const HEADROOM = 1.9; // the player's standing height: nothing may hang into the space above a walkable top
const LEDGE_MAX_H = 3; // solids thicker than this are walls, not ledges / floors
const LEDGE_MIN_SPAN = 0.7; // narrower tops are not walkways
const AXIS_EPS = 1e-3;

/** Is the frame of the 4x4 (column-major elements) a signed permutation of the axes (times its scale)? */
export function isAxisAligned(e) {
  for (const o of [0, 4, 8]) {
    const v = [Math.abs(e[o]), Math.abs(e[o + 1]), Math.abs(e[o + 2])];
    const m = Math.max(v[0], v[1], v[2]);
    if (m < 1e-6) return false;
    let big = 0;
    for (const x of v) {
      if (x > AXIS_EPS * m) big++; // the axis itself, plus anything over 0.1 % of it (a second axis: not aligned)
    }
    if (big !== 1) return false;
  }
  return true;
}

/**
 * The world boxes of one placement of `part` (kit part name without the ch1_env_ prefix), appended to `out` as
 * [minX, minY, minZ, maxX, maxY, maxZ]. Nothing for a part that does not collide or a frame that is not axis aligned.
 * @returns {number} boxes appended
 */
export function instanceBoxes(part, e, out) {
  const local = DECOR_PARTS[part];
  if (!local || !isAxisAligned(e)) return 0;
  for (const b of local) {
    let x0 = Infinity;
    let y0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    let z1 = -Infinity;
    for (let c = 0; c < 8; c++) {
      const x = c & 1 ? b[3] : b[0];
      const y = c & 2 ? b[4] : b[1];
      const z = c & 4 ? b[5] : b[2];
      const wx = e[0] * x + e[4] * y + e[8] * z + e[12];
      const wy = e[1] * x + e[5] * y + e[9] * z + e[13];
      const wz = e[2] * x + e[6] * y + e[10] * z + e[14];
      if (wx < x0) x0 = wx;
      if (wx > x1) x1 = wx;
      if (wy < y0) y0 = wy;
      if (wy > y1) y1 = wy;
      if (wz < z0) z0 = wz;
      if (wz > z1) z1 = wz;
    }
    out.push([x0, y0, z0, x1, y1, z1]);
  }
  return local.length;
}

function boxDistToPoint(b, x, y, z) {
  const dx = Math.max(b[0] - x, 0, x - b[3]);
  const dy = Math.max(b[1] - y, 0, y - b[4]);
  const dz = Math.max(b[2] - z, 0, z - b[5]);
  return Math.hypot(dx, dy, dz);
}

function boxesOverlapBox(b, s, pad) {
  return !(b[0] > s.maxX + pad || b[3] < s.minX - pad || b[1] > s.maxY + pad || b[4] < s.minY - pad || b[2] > s.maxZ + pad || b[5] < s.minZ - pad);
}

/** Is a placement (its boxes) safe to make solid? `ctx` comes from makeContext(level). */
export function acceptable(boxes, ctx) {
  for (const b of boxes) {
    for (const a of ctx.anchors) if (boxDistToPoint(b, a.x, a.y, a.z) < ANCHOR_CLEAR) return false;
    for (const p of ctx.points) if (boxDistToPoint(b, p.x, p.y, p.z) < POINT_CLEAR) return false;
    for (const c of ctx.climb) if (boxesOverlapBox(b, c, CLIMB_CLEAR)) return false;
    for (const c of ctx.edges) if (boxesOverlapBox(b, c, CLIMB_CLEAR)) return false;
    for (const h of ctx.hazards) if (boxesOverlapBox(b, h, HAZARD_CLEAR)) return false;
    if (ctx.gate && boxesOverlapBox(b, ctx.gate, 1.0)) return false;
    if (ctx.goal && boxesOverlapBox(b, ctx.goal, 1.0)) return false;
    // walkways: the headroom volume over the top of every ledge / floor slab
    for (const s of ctx.ledges) {
      if (b[0] > s.maxX || b[3] < s.minX || b[2] > s.maxZ || b[5] < s.minZ) continue;
      if (b[1] < s.maxY + HEADROOM && b[4] > s.maxY + 0.02) return false;
    }
  }
  return true;
}

/** The level facts the rules read, flattened once. */
export function makeContext(level) {
  const points = [];
  if (level.spawn) points.push(level.spawn);
  for (const s of level.sections || []) if (s && s.checkpoint) points.push(s.checkpoint);
  const ledges = [];
  for (const s of level.solids || []) {
    if (s.active === false || s.tag === 'decor') continue;
    if (s.maxY - s.minY > LEDGE_MAX_H) continue;
    if (s.maxX - s.minX < LEDGE_MIN_SPAN || s.maxZ - s.minZ < LEDGE_MIN_SPAN) continue;
    ledges.push(s);
  }
  return {
    anchors: level.anchors || [],
    points,
    climb: level.climb || [],
    edges: level.edges || [],
    hazards: level.hazards || [],
    gate: level.gate || null,
    goal: level.goal || null,
    ledges,
  };
}

/**
 * The accepted collision boxes for a list of kit placements.
 * @param {object} level  Level3D (anchors, climb, hazards, solids, spawn, sections, gate, goal)
 * @param {{part: string, m: {elements: number[]}}[]} placements  LevelView's kit plan (part names with the ch1_env_ prefix)
 * @returns {{boxes: number[][], stats: {placements: number, accepted: number, rejected: number, skipped: number}}}
 */
export function decorColliders(level, placements) {
  const ctx = makeContext(level);
  const boxes = [];
  const stats = { placements: 0, accepted: 0, rejected: 0, skipped: 0 };
  const tmp = [];
  for (const it of placements) {
    const part = String(it.part).replace(/^ch1_env_/, '');
    if (!DECOR_PARTS[part]) continue;
    stats.placements++;
    tmp.length = 0;
    if (!instanceBoxes(part, it.m.elements, tmp)) {
      stats.skipped++;
      continue;
    }
    if (!acceptable(tmp, ctx)) {
      stats.rejected++;
      continue;
    }
    stats.accepted++;
    for (const b of tmp) boxes.push(b);
  }
  return { boxes, stats };
}
