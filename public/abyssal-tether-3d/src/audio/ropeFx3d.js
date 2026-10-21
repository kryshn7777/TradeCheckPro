/* ABYSSAL TETHER 3D — ropeFx3d.js
 * Continuous rope voice, per hand and positioned at the controller's muzzle:
 *   - FRICTION: while the line runs out through the clutch / winch (rope.slipSpeed, or a reel-out) a hiss of
 *     rubbed cable and a stick-slip cable creak; pitch and level follow the pay-out speed and the load;
 *   - TAUT HUM: a subtle singing of the line that rises in pitch and level with the tension;
 *   - the matching HAPTIC buzz is ropeHaptic() (dsp3d.js), the same curve game.js sends to the controller.
 * The one-shot 'rope:slip' event adds a short bite at the start of a slip. The layers cost nothing while no line is
 * out: the sources are disconnected after 3 s of silence (AudioManager3D._gate).
 */
import { CONFIG } from '../sim/config3d.js';
import { ropeLayer, ropeHaptic } from './dsp3d.js';

export { ropeHaptic };
const HANDS = ['left', 'right'];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class RopeFx {
  constructor(mgr) {
    this.m = mgr;
    this.h = [];
    this.tmp = { amp: 0, speed: 0, load: 0, hum: 0 };
    this.pose = [{}, {}];
    this.prevLen = [0, 0];
    this.prevAtt = [false, false];
    this.slipEvents = 0;
    this.lastSlip = 0;
    this.amp = [0, 0];
    this.gravity = CONFIG.player.gravity || 9.81;
  }

  build() {
    const m = this.m;
    for (let i = 0; i < 2; i++) {
      const out = m._gainNode(1);
      const pan = m._makeSpatialPanner('flat', i ? 0.3 : -0.3, 1.5, -0.4, false);
      out.connect(pan);
      pan.connect(m.busPlayer);
      const send = m._gainNode(0.12);
      out.connect(send);
      send.connect(m.spaceIn);
      // hiss
      const white = m._loop(m._white, i ? 1.06 : 0.94);
      const hbp = m._filter('bandpass', 2400, 0.8);
      const hg = m._gainNode(0);
      white.connect(hbp);
      hbp.connect(hg);
      hg.connect(out);
      // stick-slip creak
      const saw = m._osc('sawtooth', 24);
      const c1 = m._filter('bandpass', 760, 9);
      const c2 = m._filter('bandpass', 1750, 12);
      const c2g = m._gainNode(0.55);
      const cg = m._gainNode(0);
      saw.connect(c1);
      saw.connect(c2);
      c1.connect(cg);
      c2.connect(c2g);
      c2g.connect(cg);
      cg.connect(out);
      // taut hum
      const hum = m._osc('triangle', 96);
      const hlp = m._filter('lowpass', 520, 0.6);
      const mg = m._gainNode(0);
      hum.connect(hlp);
      hlp.connect(mg);
      mg.connect(out);
      const gate = m._gate([white, hbp], [saw, c1], [saw, c2], [hum, hlp]);
      this.h.push({
        out,
        pan,
        gate,
        kHissG: m._knob(hg.gain, 0, 0.002),
        kHissF: m._knob(hbp.frequency, 2400, 8, 0.01),
        kCreakG: m._knob(cg.gain, 0, 0.002),
        kCreakO: m._knob(saw.frequency, 24, 0.3, 0.01),
        kCreakF: m._knob(c1.frequency, 760, 5, 0.01),
        kHumG: m._knob(mg.gain, 0, 0.0008),
        kHumF: m._knob(hum.frequency, 96, 0.2, 0.004),
        px: NaN,
      });
    }
  }

  control(dtc, now, game, c) {
    const m = this.m;
    const T = game && game.tethers && game.tethers.hands ? game.tethers.hands : null;
    const P = game && game.player;
    const live = !!T && !!P && c.playing && !c.dead;
    const clock = m._clock;
    const inp = game && game.input;
    for (let i = 0; i < 2; i++) {
      const L = this.h[i];
      const rope = live ? T[HANDS[i]].rope : null;
      const att = !!(rope && rope.anchor);
      let amp = 0;
      if (att) {
        const len = rope.length;
        let pay = Math.max(0, rope.slipSpeed || 0);
        if (this.prevAtt[i] && dtc > 0) {
          const dl = (len - this.prevLen[i]) / dtc;
          if (dl > 0 && dl < 40) pay = Math.max(pay, dl);
        }
        this.prevLen[i] = len;
        const loadG = (rope.tension || 0) / this.gravity;
        const r = ropeLayer(pay, loadG, this.tmp);
        amp = r.amp;
        const wob = Math.sin(clock * 9.1 + i * 2) * 0.5 + Math.sin(clock * 23.7 + i) * 0.5;
        L.kHissG.set(0.34 * Math.pow(r.amp, 0.9), now, 0.05);
        L.kHissF.set(1500 + 3600 * r.speed + 300 * wob, now, 0.07);
        L.kCreakG.set(0.42 * Math.pow(r.amp, 0.8) * (0.8 + 0.2 * wob), now, 0.05);
        L.kCreakO.set(16 + 62 * r.speed + 5 * wob, now, 0.04);
        L.kCreakF.set(640 + 520 * r.speed + 120 * r.load, now, 0.08);
        L.kHumG.set(0.05 * r.hum * (1 - 0.5 * r.amp), now, 0.25);
        L.kHumF.set(88 + 78 * r.load + 3 * wob, now, 0.2);
        // position at the controller's muzzle (cheap: only while a line is out)
        if (inp && typeof inp.handPose === 'function') {
          const p = inp.handPose(HANDS[i], this.pose[i]);
          if (p && p.x === p.x) m._setPannerPos(L.pan, p.x, p.y, p.z, now, 0.04);
        }
      } else {
        this.prevLen[i] = 0;
        L.kHissG.set(0, now, 0.06);
        L.kCreakG.set(0, now, 0.06);
        L.kHumG.set(0, now, 0.15);
      }
      this.prevAtt[i] = att;
      this.amp[i] = amp;
      const active = L.kHissG.last > 0.001 || L.kCreakG.last > 0.001 || L.kHumG.last > 0.0008;
      m._driveGate(L.gate, active, dtc);
    }
  }

  /** rope:slip — the first bite of a slip: a short rasp (the layer takes over). */
  onSlip(p) {
    const m = this.m;
    this.slipEvents++;
    const hand = p.hand === 'left' ? -1 : 1;
    const k = clamp(Number(p.intensity) || 0, 0, 1);
    this.lastSlip = k;
    if (k < 0.25) return;
    const v = m._begin('slip', 1, 0.14, 0.4, m.busPlayer, 0.35 + 0.5 * k, 0.35 * hand, 0.08, 0);
    if (!v) return;
    const t = v.t0;
    const n = m._vNoise(v, m._white, t, 1);
    const bp = m._vFilter(v, 'bandpass', 1800 + 2200 * k, 1.2);
    bp.frequency.exponentialRampToValueAtTime(900 + 600 * k, t + 0.22);
    const g = m._vGain(v, 0);
    m._perc(g.gain, t, 0.5 * k + 0.2, 0.006, 0.07);
    n.connect(bp);
    bp.connect(g);
    g.connect(v.out);
    m._tickTrain(v, t, 4, 0.18, 0.3 * k, 900, 2400, 6, 0.01, 0.4);
    m._commit(v);
  }

  debug(out) {
    out.friction = [+this.amp[0].toFixed(3), +this.amp[1].toFixed(3)];
    out.slipEvents = this.slipEvents;
    out.lastSlip = +this.lastSlip.toFixed(2);
    return out;
  }
}
