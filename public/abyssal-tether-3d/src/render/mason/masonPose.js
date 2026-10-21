/* ABYSSAL TETHER 3D — mason/masonPose.js
 * Pose maths for the rigged Mason, three-free and allocation-free (typed arrays, scalar maths): the spine frames from the sim
 * body, the head scale per section (the new crown is ~11 m tall at kit scale: it must fit the tight shafts), and the leg IK
 * (analytic 2-bone: femur + the rigid shank / metatarsus / grapnel, solved onto the sim's planted feet or the follower gait).
 * Conventions (glTF / three): X right, Y dorsal, Z backward (the head faces -Z); every bone is identity-oriented at rest.
 */

export const HUG = 1.45; // CREATURE_TUNING.hug: the head's height above the surface while crawling
export const BODY_SCALE = 1.15; // world metres per kit metre at the shoulders (the sim's 1.5 m link / the rest pitch 1.24, a touch under)

function len3(x, y, z) {
  return Math.sqrt(x * x + y * y + z * z);
}
export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Head scale for the creature's current section: tight shafts (S5 is 18 m across) shrink the 11 m crown. */
export function sectionHeadScale(creature) {
  let w = 60;
  const lv = creature && creature.level;
  const secs = lv && lv.sections;
  const i = creature && creature.sectionIndex;
  if (secs && i >= 0 && secs[i] && secs[i].shaft) {
    const s = secs[i].shaft;
    w = Math.min(s.maxX - s.minX, s.maxZ - s.minZ);
  }
  return clamp(0.036 * w, 0.58, 0.9);
}

/** How far the crown is lifted off the spine axis so the dropped ventral slab does not bury itself in the wall. */
export function headLift(hs) {
  return clamp(3.14 * hs - HUG + 0.45, 0, 0.95);
}

/**
 * Spine frames from the sim body: for point i, F[i*12 ..] = pos(3), forward(3), up(3), right(3). The crown (i = 0) uses
 * body.head. Same maths as CreatureView.
 */
export function computeFrames(B, SEG, F) {
  const sp = B.spine;
  for (let i = 0; i < SEG; i++) {
    let fx;
    let fy;
    let fz;
    if (i === 0) {
      fx = B.head.fx;
      fy = B.head.fy;
      fz = B.head.fz;
    } else {
      const a = i - 1;
      const c = Math.min(SEG - 1, i + 1);
      fx = sp[a * 3] - sp[c * 3];
      fy = sp[a * 3 + 1] - sp[c * 3 + 1];
      fz = sp[a * 3 + 2] - sp[c * 3 + 2];
    }
    let l = len3(fx, fy, fz) || 1;
    fx /= l;
    fy /= l;
    fz /= l;
    let ux = i === 0 ? B.head.ux : B.up[i * 3];
    let uy = i === 0 ? B.head.uy : B.up[i * 3 + 1];
    let uz = i === 0 ? B.head.uz : B.up[i * 3 + 2];
    const d = ux * fx + uy * fy + uz * fz;
    ux -= fx * d;
    uy -= fy * d;
    uz -= fz * d;
    l = len3(ux, uy, uz);
    if (l < 1e-4) {
      ux = Math.abs(fy) < 0.9 ? 0 : 1;
      uy = Math.abs(fy) < 0.9 ? 1 : 0;
      uz = 0;
      const d2 = ux * fx + uy * fy + uz * fz;
      ux -= fx * d2;
      uy -= fy * d2;
      uz -= fz * d2;
      l = len3(ux, uy, uz) || 1;
    }
    ux /= l;
    uy /= l;
    uz /= l;
    const o = i * 12;
    F[o] = i === 0 ? B.head.x : sp[i * 3];
    F[o + 1] = i === 0 ? B.head.y : sp[i * 3 + 1];
    F[o + 2] = i === 0 ? B.head.z : sp[i * 3 + 2];
    F[o + 3] = fx;
    F[o + 4] = fy;
    F[o + 5] = fz;
    F[o + 6] = ux;
    F[o + 7] = uy;
    F[o + 8] = uz;
    F[o + 9] = fy * uz - fz * uy;
    F[o + 10] = fz * ux - fx * uz;
    F[o + 11] = fx * uy - fy * ux;
  }
}

// ---- 3x3 helpers (row-major arrays of 9; columns are the images of the local axes) --------------------------------------------
/** Frame with columns (d, m, d x m): d unit, m = n made perpendicular to d. Returns false when degenerate. */
export function frame(out, dx, dy, dz, nx, ny, nz) {
  const k = nx * dx + ny * dy + nz * dz;
  let mx = nx - dx * k;
  let my = ny - dy * k;
  let mz = nz - dz * k;
  const l = len3(mx, my, mz);
  if (l < 1e-5) return false;
  mx /= l;
  my /= l;
  mz /= l;
  // columns
  out[0] = dx;
  out[3] = dy;
  out[6] = dz;
  out[1] = mx;
  out[4] = my;
  out[7] = mz;
  out[2] = dy * mz - dz * my;
  out[5] = dz * mx - dx * mz;
  out[8] = dx * my - dy * mx;
  return true;
}

