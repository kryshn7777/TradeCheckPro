/* THE LANTERN (ABYSSAL TETHER 3D) — sim/releasePredict.js
 * "If I let go now": the ballistic path of the body if the held rope were released this instant, for the release guide
 * (render/releaseGuide.js). Pure maths over the level's ray query: no three.js, no DOM, no allocation per call.
 *
 * The flight is integrated with the SAME free-body forces as Physics3D.step (sim/physics3d.js) when no rope is attached:
 *   gravity, the linear horizontal air brake (airDrag), the quadratic drag (dragQuad, implicit), the maxFallSpeed clamp and the
 *   global maxSpeed clamp, semi-implicit Euler, on substeps of RELEASE_PREDICT.dt / RELEASE_PREDICT.sub (20 ms against the game's
 *   4.17 ms: about 0.1 m apart after a second of flight). Air control is not modelled (the stick steers at most airAccel = 7 m/s^2
 *   toward airMaxSpeed: the arc is the hands-off path).
 * The release boost of TetherSystem.release is applied first (x releaseBoost above releaseBoostMinSpeed, only when the other hand
 * holds no line: a full let-go).
 * Only a FULL release is predicted. When the other hand still holds a line (or has a hook in flight) the body stays on that rope
 * after the release: a pendulum with a slip clutch, not a ballistic path. Then nothing is predicted (out.n = 0, out.reason 'other').
 * The path stops at the first active solid the body's centre line meets (level.raycast, extended by the body radius so a floor is
 * met when the sphere touches it), at most RELEASE_PREDICT.horizon seconds ahead.
 * The impact is judged like Physics3D.resolveCollisions: on a floor-ish face (normal y > lethalNormalY) by the larger of the normal
 * speed and the pre-contact fall speed weighted by how floor-like the face is, against diff.lethalImpact; on a wall by the wall
 * damage (sim/health3d.js wallDamage) reaching a whole health bar. Wind squalls are not modelled (the caller hides the guide).
 */
import { CONFIG } from './config3d.js';
import { wallDamage } from './health3d.js';

export const RELEASE_PREDICT = {
  dt: 0.08, // s between two points of the path
  sub: 4, // integration substeps per point
  horizon: 2.4, // s looked ahead at most
};
export const RELEASE_MAX_POINTS = Math.round(RELEASE_PREDICT.horizon / RELEASE_PREDICT.dt) + 1;

/** A reusable result for predictRelease (allocate once, pass it every call). */
export function createReleaseOut() {
  return {
    points: new Float32Array(RELEASE_MAX_POINTS * 3), // x, y, z of each point, the body's centre (points[0] = now)
    n: 0, // points written
    hit: null, // _hit when the path meets a solid, else null
    _hit: { x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, t: 0, solid: null },
    impactSpeed: 0, // m/s judged at the impact (0 without a hit)
    lethal: false, // the impact would kill (diff.impactsLethal and the lethal speed / a whole health bar of wall damage)
    boosted: false, // the release boost applies
    reason: '', // '' predicted · 'other' the other hand keeps a line (not predicted) · 'none' no body / level
    _ray: { t: 0, solid: null, x: 0, y: 0, z: 0 },
  };
}

function smoothstep(a, b, x) {
  const t = x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a);
  return t * t * (3 - 2 * t);
}

/** Outward normal of the face of box `s` nearest to the point (x, y, z) on its surface. Writes h.nx / ny / nz. */
function faceNormal(s, x, y, z, h) {
  let best = x - s.minX;
  h.nx = -1;
  h.ny = 0;
  h.nz = 0;
  let d = s.maxX - x;
  if (d < best) {
    best = d;
    h.nx = 1;
  }
  d = y - s.minY;
  if (d < best) {
    best = d;
    h.nx = 0;
    h.ny = -1;
  }
  d = s.maxY - y;
  if (d < best) {
    best = d;
    h.nx = 0;
    h.ny = 1;
  }
  d = z - s.minZ;
  if (d < best) {
    best = d;
    h.nx = 0;
    h.ny = 0;
    h.nz = -1;
  }
  d = s.maxZ - z;
  if (d < best) {
    h.nx = 0;
    h.ny = 0;
    h.nz = 1;
  }
}

/**
 * The path of the body `p` if the held line were let go now.
 * @param {object} p              the body: { x, y, z, vx, vy, vz, radius? }
 * @param {boolean} otherAttached the other hand holds a line (or has a hook in flight): not predicted
 * @param {object} level          Level3D (raycast)
 * @param {object} diff           difficulty preset (lethalImpact, impactsLethal, health.wallScale)
 * @param {object} out            createReleaseOut()
 * @returns {object} out
 */
