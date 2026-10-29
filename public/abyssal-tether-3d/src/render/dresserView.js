/* ABYSSAL TETHER 3D — dresserView.js
 * THE DRESSER (sim/dresser3d.js), drawn: a 3.2 m Lanternwright mason standing sideways on the wall, its up the wall's normal.
 * Everything is built here in code (no asset): a hooded robe and a chalk-dusted leather apron, a deep peaked hood, a split
 * saint mask (two pale half-faces on a vertical seam, slit eyes with a faint cold glow), two long segmented chisel arms out of
 * ragged sleeves, two small grey hands paying out a measuring line, long bare feet. One skinned mesh per level of detail, one
 * skeleton (31 bones) animated procedurally: breathing, a slow walk on the wall with the robe swaying, the measuring pose (the
 * chisels spread like dividers, the line taut to your ring), the saw, the spoiled pose (mask turned away, arms folded), the
 * stagger. The measuring line is part of the skinned mesh (a bone at its far end), so the whole creature is ONE draw call.
 *
 *   DresserView(game)      game: { renderer.scene, renderer.camera, renderer.qualityTier, dresser.body, settings }
 *   .update(dt, game)      once per frame (Game3D._updateViews)
 *   .info                  { drawCalls, triangles } of what it draws this frame (the debug API, the budget harness)
 *   .dispose()
 *
 * Budget: near LOD <= 12 k triangles, far LOD <= 4.5 k (switch at LOD_DIST[tier], hysteresis 3 m), beyond GLOW_DIST only the
 * two eye glints (one tiny additive mesh), hidden when the sim is out of play. The chalk outline of you is a quad of the same
 * skinned mesh on its own bone (alpha-dithered from the outline texture), so measuring costs no extra call. The material is the level's lit patch (materials.js patchMaterial: lantern, baked GI, wet
 * film, the horror grade) plus: a cold glow on the slits and the line (piercing the fog), a faint pale self-light on the mask so
 * the face reads in the dark, a fog cap so the silhouette survives the haze, and the near-eye dissolve.
 */
import * as THREE from 'three';
import { patchMaterial } from './materials.js';

/** LOD switch distance (m, camera to its chest) per quality tier, and where it becomes only two cold glints. The far LOD keeps the
 * silhouette, the split mask and the slits (~4.4 k triangles), so on Quest the full mesh is only for when it is close to you. */
export const LOD_DIST = { low: 10, quest: 12, high: 45 }; // Quest: the mid LOD from 12 m (THE CORRIDOR with skitterlings in view)
export const GLOW_DIST = 60;
const LOD_HYST = 3;
const GLOW_COL = new THREE.Color(0.55, 0.78, 1.0);

// ---------------------------------------------------------------------------------------------------------------------
// Skeleton (bind pose: the creature's own frame, +Y its up (away from the wall), +Z the way it faces, +X its left)
// ---------------------------------------------------------------------------------------------------------------------
export const BONES = [
  // [name, parent, x, y, z] (bind-pose positions in the creature's frame)
  ['root', -1, 0, 0, 0],
  ['hips', 0, 0, 1.52, 0],
  ['spine', 1, 0, 1.9, 0],
  ['chest', 2, 0, 2.3, 0],
  ['neck', 3, 0, 2.64, 0],
  ['head', 4, 0, 2.84, 0.01],
  ['upperArmL', 3, 0.31, 2.56, 0],
  ['foreArmL', 6, 0.31, 1.84, 0],
  ['chiselL', 7, 0.31, 1.15, 0],
  ['upperArmR', 3, -0.31, 2.56, 0],
  ['foreArmR', 9, -0.31, 1.84, 0],
  ['chiselR', 10, -0.31, 1.15, 0],
  ['smallUpperL', 2, 0.12, 2.06, 0.17],
  ['smallForeL', 12, 0.12, 1.81, 0.17],
  ['smallUpperR', 2, -0.12, 2.06, 0.17],
  ['smallForeR', 14, -0.12, 1.81, 0.17],
  ['thighL', 1, 0.12, 1.48, 0],
  ['shinL', 16, 0.12, 0.78, 0],
  ['footL', 17, 0.12, 0.08, 0],
  ['thighR', 1, -0.12, 1.48, 0],
  ['shinR', 19, -0.12, 0.78, 0],
  ['footR', 20, -0.12, 0.08, 0],
  ['skirtF1', 1, 0, 1.46, 0.2],
  ['skirtF2', 22, 0, 0.85, 0.27],
  ['skirtL1', 1, 0.24, 1.46, 0],
  ['skirtL2', 24, 0.33, 0.85, 0],
  ['skirtB1', 1, 0, 1.46, -0.2],
  ['skirtB2', 26, 0, 0.85, -0.27],
  ['skirtR1', 1, -0.24, 1.46, 0],
  ['skirtR2', 28, -0.33, 0.85, 0],
  ['lineEnd', 0, -0.12, 1.53, 0.2],
  ['chalk', 0, 0, 0, 0], // the chalk outline of you, on the wall beside you (placed in update; collapsed when there is none)
];
const B = Object.fromEntries(BONES.map((b, i) => [b[0], i]));
const HAND_TIP_L = [0.12, 1.53, 0.2]; // bind-pose fingertips of the small left hand: the line starts here
const LEGS = [
  [B.thighL, B.shinL, B.footL, 1],
  [B.thighR, B.shinR, B.footR, -1],
];
const ARMS = [
  [B.upperArmL, B.foreArmL, B.chiselL, 1],
  [B.upperArmR, B.foreArmR, B.chiselR, -1],
];

// ---------------------------------------------------------------------------------------------------------------------
// Small math / noise helpers (deterministic)
// ---------------------------------------------------------------------------------------------------------------------
function hash(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function noise1(x, seed = 0) {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return (hash(i + seed * 57) * 2 - 1) * (1 - u) + (hash(i + 1 + seed * 57) * 2 - 1) * u;
}
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------------------------------------------------------------
// Geometry builder: parts with per-vertex colour (rgb + roughness in a), fx (x eye glow, y pale self-light) and skin
// ---------------------------------------------------------------------------------------------------------------------
class Builder {
  constructor() {
    this.pos = [];
    this.nrm = [];
    this.col = [];
    this.fx = [];
    this.si = [];
    this.sw = [];
    this.ch = [];
    this.idx = [];
    this.n = 0;
  }

  /**
   * Adds a part. `p` flat positions, `ix` triangle indices (local), `paint(x,y,z,k) -> [r,g,b,rough, glow, pale]`,
   * `skin(x,y,z,k) -> [[bone, w], ...]` (<= 4). Normals are computed per part (smooth).
   */
  add(p, ix, paint, skin, chalk = 0) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.setIndex(ix);
    g.computeVertexNormals();
    const nr = g.attributes.normal.array;
    const n = p.length / 3;
    for (let k = 0; k < n; k++) {
      const x = p[k * 3];
      const y = p[k * 3 + 1];
      const z = p[k * 3 + 2];
      this.pos.push(x, y, z);
      this.nrm.push(nr[k * 3], nr[k * 3 + 1], nr[k * 3 + 2]);
      const c = paint(x, y, z, k);
      this.col.push(c[0], c[1], c[2], c[3]);
      this.fx.push(c[4] || 0, c[5] || 0);
      this.ch.push(chalk);
      const w = skin(x, y, z, k);
      let tot = 0;
      for (let j = 0; j < 4; j++) tot += w[j] ? w[j][1] : 0;
      for (let j = 0; j < 4; j++) {
        this.si.push(w[j] ? w[j][0] : 0);
        this.sw.push(w[j] && tot > 0 ? w[j][1] / tot : 0);
      }
    }
    for (let i = 0; i < ix.length; i++) this.idx.push(ix[i] + this.n);
    this.n += n;
    g.dispose();
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 4));
    g.setAttribute('aFx', new THREE.Float32BufferAttribute(this.fx, 2));
    g.setAttribute('aChalk', new THREE.Float32BufferAttribute(this.ch, 1));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    g.setIndex(this.n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.7, 0), 2.2);
    return g;
  }
}

/** nu x nv grid of fn(u, v) -> [x, y, z] (u, v in [0, 1]); `wrap` closes it in u. Returns { p, ix }. */
function grid(nu, nv, fn, wrap = false) {
  const p = [];
  const ix = [];
  const cols = wrap ? nu : nu + 1;
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i < cols; i++) {
      const q = fn(i / nu, j / nv, i, j);
      p.push(q[0], q[1], q[2]);
    }
  }
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * cols + i;
      const b = j * cols + (wrap ? (i + 1) % nu : i + 1);
      const c = (j + 1) * cols + i;
      const d = (j + 1) * cols + (wrap ? (i + 1) % nu : i + 1);
      ix.push(a, c, b, b, c, d);
    }
  }
  return { p, ix };
}

