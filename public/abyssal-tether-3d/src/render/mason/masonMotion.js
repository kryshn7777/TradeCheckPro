/* ABYSSAL TETHER 3D — mason/masonMotion.js
 * BodyMotion: the secondary motion layered on the sim's spine frames before the bones are posed. The sim lays the spine along a
 * breadcrumb trail (a rigid follow-the-leader column), so on its own the body slides like a plank. This adds, per vertebra and
 * in the vertebra's own frame (right / up / forward), a damped spring chain driven by
 *   - a TRAVELLING WAVE tied to the gait phase (one wave cycle per stride: the body undulates exactly as fast as the legs step,
 *     amplitude grows with speed; at rest a slow weight-shifting sway + breathing),
 *   - INERTIA: the spine point's own acceleration pushes it the other way (the tail lags a surge, sags on a stop, swings wide on
 *     a turn); the springs overshoot a little (follow-through) and the rear is softer than the front,
 *   - LEG LOAD: the body drops a little while many legs are in the air (bob at the stride rate) and rolls toward the swing side,
 *   - ANTICIPATION: the wind-up coils the front of the column up and the tail down; the strike snaps it forward and the
 *     springs carry it through; the recoil settles it.
 * then re-derives each frame (forward from the displaced neighbours, the old up carried over with a roll about the new forward).
 * The head point keeps (almost) its sim position, so hit timing / reach stay exactly the sim's.
 * Allocation-free: typed arrays and scalar maths only. Pure (no three).
 */

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export const MOTION_MASON = {
  wave: 0.2, // lateral wave amplitude (x size) at full speed
  waveUp: 0.07, // vertical wave amplitude
  waveLen: 9, // spine points per wave
  sway: 0.05, // idle sway amplitude
  inertia: 0.06, // offset (x size) per m/s^2 of local acceleration
  maxOff: 0.55, // clamp (x size)
  w0: 7.5, // spring rate (rad/s) at the front
  rearSoft: 0.45, // the tail's spring is this much softer
  zeta: 0.42, // damping ratio (< 1: follow-through)
  bob: 0.1, // load sag (x size) with every leg swinging
  roll: 0.16, // rad at full speed
  coil: 1.05, // wind-up raise (x size)
  twitch: 0,
};
export const MOTION_SKITTER = {
  wave: 0.34,
  waveUp: 0.1,
  waveLen: 6.5,
  sway: 0.08,
  inertia: 0.05,
  maxOff: 0.7,
  w0: 15,
  rearSoft: 0.3,
  zeta: 0.34,
  bob: 0.07,
  roll: 0.3,
  coil: 0.7,
  twitch: 1,
};

export class BodyMotion {
  /**
   * @param {number} seg  spine points
   * @param {object} cfg  MOTION_MASON / MOTION_SKITTER
   */
  constructor(seg, cfg) {
    this.n = seg;
    this.cfg = cfg;
    this.off = new Float64Array(seg * 3); // right, up, forward offsets (metres)
    this.vel = new Float64Array(seg * 3);
    this.prev = new Float64Array(seg * 3); // last world positions (sim spine)
    this.pv = new Float64Array(seg * 3); // filtered world velocity
    this.acc = new Float64Array(seg * 3); // filtered world acceleration
    this.roll = new Float64Array(seg);
    this.rollV = new Float64Array(seg);
    this.sag = 0; // body-wide load sag (spring)
    this.sagV = 0;
    this.bank = 0;
    this.bankV = 0;
    this.coil = 0; // anticipation state (smoothed target)
    this.coilV = 0;
    this.have = false;
    this.amp = 0; // smoothed movement amount 0..1
    this.t = 0;
    this._f = new Float64Array(3);
  }

  reset() {
    this.off.fill(0);
    this.vel.fill(0);
    this.pv.fill(0);
    this.acc.fill(0);
    this.roll.fill(0);
    this.rollV.fill(0);
    this.sag = this.sagV = this.bank = this.bankV = this.coil = this.coilV = 0;
    this.have = false;
    this.amp = 0;
  }