export function predictRelease(p, otherAttached, level, diff, out) {
  out.n = 0;
  out.hit = null;
  out.impactSpeed = 0;
  out.lethal = false;
  out.boosted = false;
  out.reason = '';
  if (!p || !level || typeof level.raycast !== 'function') {
    out.reason = 'none';
    return out;
  }
  if (otherAttached) {
    out.reason = 'other';
    return out;
  }
  const P = CONFIG.player;
  const R = CONFIG.rope;
  const O = RELEASE_PREDICT;
  const pts = out.points;
  const rad = p.radius > 0 ? p.radius : P.radius;
  let x = p.x;
  let y = p.y;
  let z = p.z;
  let vx = p.vx || 0;
  let vy = p.vy || 0;
  let vz = p.vz || 0;
  // TetherSystem.release: the boost on a full let-go above releaseBoostMinSpeed
  if (Math.sqrt(vx * vx + vy * vy + vz * vz) > R.releaseBoostMinSpeed) {
    vx *= R.releaseBoost;
    vy *= R.releaseBoost;
    vz *= R.releaseBoost;
    out.boosted = true;
  }
  pts[0] = x;
  pts[1] = y;
  pts[2] = z;
  out.n = 1;
  const h = O.dt / O.sub;
  const kAir = Math.exp(-P.airDrag * h);
  const steps = RELEASE_MAX_POINTS - 1;
  const ray = out._ray;
  for (let i = 0; i < steps; i++) {
    const x0 = x;
    const y0 = y;
    const z0 = z;
    for (let s = 0; s < O.sub; s++) {
      // Physics3D.step, a free body in the air (no rope, no ground)
      vy -= P.gravity * h;
      vx *= kAir;
      vz *= kAir;
      if (P.dragQuad > 0) {
        const f = 1 / (1 + P.dragQuad * Math.sqrt(vx * vx + vy * vy + vz * vz) * h);
        vx *= f;
        vy *= f;
        vz *= f;
      }
      if (vy < -P.maxFallSpeed) vy = -P.maxFallSpeed;
      const sp = Math.sqrt(vx * vx + vy * vy + vz * vz);
      if (sp > P.maxSpeed) {
        const k = P.maxSpeed / sp;
        vx *= k;
        vy *= k;
        vz *= k;
      }
      x += vx * h;
      y += vy * h;
      z += vz * h;
    }
    const dx = x - x0;
    const dy = y - y0;
    const dz = z - z0;
    const seg = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (seg > 1e-6) {
      // the sphere touches a solid about one radius before its centre reaches it
      const hit = level.raycast(x0, y0, z0, dx, dy, dz, seg + rad, ray);
      if (hit && hit.solid) {
        const H = out._hit;
        H.x = hit.x;
        H.y = hit.y;
        H.z = hit.z;
        H.solid = hit.solid;
        H.t = (i + Math.min(1, hit.t / seg)) * O.dt;
        faceNormal(hit.solid, hit.x, hit.y, hit.z, H);
        // the path ends where the sphere's surface meets the face
        const back = Math.max(0, hit.t - rad) / seg;
        pts[out.n * 3] = x0 + dx * back;
        pts[out.n * 3 + 1] = y0 + dy * back;
        pts[out.n * 3 + 2] = z0 + dz * back;
        out.n++;
        out.hit = H;
        judgeImpact(vx, vy, vz, H, diff, out);
        return out;
      }
    }
    pts[out.n * 3] = x;
    pts[out.n * 3 + 1] = y;
    pts[out.n * 3 + 2] = z;
    out.n++;
  }
  return out;
}

/** Physics3D.resolveCollisions' judgement of an impact at velocity (vx, vy, vz) on the face of `H`. */
function judgeImpact(vx, vy, vz, H, diff, out) {
  const P = CONFIG.player;
  const vn = -(vx * H.nx + vy * H.ny + vz * H.nz);
  const impact = vn > 0 ? vn : 0;
  const lethalSpeed = diff && diff.lethalImpact > 0 ? diff.lethalImpact : 17;
  const lethalOn = !diff || diff.impactsLethal !== false;
  if (H.ny > P.lethalNormalY) {
    const fall = Math.max(0, -vy) * smoothstep(P.lethalNormalY, 0.75, H.ny);
    out.impactSpeed = Math.max(impact, fall);
    out.lethal = lethalOn && out.impactSpeed >= lethalSpeed;
  } else {
    out.impactSpeed = impact;
    const scale = diff && diff.health && diff.health.wallScale > 0 ? diff.health.wallScale : 1;
    out.lethal = lethalOn && wallDamage(impact, lethalSpeed, scale) >= 1;
  }
  return out;
}