/** A tube along the bind-pose segment a -> b (radius r(t), t 0..1 from a), `sides` round, `segs` long, capped at b. */
function tube(a, b, sides, segs, r) {
  const ax = b[0] - a[0];
  const ay = b[1] - a[1];
  const az = b[2] - a[2];
  const len = Math.hypot(ax, ay, az) || 1;
  const dx = ax / len;
  const dy = ay / len;
  const dz = az / len;
  // a frame perpendicular to the axis
  let ux = Math.abs(dy) < 0.9 ? 0 : 1;
  let uy = Math.abs(dy) < 0.9 ? 1 : 0;
  let uz = 0;
  const dot = ux * dx + uy * dy + uz * dz;
  ux -= dx * dot;
  uy -= dy * dot;
  uz -= dz * dot;
  const ul = Math.hypot(ux, uy, uz) || 1;
  ux /= ul;
  uy /= ul;
  uz /= ul;
  const vx = dy * uz - dz * uy;
  const vy = dz * ux - dx * uz;
  const vz = dx * uy - dy * ux;
  const g = grid(sides, segs, (u, v) => {
    const th = u * Math.PI * 2;
    const rr = r(v, th);
    const c = Math.cos(th) * rr;
    const s = Math.sin(th) * rr;
    return [a[0] + ax * v + ux * c + vx * s, a[1] + ay * v + uy * c + vy * s, a[2] + az * v + uz * c + vz * s];
  }, true);
  // cap at b
  const tip = g.p.length / 3;
  g.p.push(b[0], b[1], b[2]);
  const last = segs * sides;
  for (let i = 0; i < sides; i++) g.ix.push(last + i, tip, last + ((i + 1) % sides));
  return g;
}

/** An ellipsoid (lat-long) centred at c with radii rx, ry, rz. */
function blob(c, rx, ry, rz, nu, nv) {
  return grid(nu, nv, (u, v) => {
    const th = u * Math.PI * 2;
    const ph = v * Math.PI;
    return [c[0] + Math.sin(ph) * Math.cos(th) * rx, c[1] + Math.cos(ph) * ry, c[2] + Math.sin(ph) * Math.sin(th) * rz];
  }, true);
}

// ---------------------------------------------------------------------------------------------------------------------
// Paints (linear rgb, roughness, glow, pale)
// ---------------------------------------------------------------------------------------------------------------------
const ROBE = (x, y, z) => {
  const n = 0.75 + 0.25 * hash(Math.floor(x * 31) + Math.floor(y * 23) * 7 + Math.floor(z * 29) * 13);
  const wet = smooth(1.2, 0.1, y); // the hem is soaked
  return [0.062 * n * (1 - 0.3 * wet), 0.056 * n * (1 - 0.2 * wet), 0.052 * n, 0.85 - 0.3 * wet];
};
const HOOD_IN = () => [0.006, 0.006, 0.007, 0.9];
const SKIN = (x, y, z) => {
  const n = 0.85 + 0.15 * hash(Math.floor(x * 97) + Math.floor(y * 89) * 3 + Math.floor(z * 83) * 5);
  return [0.2 * n, 0.19 * n, 0.18 * n, 0.5, 0, 0.12]; // grey, dead, wet
};
const IRON = (x, y) => {
  const band = Math.abs(Math.sin(y * 21)) > 0.93 ? 0.55 : 1; // the joints between the segments
  return [0.085 * band, 0.083 * band, 0.088 * band, 0.45];
};
const rigid = (bone) => () => [[bone, 1]];

// ---------------------------------------------------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------------------------------------------------
/** Robe radius (around its axis) at height y, before folds; and a front-back depth factor. */
function robeR(y) {
  const P = [
    [2.66, 0.11],
    [2.6, 0.2],
    [2.5, 0.235],
    [2.3, 0.21],
    [2.0, 0.172],
    [1.74, 0.158],
    [1.5, 0.198],
    [1.0, 0.255],
    [0.5, 0.315],
    [0.0, 0.37],
  ];
  if (y >= P[0][0]) return P[0][1];
  for (let i = 1; i < P.length; i++) {
    if (y >= P[i][0]) {
      const t = (y - P[i][0]) / (P[i - 1][0] - P[i][0]);
      return lerp(P[i][1], P[i - 1][1], t);
    }
  }
  return P[P.length - 1][1];
}
/** Robe surface point at angle th (0 = front +Z, +PI/2 = left +X) and height y (no folds): used by the apron and belt. */
function robeAt(th, y, folds) {
  let r = robeR(y);
  if (folds) {
    const v = smooth(1.9, 0.2, y);
    r *= 1 + (0.025 + 0.07 * v) * Math.sin(9 * th + 1.7 * Math.sin(3 * th) + y * 0.8) + 0.03 * v * noise1(th * 5 + y * 2, 3);
  }
  const shoulder = smooth(2.3, 2.52, y) * (1 - smooth(2.58, 2.66, y));
  const xs = 1 + 0.14 * shoulder; // bony shoulders
  return [Math.sin(th) * r * xs, y, Math.cos(th) * r * 0.82];
}

