/* ABYSSAL TETHER 3D — mason/masonLegs.js
 * The Mason's legs: the 10 sim-driven LEAD legs (analytic 2-bone IK from the rendered flank to the sim's planted hook, the iron
 * metatarsus keeps its wrong-way back-bend because shank + metatarsus + grapnel are one rigid lower assembly) and the 26
 * FOLLOWER legs (a metachronal gait: one phase clock advances with the DISTANCE travelled (stride length ~ the leg's reach), every
 * leg owns a phase offset (the wave runs tail to head, the two sides in antiphase); a leg lifts when the clock crosses its offset,
 * swings for a time set by the speed, plants and then stays exactly where it landed until the next lift; an overextended foot is
 * re-planted at once so nothing ever slides). Writes world matrices straight into the leg Bones (the skin reads
 * bone.matrixWorld x boneInverse), allocation-free: typed scratch arrays and scalar maths only.
 *
 * Rest frame (glTF): the leg template is a LEFT leg (x < 0) relative to its vertebra bone's head; right legs mirror x. Every bone
 * is identity-oriented at rest, so a bone's world matrix is [R*s | its head's world position].
 */
import { clamp, frame, frameMap, setWorld, solve2 } from './masonPose.js';

function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function len(a) {
  return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
}
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function norm(a) {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Rest geometry of one side of the template leg: lengths and the two rest frames (row-major 3x3) of the 2-bone chain. */
function makeProto(chain, mirror) {
  const m = (p) => (mirror ? [-p[0], p[1], p[2]] : [p[0], p[1], p[2]]);
  const H = m(chain.hip);
  const K = m(chain.knee);
  const A = m(chain.ankle);
  const T = m(chain.toe);
  const X = m(chain.tip);
  const up0 = sub(K, H);
  const lo0 = sub(X, K);
  const D0 = sub(X, H);
  const kd = dot(up0, D0) / dot(D0, D0);
  const q0 = [up0[0] - D0[0] * kd, up0[1] - D0[1] * kd, up0[2] - D0[2] * kd];
  const N0 = norm(cross(norm(D0), norm(q0)));
  const a = len(up0);
  const b = len(lo0);
  const Fu = new Float64Array(9);
  const Fl = new Float64Array(9);
  const u = norm(up0);
  const l = norm(lo0);
  frame(Fu, u[0], u[1], u[2], N0[0], N0[1], N0[2]);
  frame(Fl, l[0], l[1], l[2], N0[0], N0[1], N0[2]);
  return { H, K, A, T, X, a, b, Fu, Fl, offA: sub(A, K), offT: sub(T, K), offX: sub(X, K), total: a + b, hip: H };
}

export const GAIT_MASON = { delta: 0.1, duty: 0.7, strideK: 0.8, minDur: 0.24, maxDur: 0.8, minStep: 0.12, maxDisp: 0.62, lift: 0.13 };
export const GAIT_SKITTER = { delta: 0.15, duty: 0.55, strideK: 1.15, minDur: 0.09, maxDur: 0.4, minStep: 0.1, maxDisp: 0.62, lift: 0.14 };

/**
 * @param {Object<string, THREE.Bone>} bones  name → Bone
 * @param {object} meta  glTF extras.mason (chain, legs)
 * @param {object} [gait]  GAIT_MASON / GAIT_SKITTER
 * @param {number} [size]  creature size (follower reach scales with it)
 */
export class MasonLegs {
  constructor(bones, meta, gait, size) {
    this.gait = gait || GAIT_MASON;
    this.size = size || 1;
    this.cycle = 0; // gait phase in cycles (advanced by the view: distance / stride)
    this.stride = this.gait.strideK * 7 * this.size; // metres per cycle
    this.onLand = null; // (x, y, z, side, weight, lead) -> void: a foot has just planted (dust, audio hooks)
    this.loadL = 0;
    this.loadR = 0;
    this.protos = { '-1': makeProto(meta.chain, false), '1': makeProto(meta.chain, true) };
    this.legs = [];
    this.lead = [];
    const total = this.protos['-1'].total;
    this.restTotal = total;
    for (const lg of meta.legs) {
      const side = lg.side < 0 ? -1 : 1;
      const proto = this.protos[String(side)];
      const bs = lg.bones.map((n) => bones[n]);
      if (bs.some((b) => !b)) continue;
      // lower-assembly bones with their rest offsets from the knee: lead [knee, ankle, toe], follower [knee, toe]
      const lower = lg.kind === 'lead' ? [bs[1], bs[2], bs[3]] : [bs[1], bs[2]];
      const off = lg.kind === 'lead' ? [[0, 0, 0], proto.offA, proto.offT] : [[0, 0, 0], proto.offT];
      const L = {
        name: lg.name,
        side,
        point: lg.point,
        kind: lg.kind,
        simLimb: lg.simLimb,
        proto,
        upper: bs[0],
        lower,
        off,
        reach: 8.6 - (lg.point - 2) * 0.24,
        // foothold state (followers)
        fx: 0,
        fy: 0,
        fz: 0,
        ox: 0,
        oy: 0,
        oz: 0,
        tx: 0,
        ty: 0,
        tz: 0,
        step: -1,
        dur: 0.3,
        placed: false,
        thr: 1,
        hipX: 0,
        hipY: 0,
        hipZ: 0,
        tap: 0,
        wasPlanted: true,
        phi: -lg.point * this.gait.delta + (side > 0 ? 0.5 : 0), // gait phase offset (cycles): rear legs lift first, sides in antiphase
        lastCyc: 0,
      };
      L.thr = 0.34 + 0.012 * lg.point + 0.05 * (((lg.point * 7 + (side > 0 ? 3 : 0)) % 5) / 4); // desynchronised thresholds, rear legs a touch later
      this.legs.push(L);
      if (lg.kind === 'lead') this.lead[lg.simLimb] = L;
    }
    this._ik = new Float64Array(7);
    this._fu = new Float64Array(9);
    this._fl = new Float64Array(9);
    this._r = new Float64Array(9);
    this._phase = 0;
    this.solids = [];
    this.stats = { stepping: 0, planted: 0, slide: 0, slideLead: 0 };
    this._probe = 0;
  }

  /** Forgets every follower foothold (teleport, respawn, first frame): they re-plant where they should be. */
  reset() {
    for (const L of this.legs) {
      L.placed = false;
      L.step = -1;
      L.lastCyc = Math.floor(this.cycle - L.phi);
    }
  }

  /**
   * One frame. F = spine frames (pos, fwd, up, right per sim point, 12 floats each), S = per-point uniform scale (world metres
   * per kit metre), limbs = body.limbs, level = for foothold probes (optional), freeze = hold every leg exactly where it is.
   */
  update(dt, F, S, limbs, level, freeze, lodFar, speed) {
    const legs = this.legs;
    let nStep = 0;
    let nPlanted = 0;
    let starts = 0;
    let swL = 0;
    let swR = 0;
    let totL = 0;
    let totR = 0;
    let slide = 0;
    let slideLead = 0;
    const ik = this._ik;
    for (let li = 0; li < legs.length; li++) {
      const L = legs[li];
      if (lodFar && L.kind !== 'lead' && L.point % 2 === 1) continue; // not drawn at LOD1
      const o = L.point * 12;
      const s = S[L.point];
      const side = L.side;
      const P = L.proto;
      // hip on the rendered flank (rest hip is relative to the vertebra bone's head)
      const hx = P.H[0] * s;
      const hy = P.H[1] * s;
      const hz = P.H[2] * s;
      const rx = F[o + 9];
      const ry = F[o + 10];
      const rz = F[o + 11];
      const ux = F[o + 6];
      const uy = F[o + 7];
      const uz = F[o + 8];
      const bx = -F[o + 3];
      const by = -F[o + 4];
      const bz = -F[o + 5];
      const HX = F[o] + rx * hx + ux * hy + bx * hz;
      const HY = F[o + 1] + ry * hx + uy * hy + by * hz;
      const HZ = F[o + 2] + rz * hx + uz * hy + bz * hz;
      L.hipX = HX;
      L.hipY = HY;
      L.hipZ = HZ;
      let tx;
      let ty;
      let tz;
      let reach;
      if (L.kind === 'lead') {
        const sim = limbs && limbs[L.simLimb];
        if (!sim) {
          this._hide(L);
          continue;
        }
        tx = sim.foot.x;
        ty = sim.foot.y;
        tz = sim.foot.z;
        reach = sim.reach || L.reach;
        if (sim.planted) nPlanted++;
        else {
          nStep++;
          if (side < 0) swL++;
          else swR++;
        }
        if (side < 0) totL++;
        else totR++;
        // two feeling taps on a surface before it plants (the leg_probe clip, procedurally)
        if (sim.planted && !L.wasPlanted) {
          L.tap = 0.8;
          if (this.onLand) this.onLand(sim.foot.x, sim.foot.y, sim.foot.z, side, 1, 1);
        }
        L.wasPlanted = sim.planted;
        if (L.tap > 0) {
          const k = 0.8 - L.tap;
          L.tap -= dt > 0 ? Math.min(dt, 0.1) : 0;
          const bump = Math.max(0, Math.sin(((k - 0.12) / 0.2) * Math.PI)) * (k > 0.12 && k < 0.32 ? 1 : 0) + Math.max(0, Math.sin(((k - 0.43) / 0.2) * Math.PI)) * (k > 0.43 && k < 0.63 ? 1 : 0);
          const lift = bump * 0.35 * reach * 0.1;
          tx += ux * lift;
          ty += uy * lift;
          tz += uz * lift;
        }
      } else {
        reach = L.reach * this.size;
        const r = this._follower(L, dt, HX, HY, HZ, F, o, s, level, freeze, speed);
        if (r === 1 || r === 2) {
          nStep++;
          if (side < 0) swL++;
          else swR++;
        } else nPlanted++;
        if (side < 0) totL++;
        else totR++;
        if (r === 2) starts++;
        tx = L.fx;
        ty = L.fy;
        tz = L.fz;
      }
      // leg scale: the leg spans the sim's reach (+4 % so planted knees stay bent)
      const sl = clamp((reach * 1.04) / P.total, 0.5 * this.size, 1.9);
      const a0 = P.a * sl;
      const b0 = P.b * sl;
      let px = ux * 1.0 + rx * side * 0.7 - F[o + 3] * 0.2;
      let py = uy * 1.0 + ry * side * 0.7 - F[o + 4] * 0.2;
      let pz = uz * 1.0 + rz * side * 0.7 - F[o + 5] * 0.2;
      const pl = Math.sqrt(px * px + py * py + pz * pz) || 1;
      px /= pl;
      py /= pl;
      pz /= pl;
      solve2(ik, HX, HY, HZ, tx, ty, tz, a0, b0, px, py, pz, 1.18);
      const gx = ik[4] - tx;
      const gy = ik[5] - ty;
      const gz = ik[6] - tz;
      const gap = Math.sqrt(gx * gx + gy * gy + gz * gz);
      L.gap = gap;
      // only planted feet count as a slide (a raised foot may fall short of its lifted target mid-swing)
      if (L.kind === 'lead') {
        if (limbs && limbs[L.simLimb] && limbs[L.simLimb].planted && gap > slideLead) slideLead = gap;
      } else if (L.step < 0 && gap > slide) slide = gap;
      const KX = ik[0];
      const KY = ik[1];
      const KZ = ik[2];
      const str = ik[3];
      const sc = sl * str;
      // bend-plane normal from the solved chain: D x q (q = the knee's side, made perpendicular to D)
      let dX = ik[4] - HX;
      let dY = ik[5] - HY;
      let dZ = ik[6] - HZ;
      const dl = Math.sqrt(dX * dX + dY * dY + dZ * dZ) || 1;
      dX /= dl;
      dY /= dl;
      dZ /= dl;
      let qx = KX - HX;
      let qy = KY - HY;
      let qz = KZ - HZ;
      const qd = qx * dX + qy * dY + qz * dZ;
      qx -= dX * qd;
      qy -= dY * qd;
      qz -= dZ * qd;
      const ql = Math.sqrt(qx * qx + qy * qy + qz * qz);
      let nx;
      let ny;
      let nz;
      if (ql < 1e-4) {
        nx = ux;
        ny = uy;
        nz = uz;
      } else {
        qx /= ql;
        qy /= ql;
        qz /= ql;
        nx = dY * qz - dZ * qy;
        ny = dZ * qx - dX * qz;
        nz = dX * qy - dY * qx;
      }
      // upper bone
      let ax = KX - HX;
      let ay = KY - HY;
      let az = KZ - HZ;
      let al = Math.sqrt(ax * ax + ay * ay + az * az) || 1;
      ax /= al;
      ay /= al;
      az /= al;
      frame(this._fu, ax, ay, az, nx, ny, nz);
      frameMap(this._r, this._fu, sc, sc, sc, P.Fu);
      setWorld(L.upper.matrixWorld.elements, this._r, HX, HY, HZ);
      // lower assembly (shank + metatarsus + grapnel, one rigid piece)
      let lx = ik[4] - KX;
      let ly = ik[5] - KY;
      let lz = ik[6] - KZ;
      let ll = Math.sqrt(lx * lx + ly * ly + lz * lz) || 1;
      lx /= ll;
      ly /= ll;
      lz /= ll;
      frame(this._fl, lx, ly, lz, nx, ny, nz);
      frameMap(this._r, this._fl, sc, sc, sc, P.Fl);
      const r = this._r;
      for (let j = 0; j < L.lower.length; j++) {
        const f = L.off[j];
        const ox = r[0] * f[0] + r[1] * f[1] + r[2] * f[2];
        const oy = r[3] * f[0] + r[4] * f[1] + r[5] * f[2];
        const oz = r[6] * f[0] + r[7] * f[1] + r[8] * f[2];
        setWorld(L.lower[j].matrixWorld.elements, r, KX + ox, KY + oy, KZ + oz);
      }
    }
    this.stats.stepping = nStep;
    this.stats.planted = nPlanted;
    this.stats.slide = slide;
    this.stats.slideLead = slideLead;
    this.loadL = totL ? swL / totL : 0;
    this.loadR = totR ? swR / totR : 0;
    this._probe = starts;
  }

  _hide(L) {
    const e = L.upper.matrixWorld.elements;
    e.fill(0);
    e[15] = 1;
    e[13] = -1e5;
    for (const b of L.lower) {
      const f = b.matrixWorld.elements;
      f.fill(0);
      f[15] = 1;
      f[13] = -1e5;
    }
  }

  /**
   * Follower foothold. Returns 0 planted, 1 stepping, 2 stepping (just started).
   */
  _follower(L, dt, HX, HY, HZ, F, o, s, level, freeze, speed) {
    const g = this.gait;
    const reach = L.reach * this.size;
    const ux = F[o + 6];
    const uy = F[o + 7];
    const uz = F[o + 8];
    const rx = F[o + 9];
    const ry = F[o + 10];
    const rz = F[o + 11];
    const fx = F[o + 3];
    const fy = F[o + 4];
    const fz = F[o + 5];
    // the ideal foothold: out to the side, down toward the surface, a little forward
    const out = reach * 0.46 * L.side;
    const down = this.hug * 0.92 + reach * 0.12;
    const ix = HX + rx * out - ux * down + fx * reach * 0.06;
    const iy = HY + ry * out - uy * down + fy * reach * 0.06;
    const iz = HZ + rz * out - uz * down + fz * reach * 0.06;
    if (!L.placed || dt <= 0) {
      this._probeSurface(L, level, HX, HY, HZ, ix, iy, iz, ux, uy, uz, reach);
      L.fx = L.tx;
      L.fy = L.ty;
      L.fz = L.tz;
      L.placed = true;
      L.step = -1;
      L.lastCyc = Math.floor(this.cycle - L.phi);
      return 0;
    }
    if (freeze && L.step < 0) return 0;
    if (L.step >= 0) {
      if (freeze) return 1; // a raised leg stays raised
      L.step += dt / L.dur;
      if (L.step >= 1) {
        L.step = -1;
        L.fx = L.tx;
        L.fy = L.ty;
        L.fz = L.tz;
        if (this.onLand) this.onLand(L.fx, L.fy, L.fz, L.side, 0.4 + 0.6 * Math.min(1, speed / 6), 0);
        return 0;
      }
      const k = L.step;
      // lift early, plant late: the foot rises fast, glides, and the last quarter is a controlled descent
      const e = k * k * (3 - 2 * k);
      const lift = Math.sin(Math.PI * Math.pow(k, 0.8)) * reach * g.lift;
      L.fx = L.ox + (L.tx - L.ox) * e + ux * lift;
      L.fy = L.oy + (L.ty - L.oy) * e + uy * lift;
      L.fz = L.oz + (L.tz - L.oz) * e + uz * lift;
      return 1;
    }
    const dx = L.fx - ix;
    const dy = L.fy - iy;
    const dz = L.fz - iz;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    // the gait clock crossing this leg's offset lifts it (if the body has actually carried it somewhere); a foot dragged past
    // its limit lifts at once whatever the clock says (nothing ever slides)
    const cyc = Math.floor(this.cycle - L.phi);
    let go = false;
    let urgent = false;
    if (cyc !== L.lastCyc) {
      L.lastCyc = cyc;
      if (d > g.minStep * reach && speed > 0.12) go = true;
    }
    const hx = L.fx - HX;
    const hy = L.fy - HY;
    const hz = L.fz - HZ;
    if (d > g.maxDisp * reach || hx * hx + hy * hy + hz * hz > reach * reach * 1.06 * 1.06) {
      go = true; // dragged past the limit of the leg: lift at once
      urgent = true;
    }
    if (go && (urgent || this._canStep(L))) {
      // swing time from the speed (a stride ~ one cycle of the clock); aim ahead so the foot lands where the body will have carried it
      const dur = clamp((this.stride * (1 - g.duty)) / Math.max(speed, 0.6), g.minDur, g.maxDur) * (urgent ? 0.8 : 1);
      const lead = reach * 0.2 + clamp(speed, 0, 16) * dur * 0.9;
      this._probeSurface(L, level, HX, HY, HZ, ix + fx * lead, iy + fy * lead, iz + fz * lead, ux, uy, uz, reach);
      // the landing spot must be within the leg's reach of where the hip will be then
      const lx = L.tx - HX - fx * speed * dur;
      const ly = L.ty - HY - fy * speed * dur;
      const lz = L.tz - HZ - fz * speed * dur;
      const ld = Math.sqrt(lx * lx + ly * ly + lz * lz);
      const lim = reach * 0.97;
      if (ld > lim) {
        const k = lim / ld;
        L.tx = HX + fx * speed * dur + lx * k;
        L.ty = HY + fy * speed * dur + ly * k;
        L.tz = HZ + fz * speed * dur + lz * k;
      }
      L.ox = L.fx;
      L.oy = L.fy;
      L.oz = L.fz;
      L.step = 0;
      L.dur = dur;
      return 2;
    }
    return 0;
  }

  _canStep(L) {
    // a neighbour on the same side (or the opposite leg of this segment) already lifted: wait (no two adjacent legs in the air)
    const legs = this.legs;
    for (let i = 0; i < legs.length; i++) {
      const M = legs[i];
      if (M === L || M.step < 0) continue;
      const dp = M.point - L.point;
      if (dp === 0) return false; // never both feet of one pair in the air
    }
    return true;
  }

  /** Surface foothold near (ix,iy,iz): a ray from the hip toward it against the level's structural solids; hangs in the air when nothing is there. */
  _probeSurface(L, level, HX, HY, HZ, ix, iy, iz, ux, uy, uz, reach) {
    let dx = ix - HX;
    let dy = iy - HY;
    let dz = iz - HZ;
    const dl = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    dx /= dl;
    dy /= dl;
    dz /= dl;
    let t = Math.min(reach * 1.25, dl * 1.5 + 1);
    let hit = false;
    if (level && typeof level.querySolids === 'function') {
      const ex = HX + dx * t;
      const ey = HY + dy * t;
      const ez = HZ + dz * t;
      const list = level.querySolids(Math.min(HX, ex) - 0.5, Math.min(HY, ey) - 0.5, Math.min(HZ, ez) - 0.5, Math.max(HX, ex) + 0.5, Math.max(HY, ey) + 0.5, Math.max(HZ, ez) + 0.5, this.solids);
      let best = t;
      for (let i = 0; i < list.length; i++) {
        const b = list[i];
        if (b.active === false || b.kind === 'grate' || b.kind === 'crumble') continue;
        const h = castBox(HX, HY, HZ, dx, dy, dz, b, best);
        if (h >= 0 && h < best) {
          best = h;
          hit = true;
        }
      }
      if (hit) t = best;
    }
    if (hit) {
      L.tx = HX + dx * t - dx * 0.05;
      L.ty = HY + dy * t - dy * 0.05;
      L.tz = HZ + dz * t - dz * 0.05;
    } else {
      L.tx = ix;
      L.ty = iy;
      L.tz = iz;
    }
  }
}
MasonLegs.prototype.hug = 3.2;

/** Entry distance of the ray (o, d) into box b within [0, maxT], -1 when it misses (0 when the origin is inside). */
export function castBox(ox, oy, oz, dx, dy, dz, b, maxT) {
  let t0 = 0;
  let t1 = maxT;
  if (Math.abs(dx) < 1e-9) {
    if (ox < b.minX || ox > b.maxX) return -1;
  } else {
    let a = (b.minX - ox) / dx;
    let c = (b.maxX - ox) / dx;
    if (a > c) {
      const tmp = a;
      a = c;
      c = tmp;
    }
    if (a > t0) t0 = a;
    if (c < t1) t1 = c;
    if (t0 > t1) return -1;
  }
  if (Math.abs(dy) < 1e-9) {
    if (oy < b.minY || oy > b.maxY) return -1;
  } else {
    let a = (b.minY - oy) / dy;
    let c = (b.maxY - oy) / dy;
    if (a > c) {
      const tmp = a;
      a = c;
      c = tmp;
    }
    if (a > t0) t0 = a;
    if (c < t1) t1 = c;
    if (t0 > t1) return -1;
  }
  if (Math.abs(dz) < 1e-9) {
    if (oz < b.minZ || oz > b.maxZ) return -1;
  } else {
    let a = (b.minZ - oz) / dz;
    let c = (b.maxZ - oz) / dz;
    if (a > c) {
      const tmp = a;
      a = c;
      c = tmp;
    }
    if (a > t0) t0 = a;
    if (c < t1) t1 = c;
    if (t0 > t1) return -1;
  }
  return t0;
}
