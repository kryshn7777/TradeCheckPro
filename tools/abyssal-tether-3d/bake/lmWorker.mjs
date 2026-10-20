/* ABYSSAL TETHER 3D — lmWorker.mjs
 * Worker thread of the lightmap baker (bake_lightmaps.mjs). Two jobs over ranges of texels of the shared texel arrays:
 *   'direct'  direct light at the texel: point lamps (area-sampled shadows), the shaft key (cone-sampled), the light
 *             shafts (line emitters). Writes D (static rgb), DL (flame-lamp scalar), valid.
 *   'gather'  cosine-weighted ray gather: ambient occlusion (first pass) and one more bounce of (D + DL·tint + B_prev) off
 *             the albedo of what each ray hits. Writes AO and B (the new bounce field).
 * Every texel uses an RNG seeded by (texel, pass), so results never depend on which worker runs which range.
 */

import { parentPort, workerData } from 'node:worker_threads';
import { BoxGrid } from './lmTrace.mjs';
import { lookAt } from './lmTheme.mjs';
import { LM_FACE } from '../../../public/abyssal-tether-3d/src/render/lightmapFormat.js';

const W = workerData;
const grid = new BoxGrid(W.boxes, W.cfg.gridMin, W.cfg.gridSize, W.cfg.cell, W.gridShared);
const CH = W.charts; // stride 16
const CS = 16;
const nCharts = CH.length / CS;
const D = W.D;
const DL = W.DL;
const AO = W.AO;
const VALID = W.valid;
const BUF = [W.B0, W.B1];
const FACE_CHART = W.faceChart;
const ALB = W.albedo;
const LIGHTS = W.lights; // stride 12
const NL = LIGHTS.length / 12;
const SHAFTS = W.shafts; // stride 12
const NS = SHAFTS.length / 12;
const TINT = W.tints; // 3 per section
const Q = W.quality;
const themes = W.themes;
const KEY = W.keyDir;
const LIFT = W.cfg.lift;
const CAP = 3.0;

// ---------------------------------------------------------------------------------------------------------------------
let rs = 1;
function seed(tid, pass) {
  let h = (Math.imul(tid + 1, 0x9e3779b1) ^ Math.imul(pass + 7, 0x85ebca6b) ^ W.cfg.seed) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  rs = (h ^ (h >>> 16)) >>> 0 || 1;
}
function rnd() {
  rs ^= rs << 13;
  rs >>>= 0;
  rs ^= rs >>> 17;
  rs ^= rs << 5;
  rs >>>= 0;
  return rs / 4294967296;
}

