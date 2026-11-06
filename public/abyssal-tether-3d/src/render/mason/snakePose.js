/* THE LANTERN — render/mason/snakePose.js
 * MASON SNAKE ATTACK (plans/MASON_SNAKE_ATTACK.md): the cobra. Two halves, both pure (no three), deterministic and allocation-free:
 *
 *   update(dt, ph, reduced)   the ENVELOPES from the attack phase (render/mason/attackPhase.js): coil (the S-curve rear, a spring that
 *                             overshoots on the recoil), sway (a phase accumulator, slowing toward the lock, still ON the lock), the
 *                             strike stretch (1.5 frames of squash, then the front extends along the locked line), the dash's low
 *                             surge, the jaw, the eyes, the red glow light, and the smoothed aim point the head tracks
 *   apply(F, S, n, size)      the POSE over the spine frames the views already compute (F: pos, fwd, up, right x n; S: block scale):
 *                             the front LINKS links are rebuilt as a chain with the sim's own link lengths, pitched off the body's
 *                             forward toward its up by the cobra profile and yawed toward the aim, blended with the sim chain by the
 *                             coil (0 = the sim body exactly); the head frame looks at the aim
 *
 * Only the creature moves (never the camera). reducedEffects: less sway, no squash, a damped recoil, a smaller light flare.
 */

export const SNAKE = Object.freeze({
  links: 7, // spine points 0..6 are reshaped, anchored at point 7
  // pitch (deg) of each link from the anchor to the head: up steeply, over, and the head tipped down at you (the cobra S)
  pitch: Object.freeze([22, 52, 78, 84, 58, 18, -18]),
  yawMax: 70, // deg: how far the coil turns toward the aim off the body's forward
  swayYaw: 6, // deg at the head (stare)
  swayWeave: 3, // deg of the lateral S travelling down the neck
  swayHz: 0.75,
  swayHzLock: 0.45, // the weave slows as the lock nears
  reducedSway: 0.35,
  minGap: 4.5, // m (x size): the coiled head never comes nearer the aim than this (the S flattens)
  stretch: 1.8, // m (x size): the strike extends the front along the locked line
  squash: 0.25, // m: the anticipation pull-back
  squashT: 0.15, // share of the strike the squash lasts (0.15 x 0.16 s = 1.5 frames)
  dashLower: 0.6, // m (x size): the dash's front blocks pressed to the stone
  dashForward: 0.7, // m (x size): ... and drawn forward
  aimRate: 6, // 1/s: the head tracks the aim (stare / rise)
  aimRateRecoil: 8,
});

const D2R = Math.PI / 180;
const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (v) => {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
};
const fin = (v) => typeof v === 'number' && v === v && v !== Infinity && v !== -Infinity;

// per phase: coil target, spring rate (rad/s), damping, sway, jaw (mandible open, rad-ish), eyes (glow), light flare
const P_IDLE = 0;
const P_STALK = 1;
const P_DASH = 2;
const P_RISE = 3;
const P_STARE = 4;
const P_LOCK = 5;
const P_STRIKE = 6;
const P_RECOIL = 7;
const PIDX = Object.freeze({ idle: P_IDLE, stalk: P_STALK, dash: P_DASH, rise: P_RISE, stare: P_STARE, lock: P_LOCK, strike: P_STRIKE, recoil: P_RECOIL });

export class SnakePose {
  constructor() {
    this.active = false; // anything to apply (coil / stretch / dash above a hair)
    this.phase = 'idle';
    this.coil = 0;
    this.coilV = 0;
    this.sway = 0; // amplitude 0..1 (x the reduced factor)
    this.swayPh = 0; // the accumulator (rad)
    this.stretch = 0; // -squash .. 1
    this.dash = 0;
    this.jaw = -1; // the mandibles' target (< -0.9: leave them to the clip graph)
    this.eyes = 0; // the eye glow floor (0: the face's own)
    this.lightFlare = 0;
    this.tension = 0; // 0..1: the rattle's pace / level (rising toward the lock)
    this.aimX = 0;
    this.aimY = 0;
    this.aimZ = 0;
    this.lockX = 0; // the strike line's target
    this.lockY = 0;
    this.lockZ = 0;
    this._haveAim = false;
    this.reduced = false;
    // the coiled head (world) after the last apply(): the sounds and the light follow it
    this.headX = 0;
    this.headY = 0;
    this.headZ = 0;
    this.headOk = false;
    // scratch (the rebuilt chain)
    this._P = new Float64Array((SNAKE.links + 1) * 3);
    this._U = new Float64Array((SNAKE.links + 1) * 3);
    this._L = new Float64Array(SNAKE.links);
    this._SK = new Float64Array(SNAKE.links + 1).fill(1); // the block scale factors of the last apply (stretch / squash / dash)
    this._c0 = -1; // the coil when the strike began
    this.lastScale = 1; // the S's height factor used by the last apply (tests)
  }