/** out = A * diag(sx, sy, sz) * B^T  (all 3x3 row-major). */
export function frameMap(out, A, sx, sy, sz, Bm) {
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out[r * 3 + c] = A[r * 3] * sx * Bm[c * 3] + A[r * 3 + 1] * sy * Bm[c * 3 + 1] + A[r * 3 + 2] * sz * Bm[c * 3 + 2];
    }
  }
}

/** out = A * B (3x3). `out` must not alias A or B. */
export function mul3(out, A, Bm) {
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) out[r * 3 + c] = A[r * 3] * Bm[c] + A[r * 3 + 1] * Bm[3 + c] + A[r * 3 + 2] * Bm[6 + c];
  }
}

/** Rotation matrix (row-major) of the unit quaternion (x, y, z, w). */
export function quat3(out, x, y, z, w) {
  out[0] = 1 - 2 * (y * y + z * z);
  out[1] = 2 * (x * y - z * w);
  out[2] = 2 * (x * z + y * w);
  out[3] = 2 * (x * y + z * w);
  out[4] = 1 - 2 * (x * x + z * z);
  out[5] = 2 * (y * z - x * w);
  out[6] = 2 * (x * z - y * w);
  out[7] = 2 * (y * z + x * w);
  out[8] = 1 - 2 * (x * x + y * y);
}

/** Writes a bone's world matrix from a row-major 3x3 and a position (three's Matrix4 elements are column-major). */
export function setWorld(e, m3, px, py, pz) {
  e[0] = m3[0];
  e[1] = m3[3];
  e[2] = m3[6];
  e[3] = 0;
  e[4] = m3[1];
  e[5] = m3[4];
  e[6] = m3[7];
  e[7] = 0;
  e[8] = m3[2];
  e[9] = m3[5];
  e[10] = m3[8];
  e[11] = 0;
  e[12] = px;
  e[13] = py;
  e[14] = pz;
  e[15] = 1;
}

/**
 * Two-bone solve. Inputs: hip (hx,hy,hz), target (tx,ty,tz), lengths a (hip-knee), b (knee-tip) in world metres, the pole
 * hint (px,py,pz) (a direction the knee prefers). Writes into out: [kneeX, kneeY, kneeZ, stretch, tipX, tipY, tipZ].
 * The foot is allowed to stretch the chain up to `maxStretch`; beyond that the tip falls short of the target (it slides).
 */
export function solve2(out, hx, hy, hz, tx, ty, tz, a0, b0, px, py, pz, maxStretch) {
  let dx = tx - hx;
  let dy = ty - hy;
  let dz = tz - hz;
  const dist = len3(dx, dy, dz);
  if (dist < 1e-4) {
    dx = 0;
    dy = -1;
    dz = 0;
  } else {
    dx /= dist;
    dy /= dist;
    dz /= dist;
  }
  let a = a0;
  let b = b0;
  let stretch = 1;
  if (dist > (a0 + b0) * 0.995) {
    stretch = Math.min(maxStretch, dist / ((a0 + b0) * 0.995));
    a *= stretch;
    b *= stretch;
  }
  const D2 = clamp(dist, Math.abs(a - b) * 1.01 + 1e-3, (a + b) * 0.999);
  const cosA = clamp((a * a + D2 * D2 - b * b) / (2 * a * D2), -1, 1);
  const along = a * cosA;
  const perp = Math.sqrt(Math.max(0, a * a - along * along));
  let qx = px;
  let qy = py;
  let qz = pz;
  const pd = qx * dx + qy * dy + qz * dz;
  qx -= dx * pd;
  qy -= dy * pd;
  qz -= dz * pd;
  let ql = len3(qx, qy, qz);
  if (ql < 1e-4) {
    qx = Math.abs(dy) < 0.9 ? 0 : 1;
    qy = Math.abs(dy) < 0.9 ? 1 : 0;
    qz = 0;
    const d2 = qx * dx + qy * dy + qz * dz;
    qx -= dx * d2;
    qy -= dy * d2;
    qz -= dz * d2;
    ql = len3(qx, qy, qz) || 1;
  }
  qx /= ql;
  qy /= ql;
  qz /= ql;
  out[0] = hx + dx * along + qx * perp;
  out[1] = hy + dy * along + qy * perp;
  out[2] = hz + dz * along + qz * perp;
  out[3] = stretch;
  // the tip: along the lower bone toward the target, at its stretched length
  const lx = tx - out[0];
  const ly = ty - out[1];
  const lz = tz - out[2];
  const ll = len3(lx, ly, lz) || 1;
  out[4] = out[0] + (lx / ll) * b;
  out[5] = out[1] + (ly / ll) * b;
  out[6] = out[2] + (lz / ll) * b;
}