function skirtWeights(x, y, z) {
  // angular: front 0, left PI/2, back PI, right -PI/2
  const th = Math.atan2(x, z);
  const cols = [
    [0, B.skirtF1, B.skirtF2],
    [0, B.skirtL1, B.skirtL2],
    [0, B.skirtB1, B.skirtB2],
    [0, B.skirtR1, B.skirtR2],
  ];
  // the two columns around th (0..2PI: 0 front, PI/2 left, PI back, 3PI/2 right)
  const t = ((th % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const seg = Math.floor(t / (Math.PI / 2)) % 4;
  const f = (t - seg * (Math.PI / 2)) / (Math.PI / 2);
  const wa = 1 - f;
  const wb = f;
  const ca = cols[seg];
  const cb = cols[(seg + 1) % 4];
  const v2 = smooth(1.05, 0.65, y); // lower segment share
  const hipsW = smooth(1.3, 1.56, y);
  if (hipsW > 0) {
    return [
      [B.hips, hipsW],
      [ca[1], wa * (1 - hipsW)],
      [cb[1], wb * (1 - hipsW)],
    ];
  }
  return [
    [ca[1], wa * (1 - v2)],
    [ca[2], wa * v2],
    [cb[1], wb * (1 - v2)],
    [cb[2], wb * v2],
  ];
}

function torsoWeights(x, y, z) {
  if (y < 1.56) return skirtWeights(x, y, z);
  const w = [];
  if (y < 1.9) {
    const t = smooth(1.56, 1.9, y);
    w.push([B.hips, 1 - t], [B.spine, t]);
  } else if (y < 2.3) {
    const t = smooth(1.9, 2.3, y);
    w.push([B.spine, 1 - t], [B.chest, t]);
  } else {
    w.push([B.chest, 1]);
  }
  // the shoulders follow the arms a little
  if (y > 2.38 && Math.abs(x) > 0.16) {
    const k = 0.35 * smooth(0.16, 0.3, Math.abs(x)) * smooth(2.38, 2.52, y);
    w.push([x > 0 ? B.upperArmL : B.upperArmR, k]);
  }
  if (y > 2.6) w.push([B.neck, smooth(2.6, 2.66, y) * 0.6]);
  return w;
}

/**
 * Builds the creature's geometry for a level of detail (0 near, 1 far). Pure (no DOM): Node tests count its triangles.
 * @returns {THREE.BufferGeometry}
 */
export function buildDresserGeometry(lod = 0) {
  const far = lod > 0;
  const Bd = new Builder();

  // ---- the robe (a tall column, cinched at the waist, deep folds, a ragged soaked hem) ----
  {
    const nu = far ? 30 : 46;
    const nv = far ? 17 : 30;
    const g = grid(nu, nv, (u, v) => {
      const th = u * Math.PI * 2;
      const hem = 0.13 + 0.06 * noise1(th * 3.1, 1) + 0.09 * Math.max(0, noise1(th * 7.3, 2)) * (Math.cos(th) < 0.6 ? 1 : 0.4);
      const y = lerp(2.66, hem, Math.pow(v, 0.92));
      return robeAt(th, y, true);
    }, true);
    Bd.add(g.p, g.ix, ROBE, torsoWeights);
  }

  // ---- the hood: a tall pointed cowl, a heavy lip shadowing the mask, a drape over the shoulders ----
  const HC = [0, 2.95, -0.03];
  {
    const nu = far ? 22 : 32;
    const nv = far ? 13 : 22;
    const a0 = 0.86; // half-angle of the face opening (around +Z)
    const PK = [0, 0.83, -0.56]; // the peak's direction (up and back)
    const g = grid(nu, nv, (u, v) => {
      const beta = u * Math.PI * 2; // around the forward axis, 0 = up
      const alpha = lerp(a0, Math.PI, Math.pow(v, 0.9)); // from the opening rim to the back
      const dx = Math.sin(alpha) * Math.sin(beta);
      const dy = Math.sin(alpha) * Math.cos(beta);
      const dz = Math.cos(alpha);
      let rx = 0.19;
      let ry = 0.29;
      let rz = 0.235;
      // the drape: the lower half reaches down over the neck and spreads on the shoulders
      if (dy < 0) {
        ry *= 1 + 0.85 * -dy;
        rx *= 1 + 0.45 * -dy * -dy;
      }
      let x = HC[0] + dx * rx;
      let y = HC[1] + dy * ry;
      let z = HC[2] + dz * rz;
      // the peak: a tall point, up and back (the silhouette's crown)
      const cosP = dx * PK[0] + dy * PK[1] + dz * PK[2];
      const pk = Math.pow(Math.max(0, cosP), 9);
      y += pk * 0.36;
      z -= pk * 0.2;
      // the rim of the opening: a heavy lip pulled forward and in
      const rim = smooth(a0 + 0.4, a0, alpha);
      z += rim * 0.085;
      x *= 1 - rim * 0.1;
      y += rim * (dy > 0 ? 0.02 : -0.01);
      // cloth wrinkles and a sag of the lip
      const wr = 0.01 * noise1(beta * 6 + alpha * 3, 5) + 0.012 * rim * Math.sin(beta * 5);
      return [x + dx * wr, y + dy * wr, z + dz * wr];
    }, true);
    Bd.add(
      g.p,
      g.ix,
      (x, y, z) => {
        // darker toward the inside of the opening (one double-sided shell: the lit outside, the void you look into)
        const c = ROBE(x, y, z);
        const inner = smooth(0.0, 0.17, z) * smooth(0.19, 0.09, Math.hypot(x, (y - HC[1]) * 0.7));
        return [c[0] * (1 - 0.85 * inner), c[1] * (1 - 0.85 * inner), c[2] * (1 - 0.85 * inner), c[3]];
      },
      (x, y) => {
        if (y > 2.76) return [[B.head, 1]];
        const t = smooth(2.5, 2.76, y);
        return [
          [B.head, t],
          [B.neck, (1 - t) * 0.6],
          [B.chest, (1 - t) * 0.4],
        ];
      },
    );
    // the void inside the hood behind the mask (black, so the seam and the slits read as holes)
    const vb = blob([0, 2.94, -0.04], 0.15, 0.24, 0.12, far ? 8 : 12, far ? 5 : 8);
    Bd.add(vb.p, vb.ix, HOOD_IN, rigid(B.head));
  }

  // ---- the split saint mask: two pale half-faces on a vertical seam, closed slit eyes ----
  {
    const MC = [0, 2.93, 0.085];
    const HW = 0.112;
    const HH = 0.205;
    const nu = far ? 7 : 11;
    const nv = far ? 18 : 30;
    const halfW = (v) => HW * (v > 0.15 ? Math.pow(Math.max(0, 1 - Math.pow((v - 0.15) / 0.85, 2)), 0.42) : 1 - 0.58 * Math.pow((0.15 - v) / 1.15, 1.6));
    const g2 = (u, v, cu, cv, su, sv) => Math.exp(-(Math.pow((u - cu) / su, 2) + Math.pow((v - cv) / sv, 2)));
    const depth = (u, v) => {
      let d = 0.074 * Math.pow(Math.max(0, 1 - u * u), 0.6) * (1 - 0.3 * v * v);
      d += 0.008 * g2(u, v, 0, 0.55, 0.7, 0.2); // the forehead
      d += 0.011 * Math.exp(-Math.pow((v - 0.3) / 0.06, 2)) * (1 - 0.7 * Math.abs(u)); // the brow
      d -= 0.024 * g2(u, v, 0.42, 0.16, 0.22, 0.09); // the eye sockets
      d += 0.03 * Math.exp(-Math.pow(u / 0.14, 2)) * smooth(0.28, 0.08, v) * smooth(-0.36, -0.2, v) * (1 + 0.5 * smooth(0.0, -0.25, v)); // the nose
      d += 0.012 * g2(u, v, 0, -0.27, 0.12, 0.05); // its tip
      d -= 0.008 * g2(u, v, 0.12, -0.33, 0.08, 0.035); // the nostrils
      d += 0.01 * g2(u, v, 0.62, -0.04, 0.2, 0.12); // the cheekbones
      d -= 0.012 * g2(u, v, 0.55, -0.42, 0.18, 0.14); // the hollow cheeks
      d -= 0.006 * Math.exp(-Math.pow((v + 0.52) / 0.018, 2)) * smooth(0.4, 0.2, u); // the closed mouth
      d += 0.005 * g2(u, v, 0, -0.47, 0.32, 0.03); // the upper lip
      d += 0.006 * g2(u, v, 0, -0.58, 0.28, 0.04); // the lower lip
      d += 0.009 * g2(u, v, 0, -0.84, 0.35, 0.08); // the chin
      return d;
    };
    const paintMask = (side, rot, dy0) => (x, y) => {
      // undo the half's offset to read (u, v)
      const yy = y - MC[1] - dy0;
      const xr = x * Math.cos(-rot) - yy * Math.sin(-rot);
      const yr = x * Math.sin(-rot) + yy * Math.cos(-rot);
      const v = clamp(yr / HH, -1, 1);
      const u = Math.min(1, Math.abs(xr) / Math.max(0.02, halfW(v)));
      let k = 0.9 + 0.1 * hash(Math.floor(x * 400) * 3 + Math.floor(y * 300) * 7 + side);
      k *= 1 - 0.6 * g2(u, v, 0.44, 0.15, 0.25, 0.11); // the socket shadow
      k *= 1 - 0.55 * smooth(0.1, 0.0, u); // the seam's dark lip
      // tears of grime from the slits (wet: lower roughness)
      const tear = Math.exp(-Math.pow((u - 0.47) / 0.045, 2)) * smooth(0.12, 0.03, v) * smooth(-0.8, -0.25, v);
      k *= 1 - 0.6 * tear;
      k *= 1 - 0.3 * smooth(0.8, 1, u); // the edge
      k *= 1 - 0.35 * Math.exp(-Math.pow((v + 0.52) / 0.02, 2)) * smooth(0.4, 0.2, u); // the mouth line
      return [0.7 * k, 0.67 * k, 0.6 * k, 0.36 - 0.2 * tear, 0, 1]; // old ivory, not paper white
    };
    for (const side of [1, -1]) {
      // the misaligned halves: the left one dropped, pushed out and turned a little on the seam
      const rot = side > 0 ? -0.05 : 0.015;
      const dy = side > 0 ? -0.022 : 0.006;
      const dz = side > 0 ? 0.01 : 0;
      const place = (x, y, z) => [x * Math.cos(rot) - y * Math.sin(rot), MC[1] + x * Math.sin(rot) + y * Math.cos(rot) + dy, z + dz];
      const g = grid(nu, nv, (uu, vv) => {
        const u = lerp(0.03, 1, Math.pow(uu, 1.15));
        const v = lerp(1, -1, vv);
        return place(side * u * halfW(v), HH * v, MC[2] + depth(u, v));
      });
      if (side < 0) for (let k = 0; k < g.ix.length; k += 3) [g.ix[k + 1], g.ix[k + 2]] = [g.ix[k + 2], g.ix[k + 1]];
      Bd.add(g.p, g.ix, paintMask(side, rot, dy), rigid(B.head));
      // the seam's edge: a thin dark wall along the cut, so the split reads from the side too
      {
        const ep = [];
        const ei = [];
        const n = far ? 10 : 16;
        for (let i = 0; i <= n; i++) {
          const v = lerp(1, -1, i / n);
          const u = 0.03;
          const z = MC[2] + depth(u, v);
          ep.push(...place(side * u * halfW(v), HH * v, z), ...place(side * u * halfW(v), HH * v, z - 0.03));
        }
        for (let i = 0; i < n; i++) {
          const a = i * 2;
          ei.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
        }
        Bd.add(ep, ei, () => [0.05, 0.045, 0.04, 0.6, 0, 0], rigid(B.head));
      }
      // the slit eye: a thin downturned lens in the socket, dark with a cold glow inside
      const sp = [];
      const si = [];
      const n = far ? 6 : 10;
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const u = lerp(0.2, 0.74, t);
        const vC = 0.14 - 0.06 * t * t; // downturned to the outside (a saint's closed eyes)
        const h = 0.0085 * Math.sin(Math.PI * Math.pow(t, 0.8));
        for (const sg of [1, -1]) {
          const v = vC + (sg * h) / HH;
          sp.push(...place(side * u * halfW(v), HH * v, MC[2] + depth(u, v) + 0.002));
        }
      }
      for (let i = 0; i < n; i++) {
        const a = i * 2;
        if (side > 0) si.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
        else si.push(a, a + 2, a + 1, a + 2, a + 3, a + 1);
      }
      Bd.add(sp, si, () => [0.002, 0.003, 0.005, 0.9, 1, 0], rigid(B.head));
    }
  }

  // ---- the chisel arms: thin, long, segmented, out of ragged sleeves ----
  for (const side of [1, -1]) {
    const up = side > 0 ? B.upperArmL : B.upperArmR;
    const fo = side > 0 ? B.foreArmL : B.foreArmR;
    const ch = side > 0 ? B.chiselL : B.chiselR;
    const X = 0.31 * side;
    const S = far ? 6 : 8;
    // upper arm (hidden in the sleeve, it shows when the arms spread)
    let g = tube([X, 2.56, 0], [X, 1.86, 0], S, far ? 1 : 3, (v) => lerp(0.046, 0.036, v));
    Bd.add(g.p, g.ix, IRON, rigid(up));
    // the elbow knuckle
    g = blob([X, 1.84, 0], 0.05, 0.055, 0.05, S, far ? 4 : 6);
    Bd.add(g.p, g.ix, IRON, () => [[up, 0.5], [fo, 0.5]]);
    // the forearm in three segments (rings at the joints)
    g = tube([X, 1.84, 0], [X, 1.15, 0], S, far ? 7 : 12, (v) => {
      const ring = Math.max(Math.exp(-Math.pow((v - 0.34) / 0.025, 2)), Math.exp(-Math.pow((v - 0.67) / 0.025, 2)));
      return lerp(0.035, 0.027, v) * (1 + 0.45 * ring);
    });
    Bd.add(g.p, g.ix, IRON, rigid(fo));
    // the wrist collar
    g = blob([X, 1.15, 0], 0.04, 0.035, 0.04, S, far ? 3 : 5);
    Bd.add(g.p, g.ix, IRON, () => [[fo, 0.5], [ch, 0.5]]);
    // the chisel: a long flat tapering blade with a bevelled edge (broad to the front)
    {
      const n = far ? 3 : 8;
      const p = [];
      const ix = [];
      const yTop = 1.13;
      const yBot = 0.22;
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const y = lerp(yTop, yBot, t);
        const w = lerp(0.075, 0.034, t) * (1 + 0.15 * Math.exp(-Math.pow((t - 0.45) / 0.03, 2)));
        const th = lerp(0.016, 0.007, t);
        // the bevel: the last stretch thins to an edge
        const ed = smooth(0.82, 1, t);
        const tt = th * (1 - 0.8 * ed);
        const slant = 0.05 * ed * side; // the cutting edge is slanted
        p.push(X - w, y + slant * 0.5, -tt, X + w, y - slant * 0.5, -tt, X + w, y - slant * 0.5, tt, X - w, y + slant * 0.5, tt);
      }
      for (let i = 0; i < n; i++) {
        const a = i * 4;
        const c = a + 4;
        for (let s = 0; s < 4; s++) {
          const s1 = (s + 1) % 4;
          ix.push(a + s, c + s, a + s1, a + s1, c + s, c + s1);
        }
      }
      const e = n * 4;
      ix.push(e, e + 1, e + 2, e, e + 2, e + 3);
      Bd.add(
        p,
        ix,
        (x, y) => {
          const t = clamp((yTop - y) / (yTop - yBot), 0, 1);
          const edge = smooth(0.8, 0.98, t);
          return [lerp(0.06, 0.42, edge), lerp(0.058, 0.41, edge), lerp(0.062, 0.4, edge), lerp(0.42, 0.22, edge)];
        },
        rigid(ch),
      );
    }
    // the sleeve: a ragged flared cone over the upper arm
    {
      const nu = far ? 12 : 16;
      const nv = far ? 5 : 8;
      const g2 = grid(nu, nv, (u, v) => {
        const th = u * Math.PI * 2;
        // a ragged mouth above the elbow: the segmented forearm and its blade come out bare
        const ragged = 0.05 * noise1(th * 2.7 + side * 3, 7) + 0.12 * Math.pow(Math.max(0, noise1(th * 4.1 + side, 8)), 1.5);
        const y = lerp(2.62, 2.06 - ragged, v);
        const r = lerp(0.075, 0.105, Math.pow(v, 0.8)) * (1 + 0.12 * Math.sin(th * 5 + v * 3));
        // the sleeve hangs from the shoulder seam, its mouth drooping toward the back
        return [X + Math.sin(th) * r - side * 0.012 * v, y, Math.cos(th) * r * 0.85 - 0.015 * v];
      }, true);
      Bd.add(g2.p, g2.ix, ROBE, (x, y) => (y > 2.45 ? [[up, 0.6], [B.chest, 0.4]] : [[up, 1]]));
    }
  }

  // ---- the small arms and hands that pay out the line ----
  for (const side of [1, -1]) {
    const su = side > 0 ? B.smallUpperL : B.smallUpperR;
    const sf = side > 0 ? B.smallForeL : B.smallForeR;
    const X = 0.12 * side;
    let g = tube([X, 2.06, 0.17], [X, 1.81, 0.17], far ? 4 : 6, 2, () => 0.021);
    Bd.add(g.p, g.ix, SKIN, rigid(su));
    g = tube([X, 1.81, 0.17], [X, 1.58, 0.175], far ? 4 : 6, 2, (v) => lerp(0.019, 0.016, v));
    Bd.add(g.p, g.ix, SKIN, rigid(sf));
    // palm
    g = blob([X, 1.56, 0.18], 0.022, 0.03, 0.012, far ? 4 : 6, far ? 3 : 4);
    Bd.add(g.p, g.ix, SKIN, rigid(sf));
    // long fingers pinched toward the other hand (the line runs between them)
    const nf = far ? 2 : 4;
    for (let f = 0; f < nf; f++) {
      const fx = X + side * (-0.012 + 0.008 * f) * (far ? 2 : 1);
      g = tube([fx, 1.54, 0.185], [fx - side * 0.01, 1.505, 0.2], 3, 1, (v) => lerp(0.005, 0.003, v));
      Bd.add(g.p, g.ix, SKIN, rigid(sf));
    }
  }

  // ---- the long bare feet (and the shins, under the hem) ----
  for (const side of [1, -1]) {
    const sh = side > 0 ? B.shinL : B.shinR;
    const ft = side > 0 ? B.footL : B.footR;
    const X = 0.12 * side;
    let g = tube([X, 0.78, 0], [X, 0.1, 0], far ? 4 : 6, 2, (v) => lerp(0.05, 0.034, v));
    Bd.add(g.p, g.ix, SKIN, rigid(sh));
    g = blob([X, 0.055, 0.08], 0.04, 0.035, 0.16, far ? 5 : 8, far ? 3 : 5);
    Bd.add(g.p, g.ix, SKIN, () => [[ft, 1]]);
    const nt = far ? 2 : 4;
    for (let t = 0; t < nt; t++) {
      const tx = X + (-0.028 + (0.056 * t) / Math.max(1, nt - 1));
      g = tube([tx, 0.04, 0.2], [tx + 0.006 * side, 0.012, 0.3 - 0.012 * Math.abs(t - 1.5)], 3, 1, (v) => lerp(0.009, 0.004, v));
      Bd.add(g.p, g.ix, SKIN, () => [[ft, 1]]);
    }
  }

  // ---- the leather apron (chalk-dusted), the belt, the tools ----
  {
    const nu = far ? 7 : 10;
    const nv = far ? 12 : 20;
    const g = grid(nu, nv, (u, v) => {
      const y = lerp(2.32, 0.6 - 0.08 * noise1(u * 6, 9), v);
      const w = lerp(0.17, 0.25, v);
      const s = lerp(-1, 1, u);
      const r = robeR(y) * 0.82 + 0.018;
      const th = clamp((s * w) / Math.max(0.15, robeR(y)), -1.2, 1.2);
      return [Math.sin(th) * robeR(y) * 1.02, y, Math.cos(th) * r + 0.012 * Math.cos(u * 9)];
    });
    Bd.add(
      g.p,
      g.ix,
      (x, y) => {
        const n = 0.85 + 0.15 * hash(Math.floor(x * 50) + Math.floor(y * 40) * 11);
        const dust = clamp(noise1(x * 9 + y * 3, 4) * 1.6 - 0.4, 0, 1) * smooth(0.6, 1.4, y) * (1 - smooth(1.9, 2.3, y));
        return [lerp(0.085 * n, 0.4, dust), lerp(0.042 * n, 0.39, dust), lerp(0.03 * n, 0.36, dust), lerp(0.62, 0.9, dust), 0, 0.25 * dust];
      },
      (x, y, z) => (y > 1.56 ? torsoWeights(x, y, z) : y > 1.3 ? [[B.hips, smooth(1.3, 1.56, y)], [B.skirtF1, 1 - smooth(1.3, 1.56, y)]] : skirtWeights(0, y, 1)),
    );
    // the belt
    const bt = grid(far ? 16 : 32, far ? 3 : 5, (u, v) => {
      const th = u * Math.PI * 2;
      const q = robeAt(th, 1.74, false);
      const a = v * Math.PI * 2;
      const rr = 1 + (0.06 * Math.cos(a)) / Math.max(0.15, robeR(1.74));
      return [q[0] * rr * 1.05, 1.74 + 0.025 * Math.sin(a), q[2] * rr * 1.08];
    }, true);
    Bd.add(bt.p, bt.ix, () => [0.05, 0.035, 0.025, 0.5], () => [[B.hips, 0.6], [B.spine, 0.4]]);
    // the mallet at its right hip, the plumb bob at its left (both swing with the robe)
    let g2 = tube([-0.2, 1.72, 0.12], [-0.23, 1.38, 0.15], 5, 1, () => 0.014);
    Bd.add(g2.p, g2.ix, () => [0.06, 0.045, 0.03, 0.6], () => [[B.skirtR1, 0.7], [B.hips, 0.3]]);
    g2 = blob([-0.235, 1.34, 0.155], 0.06, 0.04, 0.04, far ? 4 : 6, far ? 3 : 4);
    Bd.add(g2.p, g2.ix, IRON, () => [[B.skirtR1, 0.7], [B.hips, 0.3]]);
    g2 = tube([0.2, 1.72, 0.12], [0.22, 1.25, 0.14], 3, 1, () => 0.004);
    Bd.add(g2.p, g2.ix, () => [0.3, 0.28, 0.25, 0.8], () => [[B.skirtL1, 1]]);
    g2 = tube([0.22, 1.27, 0.14], [0.22, 1.17, 0.14], far ? 4 : 6, 2, (v) => 0.028 * (1 - v));
    Bd.add(g2.p, g2.ix, () => [0.2, 0.17, 0.1, 0.3], () => [[B.skirtL1, 1]]);
  }

  // ---- tatters: cloth strips hanging from the hem and the sleeves ----
  if (!far) {
    const strips = [
      [0.35, 0.18, 0.4, 0],
      [1.4, 0.2, 0.35, 1],
      [2.3, 0.16, 0.45, 2],
      [3.3, 0.2, 0.3, 3],
      [4.4, 0.18, 0.42, 4],
      [5.5, 0.15, 0.38, 5],
    ];
    for (const [th, y0, len, k] of strips) {
      const q = robeAt(th, y0, false);
      const tx = Math.cos(th);
      const tz = -Math.sin(th);
      const g = grid(1, 4, (u, v) => {
        const w = 0.022 * (1 - 0.6 * v);
        const s = u * 2 - 1;
        return [q[0] * 1.03 + tx * s * w, y0 - len * v, q[2] * 1.03 + tz * s * w + 0.01 * Math.sin(v * 4 + k)];
      });
      Bd.add(g.p, g.ix, ROBE, (x, y, z) => skirtWeights(x, Math.min(y, 0.5), z));
    }
  }

  // ---- the measuring line: from the small left hand's fingertips to the lineEnd bone (the right hand, or your ring) ----
  {
    const n = far ? 4 : 10;
    const a = HAND_TIP_L;
    const e = BONES[B.lineEnd].slice(2);
    const w = far ? 0.01 : 0.007;
    const p = [];
    const ix = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = lerp(a[0], e[0], t);
      const y = lerp(a[1], e[1], t);
      const z = lerp(a[2], e[2], t);
      // a cross of two ribbons (visible from every side); the knots every other step (the line's ticks)
      const knot = i % 2 === 1 && !far ? 1.9 : 1;
      p.push(x, y + w * knot, z, x, y - w * knot, z, x, y, z + w * knot, x, y, z - w * knot);
    }
    for (let i = 0; i < n; i++) {
      const q = i * 4;
      const r = q + 4;
      ix.push(q, r, q + 1, q + 1, r, r + 1, q + 2, r + 2, q + 3, q + 3, r + 2, r + 3);
    }
    Bd.add(
      p,
      ix,
      () => [0.62, 0.6, 0.54, 0.7, 0.35, 0.9],
      (x) => {
        const t = clamp((x - a[0]) / (e[0] - a[0]), 0, 1);
        return [
          [B.smallForeL, 1 - t],
          [B.lineEnd, t],
        ];
      },
    );
  }
  // ---- the chalk outline of you: one quad on the 'chalk' bone (life-size, 0.95 x 1.9 m), drawn by the body's own material from
  // the outline texture (aFx = its uv, aChalk = 1): the outline costs no draw call of its own ----
  Bd.add(
    [-0.475, -0.95, 0, 0.475, -0.95, 0, 0.475, 0.95, 0, -0.475, 0.95, 0],
    [0, 1, 2, 0, 2, 3],
    (x, y) => [0.9, 0.89, 0.85, 1, x / 0.95 + 0.5, 0.5 + y / 1.9], // v up (the canvas texture is flipped on upload)
    () => [[B.chalk, 1]],
    1,
  );
  return Bd.geometry();
}