  reset() {
    this.active = false;
    this.phase = 'idle';
    this.coil = this.coilV = this.sway = this.swayPh = this.stretch = this.dash = 0;
    this.jaw = -1;
    this.eyes = this.lightFlare = this.tension = 0;
    this._haveAim = false;
    this.headOk = false;
  }

  /**
   * The envelopes for this frame.
   * @param {number} dt
   * @param {import('./attackPhase.js').AttackPhase} ph   the adapter (phase, t01, time, aim)
   * @param {boolean} reduced  settings.reducedEffects
   */
  update(dt, ph, reduced) {
    dt = dt > 0 ? (dt < 0.1 ? dt : 0.1) : 0;
    this.reduced = !!reduced;
    const name = ph ? ph.phase : 'idle';
    const p = PIDX[name] === undefined ? P_IDLE : PIDX[name];
    const u = ph ? clamp01(ph.t01) : 0;
    const time = ph ? ph.time : 0;
    // ---- coil (spring) ----
    let target = 0;
    let w = 6;
    let z = 1;
    if (p === P_RISE) {
      target = smooth(u * 1.15);
      w = 9;
    } else if (p === P_STARE) {
      target = 1;
      w = 7;
    } else if (p === P_LOCK) {
      target = 1.06; // drawn back: the anticipation
      w = 18;
      z = 0.9;
    } else if (p === P_STRIKE) {
      target = 0;
      w = 45;
      z = 1;
    } else if (p === P_RECOIL) {
      target = 1;
      w = 14;
      z = reduced ? 0.8 : 0.42; // the whip back overshoots (~12 %)
    } else if (p === P_DASH) {
      target = 0;
      w = 10;
    } else {
      target = 0;
      w = 3.5;
    }
    if (p === P_STRIKE && !(ph && ph.held)) {
      // the release is driven by the strike's own clock (in step with the stretch): the head flies out over ~0.1 s, not in one frame
      if (this.phase !== name || this._c0 < 0) this._c0 = this.coil;
      const c1 = this._c0 * (1 - smooth((u - SNAKE.squashT) / 0.55));
      this.coilV = dt > 0 ? (c1 - this.coil) / dt : 0;
      this.coil = c1;
    } else if (dt > 0) {
      this._c0 = -1;
      const n = Math.max(1, Math.ceil(dt / 0.008));
      const h = dt / n;
      for (let i = 0; i < n; i++) {
        this.coilV += (w * w * (target - this.coil) - 2 * z * w * this.coilV) * h;
        this.coil += this.coilV * h;
      }
    }
    this.coil = clamp(this.coil, -0.1, 1.3);
    this.phase = name;
    // ---- sway: fades in while coiled, slows toward the lock, gone on it ----
    let swayT = 0;
    let hz = SNAKE.swayHz;
    if (p === P_RISE) {
      swayT = 0.4 + 0.6 * u;
    } else if (p === P_STARE) {
      swayT = 1;
      hz = SNAKE.swayHz + (SNAKE.swayHzLock - SNAKE.swayHz) * u;
    } else if (p === P_RECOIL) swayT = 0.6 * u;
    if (reduced) swayT *= SNAKE.reducedSway;
    const sk = p === P_LOCK || p === P_STRIKE ? 1 - Math.exp(-dt * 30) : 1 - Math.exp(-dt * 4); // the lock stills it in ~0.1 s
    this.sway += (swayT - this.sway) * sk;
    if (p !== P_LOCK && p !== P_STRIKE) {
      this.swayPh += TAU * hz * dt;
      if (this.swayPh > TAU * 64) this.swayPh -= TAU * 64;
    }
    // ---- the strike stretch ----
    let st = 0;
    if (p === P_STRIKE) {
      if (u < SNAKE.squashT && !reduced) st = -SNAKE.squash * Math.sin((Math.PI * u) / SNAKE.squashT); // 1-2 frames of squash
      else st = smooth((u - (reduced ? 0 : SNAKE.squashT)) / 0.45);
      this.stretch = st; // driven directly: the strike is too short for a filter
    } else {
      if (p === P_RECOIL) st = 1 - smooth(time / 0.2);
      this.stretch += (st - this.stretch) * (1 - Math.exp(-dt * 22));
    }
    // ---- the dash: low and drawn forward ----
    const dT = p === P_DASH ? 1 : 0;
    this.dash += (dT - this.dash) * (1 - Math.exp(-dt * (dT > this.dash ? 9 : 5)));
    // ---- face ----
    if (p === P_LOCK) {
      this.jaw = 1.25;
      this.eyes = 1.3 + 1.3 * smooth(time / 0.06);
    } else if (p === P_STRIKE) {
      this.jaw = -0.55;
      this.eyes = 2.2;
    } else if (p === P_RECOIL) {
      this.jaw = -0.4 + 0.9 * smooth(time / 0.4);
      this.eyes = 2.2 + (1.3 - 2.2) * smooth(time / 0.35);
    } else if (p === P_RISE) {
      this.jaw = 0.4 + 0.15 * u;
      this.eyes = 1.0 + 0.2 * u;
    } else if (p === P_STARE) {
      this.jaw = 0.6 + 0.04 * Math.sin(this.swayPh * 2);
      this.eyes = 1.3;
    } else if (p === P_DASH) {
      this.jaw = -1; // the clip graph's BURST chomp
      this.eyes = 1.4;
    } else {
      this.jaw = -1;
      this.eyes = 0;
    }
    // ---- light ----
    let lf = 0;
    if (p === P_LOCK) lf = 0.7 * smooth(time / 0.05);
    else if (p === P_STRIKE) lf = 1.2;
    else if (p === P_RECOIL) lf = 1.2 * (1 - smooth(time / 0.35));
    else if (p === P_DASH) lf = 0.2;
    if (reduced && lf > 0.3) lf = 0.3;
    this.lightFlare = p === P_LOCK || p === P_STRIKE ? lf : this.lightFlare + (lf - this.lightFlare) * (1 - Math.exp(-dt * 12));
    // ---- the rattle's tension ----
    this.tension = p === P_RISE ? 0.25 * u : p === P_STARE ? 0.3 + 0.7 * u : p === P_RECOIL ? 0.15 : 0;
    // ---- the aim (smoothed; frozen on the lock) ----
    if (ph && fin(ph.aimX) && fin(ph.aimY) && fin(ph.aimZ)) {
      if (!this._haveAim) {
        this.aimX = ph.aimX;
        this.aimY = ph.aimY;
        this.aimZ = ph.aimZ;
        this._haveAim = true;
      } else if (p !== P_LOCK && p !== P_STRIKE) {
        const k = 1 - Math.exp(-dt * (p === P_RECOIL ? SNAKE.aimRateRecoil : SNAKE.aimRate));
        this.aimX += (ph.aimX - this.aimX) * k;
        this.aimY += (ph.aimY - this.aimY) * k;
        this.aimZ += (ph.aimZ - this.aimZ) * k;
      }
      if (ph.locked) {
        this.lockX = ph.aimX;
        this.lockY = ph.aimY;
        this.lockZ = ph.aimZ;
      }
    }
    if (ph && ph.held) this._canon(p, u);
    this.active = this.coil > 0.002 || this.coil < -0.002 || this.stretch > 0.002 || this.stretch < -0.002 || this.dash > 0.002;
    return this;
  }