function chartOf(tid) {
  let lo = 0;
  let hi = nCharts - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (CH[mid * CS + 13] <= tid) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

const look = {};
const P = [0, 0, 0];
const N = [0, 0, 0];

/** Sets P (the sample point, lifted off the surface) and N for texel (i, j) of chart c; returns false if it is inside a solid. */
function texelPoint(c, i, j) {
  const o = c * CS;
  const a = CH[o + 2];
  const sign = CH[o + 3];
  const sa = CH[o + 4];
  const ta = CH[o + 5];
  const w = CH[o + 11];
  const h = CH[o + 12];
  N[0] = N[1] = N[2] = 0;
  N[a] = sign;
  P[a] = CH[o + 6] + sign * LIFT;
  P[sa] = CH[o + 7] + ((i + 0.5) / w) * (CH[o + 8] - CH[o + 7]);
  P[ta] = CH[o + 9] + ((j + 0.5) / h) * (CH[o + 10] - CH[o + 9]);
  return !grid.inside(P[0], P[1], P[2]);
}

// ---------------------------------------------------------------------------------------------------------------------
// Direct light
// ---------------------------------------------------------------------------------------------------------------------
const dir = [0, 0, 0];
const HV = [0, 0, 0];
function sphereDir() {
  const z = 1 - 2 * rnd();
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  const p = 6.283185307 * rnd();
  dir[0] = r * Math.cos(p);
  dir[1] = z;
  dir[2] = r * Math.sin(p);
}

function directAt(tid, out) {
  // out: [r, g, b, lamp]
  let er = 0;
  let eg = 0;
  let eb = 0;
  let el = 0;
  const px = P[0];
  const py = P[1];
  const pz = P[2];
  const nx = N[0];
  const ny = N[1];
  const nz = N[2];
  // ---- point lamps (soft shadows: random points on the lamp's sphere)
  for (let l = 0; l < NL; l++) {
    const o = l * 12;
    const dx = LIGHTS[o] - px;
    const dy = LIGHTS[o + 1] - py;
    const dz = LIGHTS[o + 2] - pz;
    const d2 = dx * dx + dy * dy + dz * dz;
    const R = LIGHTS[o + 7];
    if (d2 >= R * R) continue;
    const d = Math.sqrt(d2);
    if ((dx * nx + dy * ny + dz * nz) / d <= 0.001) continue;
    const rad = LIGHTS[o + 8];
    const ns = d < 3 ? Q.lampSamples + 1 : Q.lampSamples;
    let vis = 0;
    let cosAcc = 0;
    for (let k = 0; k < ns; k++) {
      sphereDir();
      const tx = dx + dir[0] * rad;
      const ty = dy + dir[1] * rad;
      const tz = dz + dir[2] * rad;
      const td = Math.sqrt(tx * tx + ty * ty + tz * tz);
      const c = (tx * nx + ty * ny + tz * nz) / td;
      if (c <= 0) continue;
      if (grid.trace(px, py, pz, tx / td, ty / td, tz / td, td - 0.06) === Infinity) {
        vis++;
        cosAcc += c;
      }
    }
    if (!vis) continue;
    const q = d / R;
    const win = Math.max(0, 1 - q * q * q * q);
    let e = (LIGHTS[o + 6] * (cosAcc / ns) * win * win) / Math.max(d2, 1.0);
    e = CAP * Math.tanh(e / CAP); // a lamp right next to a surface must not burn a hole in the encoding range
    if (LIGHTS[o + 9] > 0.5) {
      // flame lamp: scalar luminance of its colour × e
      el += e * LIGHTS[o + 10];
    } else {
      er += e * LIGHTS[o + 3];
      eg += e * LIGHTS[o + 4];
      eb += e * LIGHTS[o + 5];
    }
  }
  // ---- light shafts (vertical line emitters: analytic unoccluded irradiance × sampled visibility)
  for (let s = 0; s < NS; s++) {
    const o = s * 12;
    const hx = SHAFTS[o] - px;
    const hz = SHAFTS[o + 3] - pz;
    const reach = SHAFTS[o + 9];
    const rho2 = hx * hx + hz * hz;
    if (rho2 > reach * reach) continue;
    const y0 = SHAFTS[o + 1];
    const y1 = SHAFTS[o + 2];
    if (py < y0 - reach || py > y1 + reach) continue;
    const rad = SHAFTS[o + 4];
    const A = nx * hx + nz * hz;
    const r2 = rho2 + 1.0 + rad * rad * 0.25; // softened: the beam has a radius
    let u0 = y0 - py;
    let u1 = y1 - py;
    // only the part of the line in front of the surface (n·v > 0)
    if (ny > 1e-4) u0 = Math.max(u0, -A / ny);
    else if (ny < -1e-4) u1 = Math.min(u1, -A / ny);
    if (u1 <= u0) continue;
    const F = (u) => (A * u) / (r2 * Math.sqrt(r2 + u * u)) - ny / Math.sqrt(r2 + u * u);
    let e = SHAFTS[o + 8] * (F(u1) - F(u0));
    if (e <= 0) continue;
    const f = Math.max(0, 1 - Math.sqrt(rho2) / reach);
    e *= f * f;
    // visibility: stratified points along the visible part of the axis
    const ns = Q.shaftSamples;
    let vis = 0;
    for (let k = 0; k < ns; k++) {
      const u = u0 + ((k + rnd()) / ns) * (u1 - u0);
      const a = 6.283185307 * rnd();
      const rr = rad * Math.sqrt(rnd());
      const tx = hx + Math.cos(a) * rr;
      const tz = hz + Math.sin(a) * rr;
      const td = Math.sqrt(tx * tx + u * u + tz * tz);
      if (td < 0.2) {
        vis++;
        continue;
      }
      if (grid.trace(px, py, pz, tx / td, u / td, tz / td, td - 0.06) === Infinity) vis++;
    }
    e *= vis / ns;
    er += e * SHAFTS[o + 5];
    eg += e * SHAFTS[o + 6];
    eb += e * SHAFTS[o + 7];
  }
  // ---- the shaft key (cone-sampled visibility)
  lookAt(themes, py, look);
  const nl = nx * KEY[0] + ny * KEY[1] + nz * KEY[2];
  if (nl > 0 && look.keyK > 0) {
    // basis around the key direction
    const ux = Math.abs(KEY[1]) < 0.9 ? 0 : 1;
    const uy = Math.abs(KEY[1]) < 0.9 ? 1 : 0;
    let ax = KEY[1] * 0 - KEY[2] * uy;
    let ay = KEY[2] * ux - KEY[0] * 0;
    let az = KEY[0] * uy - KEY[1] * ux;
    const al = Math.hypot(ax, ay, az);
    ax /= al;
    ay /= al;
    az /= al;
    const bx = KEY[1] * az - KEY[2] * ay;
    const by = KEY[2] * ax - KEY[0] * az;
    const bz = KEY[0] * ay - KEY[1] * ax;
    let vis = 0;
    const ns = Q.keySamples;
    for (let k = 0; k < ns; k++) {
      const r = 0.16 * Math.sqrt(rnd());
      const a = 6.283185307 * rnd();
      let dx = KEY[0] + (ax * Math.cos(a) + bx * Math.sin(a)) * r;
      let dy = KEY[1] + (ay * Math.cos(a) + by * Math.sin(a)) * r;
      let dz = KEY[2] + (az * Math.cos(a) + bz * Math.sin(a)) * r;
      const dl = Math.sqrt(dx * dx + dy * dy + dz * dz);
      dx /= dl;
      dy /= dl;
      dz /= dl;
      if (nx * dx + ny * dy + nz * dz <= 0) continue;
      if (grid.trace(px, py, pz, dx, dy, dz, Q.keyRange) === Infinity) vis++;
    }
    const v = vis / ns;
    // the old runtime gave blocked regions a share of the key (a slanted cold fill, not a sun): keyFloor of it stays
    const k = look.keyK * nl * (Q.keyFloor + (1 - Q.keyFloor) * v);
    er += k * look.keyCol[0];
    eg += k * look.keyCol[1];
    eb += k * look.keyCol[2];
  }
  out[0] = er;
  out[1] = eg;
  out[2] = eb;
  out[3] = el;
}

// ---------------------------------------------------------------------------------------------------------------------
// Gather
// ---------------------------------------------------------------------------------------------------------------------
function gatherAt(tid, pass, K, src, out) {
  const px = P[0];
  const py = P[1];
  const pz = P[2];
  // basis: n and the two other world axes
  let a = 0;
  let sg = 1;
  if (N[1] !== 0) {
    a = 1;
    sg = N[1];
  } else if (N[2] !== 0) {
    a = 2;
    sg = N[2];
  } else {
    sg = N[0];
  }
  const e1 = (a + 1) % 3;
  const e2 = (a + 2) % 3;
  const Bs = BUF[src];
  const r1 = rnd();
  const r2 = rnd();
  let sr = 0;
  let sg2 = 0;
  let sb = 0;
  let occ = 0;
  const aoR = Q.aoRange;
  for (let k = 0; k < K; k++) {
    const u = (k + r1) / K;
    const v = (k * 0.6180339887 + r2) % 1;
    const sinT = Math.sqrt(u);
    const cosT = Math.sqrt(1 - u);
    const ph = 6.283185307 * v;
    const ct = sinT * Math.cos(ph);
    const st = sinT * Math.sin(ph);
    dir[a] = cosT * sg;
    dir[e1] = ct;
    dir[e2] = st;
    const t = grid.trace(px, py, pz, dir[0], dir[1], dir[2], Q.gatherRange);
    if (t === Infinity) continue;
    if (t < aoR) occ += 1 - t / aoR;
    const bi = grid.hitBox;
    const f = grid.hitAxis * 2 + (grid.hitSign > 0 ? 0 : 1);
    const cid = FACE_CHART[bi * 6 + f];
    if (cid < 0) continue;
    const o = cid * CS;
    const hs = LM_FACE[f][2];
    const ht = LM_FACE[f][3];
    const hp = px + dir[0] * t;
    const hq = py + dir[1] * t;
    const hr = pz + dir[2] * t;
    HV[0] = hp;
    HV[1] = hq;
    HV[2] = hr;
    let u0 = (HV[hs] - CH[o + 7]) / (CH[o + 8] - CH[o + 7]);
    let v0 = (HV[ht] - CH[o + 9]) / (CH[o + 10] - CH[o + 9]);
    u0 = u0 < 0 ? 0 : u0 > 0.9999 ? 0.9999 : u0;
    v0 = v0 < 0 ? 0 : v0 > 0.9999 ? 0.9999 : v0;
    const tid2 = CH[o + 13] + Math.floor(v0 * CH[o + 12]) * CH[o + 11] + Math.floor(u0 * CH[o + 11]);
    const sec = CH[o + 14];
    const dl = DL[tid2];
    const er = Math.min(6, D[tid2 * 3] + dl * TINT[sec * 3] + Bs[tid2 * 3]);
    const eg = Math.min(6, D[tid2 * 3 + 1] + dl * TINT[sec * 3 + 1] + Bs[tid2 * 3 + 1]);
    const eb = Math.min(6, D[tid2 * 3 + 2] + dl * TINT[sec * 3 + 2] + Bs[tid2 * 3 + 2]);
    const so = CH[o] * 3;
    sr += ALB[so] * er;
    sg2 += ALB[so + 1] * eg;
    sb += ALB[so + 2] * eb;
  }
  out[0] = sr / K;
  out[1] = sg2 / K;
  out[2] = sb / K;
  out[3] = occ / K;
}

// ---------------------------------------------------------------------------------------------------------------------
const tmp = [0, 0, 0, 0];
parentPort.on('message', (m) => {
  if (m.op === 'exit') {
    process.exit(0);
  }
  const { op, a, b, pass, K, src, dst } = m;
  let c = chartOf(a);
  for (let tid = a; tid < b; tid++) {
    while (c < nCharts - 1 && CH[(c + 1) * CS + 13] <= tid) c++;
    const o = c * CS;
    const w = CH[o + 11];
    const local = tid - CH[o + 13];
    const j = Math.floor(local / w);
    const i = local - j * w;
    const ok = texelPoint(c, i, j);
    seed(tid, pass);
    if (op === 'direct') {
      VALID[tid] = ok ? 1 : 0;
      if (!ok) continue;
      directAt(tid, tmp);
      D[tid * 3] = tmp[0];
      D[tid * 3 + 1] = tmp[1];
      D[tid * 3 + 2] = tmp[2];
      DL[tid] = tmp[3];
    } else {
      if (!VALID[tid]) continue;
      gatherAt(tid, pass, K, src, tmp);
      const Bd = BUF[dst];
      Bd[tid * 3] = tmp[0];
      Bd[tid * 3 + 1] = tmp[1];
      Bd[tid * 3 + 2] = tmp[2];
      if (pass === 0) AO[tid] = tmp[3];
    }
  }
  parentPort.postMessage({ id: m.id });
});