// ---------------------------------------------------------------------------------------------------------------------
// The chalk outline of your body (canvas: alpha = chalk, green = stroke order for the draw-on reveal)
// ---------------------------------------------------------------------------------------------------------------------
/** The outline (a body hanging from one raised right arm) in canvas units 0..1 (x across, y down). */
const OUTLINE = [
  [0.58, 0.02], [0.61, 0.08], [0.6, 0.16], [0.58, 0.2], // the raised right arm (hand at the top)
  [0.56, 0.24], [0.57, 0.27], [0.62, 0.3], [0.66, 0.36], [0.68, 0.46], [0.69, 0.52], [0.7, 0.58], [0.67, 0.59], [0.64, 0.5], [0.62, 0.42], // shoulder, left arm hanging
  [0.62, 0.55], [0.6, 0.64], [0.6, 0.76], [0.61, 0.88], [0.63, 0.96], [0.57, 0.97], [0.55, 0.88], [0.53, 0.76], [0.5, 0.66], // left leg
  [0.47, 0.76], [0.45, 0.88], [0.43, 0.97], [0.37, 0.96], [0.39, 0.88], [0.4, 0.76], [0.4, 0.64], [0.38, 0.55], // right leg
  [0.37, 0.42], [0.36, 0.33], [0.39, 0.29], [0.43, 0.27], [0.44, 0.24], // the right side of the chest up to the neck
  [0.41, 0.22], [0.39, 0.17], [0.4, 0.12], [0.44, 0.09], [0.49, 0.09], [0.53, 0.12], [0.54, 0.17], [0.52, 0.22], // the head
  [0.5, 0.24], [0.52, 0.2], [0.54, 0.12], [0.55, 0.06], [0.54, 0.02], [0.58, 0.02], // back up the arm
];
/** The cut lines across the body (where the blocks part), drawn last: [y, x0, x1]. */
const CUTS = [
  [0.235, 0.42, 0.55],
  [0.36, 0.36, 0.67],
  [0.53, 0.38, 0.62],
  [0.75, 0.39, 0.62],
];

