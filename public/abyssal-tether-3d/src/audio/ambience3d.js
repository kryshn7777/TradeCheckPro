/* ABYSSAL TETHER 3D — ambience3d.js
 * Designed ambience beds for the eight sections (S1-S8), on top of the wind / pad / rumble bed in audio3d.js:
 *   - a convolution reverb whose impulse response is GENERATED per section from the shaft's size (rt60, early
 *     reflections, darkening tail), built incrementally over control ticks and cross-faded between two
 *     ConvolverNodes at section transitions (no clicks); the wet level follows the local openness (level.raycast
 *     in six directions, 3 Hz) and the section's authored wet level;
 *   - a low drone / room-tone bank whose character (metal, organ, machine hum, breath) differs per section,
 *     crossfading by parameter glides (a section change never restarts a source);
 *   - one-shot events scheduled by section density: water drips and cistern plonks (stereo, reverberant), machinery
 *     groans, creaking iron, chain clinks and, deeper down, wet slurps and sinew creaks;
 *   - the shaft "breath": a slow inhale / exhale (mgr._shaftBreath, -1..1) that swells the wind bed;
 *   - the silence signal: events thin with mgr._thin (the creature listening → the ambience thins out).
 * All sounds are synthesised; nothing is sampled. Costs: 2 convolvers while cross-fading (1 otherwise), 6 gated
 * oscillators, 1 gated noise loop.
 */
import { SECTION_BEDS, IRBuilder, reverbSpec } from './dsp3d.js';

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const FADE_TC = 0.8; // s, reverb cross-fade time constant (≈ 2.5 s to settle)
const IR_BUDGET = 22000; // samples per channel generated per control tick (30 Hz): a 3.4 s IR takes ~8 ticks
const EVENT_NAMES = ['drip', 'deep', 'groan', 'iron', 'chain', 'slurp', 'sinew'];