  /**
   * Bends the front of the body. F: 12 floats per spine point (pos, fwd toward the head, up, right = fwd x up); S: block scales.
   * @param {Float32Array} F
   * @param {Float32Array|null} S
   * @param {number} n     spine points
   * @param {number} size  creature size (1 = the Mason)
   */
  apply(F, S, n, size) {
    this.headOk = false;
    const K = SNAKE.links;
    const SK = this._SK;
    SK.fill(1);
    if (!this.active || n <= K + 1) {
      if (n > 0) this._head(F);
      return false;
    }
    size = size > 0 ? size : 1;
    const c = clamp(this.coil, -0.1, 1.3);
    const P = this._P;
    const U = this._U;
    const L = this._L;
    // ---- 1. the dash: the front pressed low and drawn forward (in each point's own frame) ----
    if (this.dash > 0.002) {
      const dl = this.dash * SNAKE.dashLower * size;
      const df = this.dash * SNAKE.dashForward * size;
      for (let i = 0; i <= K; i++) {
        const o = i * 12;
        const wgt = Math.exp(-i / 3);
        F[o] += (F[o + 3] * df - F[o + 6] * dl) * wgt;
        F[o + 1] += (F[o + 4] * df - F[o + 7] * dl) * wgt;
        F[o + 2] += (F[o + 5] * df - F[o + 8] * dl) * wgt;
        SK[i] *= 1 - 0.04 * this.dash * wgt;
      }
    }
    // ---- 2. the coil: the cobra chain from the anchor ----
    const ko = K * 12;
    const px = F[ko];
    const py = F[ko + 1];
    const pz = F[ko + 2];
    let fx = F[ko + 3];
    let fy = F[ko + 4];
    let fz = F[ko + 5];
    let ux = F[ko + 6];
    let uy = F[ko + 7];
    let uz = F[ko + 8];
    // re-orthonormalise the anchor frame (r = f x u)
    let d = ux * fx + uy * fy + uz * fz;
    ux -= fx * d;
    uy -= fy * d;
    uz -= fz * d;
    let l = Math.sqrt(ux * ux + uy * uy + uz * uz) || 1;
    ux /= l;
    uy /= l;
    uz /= l;
    const rx = fy * uz - fz * uy;
    const ry = fz * ux - fx * uz;
    const rz = fx * uy - fy * ux;
    for (let j = 0; j < K; j++) {
      const a = (K - j) * 12; // anchor side
      const b = (K - j - 1) * 12;
      const dx = F[b] - F[a];
      const dy = F[b + 1] - F[a + 1];
      const dz = F[b + 2] - F[a + 2];
      L[j] = Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    const wantCoil = c > 0.002 || c < -0.002;
    if (wantCoil) {
      // the aim in the anchor's frame: the yaw the coil turns toward
      const ax = this.aimX - px;
      const ay = this.aimY - py;
      const az = this.aimZ - pz;
      const af = ax * fx + ay * fy + az * fz;
      const ar = ax * rx + ay * ry + az * rz;
      const yawA = this._haveAim ? clamp(Math.atan2(ar, af > -1e-6 ? af : -1e-6), -SNAKE.yawMax * D2R, SNAKE.yawMax * D2R) : 0;
      // how much the sim already lifts the head off the anchor's plane (the new sim may rear it itself): the S shrinks by that
      const hz0 = (F[0] - px) * ux + (F[1] - py) * uy + (F[2] - pz) * uz;
      let scale = clamp(1 - Math.max(0, hz0) / (5.5 * size), 0.15, 1);
      // build, then flatten if the head would come within minGap of the aim
      for (let pass = 0; pass < 2; pass++) {
        this._chain(px, py, pz, fx, fy, fz, ux, uy, uz, rx, ry, rz, yawA, scale);
        const hx = P[K * 3] - this.aimX;
        const hy = P[K * 3 + 1] - this.aimY;
        const hzz = P[K * 3 + 2] - this.aimZ;
        const gap = Math.sqrt(hx * hx + hy * hy + hzz * hzz);
        const min = SNAKE.minGap * size;
        if (!this._haveAim || gap >= min || pass === 1) break;
        scale *= clamp(gap / min, 0.3, 1) * 0.75;
      }
      this.lastScale = scale;
      // blend: point i = K - j  <-  chain point j (0 = the anchor itself)
      const cb = clamp(c, -0.1, 1.15);
      for (let j = 1; j <= K; j++) {
        const i = K - j;
        const o = i * 12;
        const q = j * 3;
        F[o] += (P[q] - F[o]) * cb;
        F[o + 1] += (P[q + 1] - F[o + 1]) * cb;
        F[o + 2] += (P[q + 2] - F[o + 2]) * cb;
        // the up: toward the chain's own (the analytic perpendicular in the pitch plane), re-orthogonalised below
        const cu = clamp(cb, 0, 1);
        F[o + 6] += (U[q] - F[o + 6]) * cu;
        F[o + 7] += (U[q + 1] - F[o + 7]) * cu;
        F[o + 8] += (U[q + 2] - F[o + 8]) * cu;
      }
    }
    // ---- 3. the strike: squash, then the front extends along the locked line ----
    const s = this.stretch;
    if (s > 0.002 || s < -0.002) {
      let lx = this.lockX - F[0];
      let ly = this.lockY - F[1];
      let lz = this.lockZ - F[2];
      l = Math.sqrt(lx * lx + ly * ly + lz * lz);
      if (l < 1e-4) {
        lx = F[3];
        ly = F[4];
        lz = F[5];
        l = 1;
      }
      lx /= l;
      ly /= l;
      lz /= l;
      const ext = s > 0 ? s * SNAKE.stretch * size : s * size; // (the squash is already in metres)
      for (let i = 0; i <= K; i++) {
        const o = i * 12;
        const wgt = Math.pow(1 - i / (K + 1), 1.5);
        F[o] += lx * ext * wgt;
        F[o + 1] += ly * ext * wgt;
        F[o + 2] += lz * ext * wgt;
        SK[i] *= s > 0 ? 1 - 0.08 * s * wgt : 1 - 0.32 * s * wgt; // thinner when stretched, fatter on the squash
      }
    }
    // ---- 4. re-derive the frames 0..K ----
    for (let i = 0; i <= K; i++) {
      const o = i * 12;
      let nfx;
      let nfy;
      let nfz;
      if (i === 0) {
        // the head: along its neck, turned to look at the aim as much as it is coiled
        nfx = F[0] - F[12];
        nfy = F[1] - F[13];
        nfz = F[2] - F[14];
        l = Math.sqrt(nfx * nfx + nfy * nfy + nfz * nfz) || 1;
        nfx /= l;
        nfy /= l;
        nfz /= l;
        if (this._haveAim) {
          const lk = s > 0.05;
          let tx = (lk ? this.lockX : this.aimX) - F[0];
          let ty = (lk ? this.lockY : this.aimY) - F[1];
          let tz = (lk ? this.lockZ : this.aimZ) - F[2];
          const tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
          if (tl > 0.5) {
            tx /= tl;
            ty /= tl;
            tz /= tl;
            const wl = clamp(Math.max(c, s), 0, 1) * 0.85;
            nfx += (tx - nfx) * wl;
            nfy += (ty - nfy) * wl;
            nfz += (tz - nfz) * wl;
          }
        }
        // keep the wall-crawl facing when nothing coils (the sim's own head direction)
        const keep = 1 - clamp(Math.max(c, Math.abs(s)) * 2, 0, 1);
        nfx += (F[3] - nfx) * keep;
        nfy += (F[4] - nfy) * keep;
        nfz += (F[5] - nfz) * keep;
      } else {
        const a = (i - 1) * 12;
        const b = (i + 1) * 12;
        nfx = F[a] - F[b];
        nfy = F[a + 1] - F[b + 1];
        nfz = F[a + 2] - F[b + 2];
      }
      l = Math.sqrt(nfx * nfx + nfy * nfy + nfz * nfz);
      if (l < 1e-6) continue;
      nfx /= l;
      nfy /= l;
      nfz /= l;
      let qx = F[o + 6];
      let qy = F[o + 7];
      let qz = F[o + 8];
      d = qx * nfx + qy * nfy + qz * nfz;
      qx -= nfx * d;
      qy -= nfy * d;
      qz -= nfz * d;
      l = Math.sqrt(qx * qx + qy * qy + qz * qz);
      if (l < 1e-5) {
        // the up ran along the new forward: take the anchor's right x forward
        qx = nfy * rz - nfz * ry;
        qy = nfz * rx - nfx * rz;
        qz = nfx * ry - nfy * rx;
        l = Math.sqrt(qx * qx + qy * qy + qz * qz) || 1;
      }
      qx /= l;
      qy /= l;
      qz /= l;
      F[o + 3] = nfx;
      F[o + 4] = nfy;
      F[o + 5] = nfz;
      F[o + 6] = qx;
      F[o + 7] = qy;
      F[o + 8] = qz;
      F[o + 9] = nfy * qz - nfz * qy;
      F[o + 10] = nfz * qx - nfx * qz;
      F[o + 11] = nfx * qy - nfy * qx;
    }
    this._head(F);
    if (S) this.scaleBlocks(S);
    return true;
  }

  /** Multiplies the last apply()'s block factors into S (the views that size their blocks after the pose call this then). */
  scaleBlocks(S) {
    const SK = this._SK;
    for (let i = 0; i < SK.length && i < S.length; i++) S[i] *= SK[i];
  }

  /** The last apply()'s block factor of spine point i. */
  scaleOf(i) {
    return i >= 0 && i < this._SK.length ? this._SK[i] : 1;
  }

  /** A held (debug) phase: the springs jump to the shape that moment has in a real attack (deterministic captures). */
  _canon(p, u) {
    const red = this.reduced;
    this.coilV = 0;
    if (p === P_RISE) this.coil = smooth(u * 1.15);
    else if (p === P_STARE || p === P_LOCK) this.coil = p === P_LOCK ? 1.06 : 1;
    else if (p === P_STRIKE) this.coil = 1 - smooth(u / 0.55); // released over the first half of the lunge
    else if (p === P_RECOIL) this.coil = red ? smooth(u * 1.3) : smooth(u * 1.6) + 0.12 * Math.sin(Math.PI * clamp01((u - 0.45) / 0.55)); // the overshoot
    else this.coil = 0;
    if (p !== P_STRIKE) this.stretch = p === P_RECOIL ? 1 - smooth((u * 0.5) / 0.2) : 0;
    this.dash = p === P_DASH ? 1 : 0;
    this.sway = p === P_STARE ? (red ? SNAKE.reducedSway : 1) : p === P_RISE ? (0.4 + 0.6 * u) * (red ? SNAKE.reducedSway : 1) : 0;
    if (p === P_STARE || p === P_RISE) this.swayPh = Math.PI * 0.5; // the head at the end of its weave
    if (p === P_LOCK) {
      this.eyes = 2.6;
      this.lightFlare = red ? 0.3 : 0.7;
    }
  }

  _head(F) {
    this.headX = F[0];
    this.headY = F[1];
    this.headZ = F[2];
    this.headOk = fin(F[0]) && fin(F[1]) && fin(F[2]);
  }

  /** The cobra chain into _P / _U (point j = 0 the anchor .. K the head). */
  _chain(px, py, pz, fx, fy, fz, ux, uy, uz, rx, ry, rz, yawA, scale) {
    const K = SNAKE.links;
    const P = this._P;
    const U = this._U;
    const L = this._L;
    const pitch = SNAKE.pitch;
    P[0] = px;
    P[1] = py;
    P[2] = pz;
    U[0] = ux;
    U[1] = uy;
    U[2] = uz;
    const sw = this.sway;
    const ph = this.swayPh;
    for (let j = 1; j <= K; j++) {
      const g = j / K; // 0 at the anchor .. 1 at the head
      // the yaw: toward the aim, growing up the neck; the sway: a weave travelling up the neck, the head's yaw the widest
      const yaw = yawA * Math.min(1, g * 1.4) + sw * (SNAKE.swayWeave * D2R * Math.sin(ph - j * 0.6) * g + SNAKE.swayYaw * D2R * Math.sin(ph) * g * g);
      const th = pitch[j - 1] * D2R * scale;
      const cy = Math.cos(yaw);
      const sy = Math.sin(yaw);
      const ct = Math.cos(th);
      const st = Math.sin(th);
      // the horizontal heading in the anchor's plane, then pitched toward its up
      const hx = fx * cy + rx * sy;
      const hy = fy * cy + ry * sy;
      const hz = fz * cy + rz * sy;
      const dx = hx * ct + ux * st;
      const dy = hy * ct + uy * st;
      const dz = hz * ct + uz * st;
      const q = j * 3;
      const len = L[j - 1];
      P[q] = P[q - 3] + dx * len;
      P[q + 1] = P[q - 2] + dy * len;
      P[q + 2] = P[q - 1] + dz * len;
      U[q] = -hx * st + ux * ct;
      U[q + 1] = -hy * st + uy * ct;
      U[q + 2] = -hz * st + uz * ct;
    }
  }
}