/** Draws the outline texture; null without a DOM (Node). */
export function makeOutlineTexture() {
  if (typeof document === 'undefined') return null;
  const W = 256;
  const H = 512;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d');
  if (!g) return null;
  g.clearRect(0, 0, W, H);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  let total = 0;
  for (let i = 1; i < OUTLINE.length; i++) total += Math.hypot((OUTLINE[i][0] - OUTLINE[i - 1][0]) * W, (OUTLINE[i][1] - OUTLINE[i - 1][1]) * H);
  const chalk = (x0, y0, x1, y1, order, width, seed) => {
    // a rough chalk stroke: a few jittered passes, each slightly different in width and pressure
    const steps = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 6));
    for (let pass = 0; pass < 3; pass++) {
      g.beginPath();
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const jx = (hash(seed * 13 + s * 7 + pass * 101) - 0.5) * 2.2;
        const jy = (hash(seed * 17 + s * 11 + pass * 131) - 0.5) * 2.2;
        const x = lerp(x0, x1, t) + jx;
        const y = lerp(y0, y1, t) + jy;
        if (s === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      const r = Math.round(170 + 85 * hash(seed + pass * 3));
      g.strokeStyle = `rgba(${r}, ${Math.round(clamp(order, 0, 1) * 255)}, 0, ${(0.45 + 0.4 * hash(seed * 5 + pass)).toFixed(3)})`;
      g.lineWidth = width * (0.6 + 0.5 * hash(seed * 3 + pass * 7));
      g.stroke();
    }
  };
  let acc = 0;
  for (let i = 1; i < OUTLINE.length; i++) {
    const x0 = OUTLINE[i - 1][0] * W;
    const y0 = OUTLINE[i - 1][1] * H;
    const x1 = OUTLINE[i][0] * W;
    const y1 = OUTLINE[i][1] * H;
    const l = Math.hypot(x1 - x0, y1 - y0);
    // short pieces so the order varies along the stroke
    const k = Math.max(1, Math.ceil(l / 10));
    for (let j = 0; j < k; j++) {
      const ta = j / k;
      const tb = (j + 1) / k;
      const order = ((acc + l * (ta + tb) * 0.5) / total) * 0.78;
      chalk(lerp(x0, x1, ta), lerp(y0, y1, ta), lerp(x0, x1, tb), lerp(y0, y1, tb), order, 11, i * 31 + j);
    }
    acc += l;
  }
  // the cut lines (dashed), then the mason's marks beside each block
  CUTS.forEach(([y, xa, xb], c) => {
    const n = 7;
    for (let d = 0; d < n; d++) {
      const t0 = d / n;
      const t1 = t0 + 0.6 / n;
      const order = 0.8 + 0.035 * c + 0.035 * (d / n);
      chalk(lerp(xa, xb, t0) * W - 6, y * H, lerp(xa, xb, t1) * W - 6, y * H + (hash(c * 9 + d) - 0.5) * 3, order, 6, 900 + c * 17 + d);
    }
    // ticks: I, II, III, IV to the right of each cut
    for (let m = 0; m <= c; m++) {
      const x = (xb + 0.05) * W + m * 7;
      chalk(x, y * H - 9, x + 1, y * H + 9, 0.95 + 0.012 * c, 5, 1200 + c * 5 + m);
    }
  });
  // chalk dust: a faint speckle near the strokes, and erosion (the stone's grain breaking the chalk)
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 1800; i++) {
    const x = hash(i * 3.1) * W;
    const y = hash(i * 7.7 + 1) * H;
    g.fillStyle = `rgba(0, 0, 0, ${(0.3 + 0.6 * hash(i * 1.3)).toFixed(2)})`;
    g.fillRect(x, y, 1 + hash(i) * 2, 1 + hash(i * 2.2) * 2);
  }
  g.globalCompositeOperation = 'source-over';
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.NoColorSpace; // data: alpha = chalk, green = order
  tex.anisotropy = 4;
  return tex;
}