export class Ambience {
  constructor(mgr) {
    this.m = mgr;
    this.index = 0;
    this.open = 0.55; // smoothed openness 0..1
    this.openT = 0;
    this.rays = [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 0, 1],
      [0, 0, -1],
      [0, 1, 0],
      [0, -1, 0],
    ];
    this.ray = { t: 0, solid: null, x: 0, y: 0, z: 0 };
    this.timers = { drip: rand(1, 4), deep: rand(8, 20), groan: rand(10, 30), iron: rand(4, 12), chain: rand(10, 30), slurp: rand(5, 20), sinew: rand(8, 24) };
    this.breathPhase = rand(0, 6.28);
    this.builder = null;
    this.pendingIdx = -1;
    this.active = 0; // which convolver is audible (0 = A, 1 = B)
    this.swapAt = -1;
    this.irBuilt = 0; // IRs generated (diagnostics)
    this.wet = 0;
    this.spec = null;
    this.eventCount = 0;
    this.lastEvent = '';
    this.enabledReverb = true;
  }

  build() {
    const m = this.m;
    const ctx = m.ctx;
    // ---- convolution reverb: spaceIn → pre → (gate, fade) → convolver A | B → fade → wet → muffle ----
    this.pre = m._filter('lowpass', 6200, 0);
    m.spaceIn.connect(this.pre);
    this.wetOut = m._gainNode(0);
    this.wetOut.connect(m.muffle);
    this.kWet = m._knob(this.wetOut.gain, 0, 0.002);
    this.cv = [];
    for (let k = 0; k < 2; k++) {
      let node = null;
      try {
        node = ctx.createConvolver();
        node.normalize = false;
      } catch {
        node = null;
      }
      if (!node) {
        this.enabledReverb = false;
        break;
      }
      const gIn = m._gainNode(0);
      const gOut = m._gainNode(0);
      this.pre.connect(gIn);
      gIn.connect(node);
      node.connect(gOut);
      gOut.connect(this.wetOut);
      this.cv.push({ node, gIn, gOut, kIn: m._knob(gIn.gain, 0, 0.002), kOut: m._knob(gOut.gain, 0, 0.002), hasIR: false, idleSince: 0 });
    }
    if (this.enabledReverb) this._installIR(0, new IRBuilder(ctx.sampleRate, reverbSpec(0, null, m._reduced)).all(), 0);
    if (this.enabledReverb) {
      this.cv[0].kIn.force(1, ctx.currentTime, 0.05);
      this.cv[0].kOut.force(1, ctx.currentTime, 0.05);
    }

    // ---- drone / room-tone bank ----
    const bank = m._gainNode(1);
    const mk = (type, f, level) => {
      const o = m._osc(type, f);
      const g = m._gainNode(0);
      o.connect(g);
      g.connect(bank);
      return { o, g, kf: m._knob(o.frequency, f, 0.05, 0.002), kg: m._knob(g.gain, 0, 0.0005) };
    };
    this.d1 = mk('sine', 130, 0);
    this.d2 = mk('sine', 130.4, 0);
    this.d3 = mk('triangle', 196, 0);
    this.dMetal = mk('sine', 720, 0);
    // organ / choir: sawtooth through a low-pass whose cutoff breathes
    const org = m._osc('sawtooth', 130);
    const orgLp = m._filter('lowpass', 300, 1.2);
    const orgG = m._gainNode(0);
    org.connect(orgLp);
    orgLp.connect(orgG);
    orgG.connect(bank);
    this.dOrg = { kf: m._knob(org.frequency, 130, 0.05, 0.002), kg: m._knob(orgG.gain, 0, 0.0005), kLp: m._knob(orgLp.frequency, 300, 2, 0.01) };
    // machine hum: a rough 50 Hz buzz with a lowpass (mains-like, never loud)
    const hum = m._osc('sawtooth', 50);
    const humLp = m._filter('lowpass', 210, 0.7);
    const humG = m._gainNode(0);
    hum.connect(humLp);
    humLp.connect(humG);
    humG.connect(bank);
    this.dHum = { kg: m._knob(humG.gain, 0, 0.0005) };
    // room tone: pink noise through a formant-ish band
    const noise = m._loop(m._pink, 0.77);
    const nbp = m._filter('bandpass', 260, 2.5);
    const ng = m._gainNode(0);
    noise.connect(nbp);
    nbp.connect(ng);
    ng.connect(bank);
    this.dNoise = { kg: m._knob(ng.gain, 0, 0.0005), kf: m._knob(nbp.frequency, 260, 2, 0.01) };
    this.bankOut = m._gainNode(0);
    const send = m._gainNode(0.4);
    this.bankOut.connect(m.busAmbient);
    this.bankOut.connect(send);
    send.connect(m.spaceIn);
    this.kBank = m._knob(this.bankOut.gain, 0, 0.0005);
    this.gBank = m._gate([bank, this.bankOut]);
  }

  /** Section change: new drone targets, a new impulse response (incremental), event density. */
  setSection(index, section, now, tc) {
    const m = this.m;
    const i = clamp(index | 0, 0, SECTION_BEDS.length - 1);
    this.index = i;
    const bed = SECTION_BEDS[i];
    const sec = m._sec;
    const base = sec.root * 2;
    const dr = bed.drone;
    this.d1.kf.set(base, now, tc);
    this.d2.kf.set(base + dr.beat, now, tc);
    this.d3.kf.set(base * sec.iv, now, tc);
    this.dMetal.kf.set(base * 5.52, now, tc);
    this.dOrg.kf.set(base * 0.5, now, tc);
    this.dNoise.kf.set(dr.form, now, tc);
    if (this.enabledReverb) {
      this.pendingIdx = i;
      this.builder = new IRBuilder(m.ctx.sampleRate, reverbSpec(i, section, m._reduced));
    }
  }

  control(dtc, now, game, c) {
    const m = this.m;
    const bed = SECTION_BEDS[this.index];
    const dr = bed.drone;
    const clock = m._clock;
    // shaft breath: ~11 s cycle, slightly different per section
    this.breathPhase += (dtc * 6.2832) / (9 + (this.index % 4) * 1.3);
    if (this.breathPhase > 6.2832) this.breathPhase -= 6.2832;
    m._shaftBreath = Math.sin(this.breathPhase) * (0.6 + 0.4 * Math.sin(clock * 0.07));

    // ---- openness probe ----
    this.openT -= dtc;
    if (this.openT <= 0) {
      this.openT = 0.34;
      this._probe(game, bed);
    }
    // ---- reverb: wet follows openness; cross-fade when a new IR is ready ----
    if (this.enabledReverb) this._reverb(now, c, bed);

    // ---- drone bank ----
    const thin = c.thin;
    const lvl = dr.lvl * 0.075 * (0.55 + 0.45 * thin) * (c.victory ? 0.4 : 1) * (1 + 0.18 * m._shaftBreath);
    const red = m._reduced ? 0.7 : 1;
    this.kBank.set(lvl, now, 0.9);
    this.d1.kg.set(dr.tone * 0.9 * red, now, 1.2);
    this.d2.kg.set(dr.tone * 0.8 * red, now, 1.2);
    this.d3.kg.set(dr.tone * 0.45, now, 1.2);
    this.dMetal.kg.set(dr.metal * 0.05 * (0.6 + 0.4 * (0.5 + 0.5 * Math.sin(clock * 0.31))), now, 0.8);
    this.dOrg.kg.set(dr.organ * 0.3 * (0.7 + 0.3 * m._shaftBreath), now, 1.4);
    this.dOrg.kLp.set(dr.lp * (1 + 0.3 * Math.sin(clock * 0.19) + 0.12 * m._shaftBreath), now, 0.5);
    this.dHum.kg.set(dr.hum * 0.14, now, 1.5);
    this.dNoise.kg.set(0.5 * (0.7 + 0.3 * Math.sin(clock * 0.23 + 1)), now, 1.0);
    m._driveGate(this.gBank, this.kBank.last > 0.0005, dtc);

    // ---- events ----
    if (now < m._hushUntil) return;
    const scale = bed.scale * (0.35 + 0.65 * thin) * (m._reduced ? 0.6 : 1) * (1 + 0.5 * c.tv);
    for (let k = 0; k < EVENT_NAMES.length; k++) {
      const name = EVENT_NAMES[k];
      const rate = bed.ev[name] * scale;
      if (rate <= 0) continue;
      this.timers[name] -= dtc;
      if (this.timers[name] <= 0) {
        this.timers[name] = (rand(0.45, 1.7) * 60) / Math.max(0.2, rate);
        this._fire(name);
      }
    }
  }

  _probe(game, bed) {
    const m = this.m;
    const lv = game && game.level;
    let target = bed.open;
    if (lv && typeof lv.raycast === 'function' && m._listenerSet) {
      let sum = 0;
      for (let k = 0; k < 6; k++) {
        const d = this.rays[k];
        let t = 36;
        try {
          const r = lv.raycast(m._lx, m._ly, m._lz, d[0], d[1], d[2], 36, this.ray);
          if (r && r.t === r.t) t = r.t;
        } catch {
          t = 36;
        }
        // The vertical axis counts less: every shaft is tall.
        sum += Math.min(1, t / 36) * (k >= 4 ? 0.5 : 1);
      }
      target = clamp(sum / 5, 0, 1);
      target = 0.35 * bed.open + 0.65 * target;
    }
    this.open += (target - this.open) * 0.3;
  }

  _reverb(now, c, bed) {
    const m = this.m;
    // wet level: authored × openness
    const hushed = now < m._hushUntil;
    this.wet = bed.wet * (0.5 + 0.9 * this.open);
    this.kWet.set(hushed ? 0 : this.wet * 0.95, now, 0.6);
    // build the next IR a slice at a time
    const b = this.builder;
    if (b) {
      b.step(IR_BUDGET);
      if (b.finished) {
        const idle = 1 - this.active;
        const cvI = this.cv[idle];
        // The idle convolver is silent (input and output faded long ago): safe to swap its buffer.
        if (this.swapAt < 0 || now >= this.swapAt) {
          this._installIR(idle, b, now);
          cvI.kIn.force(1, now, FADE_TC);
          cvI.kOut.force(1, now, FADE_TC);
          const old = this.cv[this.active];
          old.kIn.force(0, now, FADE_TC);
          old.kOut.force(0, now, FADE_TC);
          this.active = idle;
          this.swapAt = now + 4.2; // the old convolver is quiet after this; only then may it be reloaded
          this.builder = null;
          this.irBuilt++;
        }
      }
    }
  }

  _installIR(k, b, now) {
    const m = this.m;
    const cv = this.cv[k];
    try {
      const buf = m.ctx.createBuffer(2, b.len, m.ctx.sampleRate);
      buf.getChannelData(0).set(b.L);
      buf.getChannelData(1).set(b.R);
      cv.node.buffer = buf;
      cv.hasIR = true;
      this.spec = b.spec;
    } catch (err) {
      this.enabledReverb = false;
      m._warn('ir', err);
    }
  }

  // -------------------------------------------------------------------------
  // events
  // -------------------------------------------------------------------------

  _fire(name) {
    this.eventCount++;
    this.lastEvent = name;
    try {
      this['_' + name]();
    } catch (err) {
      this.m._warn('amb-' + name, err);
    }
  }

  /** Water drip: a rising "bloop" with a tick; puddle / pipe / shaft flavours; sometimes a second drop. */
  _drip() {
    const m = this.m;
    const bed = SECTION_BEDS[this.index];
    const pos = m._around(3, 24, 10);
    const flavour = Math.random();
    const metal = flavour < 0.22;
    const lvl = rand(0.07, 0.15) * m._ambientLift(pos);
    const v = m._begin('drip', 0, 0.07, 1.3, m.busAmbient, lvl, 0, rand(0.55, 0.9), 0, pos, 'ambient', true);
    if (!v) return;
    const drops = Math.random() < 0.3 ? 2 : 1;
    for (let d = 0; d < drops; d++) {
      const t = v.t0 + (d ? rand(0.1, 0.45) : 0);
      const k = d ? 0.55 : 1;
      const f = metal ? rand(1300, 2700) : rand(480, 1250) * (1 + 0.3 * bed.wetness);
      const o = m._vOsc(v, 'sine', f, t);
      o.frequency.setTargetAtTime(f * (metal ? 1.15 : 2.3), t, metal ? 0.05 : 0.014);
      const g = m._vGain(v, 0);
      m._perc(g.gain, t, 0.8 * k, 0.002, metal ? 0.05 : 0.028);
      o.connect(g);
      g.connect(v.out);
      if (metal) {
        const r = m._vOsc(v, 'sine', f * 2.76, t);
        const rg = m._vGain(v, 0);
        m._perc(rg.gain, t, 0.3 * k, 0.001, 0.13);
        r.connect(rg);
        rg.connect(v.out);
      }
      m._tickTrain(v, t, 1, 0.01, 0.35 * k, 1800, 4600, 4, 0.006, 0);
    }
    m._commit(v);
  }

  /** Cistern plonk: a deep drop into a large pool, long echo. */
  _deep() {
    const m = this.m;
    const pos = m._around(8, 34, 18);
    const v = m._begin('deep', 0, 1.5, 2.2, m.busAmbient, rand(0.12, 0.22) * m._ambientLift(pos), 0, 0.95, 0, pos, 'ambient', true);
    if (!v) return;
    const t = v.t0;
    const f = rand(140, 300);
    const o = m._vOsc(v, 'sine', f * 1.6, t);
    o.frequency.setTargetAtTime(f, t, 0.045);
    const g = m._vGain(v, 0);
    m._perc(g.gain, t, 0.9, 0.003, 0.09);
    o.connect(g);
    g.connect(v.out);
    const n = m._vNoise(v, m._brown, t, 1.3);
    const lp = m._vFilter(v, 'lowpass', 520, 0);
    const ng = m._vGain(v, 0);
    m._perc(ng.gain, t, 0.5, 0.004, 0.05);
    n.connect(lp);
    lp.connect(ng);
    ng.connect(v.out);
    m._commit(v);
  }

  /** Distant machinery: a gear-driven low groan. */
  _groan() {
    const m = this.m;
    const dur = rand(2.6, 5.2);
    const pos = m._around(26, 62, 28);
    const v = m._begin('groan', 0, 3, dur + 1.2, m.busAmbient, rand(0.26, 0.4) * m._ambientLift(pos), 0, 0.6, 0, pos, 'ambient', true);
    if (!v) return;
    const t = v.t0;
    const f0 = rand(34, 62);
    const o = m._vOsc(v, 'sawtooth', f0, t);
    o.frequency.exponentialRampToValueAtTime(f0 * rand(0.72, 1.35), t + dur);
    const lp = m._vFilter(v, 'lowpass', 240, 1);
    const bp = m._vFilter(v, 'bandpass', rand(110, 260), 4);
    const am = m._vGain(v, 0.7);
    const lfo = m._vOsc(v, 'sine', rand(2.5, 8), t);
    const lg = m._vGain(v, 0.3);
    lfo.connect(lg);
    lg.connect(am.gain);
    const g = m._vGain(v, 0);
    m._swell(g.gain, t, 1, dur * 0.4, dur * 0.25, dur * 0.2);
    o.connect(lp);
    lp.connect(am);
    am.connect(g);
    o.connect(bp);
    bp.connect(am);
    g.connect(v.out);
    m._commit(v);
  }

  /** Creaking iron: stick-slip pulses through metallic resonances, sometimes a ping. */
  _iron() {
    const m = this.m;
    const dur = rand(0.8, 2.2);
    const pos = m._around(6, 30, 12);
    const v = m._begin('iron', 0, 0.8, dur + 1.5, m.busAmbient, rand(0.1, 0.2) * m._ambientLift(pos), 0, 0.5, 0, pos, 'ambient', true);
    if (!v) return;
    const t = v.t0;
    const f1 = rand(450, 900);
    const o = m._vOsc(v, 'sawtooth', rand(7, 19), t);
    o.frequency.linearRampToValueAtTime(rand(10, 30), t + dur);
    const b1 = m._vFilter(v, 'bandpass', f1, 18);
    b1.frequency.linearRampToValueAtTime(f1 * rand(0.8, 1.3), t + dur);
    const b2 = m._vFilter(v, 'bandpass', f1 * rand(2.3, 2.9), 22);
    const g = m._vGain(v, 0);
    m._swell(g.gain, t, 1, dur * 0.3, dur * 0.4, 0.22);
    o.connect(b1);
    o.connect(b2);
    b1.connect(g);
    b2.connect(g);
    g.connect(v.out);
    if (Math.random() < 0.4) {
      const p = m._vOsc(v, 'sine', f1 * 3.01, t);
      const pg = m._vGain(v, 0);
      m._perc(pg.gain, t + dur * 0.3, 0.12, 0.002, 0.25);
      p.connect(pg);
      pg.connect(v.out);
    }
    m._commit(v);
  }

  /** A chain swaying: a few irregular clinks that ring. */
  _chain() {
    const m = this.m;
    const pos = m._around(10, 40, 20);
    const v = m._begin('chain', 0, 3, 3, m.busAmbient, rand(0.14, 0.24) * m._ambientLift(pos), 0, 0.6, 0, pos, 'ambient', true);
    if (!v) return;
    m._tickTrain(v, v.t0, 3 + Math.floor(Math.random() * 4), rand(0.9, 1.9), 0.6, 2200, 4800, 18, 0.05, 0.4);
    m._commit(v);
  }

  /** Wet organic slurp: a bubbling, band-swept gloop. */
  _slurp() {
    const m = this.m;
    const dur = rand(0.45, 1.1);
    const pos = m._around(4, 22, 8);
    const v = m._begin('slurp', 0, 0.8, dur + 0.6, m.busAmbient, rand(0.14, 0.26) * m._ambientLift(pos), 0, 0.45, 0, pos, 'ambient', true);
    if (!v) return;
    const t = v.t0;
    const n = m._vNoise(v, m._pink, t, 0.9);
    const bp = m._vFilter(v, 'bandpass', rand(250, 500), 7);
    const up = Math.random() < 0.5;
    bp.frequency.exponentialRampToValueAtTime(up ? rand(900, 1500) : rand(160, 260), t + dur);
    const g = m._vGain(v, 0);
    m._swell(g.gain, t, 0.8, dur * 0.35, dur * 0.2, dur * 0.18);
    n.connect(bp);
    bp.connect(g);
    g.connect(v.out);
    const o = m._vOsc(v, 'sine', rand(95, 170), t);
    o.frequency.exponentialRampToValueAtTime(rand(45, 80), t + dur);
    const am = m._vGain(v, 0.5);
    const lfo = m._vOsc(v, 'sine', rand(13, 24), t);
    const lg = m._vGain(v, 0.5);
    lfo.connect(lg);
    lg.connect(am.gain);
    const og = m._vGain(v, 0);
    m._swell(og.gain, t, 0.5, dur * 0.3, dur * 0.2, dur * 0.2);
    o.connect(am);
    am.connect(og);
    og.connect(v.out);
    m._commit(v);
  }

  /** Sinew creak: fast stick-slip pulses on a narrow band plus a low moan. */
  _sinew() {
    const m = this.m;
    const dur = rand(1.0, 2.2);
    const pos = m._around(5, 24, 10);
    const v = m._begin('sinew', 0, 1.2, dur + 1, m.busAmbient, rand(0.1, 0.18) * m._ambientLift(pos), 0, 0.5, 0, pos, 'ambient', true);
    if (!v) return;
    const t = v.t0;
    const o = m._vOsc(v, 'sawtooth', rand(14, 24), t);
    o.frequency.linearRampToValueAtTime(rand(24, 44), t + dur);
    const f = rand(700, 1700);
    const bp = m._vFilter(v, 'bandpass', f, 12);
    bp.frequency.linearRampToValueAtTime(f * rand(0.7, 1.4), t + dur);
    const g = m._vGain(v, 0);
    m._swell(g.gain, t, 0.9, dur * 0.4, dur * 0.2, dur * 0.18);
    o.connect(bp);
    bp.connect(g);
    g.connect(v.out);
    const mo = m._vOsc(v, 'sine', rand(70, 130), t);
    mo.frequency.linearRampToValueAtTime(rand(60, 150), t + dur);
    const vib = m._vOsc(v, 'sine', rand(3, 5), t);
    const vg = m._vGain(v, 4);
    vib.connect(vg);
    vg.connect(mo.frequency);
    const mg = m._vGain(v, 0);
    m._swell(mg.gain, t, 0.35, dur * 0.5, dur * 0.1, dur * 0.2);
    mo.connect(mg);
    mg.connect(v.out);
    m._commit(v);
  }

  debug(out) {
    out.section = this.index;
    out.open = +this.open.toFixed(3);
    out.wet = +this.wet.toFixed(3);
    out.reverb = this.enabledReverb ? { rt60: this.spec ? +this.spec.rt.toFixed(2) : 0, active: this.active, irBuilt: this.irBuilt, building: !!this.builder } : null;
    out.events = this.eventCount;
    out.lastEvent = this.lastEvent;
    out.shaftBreath = +(this.m._shaftBreath || 0).toFixed(3);
    return out;
  }
}