  /**
   * One frame. F = the spine frames (12 floats per point: pos, fwd, up, right), modified in place.
   * @param {number} dt
   * @param {Float32Array} F
   * @param {Float32Array} sp   the sim's spine positions (x,y,z per point), for the velocity / acceleration
   * @param {number} size       creature size (1 = Mason)
   * @param {number} speed      smoothed speed (m/s)
   * @param {number} cycle      gait phase in cycles (continuous)
   * @param {number} loadL      legs in the air on the left (0..1 of the side), loadR for the right
   * @param {number} loadR
   * @param {number} wind       attack anticipation: +0..1 during the wind-up, -0.5 on the strike, 0 otherwise
   * @param {number} jitter     0..1 agitation (twitch)
   */
  update(dt, F, sp, size, speed, cycle, loadL, loadR, wind, jitter) {
    const n = this.n;
    const c = this.cfg;
    const off = this.off;
    const vel = this.vel;
    if (!(dt > 0)) return;
    this.t += dt;
    const sub = Math.max(1, Math.ceil(dt / 0.012));
    const h = dt / sub;
    const mv = clamp(speed / (4.5 * Math.max(size, 0.3) ** 0.5), 0, 1.15); // speed relative to a brisk crawl
    this.amp += (mv - this.amp) * (1 - Math.exp(-dt * 4));
    const amp = this.amp;
    const lim = c.maxOff * size;
    const TAU = 6.283185307179586;
    const kw = TAU / c.waveLen;
    const wPh = cycle * TAU;
    // body-wide targets: sag with the swing load, bank toward the swing side + with the lateral acceleration
    const load = 0.5 * (loadL + loadR);
    const tSag = -c.bob * size * load * (0.35 + 0.65 * amp) * 2;
    const tBank = (loadL - loadR) * c.roll * (0.3 + 0.7 * amp);
    const d4 = Math.min(dt, 0.03);
    this.sagV += (80 * (tSag - this.sag) - 14 * this.sagV) * d4;
    this.sag += this.sagV * d4;
    this.bankV += (60 * (tBank - this.bank) - 11 * this.bankV) * d4;
    this.bank += this.bankV * d4;
    // anticipation: a spring toward the wind-up value (the release overshoots: follow-through)
    this.coilV += (140 * (wind - this.coil) - 17 * this.coilV) * d4;
    this.coil += this.coilV * d4;
    const coilNow = this.coil;
    const have = this.have;
    for (let i = 0; i < n; i++) {
      const o = i * 12;
      const fx = F[o + 3];
      const fy = F[o + 4];
      const fz = F[o + 5];
      const ux = F[o + 6];
      const uy = F[o + 7];
      const uz = F[o + 8];
      const rx = F[o + 9];
      const ry = F[o + 10];
      const rz = F[o + 11];
      // world velocity / acceleration of the sim point (filtered): the tail's inertia reads from these
      const px = sp[i * 3];
      const py = sp[i * 3 + 1];
      const pz = sp[i * 3 + 2];
      const q = i * 3;
      if (have) {
        const vx = (px - this.prev[q]) / dt;
        const vy = (py - this.prev[q + 1]) / dt;
        const vz = (pz - this.prev[q + 2]) / dt;
        const k = 1 - Math.exp(-dt * 14);
        const ax = (vx - this.pv[q]) / dt;
        const ay = (vy - this.pv[q + 1]) / dt;
        const az = (vz - this.pv[q + 2]) / dt;
        this.acc[q] += (clamp(ax, -70, 70) - this.acc[q]) * (1 - Math.exp(-dt * 9));
        this.acc[q + 1] += (clamp(ay, -70, 70) - this.acc[q + 1]) * (1 - Math.exp(-dt * 9));
        this.acc[q + 2] += (clamp(az, -70, 70) - this.acc[q + 2]) * (1 - Math.exp(-dt * 9));
        this.pv[q] += (vx - this.pv[q]) * k;
        this.pv[q + 1] += (vy - this.pv[q + 1]) * k;
        this.pv[q + 2] += (vz - this.pv[q + 2]) * k;
      }
      this.prev[q] = px;
      this.prev[q + 1] = py;
      this.prev[q + 2] = pz;
      const aR = this.acc[q] * rx + this.acc[q + 1] * ry + this.acc[q + 2] * rz;
      const aU = this.acc[q] * ux + this.acc[q + 1] * uy + this.acc[q + 2] * uz;
      const aF = this.acc[q] * fx + this.acc[q + 1] * fy + this.acc[q + 2] * fz;
      const t = i / (n - 1);
      const env = i === 0 ? 0.12 : Math.min(1, 0.35 + i * 0.22) * (1 - 0.25 * t); // the head stays near the sim point
      const ph = wPh - i * kw;
      const swayPh = this.t * 0.55 - i * 0.42;
      // targets (right, up, forward)
      let tr = -aR * c.inertia * size * (0.5 + t) + Math.sin(ph) * c.wave * size * amp * env + Math.sin(swayPh) * c.sway * size * (1 - 0.6 * amp) * env;
      let tu = -aU * c.inertia * 0.7 * size * (0.4 + t) + Math.sin(2 * ph + 0.9) * c.waveUp * size * amp * env + this.sag * (0.4 + 0.6 * (1 - Math.abs(2 * t - 0.8))) + Math.sin(this.t * 1.7 - i * 0.3) * 0.012 * size * env;
      let tf = -aF * c.inertia * 0.5 * size * (0.3 + t);
      // anticipation: coil the front up, crouch the tail
      const front = Math.exp(-i / 3.2);
      tu += coilNow * c.coil * size * (front - 0.18 * t);
      tf -= coilNow * c.coil * size * 0.35 * front;
      if (c.twitch > 0 && jitter > 0.01) tr += Math.sin(this.t * 53 + i * 2.1) * Math.sin(this.t * 17 + i * 0.9) * 0.05 * size * jitter;
      const he = i === 0 ? 0.3 : 1; // the crown stays close to the sim point (hit reach / timing)
      tr = clamp(tr * he, -lim, lim);
      tu = clamp(tu * he, -lim * 1.6, lim * 1.6);
      tf = clamp(tf * he, -lim, lim);
      const w = c.w0 * (1 - c.rearSoft * t);
      const w2 = w * w;
      const zz = 2 * c.zeta * w;
      const j = i * 3;
      for (let s = 0; s < sub; s++) {
        vel[j] += (w2 * (tr - off[j]) - zz * vel[j]) * h;
        off[j] += vel[j] * h;
        vel[j + 1] += (w2 * (tu - off[j + 1]) - zz * vel[j + 1]) * h;
        off[j + 1] += vel[j + 1] * h;
        vel[j + 2] += (w2 * (tf - off[j + 2]) - zz * vel[j + 2]) * h;
        off[j + 2] += vel[j + 2] * h;
      }
      // roll target: the body banks (load / turning) and rolls with the lateral wave's slope
      const tRoll = this.bank * (0.4 + 0.6 * env) + Math.cos(ph) * c.roll * 0.5 * amp * env - aR * 0.004 * c.roll;
      this.rollV[i] += (90 * (tRoll - this.roll[i]) - 13 * this.rollV[i]) * d4;
      this.roll[i] += this.rollV[i] * d4;
    }
    this.have = true;
    // ---- apply: displace, then re-derive the frames ----
    for (let i = 0; i < n; i++) {
      const o = i * 12;
      const j = i * 3;
      F[o] += F[o + 9] * off[j] + F[o + 6] * off[j + 1] + F[o + 3] * off[j + 2];
      F[o + 1] += F[o + 10] * off[j] + F[o + 7] * off[j + 1] + F[o + 4] * off[j + 2];
      F[o + 2] += F[o + 11] * off[j] + F[o + 8] * off[j + 1] + F[o + 5] * off[j + 2];
    }
    for (let i = 1; i < n; i++) {
      const o = i * 12;
      const a = (i - 1) * 12;
      const b = Math.min(n - 1, i + 1) * 12;
      let nfx = F[a] - F[b];
      let nfy = F[a + 1] - F[b + 1];
      let nfz = F[a + 2] - F[b + 2];
      const nl = Math.sqrt(nfx * nfx + nfy * nfy + nfz * nfz);
      if (nl < 1e-6) continue;
      nfx /= nl;
      nfy /= nl;
      nfz /= nl;
      // old up made perpendicular to the new forward
      let ux = F[o + 6];
      let uy = F[o + 7];
      let uz = F[o + 8];
      const d = ux * nfx + uy * nfy + uz * nfz;
      ux -= nfx * d;
      uy -= nfy * d;
      uz -= nfz * d;
      const ul = Math.sqrt(ux * ux + uy * uy + uz * uz);
      if (ul < 1e-5) continue;
      ux /= ul;
      uy /= ul;
      uz /= ul;
      // right = f x u (the sim's convention), then the roll about the forward axis
      let rx = nfy * uz - nfz * uy;
      let ry = nfz * ux - nfx * uz;
      let rz = nfx * uy - nfy * ux;
      const ro = this.roll[i];
      const cr = Math.cos(ro);
      const sr = Math.sin(ro);
      const nux = ux * cr - rx * sr;
      const nuy = uy * cr - ry * sr;
      const nuz = uz * cr - rz * sr;
      rx = rx * cr + ux * sr;
      ry = ry * cr + uy * sr;
      rz = rz * cr + uz * sr;
      F[o + 3] = nfx;
      F[o + 4] = nfy;
      F[o + 5] = nfz;
      F[o + 6] = nux;
      F[o + 7] = nuy;
      F[o + 8] = nuz;
      F[o + 9] = rx;
      F[o + 10] = ry;
      F[o + 11] = rz;
    }
  }
}
