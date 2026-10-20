/* ABYSSAL TETHER 3D — movement3d.js
 * Body-in-the-world sounds, all synthesised:
 *   - footsteps by SURFACE (stone / iron / wet puddle: patches are a hash of the position, so the same patch always
 *     sounds the same) and by speed, alternating feet; landing colour (iron clang, puddle splash) on top of the
 *     thud in AudioManager3D._sfxLand, which scales with the impact speed;
 *   - wall SCRAPE: a continuous grind while the body slides along masonry / iron (level.querySolids, 15 Hz);
 *   - air RUSH: a stereo wind pair whose brightness and level follow the speed (filtering only, never pitch-shifted),
 *     leaning toward the side the body is moving to;
 *   - cloth / leather RUSTLE: harness and jacket noise that follows body acceleration and arm swing.
 * Breathing under exertion is scheduled in AudioManager3D._scheduleBreath (pant / gasp); health audio is untouched.
 */
import { SURFACE, surfaceOf, SECTION_BEDS, sectionOfY, smooth } from './dsp3d.js';
import { CONFIG } from '../sim/config3d.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rand = (a, b) => a + Math.random() * (b - a);
const HANDS = ['left', 'right'];

function hash3(a, b, c) {
  let x = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1);
  x = Math.imul(x ^ (x >>> 15), 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

export class Movement {
  constructor(mgr) {
    this.m = mgr;
    this.foot = 1;
    this.surface = SURFACE.STONE;
    this.steps = 0;
    this.scrape = 0; // smoothed contact 0..1
    this.scrapeMetal = false;
    this.rush = 0;
    this.rustle = 0;
    this.prevV = { x: 0, y: 0, z: 0 };
    this.acc = 0;
    this.arm = 0;
    this.pose = [{ x: NaN, y: 0, z: 0 }, { x: NaN, y: 0, z: 0 }];
    this.handV = 0;
    this.poseT = 0;
    this.qs = [];
    this.scrapeT = 0;
    this.contact = 0;
    this.contactMetal = false;
    this.tang = 0;
  }

  build() {
    const m = this.m;
    // ---- wall scrape: brown grit (stone) + bright ring (iron), grain-modulated ----
    const out = m._gainNode(1);
    out.connect(m.busPlayer);
    const send = m._gainNode(0.1);
    out.connect(send);
    send.connect(m.spaceIn);
    const brown = m._loop(m._brown, 1.15);
    const sbp = m._filter('bandpass', 700, 1.4);
    const sg = m._gainNode(0);
    const grain = m._osc('sawtooth', 34);
    const grainG = m._gainNode(0.4);
    const am = m._gainNode(0.6);
    brown.connect(sbp);
    sbp.connect(am);
    grain.connect(grainG);
    grainG.connect(am.gain);
    am.connect(sg);
    sg.connect(out);
    const white = m._loop(m._white, 0.89);
    const mbp = m._filter('bandpass', 2300, 5);
    const mg = m._gainNode(0);
    white.connect(mbp);
    mbp.connect(mg);
    mg.connect(out);
    this.gScrape = m._gate([brown, sbp], [grain, grainG], [white, mbp]);
    this.kScrG = m._knob(sg.gain, 0, 0.002);
    this.kScrF = m._knob(sbp.frequency, 700, 5, 0.01);
    this.kScrGrain = m._knob(grain.frequency, 34, 0.5, 0.01);
    this.kScrMG = m._knob(mg.gain, 0, 0.002);
    this.kScrMF = m._knob(mbp.frequency, 2300, 8, 0.01);

    // ---- air rush: a decorrelated stereo pair ----
    this.rushPair = [];
    for (let i = 0; i < 2; i++) {
      const src = m._loop(i ? m._white : m._pink, i ? 1.07 : 0.93);
      const hp = m._filter('highpass', 900, 0);
      const lp = m._filter('lowpass', 2600, 0.3);
      const g = m._gainNode(0);
      const pan = m._makePanner(i ? 0.6 : -0.6);
      src.connect(hp);
      hp.connect(lp);
      lp.connect(g);
      g.connect(pan);
      pan.connect(m.busPlayer);
      this.rushPair.push({ src, hp, lp, g, kG: m._knob(g.gain, 0, 0.002), kF: m._knob(lp.frequency, 2600, 20, 0.01), kH: m._knob(hp.frequency, 900, 10, 0.01), gate: m._gate([src, hp]) });
    }

    // ---- cloth + leather rustle ----
    const cw = m._loop(m._white, 0.91);
    const cbp = m._filter('bandpass', 3600, 0.7);
    const cg = m._gainNode(0);
    cw.connect(cbp);
    cbp.connect(cg);
    cg.connect(m.busPlayer);
    const lo = m._osc('sawtooth', 38);
    const lbp = m._filter('bandpass', 540, 10);
    const lg = m._gainNode(0);
    lo.connect(lbp);
    lbp.connect(lg);
    lg.connect(m.busPlayer);
    this.gRustle = m._gate([cw, cbp], [lo, lbp]);
    this.kClothG = m._knob(cg.gain, 0, 0.0008);
    this.kClothF = m._knob(cbp.frequency, 3600, 10, 0.01);
    this.kLeatherG = m._knob(lg.gain, 0, 0.0005);
    this.kLeatherF = m._knob(lbp.frequency, 540, 5, 0.01);
    this.kLeatherO = m._knob(lo.frequency, 38, 0.3, 0.01);
  }

  // -------------------------------------------------------------------------
  // surfaces
  // -------------------------------------------------------------------------

  /** Surface under the body now (SURFACE.*), from the ground solid's kind and a position-hashed puddle patch. */
  surfaceUnder(game) {
    const P = game && game.player;
    if (!P) return SURFACE.STONE;
    const si = game && typeof game.sectionIndex === 'number' ? game.sectionIndex | 0 : sectionOfY(P.y);
    const wet = SECTION_BEDS[clamp(si, 0, SECTION_BEDS.length - 1)].wetness;
    const roll = hash3(Math.floor(P.x / 2.2), Math.floor(P.z / 2.2), Math.floor(P.y / 3));
    const kind = P.groundSolid && P.groundSolid.kind;
    return surfaceOf(kind, wet, roll);
  }

  footstep(intensity, game) {
    const m = this.m;
    const surf = this.surfaceUnder(game);
    this.surface = surf;
    this.steps++;
    this.foot = -this.foot;
    const k = clamp(intensity, 0.2, 1);
    const pan = this.foot * 0.1;
    const lvl = 0.36 * k;
    const send = surf === SURFACE.IRON ? 0.14 : surf === SURFACE.WET ? 0.2 : 0.06;
    const v = m._begin('step', 0, 0.09, 0.35, m.busPlayer, lvl, pan, send, 0);
    if (!v) return;
    const t = v.t0;
    if (surf === SURFACE.IRON) {
      // a hollow "tonk": body resonance, a thin ring, the grating's tick
      const f = rand(170, 270);
      const o = m._vOsc(v, 'sine', f, t);
      o.frequency.setTargetAtTime(f * 0.7, t, 0.04);
      const g = m._vGain(v, 0);
      m._perc(g.gain, t, 0.7, 0.002, 0.07);
      o.connect(g);
      g.connect(v.out);
      const r = m._vOsc(v, 'sine', f * 2.43, t);
      const rg = m._vGain(v, 0);
      m._perc(rg.gain, t, 0.22, 0.001, 0.09);
      r.connect(rg);
      rg.connect(v.out);
      const n = m._vNoise(v, m._white, t, 1);
      const bp = m._vFilter(v, 'bandpass', rand(3600, 4800), 14);
      const ng = m._vGain(v, 0);
      m._perc(ng.gain, t, 0.35, 0.001, 0.04);
      n.connect(bp);
      bp.connect(ng);
      ng.connect(v.out);
    } else if (surf === SURFACE.WET) {
      // a squelching step into a shallow puddle
      const n = m._vNoise(v, m._pink, t, 1);
      const bp = m._vFilter(v, 'bandpass', rand(330, 480), 3);
      bp.frequency.exponentialRampToValueAtTime(rand(1100, 1600), t + 0.11);
      const g = m._vGain(v, 0);
      m._perc(g.gain, t, 0.7, 0.004, 0.06);
      n.connect(bp);
      bp.connect(g);
      g.connect(v.out);
      const o = m._vOsc(v, 'sine', rand(500, 760), t + 0.03);
      o.frequency.setTargetAtTime(rand(1400, 2000), t + 0.03, 0.014);
      const og = m._vGain(v, 0);
      m._perc(og.gain, t + 0.03, 0.3, 0.002, 0.03);
      o.connect(og);
      og.connect(v.out);
      const b = m._vNoise(v, m._brown, t, 1.1);
      const lp = m._vFilter(v, 'lowpass', 260, 0);
      const bg = m._vGain(v, 0);
      m._perc(bg.gain, t, 0.6, 0.002, 0.04);
      b.connect(lp);
      lp.connect(bg);
      bg.connect(v.out);
    } else {
      // stone: heel thud + toe tick + a scuff of grit
      const b = m._vNoise(v, m._brown, t, 1.2);
      const bp = m._vFilter(v, 'bandpass', rand(190, 270), 1);
      const g = m._vGain(v, 0);
      m._perc(g.gain, t, 0.8, 0.002, 0.03);
      b.connect(bp);
      bp.connect(g);
      g.connect(v.out);
      const o = m._vOsc(v, 'sine', rand(95, 125), t);
      o.frequency.setTargetAtTime(62, t, 0.03);
      const og = m._vGain(v, 0);
      m._perc(og.gain, t, 0.35 * k, 0.002, 0.04);
      o.connect(og);
      og.connect(v.out);
      const n = m._vNoise(v, m._white, t + 0.012, 1);
      const hp = m._vFilter(v, 'bandpass', rand(2600, 3600), 1);
      const ng = m._vGain(v, 0);
      m._perc(ng.gain, t + 0.012, 0.16, 0.002, 0.02);
      n.connect(hp);
      hp.connect(ng);
      ng.connect(v.out);
      if (k > 0.6) {
        const sc = m._vNoise(v, m._pink, t + 0.03, 1);
        const sh = m._vFilter(v, 'highpass', 4200, 0);
        const sg = m._vGain(v, 0);
        m._perc(sg.gain, t + 0.03, 0.06, 0.01, 0.04);
        sc.connect(sh);
        sh.connect(sg);
        sg.connect(v.out);
      }
    }
    m._commit(v);
  }

  /** Extra layers on a landing voice, by surface (called from _sfxLand with the voice, its start and s = 0..1). */
  landColor(v, t, s, game) {
    const m = this.m;
    const surf = this.surfaceUnder(game);
    if (surf === SURFACE.IRON) {
      const f = rand(140, 210);
      for (let k = 0; k < 3; k++) {
        const o = m._vOsc(v, 'sine', f * [1, 2.32, 3.86][k], t);
        const g = m._vGain(v, 0);
        m._perc(g.gain, t, (0.4 - k * 0.1) * (0.4 + 0.6 * s), 0.002, 0.12 + 0.1 * s - k * 0.025);
        o.connect(g);
        g.connect(v.out);
      }
    } else if (surf === SURFACE.WET) {
      const n = m._vNoise(v, m._white, t, 1);
      const hp = m._vFilter(v, 'highpass', 1700, 0);
      const g = m._vGain(v, 0);
      m._swell(g.gain, t, 0.35 * (0.4 + 0.6 * s), 0.012, 0.03, 0.09);
      n.connect(hp);
      hp.connect(g);
      g.connect(v.out);
      m._tickTrain(v, t + 0.04, 3 + Math.round(3 * s), 0.3, 0.3, 900, 2400, 5, 0.01, 0.5);
    }
  }

  // -------------------------------------------------------------------------
  // continuous layers
  // -------------------------------------------------------------------------

  control(dtc, now, game, c) {
    const m = this.m;
    const P = game && game.player;
    const body = !!P && c.playing && !c.dead && P.alive !== false;
    const clock = m._clock;
    const spd = c.speed;

    // ---- rush ----
    const lethal = c.lethal;
    const lat = body ? this._lateral(P) : 0;
    const rushK = body ? Math.max(smooth(0.3 * lethal, 1.3 * lethal, spd), 0.6 * smooth(0.18 * lethal, 0.7 * lethal, spd)) : 0;
    this.rush = rushK;
    const lvl = 0.2 * Math.pow(rushK, 1.35) * (m._reduced ? 0.8 : 1);
    const gust = 1 + 0.2 * Math.sin(clock * 5.3) * rushK;
    for (let i = 0; i < 2; i++) {
      const R = this.rushPair[i];
      const side = i ? lat : -lat; // louder on the side the body is leaning to
      R.kG.set(lvl * gust * (1 + 0.35 * side), now, 0.07);
      R.kF.set(1700 + 5200 * rushK, now, 0.1);
      R.kH.set(500 + 1100 * rushK, now, 0.12);
      m._driveGate(R.gate, R.kG.last > 0.001, dtc);
    }

    // ---- wall scrape ----
    this.scrapeT -= dtc;
    if (this.scrapeT <= 0) {
      this.scrapeT = 1 / 15;
      this._probeContact(game, P, body, spd);
    }
    this.scrape += (this.contact - this.scrape) * Math.min(1, dtc * 14);
    const sp = smooth(1.0, 8.5, this.tang);
    const sc = this.scrape * sp;
    const metal = this.contactMetal;
    this.kScrG.set(metal ? sc * 0.12 : sc * 0.4, now, 0.05);
    this.kScrF.set(380 + 1000 * sp, now, 0.07);
    this.kScrGrain.set(22 + 46 * sp, now, 0.06);
    this.kScrMG.set(metal ? sc * 0.2 : 0, now, 0.05);
    this.kScrMF.set(1700 + 1900 * sp, now, 0.08);
    m._driveGate(this.gScrape, this.kScrG.last > 0.001 || this.kScrMG.last > 0.001, dtc);

    // ---- rustle ----
    if (body && dtc > 0) {
      const ax = (P.vx - this.prevV.x) / dtc;
      const ay = (P.vy - this.prevV.y) / dtc;
      const az = (P.vz - this.prevV.z) / dtc;
      const a = Math.min(60, Math.hypot(ax, ay, az));
      this.acc += (a - this.acc) * Math.min(1, dtc * 6);
    } else this.acc *= 0.9;
    if (body) {
      this.prevV.x = P.vx;
      this.prevV.y = P.vy;
      this.prevV.z = P.vz;
    }
    this.poseT -= dtc;
    if (body && this.poseT <= 0 && game.input && typeof game.input.handPose === 'function') {
      const dt = 0.1 - this.poseT;
      this.poseT = 0.1;
      let hv = 0;
      for (let i = 0; i < 2; i++) {
        const o = this.pose[i];
        const px = o.x;
        const py = o.y;
        const pz = o.z;
        const p = game.input.handPose(HANDS[i], o);
        if (px === px && p) hv = Math.max(hv, Math.hypot(o.x - px, o.y - py, o.z - pz) / dt);
      }
      this.handV += (Math.min(hv, 12) - this.handV) * 0.6;
    }
    const e = body ? Math.max(smooth(2.5, 16, this.acc), 0.7 * smooth(0.8, 4.5, this.handV), 0.45 * smooth(1.5, 5.5, c.hspeed)) : 0;
    this.rustle = e;
    const fall = 1 - 0.5 * rushK; // wind covers the cloth in a fall
    this.kClothG.set(0.07 * e * fall * (0.6 + 0.4 * Math.abs(Math.sin(clock * 11.3))), now, 0.05);
    this.kClothF.set(3200 + 1400 * e, now, 0.1);
    this.kLeatherG.set(0.06 * Math.pow(e, 1.6) * fall, now, 0.06);
    this.kLeatherF.set(480 + 200 * Math.sin(clock * 1.7) + 260 * e, now, 0.08);
    this.kLeatherO.set(26 + 30 * e, now, 0.08);
    m._driveGate(this.gRustle, this.kClothG.last > 0.0008 || this.kLeatherG.last > 0.0005, dtc);
  }

  /** Lateral velocity share (−1 left … 1 right) of the body relative to where the head looks. */
  _lateral(P) {
    const m = this.m;
    const fx = m._lfx;
    const fz = m._lfz;
    const hl = Math.hypot(fx, fz);
    if (hl < 0.2) return 0;
    const rx = -fz / hl;
    const rz = fx / hl;
    const hs = Math.hypot(P.vx, P.vz);
    if (hs < 1.5) return 0;
    return clamp((P.vx * rx + P.vz * rz) / hs, -1, 1) * clamp(hs / 10, 0, 1);
  }

  /** Is the body sliding along a non-floor surface? Sets this.contact / contactMetal / tang. */
  _probeContact(game, P, body, spd) {
    this.contact = 0;
    this.tang = 0;
    const lv = game && game.level;
    if (!body || spd < 1.2 || !lv || typeof lv.querySolids !== 'function') return;
    const r = CONFIG.player.radius;
    const q = r + 0.22;
    const list = lv.querySolids(P.x - q, P.y - q, P.z - q, P.x + q, P.y + q, P.z + q, this.qs);
    let best = r + 0.09;
    let bx = 0;
    let by = 0;
    let bz = 0;
    let kind = '';
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (b.active === false) continue;
      const dx = P.x - clamp(P.x, b.minX, b.maxX);
      const dy = P.y - clamp(P.y, b.minY, b.maxY);
      const dz = P.z - clamp(P.z, b.minZ, b.maxZ);
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < best && d > 1e-6) {
        best = d;
        bx = dx / d;
        by = dy / d;
        bz = dz / d;
        kind = b.kind;
      }
    }
    list.length = 0;
    if (best >= r + 0.09 || by > 0.55) return; // nothing close, or it is a floor (the feet handle it)
    const vn = P.vx * bx + P.vy * by + P.vz * bz;
    const tx = P.vx - vn * bx;
    const ty = P.vy - vn * by;
    const tz = P.vz - vn * bz;
    this.tang = Math.hypot(tx, ty, tz);
    this.contact = 1;
    this.contactMetal = kind === 'metal' || kind === 'grate' || kind === 'bridge';
  }

  debug(out) {
    out.steps = this.steps;
    out.surface = ['stone', 'iron', 'wet', 'wood'][this.surface];
    out.scrape = +this.scrape.toFixed(3);
    out.rush = +this.rush.toFixed(3);
    out.rustle = +this.rustle.toFixed(3);
    return out;
  }
}