// ---------------------------------------------------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------------------------------------------------
function chain(mat, tag, edit) {
  const base = mat.onBeforeCompile;
  const baseKey = mat.customProgramCacheKey;
  mat.onBeforeCompile = (shader, renderer) => {
    base(shader, renderer);
    edit(shader);
  };
  mat.customProgramCacheKey = () => `${baseKey.call(mat)}|${tag}`;
}

export function makeDresserUniforms() {
  return {
    uChalk: { value: null },
    uChalkK: { value: new THREE.Vector2(0, 0) }, // x grow (the draw-on reveal 0..1), y alpha
    uGlow: { value: 0.4 },
    uGlowCol: { value: GLOW_COL.clone() },
    uPale: { value: 0.3 },
    uPierce: { value: 0.6 },
    uNear: { value: new THREE.Vector2(0.3, 0.75) },
    uAmb: { value: new THREE.Color(0.2, 0.24, 0.28) },
    uRimC: { value: new THREE.Color(0.075, 0.095, 0.115) },
  };
}

function makeBodyMaterial(U) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.6 });
  mat.name = 'at3dDresser';
  patchMaterial(mat, { lit: true, grade: true, wetMin: 0.15, fog: 'cap', fogCap: 0.8 });
  const fogFn = /atFogFactor/.test(THREE.ShaderChunk.fog_pars_fragment) ? 'atFogFactor( vFogDepth )' : 'smoothstep( fogNear, fogFar, vFogDepth )';
  chain(mat, 'dresser1', (shader) => {
    Object.assign(shader.uniforms, U);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aFx;\nattribute float aChalk;\nvarying vec2 vDrFx;\nvarying float vDrCh;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vDrFx = aFx;\n  vDrCh = aChalk;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vDrFx;\nvarying float vDrCh;\nuniform float uGlow;\nuniform vec3 uGlowCol;\nuniform float uPale;\nuniform float uPierce;\nuniform vec2 uNear;\nuniform vec3 uAmb;\nuniform vec3 uRimC;\nuniform sampler2D uChalk;\nuniform vec2 uChalkK;')
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
  float drIgn = fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) );
  float drChalk = 0.0;
  if ( vDrCh > 0.5 ) {
    // the chalk outline: drawn on in stroke order (green), its chalk in alpha, dithered (no blending: no draw call of its own)
    vec4 dcT = texture2D( uChalk, vDrFx );
    drChalk = dcT.a * smoothstep( dcT.g - 0.02, dcT.g, uChalkK.x ) * uChalkK.y;
    if ( drChalk < drIgn * 0.9 + 0.05 ) discard;
  } else {
    // the near-eye dissolve: it can never fill the headset or clip the near plane
    float drNf = smoothstep( uNear.x, uNear.y, length( vViewPosition ) );
    if ( drNf < 0.999 && drNf < drIgn ) discard;
  }`,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n#ifdef USE_COLOR_ALPHA\n  roughnessFactor *= vColor.a;\n#endif')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
  if ( vDrCh > 0.5 ) {
    totalEmissiveRadiance += diffuseColor.rgb * 0.16; // chalk reads in the dark before the lantern reaches it
  } else {
  totalEmissiveRadiance += uGlowCol * ( vDrFx.x * uGlow * 0.9 ) + diffuseColor.rgb * ( vDrFx.y * uPale );
  }
  if ( vDrCh < 0.5 ) {
    // a faint cold ambient (x albedo) and a grazing rim: the dark robe keeps its outline against the haze
    float drFr = 1.0 - clamp( dot( normalize( normal ), normalize( vViewPosition ) ), 0.0, 1.0 );
    totalEmissiveRadiance += diffuseColor.rgb * uAmb + uRimC * ( drFr * drFr * drFr );
  }`,
      )
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
#ifdef USE_FOG
  if ( vDrCh < 0.5 ) gl_FragColor.rgb += uGlowCol * ( vDrFx.x * uGlow * uPierce * ${fogFn} );
#endif`,
      );
  });
  return mat;
}

// ---------------------------------------------------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------------------------------------------------
const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _s = new THREE.Vector3();

export class DresserView {
  constructor(game) {
    this.scene = game && game.renderer ? game.renderer.scene : null;
    this.root = new THREE.Group();
    this.root.name = 'dresser';
    this.root.visible = false;
    // the skeleton (bones in the creature's frame under the root)
    this.bones = BONES.map((b) => {
      const bone = new THREE.Bone();
      bone.name = b[0];
      return bone;
    });
    this._bind = BONES.map((b) => new THREE.Vector3(b[2], b[3], b[4]));
    BONES.forEach((b, i) => {
      const p = b[1];
      const bone = this.bones[i];
      if (p < 0) {
        bone.position.copy(this._bind[i]);
        this.root.add(bone);
      } else {
        bone.position.copy(this._bind[i]).sub(this._bind[p]);
        this.bones[p].add(bone);
      }
    });
    this.root.updateMatrixWorld(true);
    this.skeleton = new THREE.Skeleton(this.bones);
    this.uniforms = makeDresserUniforms();
    this.material = makeBodyMaterial(this.uniforms);
    this.geometries = [buildDresserGeometry(0), buildDresserGeometry(1)];
    this.meshes = this.geometries.map((g, i) => {
      const m = new THREE.SkinnedMesh(g, this.material);
      m.name = i === 0 ? 'dresserNear' : 'dresserFar';
      m.bind(this.skeleton, new THREE.Matrix4());
      m.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.7, 0), 2.4);
      m.visible = i === 0;
      this.root.add(m);
      return m;
    });
    this.triangles = this.geometries.map((g) => g.index.count / 3);
    // the far glints: two tiny additive quads on the head bone (only beyond GLOW_DIST)
    const gp = [];
    for (const s of [1, -1]) gp.push(s * 0.052 - 0.035, 2.955, 0.17, s * 0.052 + 0.035, 2.955, 0.17, s * 0.052, 2.97, 0.17, s * 0.052, 2.94, 0.17);
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.Float32BufferAttribute(gp, 3));
    gg.setIndex([0, 2, 1, 0, 1, 3, 4, 6, 5, 4, 5, 7]);
    this._glowMat = new THREE.MeshBasicMaterial({ color: GLOW_COL, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: false });
    this.glints = new THREE.Mesh(gg, this._glowMat);
    this.glints.name = 'dresserGlints';
    this.glints.position.set(0, -BONES[B.head][3], -BONES[B.head][4]);
    this.glints.frustumCulled = false;
    this.glints.visible = false;
    this.bones[B.head].add(this.glints);
    // the chalk outline: a quad of the skinned mesh on the 'chalk' bone (no mesh, no draw call of its own)
    this.outlineTex = makeOutlineTexture();
    this.uniforms.uChalk.value = this.outlineTex;
    this.outline = { visible: false };
    if (this.scene) {
      this.scene.add(this.root);
    }
    this.lod = 0;
    this.info = { drawCalls: 0, triangles: 0 };
    this._t = 0;
    this._snapT = 0;
    this._tilt = 0;
    this._tiltTo = 0;
    this._tickN = 0;
    this._tickK = 0;
    this._yaw = 0;
    this._pitch = 0;
    this._quat = new THREE.Quaternion();
    this._qReady = false;
    this._sw = new Float32Array(8); // skirt spring angles (x, z per column)
    this._want = new Float32Array(4);
    // rotate bone i by the euler (x, y, z) after its current rotation (no allocation per frame)
    const bones = this.bones;
    this._rot = (i, x, y, z) => {
      _e.set(x, y, z, 'XYZ');
      _q2.setFromEuler(_e);
      bones[i].quaternion.multiply(_q2);
    };
    this._swv = new Float32Array(8);
    this._outlineHand = 'right';
    this.debug = { forceLod: -1 };
  }

  /** Per frame. */
  update(dt, game) {
    const d = game && game.dresser;
    const b = d && !d.isNull ? d.body : null;
    const cam = game && game.renderer ? game.renderer.camera : null;
    const reduced = !!(game && game.settings && game.settings.reducedEffects);
    this._t += dt;
    if (!b || !b.visible) {
      this.root.visible = false;
      this.outline.visible = false;
      this.info.drawCalls = 0;
      this.info.triangles = 0;
      this._qReady = false;
      return;
    }
    this.root.visible = true;
    // ---- placement: feet on the wall, up = its normal, facing = its tangent heading ----
    _y.set(b.ux, b.uy, b.uz).normalize();
    _z.set(b.fx, b.fy, b.fz);
    _z.addScaledVector(_y, -_z.dot(_y));
    if (_z.lengthSq() < 1e-6) _z.set(1, 0, 0).addScaledVector(_y, -_y.x);
    _z.normalize();
    _x.crossVectors(_y, _z).normalize();
    _m.makeBasis(_x, _y, _z);
    _q.setFromRotationMatrix(_m);
    if (!this._qReady) {
      this._quat.copy(_q);
      this._qReady = true;
    } else this._quat.slerp(_q, 1 - Math.exp(-8 * dt));
    this.root.position.set(b.x, b.y, b.z);
    this.root.quaternion.copy(this._quat);
    // ---- distance, LOD, glow-only ----
    let camD = 10;
    if (cam) {
      cam.getWorldPosition(_v);
      camD = _v.distanceTo(_v2.set(b.x + _y.x * 1.8, b.y + _y.y * 1.8, b.z + _y.z * 1.8));
    }
    const tier = game && game.renderer && game.renderer.qualityTier;
    const lodD = LOD_DIST[tier] || LOD_DIST.quest;
    let lod = camD > (this.lod === 1 ? lodD - LOD_HYST : lodD) ? 1 : 0;
    if (this.debug.forceLod >= 0) lod = this.debug.forceLod;
    this.lod = lod;
    const glowOnly = camD > GLOW_DIST && this.debug.forceLod < 0;
    this.meshes[0].visible = !glowOnly && lod === 0;
    this.meshes[1].visible = !glowOnly && lod === 1;
    this.glints.visible = glowOnly && b.glow > 0.2;
    this._glowMat.opacity = 0.35 + 0.5 * b.glow;
    // ---- pose ----
    this._pose(dt, b, reduced);
    // ---- the line's far end: your ring while it measures, else the right hand's fingertips; the chalk outline beside you ----
    this._placeLineEnd(b);
    const od = this._updateOutline(b, d);
    // ---- uniforms ----
    const U = this.uniforms;
    U.uGlow.value = b.glow;
    U.uPale.value = 0.3 + 0.12 * b.measure; // the ivory face reads in the dark (brighter while it measures you)
    // bounds for the frustum test (the line can reach your ring)
    const bs = this.meshes[0].boundingSphere;
    const ln = b.line && b.line.on ? _v3.set(b.line.x - b.x, b.line.y - b.y, b.line.z - b.z).length() : 0;
    bs.radius = Math.max(2.4, ln + 1.2, od + 1.4);
    this.meshes[1].boundingSphere.radius = bs.radius;
    // ---- what it draws (the line and the chalk outline are part of the skinned mesh) ----
    if (glowOnly) {
      this.info.drawCalls = this.glints.visible ? 1 : 0;
      this.info.triangles = this.glints.visible ? 4 : 0;
    } else {
      this.info.drawCalls = 1;
      this.info.triangles = this.triangles[lod];
    }
  }

  /** The procedural animation: breathing, the walk, the measuring / cutting / spoiled / stagger poses, the head on you. */
  _pose(dt, b, reduced) {
    const t = this._t;
    const bones = this.bones;
    for (let i = 0; i < bones.length; i++) {
      if (i === B.lineEnd) continue;
      bones[i].quaternion.identity();
      if (i > 0 && BONES[i][1] >= 0) bones[i].position.copy(this._bind[i]).sub(this._bind[BONES[i][1]]);
    }
    const me = b.measure;
    const cu = b.cut;
    const sp = b.spoiled;
    const st = b.stagger;
    const walkW = clamp(b.speed / 1.2, 0, 1) * (1 - me);
    const ph = (b.walk / 1.05) * Math.PI; // a step every 1.05 m
    const breathe = Math.sin(t * 1.35);
    // ticks: the hands jerk as the line pays out
    if (b.tick !== this._tickN) {
      this._tickN = b.tick;
      this._tickK = 1;
    }
    this._tickK = Math.max(0, this._tickK - dt * 9);
    // micro snaps of the head (the uncanny part): a new small tilt every few seconds, taken quickly
    this._snapT -= dt;
    if (this._snapT <= 0) {
      this._snapT = 1.4 + 3 * hash(Math.floor(t * 10));
      this._tiltTo = (hash(Math.floor(t * 7) + 3) - 0.5) * 0.5;
    }
    this._tilt += (this._tiltTo - this._tilt) * (1 - Math.exp(-(reduced ? 3 : 14) * dt));

    const rot = this._rot;
    // ---- hips and the walk ----
    const sw = Math.sin(ph);
    bones[B.hips].position.y += 0.035 * Math.abs(Math.cos(ph)) * walkW + 0.008 * breathe;
    rot(B.hips, 0.04 * walkW, 0.05 * sw * walkW, 0.035 * sw * walkW);
    for (let li = 0; li < 2; li++) {
      const th = LEGS[li][0];
      const sh = LEGS[li][1];
      const ft = LEGS[li][2];
      const sgn = LEGS[li][3];
      const s = Math.sin(ph + (sgn > 0 ? 0 : Math.PI));
      const lift = Math.max(0, Math.cos(ph + (sgn > 0 ? 0 : Math.PI)));
      rot(th, -0.42 * s * walkW + 0.05 * me, 0, 0.03 * sgn);
      rot(sh, 0.55 * lift * walkW, 0, 0);
      rot(ft, -0.25 * lift * walkW, 0, 0);
    }
    // ---- spine: the hunch, breathing, leaning in to measure, slumped when spoiled, thrown back by a stagger ----
    const shake = st > 0 && !reduced ? (hash(Math.floor(t * 30)) - 0.5) * 0.12 * st : 0;
    rot(B.spine, 0.1 + 0.015 * breathe + 0.12 * me + 0.1 * sp - 0.45 * st + shake, 0.06 * sw * walkW, 0);
    rot(B.chest, 0.12 + 0.02 * breathe + 0.08 * me + 0.12 * sp - 0.3 * st, -0.04 * sw * walkW, 0.05 * shake);
    rot(B.neck, 0.15 + 0.05 * sp - 0.2 * st, 0, 0);
    // ---- the head: on you (an owl's reach, past a person's), away from you when spoiled ----
    {
      this.root.updateMatrixWorld(true);
      bones[B.neck].getWorldPosition(_v);
      _v2.set(b.lx, b.ly, b.lz).sub(_v);
      _q.copy(this.root.quaternion).invert();
      _v2.applyQuaternion(_q);
      // remove the chest's own tilt (approximately): read the target in the root frame
      let yaw = Math.atan2(_v2.x, _v2.z);
      let pitch = -Math.atan2(_v2.y, Math.hypot(_v2.x, _v2.z)) - 0.25;
      yaw = clamp(yaw, -2.0, 2.0);
      pitch = clamp(pitch, -1.25, 0.9);
      // spoiled: the mask turns away from you, down to the wall
      const away = yaw >= 0 ? -1.9 : 1.9;
      yaw = lerp(yaw, away, sp);
      pitch = lerp(pitch, 0.55, sp);
      pitch = lerp(pitch, -0.6, st);
      const k = 1 - Math.exp(-(me > 0.5 ? 5 : 2.4) * dt);
      this._yaw += (yaw - this._yaw) * k;
      this._pitch += (pitch - this._pitch) * k;
      const tilt = this._tilt * (1 - sp) + 0.32 * me + 0.25 * sp;
      rot(B.neck, this._pitch * 0.35, this._yaw * 0.4, 0);
      rot(B.head, this._pitch * 0.65, this._yaw * 0.6, tilt + shake);
    }
    // ---- the chisel arms ----
    for (let ai = 0; ai < 2; ai++) {
      const up = ARMS[ai][0];
      const fo = ARMS[ai][1];
      const ch = ARMS[ai][2];
      const sgn = ARMS[ai][3];
      const swing = 0.12 * Math.sin(ph + (sgn > 0 ? Math.PI : 0)) * walkW;
      const saw = cu > 0 ? Math.sin(t * 15 + (sgn > 0 ? 0 : Math.PI)) * 0.22 * cu : 0;
      // idle: held like a mantis's forelegs, the forearms raised in front, the long blades hanging point-down from the wrists
      let ux = -0.32 + swing + 0.03 * breathe;
      let uz = 0.2 * sgn;
      let fx = -1.3 + 0.04 * breathe;
      let cx = 0.55;
      let fy = -0.12 * sgn;
      // measuring: spread out like a pair of dividers, the blades pointing at you
      ux = lerp(ux, -0.85, me);
      uz = lerp(uz, 0.95 * sgn, me);
      fx = lerp(fx, -0.5, me);
      cx = lerp(cx, -0.3, me);
      fy = lerp(fy, 0, me);
      // the cut: the chisels drawn in front, working the line like a bow saw
      ux = lerp(ux, -1.05 + saw, cu);
      uz = lerp(uz, 0.45 * sgn, cu);
      fx = lerp(fx, -0.7 - saw, cu);
      // spoiled: folded across the chest, the blades up behind the shoulders (a mantis at rest)
      ux = lerp(ux, -0.35, sp);
      uz = lerp(uz, -0.32 * sgn, sp);
      fx = lerp(fx, -2.55, sp);
      fy = lerp(fy, 0.5 * sgn, sp);
      cx = lerp(cx, -0.25, sp);
      // stagger: flung out
      ux = lerp(ux, -0.2, st);
      uz = lerp(uz, 1.35 * sgn, st);
      fx = lerp(fx, -0.2, st);
      rot(up, ux, 0, uz);
      rot(fo, fx, fy, 0);
      rot(ch, cx, 0, 0);
    }
    // ---- the small hands: holding the line before its belly; one paying out to your ring while it measures ----
    {
      const jerk = this._tickK * 0.18;
      rot(B.smallUpperL, -0.95 - 0.35 * me + 0.1 * sp, 0, 0.18 + 0.2 * me);
      rot(B.smallForeL, -0.75 - 0.4 * me - jerk, 0, 0);
      rot(B.smallUpperR, -0.95 + 0.1 * sp, 0, -0.18);
      rot(B.smallForeR, -0.75 + jerk * 1.5, 0, 0);
    }
    // ---- the robe: swings with the legs, lags behind, sags a little toward the world's floor ----
    {
      _v.set(0, -1, 0).applyQuaternion(_q.copy(this.root.quaternion).invert()); // world down in its frame
      const gx = clamp(_v.z, -1, 1) * 0.12; // sag forward / back
      const gz = clamp(-_v.x, -1, 1) * 0.12;
      const tL = -0.42 * Math.sin(ph) * walkW;
      const tR = 0.42 * Math.sin(ph) * walkW;
      const want = this._want;
      want[0] = Math.min(tL, tR) * 0.7 + gx - 0.05 * me; // front: pushed by the forward leg
      want[1] = 0.02 * Math.sin(t * 0.7) + gz;
      want[2] = Math.max(tL, tR) * 0.5 + gx; // back
      want[3] = 0.02 * Math.sin(t * 0.6 + 1) + gz;
      const sway = reduced ? 0 : 0.03 * Math.sin(t * 0.9) + 0.06 * st * Math.sin(t * 13);
      for (let c = 0; c < 4; c++) {
        // a damped spring per column (x: the column's main swing)
        const target = want[c] + sway;
        const a = (target - this._sw[c]) * 40 - this._swv[c] * 7;
        this._swv[c] += a * dt;
        this._sw[c] += this._swv[c] * dt;
      }
      const f = this._sw[0];
      const l = this._sw[1];
      const bk = this._sw[2];
      const r = this._sw[3];
      rot(B.skirtF1, f, 0, 0);
      rot(B.skirtF2, f * 0.6 + 0.05 * Math.sin(t * 1.1), 0, 0);
      rot(B.skirtB1, bk, 0, 0);
      rot(B.skirtB2, bk * 0.6, 0, 0);
      rot(B.skirtL1, gx * 0.5, 0, l + 0.05 * walkW * Math.sin(ph));
      rot(B.skirtL2, 0, 0, l * 0.6);
      rot(B.skirtR1, gx * 0.5, 0, r - 0.05 * walkW * Math.sin(ph));
      rot(B.skirtR2, 0, 0, r * 0.6);
    }
  }

  /** Sets the lineEnd bone: on your ring while it measures, else at the right hand's fingertips; oriented as the left hand. */
  _placeLineEnd(b) {
    const bones = this.bones;
    this.root.updateMatrixWorld(true);
    _m.copy(this.root.matrixWorld).invert();
    const le = bones[B.lineEnd];
    if (b.line && b.line.on) {
      _v.set(b.line.x, b.line.y, b.line.z).applyMatrix4(_m);
      // a little short of the ring (the hook end), taut
      le.position.copy(_v);
    } else {
      // the right hand's fingertips: its bind tip carried by the right small forearm
      _v.set(-0.12, 1.53, 0.2).sub(this._bind[B.smallForeR]);
      _v.applyMatrix4(bones[B.smallForeR].matrixWorld).applyMatrix4(_m);
      le.position.copy(_v);
    }
    // same orientation as the left forearm (so the ribbon does not twist)
    _m2.multiplyMatrices(_m, bones[B.smallForeL].matrixWorld);
    _m2.decompose(_v2, le.quaternion, _s);
    le.updateMatrixWorld(true);
  }

  /**
   * The chalk outline (the 'chalk' bone): on the wall beside you while it measures (it draws on), then it stays a while and fades;
   * collapsed (scale 0) when there is none. Returns its distance from the feet (the frustum bounds must reach it).
   */
  _updateOutline(b, d) {
    const o = b && b.outline;
    const on = !!(o && o.on && o.alpha > 0.002 && this.outlineTex);
    this.outline.visible = on;
    const cb = this.bones[B.chalk];
    const U = this.uniforms;
    if (!on) {
      cb.scale.set(1e-4, 1e-4, 1e-4);
      cb.position.set(0, 0, 0);
      cb.updateMatrixWorld(true);
      U.uChalkK.value.set(0, 0);
      return 0;
    }
    _z.set(o.nx, o.ny, o.nz).normalize();
    // upright on a wall: its up is the world's up projected on the wall
    _y.set(0, 1, 0).addScaledVector(_z, -_z.y);
    if (_y.lengthSq() < 1e-4) _y.set(1, 0, 0).addScaledVector(_z, -_z.x);
    _y.normalize();
    _x.crossVectors(_y, _z).normalize();
    _m.makeBasis(_x, _y, _z);
    _q.setFromRotationMatrix(_m);
    // into the root's frame
    _q2.copy(this.root.quaternion).invert();
    cb.quaternion.copy(_q2).multiply(_q);
    _v.set(o.x, o.y + 0.11, o.z); // the sim's point is level with your chest: the figure's feet below you
    _m2.copy(this.root.matrixWorld).invert();
    cb.position.copy(_v).applyMatrix4(_m2);
    // mirrored to the hand you hang by
    const hand = d && d.targetHand ? d.targetHand : this._outlineHand;
    this._outlineHand = hand;
    cb.scale.set(hand === 'left' ? -1 : 1, 1, 1);
    cb.updateMatrixWorld(true);
    U.uChalkK.value.set(o.grow, o.alpha);
    return cb.position.length();
  }

  dispose() {
    if (this.root.parent) this.root.parent.remove(this.root);
    for (const g of this.geometries) g.dispose();
    this.material.dispose();
    this.glints.geometry.dispose();
    this._glowMat.dispose();
    if (this.outlineTex) this.outlineTex.dispose();
    this.skeleton.dispose();
  }
}
