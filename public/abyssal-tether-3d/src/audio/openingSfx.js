/* THE LANTERN — audio/openingSfx.js
 * The opening cinematic's sound (docs/abyssal-tether-3d/plans/OPENING_CINEMATIC.md section 7): a score, foley, the creature and the
 * narration (v2: THE COLLAR's machines, OPENING_V2_THE_COLLAR.md section 5), each a designed cue at a fixed time on the film's cue
 * sheet (sim/openingCinematic.js CUES / VO). Nothing is random: the noise sources are seeded buffers and every "variation" (the
 * line's ratchet, the grit, the grinding) is a fixed table, and the rotors' pitch / pan come from the timeline itself.
 *
 *   OpeningScore(ctx, {score, sfx, voice})   works on any BaseAudioContext: the game's live one (AudioManager3D mixes it in below)
 *                                             and an OfflineAudioContext (tools/abyssal-tether-3d/release/render-opening.mjs renders the
 *                                             trailer's soundtrack with the same code)
 *     .cue(name, when)    schedule cue `name` at context time `when`
 *     .voice(id, when)    play a narration clip (loadVoice first)
 *     .loadVoice(base)    fetch + decode assets/audio/opening/<id>.ogg (resolves when all are in; a missing one is skipped)
 *     .stop(fade)         fade everything out and stop it (the end of the film, a skip)
 *
 * The mixin (OPENING_SFX / OPENING_EVENTS) wires the bus events the game emits: opening:begin, opening:cue {name}, opening:vo {id},
 * opening:skip, opening:end {skipped}. Routing: the score and the narration on the stinger bus (the master volume, not the effects slider: it is
 * music), the foley and the creature on the player bus (the effects slider).
 */
import { CUES, VO, LIGHTS_DIE, newOpeningSnapshot, sampleOpening } from '../sim/openingCinematic.js';

const SR_NOISE = 2.5; // seconds of each noise buffer

/** A seeded generator (mulberry32): the noise and the tables are the same every run. */
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function noiseBuffer(ctx, kind, seed) {
  const len = Math.floor(ctx.sampleRate * SR_NOISE);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  const rnd = seeded(seed);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let last = 0;
  for (let i = 0; i < len; i++) {
    const w = rnd() * 2 - 1;
    if (kind === 'pink') {
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
    } else if (kind === 'brown') {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.2;
    } else d[i] = w * 0.6;
  }
  // seamless loop: fade the drift between the ends
  const drift = d[len - 1] - d[0];
  for (let i = 0; i < len; i++) d[i] -= (drift * i) / (len - 1);
  return buf;
}

/** The chimney: a long, dark stereo impulse response (deterministic). */
function chimneyIR(ctx, seconds) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    const rnd = seeded(1791 + ch * 41);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / ctx.sampleRate;
      const env = Math.exp(-t * 1.55) * (t < 0.012 ? t / 0.012 : 1);
      lp += ((rnd() * 2 - 1) - lp) * (0.32 - 0.24 * Math.min(1, t / seconds)); // darker as it decays
      d[i] = lp * env * 0.9;
    }
  }
  return ir;
}

// ---- the fixed tables (built once from a seed, never at play time) ----------------------------------------------------------
const TABLE = (() => {
  const r = seeded(4111);
  // dust off the arch after the stop: grains [t, level, freq]
  const dust = [];
  for (let k = 0, tt = 0.2; k < 34 && tt < 2.6; k++) {
    dust.push([tt, 0.2 + 0.8 * r() * Math.exp(-tt), 2600 + 4200 * r()]);
    tt += 0.03 + 0.12 * r();
  }
  // the grinding below: grain onsets over 7.5 s
  const grind = [];
  for (let tt = 0; tt < 7.6; ) {
    grind.push([tt, 0.3 + 0.7 * r(), 90 + 160 * r()]);
    tt += 0.07 + 0.22 * r();
  }
  // the line paying out from the Collar's winch on the way down: a ratchet tick every ~1.6 s, a fixed jitter
  const ratchet = [];
  for (let tt = 0.4; tt < 26; tt += 1.45 + 0.3 * r()) ratchet.push([tt, 0.5 + 0.5 * r()]);
  return Object.freeze({ dust, grind, ratchet });
})();

export const OPENING_TABLES = TABLE; // tests: the sheet is fixed

const D2 = 73.416;
/** The narration's colour per line: 'radio' (the team on the uplink: the console speaker) or 'close' (the record, dry). */
const VO_FX = Object.freeze(Object.fromEntries(VO.map((l) => [l.id, l.fx || 'close'])));
const MOTIF = [293.66, 440.0, 349.23, 329.63, 293.66]; // D A F E D: the Lamp motif

export class OpeningScore {
  /**
   * @param {BaseAudioContext} ctx
   * @param {{score: AudioNode, sfx?: AudioNode, voice?: AudioNode}} out
   */
  constructor(ctx, out) {
    this.ctx = ctx;
    this.white = noiseBuffer(ctx, 'white', 11);
    this.pink = noiseBuffer(ctx, 'pink', 23);
    this.brown = noiseBuffer(ctx, 'brown', 37);
    // buses: everything through one gain per kind, then out; one reverb (the chimney) shared
    this.music = ctx.createGain();
    this.fx = ctx.createGain();
    this.vo = ctx.createGain();
    this.music.connect(out.score);
    this.fx.connect(out.sfx || out.score);
    this.vo.connect(out.voice || out.score);
    this.rev = ctx.createConvolver();
    this.rev.buffer = chimneyIR(ctx, 4.6);
    this.revIn = ctx.createGain();
    this.revIn.gain.value = 1;
    this.revIn.connect(this.rev);
    this.rev.connect(this.music);
    this.voBufs = Object.create(null);
    this._live = []; // [{src, end}]
    this._drone = null;
    this._voSrc = null;
    this._dead = false;
  }

  // ---- building blocks -----------------------------------------------------------------------------------------------------
  _track(src, end) {
    const L = this._live;
    const now = this.ctx.currentTime;
    for (let i = L.length - 1; i >= 0; i--) if (L[i].end < now - 0.5) L.splice(i, 1);
    L.push({ src, end });
    return src;
  }

  _osc(type, f, t0, t1) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, t0);
    o.start(t0);
    o.stop(t1);
    return this._track(o, t1);
  }

  _noise(buf, t0, t1, rate, offset) {
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.playbackRate.value = rate || 1;
    s.start(t0, offset || 0);
    s.stop(t1);
    return this._track(s, t1);
  }

  _filter(type, f, q) {
    const b = this.ctx.createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    b.Q.value = q == null ? 0.707 : q;
    return b;
  }

  _gain(v) {
    const g = this.ctx.createGain();
    g.gain.value = v || 0;
    return g;
  }

  _pan(p) {
    if (typeof this.ctx.createStereoPanner !== 'function') return this._gain(1);
    const n = this.ctx.createStereoPanner();
    n.pan.value = p;
    return n;
  }

  /** An AD envelope on a gain param: 0 -> peak in `a`, exponential decay of time constant `d` from there. */
  _ad(param, t, peak, a, d) {
    param.setValueAtTime(0, t);
    param.linearRampToValueAtTime(peak, t + a);
    param.setTargetAtTime(0, t + a, d);
  }

  /** Route `node` to a bus (and the reverb with `send`). */
  _out(node, bus, send, pan) {
    let tail = node;
    if (pan) {
      const p = this._pan(pan);
      tail.connect(p);
      tail = p;
    }
    tail.connect(bus);
    if (send > 0) {
      const s = this._gain(send);
      tail.connect(s);
      s.connect(this.revIn);
    }
  }

  /** A bowed-metal note: inharmonic partials, a slow bow attack, a little scrape. Returns the fundamental's oscillator. */
  _bowed(f, t, dur, peak, bus, send) {
    const parts = [
      [1, 1],
      [2.01, 0.42],
      [3.03, 0.22],
      [4.12, 0.11],
      [5.43, 0.06],
    ];
    const env = this._gain(0);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(peak, t + 0.42);
    env.gain.setValueAtTime(peak, t + Math.max(0.45, dur - 0.5));
    env.gain.linearRampToValueAtTime(0, t + dur + 0.6);
    const lp = this._filter('lowpass', f * 6, 0.5);
    env.connect(lp);
    let first = null;
    for (const [m, a] of parts) {
      const o = this._osc(m === 1 ? 'triangle' : 'sine', f * m, t, t + dur + 0.7);
      // the bow's vibrato: a fixed 5.1 Hz LFO, deeper as the note sustains
      const lfo = this._osc('sine', 5.1, t, t + dur + 0.7);
      const lg = this._gain(0);
      lg.gain.setValueAtTime(0, t);
      lg.gain.linearRampToValueAtTime(f * m * 0.0035, t + 0.8);
      lfo.connect(lg);
      lg.connect(o.frequency);
      const g = this._gain(a);
      o.connect(g);
      g.connect(env);
      if (!first) first = o;
    }
    // the hair on the metal: narrow noise at the third partial
    const n = this._noise(this.pink, t, t + dur + 0.7, 1, (f % 1) * 2);
    const bp = this._filter('bandpass', f * 3, 9);
    const ng = this._gain(0.5);
    n.connect(bp);
    bp.connect(ng);
    ng.connect(env);
    this._out(lp, bus, send);
    return first;
  }

  _thump(t, f0, f1, dur, peak, bus, send, pan) {
    const o = this._osc('sine', f0, t, t + dur + 0.1);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = this._gain(0);
    this._ad(g.gain, t, peak, 0.004, dur / 3);
    o.connect(g);
    this._out(g, bus, send, pan);
  }

  _burst(buf, t, dur, type, f, q, peak, bus, send, pan, rate) {
    const n = this._noise(buf, t, t + dur + 0.05, rate || 1, (t * 0.37) % 2);
    const fl = this._filter(type, f, q);
    const g = this._gain(0);
    this._ad(g.gain, t, peak, Math.min(0.01, dur * 0.2), dur / 3);
    n.connect(fl);
    fl.connect(g);
    this._out(g, bus, send, pan);
    return fl;
  }

  /** A metal clink: three partials and a tick. */
  _clink(t, k, level, bus, pan) {
    const base = 2050 + 520 * k;
    for (const [m, a, d] of [
      [1, 1, 0.09],
      [1.57, 0.55, 0.06],
      [2.23, 0.32, 0.04],
    ]) {
      const o = this._osc('sine', base * m, t, t + 0.4);
      const g = this._gain(0);
      this._ad(g.gain, t, a * level, 0.001, d);
      o.connect(g);
      this._out(g, bus, 0.35, pan);
    }
    this._burst(this.white, t, 0.02, 'highpass', 3000, 0.7, 0.4 * level, bus, 0.1, pan);
  }

  _heartbeat(t, peak, bus) {
    this._thump(t, 62, 44, 0.16, peak, bus, 0.02);
    this._thump(t + 0.15, 54, 40, 0.14, peak * 0.7, bus, 0.02);
  }

  /** The human inhale: a band of breath that swells and is cut. */
  _breath(t, dur, peak, bus, f, pan) {
    const n = this._noise(this.pink, t, t + dur + 0.2, 1, 0.3);
    const bp = this._filter('bandpass', f || 1300, 0.9);
    const bp2 = this._filter('bandpass', (f || 1300) * 0.45, 1.2);
    const g = this._gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak * 0.6, t + dur * 0.18);
    g.gain.linearRampToValueAtTime(peak, t + dur * 0.8);
    g.gain.linearRampToValueAtTime(0, t + dur);
    n.connect(bp);
    n.connect(bp2);
    bp.connect(g);
    bp2.connect(g);
    this._out(g, bus, 0.04, pan);
  }

  // ---- the cue sheet -------------------------------------------------------------------------------------------------------
  /** Schedule cue `name` at context time `t`. */
  cue(name, t) {
    if (this._dead) return;
    const fn = this['_cue_' + name];
    if (typeof fn === 'function') fn.call(this, t);
  }

  _cue_roomTone(t) {
    // the drone: D (sine + a filtered saw), a fifth joins at the lowering; its level and colour follow the acts (other cues ramp it)
    const g = this._gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.1, t + 3.2);
    const lp = this._filter('lowpass', 260, 0.6);
    const s1 = this._osc('sine', D2, t, t + 70);
    const s2 = this._osc('sawtooth', D2 * 0.5, t, t + 70);
    const s2g = this._gain(0.22);
    s2.connect(s2g);
    s2g.connect(lp);
    s1.connect(g);
    lp.connect(g);
    const fifth = this._osc('sine', D2 * 1.5, t, t + 70);
    const fg = this._gain(0);
    fifth.connect(fg);
    fg.connect(g);
    this._out(g, this.music, 0.25);
    this._drone = { g, lp, fifth: fg };
    // the room: the shaft breathing (brown noise in a low band, a slow fixed swell)
    const w = this._noise(this.brown, t, t + 66, 0.5);
    const wb = this._filter('bandpass', 180, 0.8);
    const wg = this._gain(0);
    wg.gain.setValueAtTime(0, t);
    wg.gain.linearRampToValueAtTime(0.05, t + 4);
    for (let k = 0; k < 13; k++) wg.gain.linearRampToValueAtTime(0.05 + 0.025 * Math.sin(k * 1.3) + 0.02 * (k > 3 ? 1 : 0), t + 4 + k * 4.6);
    w.connect(wb);
    wb.connect(wg);
    this._out(wg, this.fx, 0.15);
    this._wind = wg;
  }

  _motif(t, peak, step, octave) {
    let last = null;
    for (let i = 0; i < MOTIF.length; i++) {
      const dur = i === MOTIF.length - 1 ? step * 4.2 : step * 1.15;
      last = this._bowed(MOTIF[i], t + i * step, dur, peak, this.music, 0.45);
      if (octave) this._bowed(MOTIF[i] * 0.5, t + i * step, dur, peak * 0.55, this.music, 0.45);
    }
    return last;
  }

  _cue_motif1(t) {
    this._motif(t, 0.05, 1.15, false);
  }

  _cue_motif2(t) {
    // THE WINDOW: the motif full (an octave under it) and a cold high cluster that opens slowly
    this._motif(t + 0.4, 0.075, 1.35, true);
    const cl = [880, 1318.5, 1174.66, 987.77];
    for (let i = 0; i < cl.length; i++) {
      for (const det of [-0.0017, 0.0017]) {
        const o = this._osc('sine', cl[i] * (1 + det), t, t + 12.5);
        const g = this._gain(0);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.012 - i * 0.0018, t + 2.4 + i * 0.5);
        g.gain.setValueAtTime(0.012 - i * 0.0018, t + 9.4);
        g.gain.linearRampToValueAtTime(0, t + 12.2);
        o.connect(g);
        this._out(g, this.music, 0.6, det > 0 ? 0.35 : -0.35);
      }
    }
    const d = this._drone;
    if (d) {
      d.g.gain.setTargetAtTime(0.17, t, 1.5);
      d.lp.frequency.setTargetAtTime(520, t, 2);
    }
  }

  // ---- THE COLLAR (v2: OPENING_V2_THE_COLLAR.md section 5) ------------------------------------------------------------------
  /** Where drone i is at film time ft, as a stereo pan and a distance gain from the desktop camera (sampled once per cue). */
  _droneAt(i, ft) {
    const s = sampleOpening(ft, null, this._snap || (this._snap = newOpeningSnapshot()));
    const d = s.drones[i];
    const c = s.cam;
    const dx = d.x - c.x;
    const dy = d.y - c.y;
    const dz = d.z - c.z;
    const r = Math.hypot(dx, dy, dz) || 1;
    const right = (dx * Math.cos(c.yaw) - dz * Math.sin(c.yaw)) / r;
    return { pan: Math.max(-0.9, Math.min(0.9, right)), g: 1 / (1 + r / 4), r };
  }

  /** A rotor: a band-passed saw at the blade-pass frequency and its wash; gain / pitch / pan automated every 0.5 s from the timeline. */
  _rotor(i, t, ft0, ft1, f0, f1) {
    const o = this._osc('sawtooth', f0, t, t + (ft1 - ft0) + 0.3);
    const bp = this._filter('bandpass', f0 * 2.2, 1.4);
    const n = this._noise(this.pink, t, t + (ft1 - ft0) + 0.3, 1, i * 0.37);
    const nb = this._filter('bandpass', 1300 + 140 * i, 0.8);
    const g = this._gain(0);
    const pan = this._pan(0);
    o.connect(bp);
    bp.connect(g);
    n.connect(nb);
    const ng = this._gain(0.6);
    nb.connect(ng);
    ng.connect(g);
    g.connect(pan);
    pan.connect(this.fx);
    const send = this._gain(0.2);
    pan.connect(send);
    send.connect(this.revIn);
    g.gain.setValueAtTime(0, t);
    let lastR = -1;
    for (let ft = ft0; ft <= ft1 + 1e-6; ft += 0.5) {
      const at = t + (ft - ft0);
      const k = (ft - ft0) / Math.max(0.5, ft1 - ft0);
      const p = this._droneAt(i, ft);
      const vr = lastR < 0 ? 0 : (p.r - lastR) / 0.5; // receding > 0
      lastR = p.r;
      const dop = 343 / (343 + Math.max(-60, Math.min(60, vr)));
      const f = (f0 + (f1 - f0) * Math.min(1, k * 3)) * dop;
      o.frequency.linearRampToValueAtTime(f, at);
      bp.frequency.linearRampToValueAtTime(f * 2.2, at);
      g.gain.linearRampToValueAtTime(0.045 * p.g * Math.min(1, k * 4), at);
      if (pan.pan) pan.pan.linearRampToValueAtTime(p.pan, at);
    }
    g.gain.linearRampToValueAtTime(0, t + (ft1 - ft0) + 0.25);
  }

  _cue_stationHum(t) {
    // the LED strips' hum (100 Hz and its third, narrow and cold) and the deck's air handling; gone as the shaft takes over
    const end = t + 26;
    for (const [f, a] of [
      [100, 0.012],
      [300, 0.006],
    ]) {
      const o = this._osc('sine', f, t, end);
      const g = this._gain(0);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(a, t + 2);
      g.gain.setValueAtTime(a, t + 22);
      g.gain.linearRampToValueAtTime(0, end - 0.1);
      o.connect(g);
      this._out(g, this.fx, 0.05);
    }
    const n = this._noise(this.pink, t, end, 0.8, 0.2);
    const bp = this._filter('bandpass', 620, 0.6);
    const g = this._gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.03, t + 3);
    g.gain.setValueAtTime(0.03, t + 22);
    g.gain.linearRampToValueAtTime(0, end - 0.1);
    n.connect(bp);
    bp.connect(g);
    this._out(g, this.fx, 0.1);
  }

  _cue_droneSpin(t) {
    // four rotors spin up on their pads and stay with the drones until they are gone (the climb home), Doppler and pan from the film
    for (let i = 0; i < 4; i++) this._rotor(i, t + 0.2 * i, 3.0 + 0.2 * i, 63.5, 30, 148);
  }

  _cue_droneFly(t) {
    // the lift-off: a gust off each pad, staggered
    for (let i = 0; i < 4; i++) {
      const p = this._droneAt(i, 8.75 + 0.25 * i);
      this._burst(this.brown, t + 0.15 + 0.25 * i, 0.9, 'lowpass', 420, 0.7, 0.12 * p.g, this.fx, 0.15, p.pan);
    }
  }

  _cue_measureIn(t) {
    const f = this._burst(this.pink, t - 0.3, 0.9, 'bandpass', 600, 1.2, 0.035, this.fx, 0.1, 0.3);
    f.frequency.setValueAtTime(600, t - 0.3);
    f.frequency.exponentialRampToValueAtTime(1500, t + 0.5);
  }

  _cue_clamp(t) {
    // a latch: the solenoid's click, metal on composite, a short servo whir
    this._burst(this.white, t, 0.012, 'bandpass', 4200, 3, 0.09, this.fx, 0.15, 0.1);
    this._thump(t + 0.02, 420, 180, 0.07, 0.12, this.fx, 0.2, 0.1);
    const o = this._osc('square', 310, t + 0.06, t + 0.32);
    o.frequency.linearRampToValueAtTime(520, t + 0.3);
    const bp = this._filter('bandpass', 1400, 4);
    const g = this._gain(0);
    this._ad(g.gain, t + 0.06, 0.012, 0.03, 0.1);
    o.connect(bp);
    bp.connect(g);
    this._out(g, this.fx, 0.1, 0.1);
  }

  _cue_scan(t) {
    // the measure: a clean sweep up and down, a fixed data chirp under it
    const o = this._osc('sine', 1200, t, t + 2.3);
    o.frequency.linearRampToValueAtTime(2400, t + 1.1);
    o.frequency.linearRampToValueAtTime(1300, t + 2.2);
    const g = this._gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.012, t + 0.2);
    g.gain.setValueAtTime(0.012, t + 2.0);
    g.gain.linearRampToValueAtTime(0, t + 2.25);
    o.connect(g);
    this._out(g, this.fx, 0.1);
    for (let k = 0; k < 14; k++) this._burst(this.white, t + 0.1 + k * 0.15, 0.01, 'bandpass', 3000 + 400 * (k % 3), 6, 0.02, this.fx, 0.05);
  }

  _cue_hallIn(t) {
    // the console: two soft chirps; the room's air
    for (const [dt, f] of [
      [0.1, 1760],
      [0.28, 2349.3],
    ]) {
      const o = this._osc('sine', f, t + dt, t + dt + 0.2);
      const g = this._gain(0);
      this._ad(g.gain, t + dt, 0.01, 0.005, 0.05);
      o.connect(g);
      this._out(g, this.fx, 0.05, 0.25);
    }
  }

  _cue_lift(t) {
    // the drones take the weight: the cradle's servo, the line's brake letting go
    const o = this._osc('sawtooth', 90, t, t + 2.6);
    o.frequency.linearRampToValueAtTime(140, t + 2.4);
    const lp = this._filter('lowpass', 700, 2);
    const g = this._gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.02, t + 0.4);
    g.gain.linearRampToValueAtTime(0, t + 2.5);
    o.connect(lp);
    lp.connect(g);
    this._out(g, this.fx, 0.15);
    this._burst(this.white, t + 0.2, 0.25, 'bandpass', 2200, 2, 0.04, this.fx, 0.2);
  }

  _cue_iris(t) {
    // eight leaf motors (fixed clicks), the leaves sliding, the shaft's air meeting the station's
    for (let k = 0; k < 8; k++) this._burst(this.white, t + k * 0.09, 0.015, 'bandpass', 2600 + 90 * k, 4, 0.05, this.fx, 0.2, ((k % 4) - 1.5) * 0.3);
    const n = this._noise(this.pink, t + 0.3, t + 4.2, 0.6, 0.4);
    const bp = this._filter('bandpass', 380, 1.1);
    const g = this._gain(0);
    g.gain.setValueAtTime(0, t + 0.3);
    g.gain.linearRampToValueAtTime(0.05, t + 2.2);
    g.gain.linearRampToValueAtTime(0, t + 4.1);
    n.connect(bp);
    bp.connect(g);
    this._out(g, this.fx, 0.3);
    this._thump(t + 3.9, 48, 30, 0.6, 0.25, this.fx, 0.4);
  }

  _cue_irisIn(t) {
    // the draft up out of the shaft
    const n = this._noise(this.brown, t, t + 3, 0.7, 0.8);
    const lp = this._filter('lowpass', 300, 0.7);
    const g = this._gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.08, t + 1.6);
    g.gain.linearRampToValueAtTime(0, t + 2.9);
    n.connect(lp);
    lp.connect(g);
    this._out(g, this.fx, 0.3);
  }

  _cue_beamsOn(t) {
    for (let i = 0; i < 4; i++) this._burst(this.white, t + 0.15 * i, 0.01, 'bandpass', 3400, 5, 0.06, this.fx, 0.15, this._droneAt(i, 23 + 0.15 * i).pan);
  }

  _cue_descend(t) {
    // the descent: the shaft's air rising past the cradle, the drone's bed opening a fifth, the line paying out (a ratchet tick)
    const n = this._noise(this.brown, t, t + 26.6, 0.9, 1.1);
    const bp = this._filter('bandpass', 240, 0.8);
    const g = this._gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.09, t + 3);
    g.gain.setValueAtTime(0.09, t + 25.2);
    g.gain.linearRampToValueAtTime(0, t + 26.5);
    n.connect(bp);
    bp.connect(g);
    this._out(g, this.fx, 0.3);
    for (const [dt, lvl] of TABLE.ratchet) this._burst(this.white, t + dt, 0.012, 'bandpass', 3600, 3, 0.035 * lvl, this.fx, 0.25, -0.1);
    const d = this._drone;
    if (d) {
      d.fifth.gain.setTargetAtTime(0.5, t, 2.5);
      d.lp.frequency.setTargetAtTime(380, t, 3);
      d.g.gain.setTargetAtTime(0.14, t, 2);
    }
  }

  _cue_approach(t) {
    // near stone again: the rotors' wash thrown back off the walls (a comb of two short delays)
    const n = this._noise(this.pink, t, t + 9, 1, 1.4);
    const bp = this._filter('bandpass', 900, 0.9);
    const g = this._gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.04, t + 6);
    g.gain.linearRampToValueAtTime(0, t + 9);
    n.connect(bp);
    bp.connect(g);
    for (const dl of [0.007, 0.013]) {
      if (typeof this.ctx.createDelay !== 'function') break;
      const de = this.ctx.createDelay(0.05);
      de.delayTime.value = dl;
      bp.connect(de);
      de.connect(g);
    }
    this._out(g, this.fx, 0.35);
    const d = this._drone;
    if (d) d.g.gain.setTargetAtTime(0.11, t, 1.2);
  }

  _cue_land(t) {
    // the plate on the stone: a heavy thump, the cage ringing, grit off the ledge
    this._thump(t, 72, 36, 0.4, 0.4, this.fx, 0.35);
    for (const [f, a, dd] of [
      [520, 0.06, 0.4],
      [1130, 0.04, 0.25],
      [1980, 0.025, 0.15],
      [3110, 0.015, 0.09],
    ]) {
      const o = this._osc('sine', f, t, t + 1.6);
      const g = this._gain(0);
      this._ad(g.gain, t, a, 0.002, dd);
      o.connect(g);
      this._out(g, this.fx, 0.45);
    }
    for (const [dt, lvl, f] of TABLE.dust) this._burst(this.white, t + 0.15 + dt, 0.018, 'bandpass', f, 2.5, 0.02 * lvl, this.fx, 0.25, -0.2);
  }

  _cue_releaseIn(t) {
    // the shaft's long reverb opens over the landed cradle: a low swell
    const o = this._osc('sine', 41, t, t + 1.8);
    const g = this._gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.06, t + 0.8);
    g.gain.linearRampToValueAtTime(0, t + 1.7);
    o.connect(g);
    this._out(g, this.music, 0.3);
  }

  _cue_release(t) {
    // a clamp lets go (the latch in reverse) and the rotor surges
    this._burst(this.white, t, 0.01, 'bandpass', 3800, 3, 0.08, this.fx, 0.2, -0.1);
    this._thump(t + 0.015, 300, 140, 0.06, 0.1, this.fx, 0.25, -0.1);
    this._burst(this.brown, t + 0.05, 0.5, 'lowpass', 500, 0.8, 0.07, this.fx, 0.3);
  }

  _cue_droneAway(t) {
    // the climb home: the chimney's reverb takes the whine (the rotors' own Doppler is in their automation)
    const g = this._gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.25, t + 3);
    g.gain.linearRampToValueAtTime(0, t + 10);
    const n = this._noise(this.pink, t, t + 10.2, 1, 0.9);
    const bp = this._filter('bandpass', 700, 1.5);
    bp.frequency.setValueAtTime(900, t);
    bp.frequency.exponentialRampToValueAtTime(260, t + 9);
    const ng = this._gain(0.12);
    n.connect(bp);
    bp.connect(ng);
    ng.connect(g);
    this._out(g, this.fx, 0.9);
  }

  _cue_lightDie(t) {
    // a failing LED driver: a buzz that stutters three times (fixed) and stops
    const k = this._dies = (this._dies || 0) + 1;
    const p = this._droneAt(Math.min(3, k - 1), LIGHTS_DIE[Math.min(3, k - 1)]);
    for (const [dt, dur] of [
      [-0.3, 0.08],
      [-0.12, 0.06],
      [0.05, 0.12],
    ]) {
      const o = this._osc('square', 120, t + dt, t + dt + dur + 0.02);
      const bp = this._filter('bandpass', 2400, 3);
      const g = this._gain(0);
      g.gain.setValueAtTime(0, t + dt);
      g.gain.linearRampToValueAtTime(0.02 * (0.4 + p.g), t + dt + 0.005);
      g.gain.setValueAtTime(0.02 * (0.4 + p.g), t + dt + dur);
      g.gain.linearRampToValueAtTime(0, t + dt + dur + 0.01);
      o.connect(bp);
      bp.connect(g);
      this._out(g, this.fx, 0.6, p.pan);
    }
  }

  _cue_doorIn(t) {
    // the Threshold lamp's hiss and a stone tick
    this._burst(this.white, t + 0.1, 0.02, 'bandpass', 1800, 3, 0.03, this.fx, 0.4, -0.2);
    const n = this._noise(this.white, t, t + 2.2, 1, 1.7);
    const bp = this._filter('bandpass', 4200, 1.2);
    const g = this._gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.006, t + 0.8);
    g.gain.linearRampToValueAtTime(0, t + 2.1);
    n.connect(bp);
    bp.connect(g);
    this._out(g, this.fx, 0.1, -0.3);
  }

  _cue_creak(t) {
    // the lantern swinging on its hook after the stop: two creaks, a pendulum apart
    for (const [dt, a] of [
      [0, 1],
      [2.4, 0.6],
    ]) {
      const o = this._osc('sawtooth', 300, t + dt, t + dt + 0.5);
      o.frequency.linearRampToValueAtTime(345, t + dt + 0.35);
      const bp = this._filter('bandpass', 320, 14);
      const g = this._gain(0);
      this._ad(g.gain, t + dt, 0.02 * a, 0.08, 0.12);
      o.connect(bp);
      bp.connect(g);
      this._out(g, this.fx, 0.25);
    }
  }

  _cue_musicOut(t) {
    const d = this._drone;
    if (d) {
      d.g.gain.setTargetAtTime(0.028, t, 0.25);
      d.lp.frequency.setTargetAtTime(150, t, 0.4);
      d.fifth.gain.setTargetAtTime(0, t, 0.4);
    }
    if (this._wind) this._wind.gain.setTargetAtTime(0.035, t, 0.6);
  }

  _cue_knock(t) {
    // a knock inside the wall: a big stone thud, the room answering (from behind, left)
    this._thump(t, 105, 52, 0.2, 0.42, this.fx, 0.75, -0.55);
    this._burst(this.brown, t, 0.14, 'lowpass', 520, 0.9, 0.5, this.fx, 0.7, -0.55);
    this._burst(this.white, t, 0.02, 'bandpass', 1400, 1.5, 0.05, this.fx, 0.5, -0.55);
  }

  _cue_lean(t) {
    const f = this._burst(this.pink, t, 0.9, 'bandpass', 1600, 1.4, 0.03, this.fx, 0.1, 0.2);
    f.frequency.setValueAtTime(1600, t);
    f.frequency.exponentialRampToValueAtTime(600, t + 0.8);
  }

  _cue_heartbeat(t) {
    // from the knock to the snuff: slow, then quicker as it rises
    let at = t;
    let gap = 1.42;
    while (at < t + 13) {
      this._heartbeat(at, 0.16, this.fx);
      at += gap;
      gap = Math.max(0.68, gap * 0.955);
    }
  }

  _cue_grind(t) {
    // the plates grinding far below: a low moving band and stone grains (the fixed table)
    const n = this._noise(this.brown, t, t + 8.3, 0.7, 0.5);
    const bp = this._filter('bandpass', 130, 2.2);
    bp.frequency.setValueAtTime(110, t);
    bp.frequency.linearRampToValueAtTime(190, t + 7.6);
    const g = this._gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.16, t + 3);
    g.gain.linearRampToValueAtTime(0.26, t + 7.4);
    g.gain.linearRampToValueAtTime(0, t + 8.1);
    n.connect(bp);
    bp.connect(g);
    this._out(g, this.fx, 0.5, 0.35);
    for (const [dt, lvl, f] of TABLE.grind) this._burst(this.brown, t + dt, 0.06, 'bandpass', f * 3, 3, 0.08 * lvl * (0.4 + dt / 8), this.fx, 0.4, 0.35);
  }

  _cue_eyes(t) {
    for (const [f, a] of [
      [41.2, 0.18],
      [61.7, 0.1],
    ]) {
      const o = this._osc('sine', f, t, t + 5.6);
      const g = this._gain(0);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(a, t + 2.2);
      g.gain.setValueAtTime(a, t + 5.0);
      g.gain.linearRampToValueAtTime(0, t + 5.5);
      o.connect(g);
      this._out(g, this.music, 0.2, 0.3);
    }
    this._burst(this.white, t + 0.05, 0.03, 'bandpass', 2100, 4, 0.06, this.fx, 0.6, 0.35); // a wet click
  }

  _cue_breath(t) {
    // too big a breath: in, then out, low and wet
    for (const [dt, dur, a, f] of [
      [0, 1.6, 0.14, 380],
      [1.75, 2.0, 0.11, 300],
    ]) {
      const n = this._noise(this.brown, t + dt, t + dt + dur + 0.1, 1.4, dt);
      const bp = this._filter('bandpass', f, 1.3);
      const g = this._gain(0);
      g.gain.setValueAtTime(0, t + dt);
      g.gain.linearRampToValueAtTime(a, t + dt + dur * 0.55);
      g.gain.linearRampToValueAtTime(0, t + dt + dur);
      n.connect(bp);
      bp.connect(g);
      this._out(g, this.fx, 0.5, 0.35);
    }
  }

  _cue_riser(t) {
    const o = this._osc('sine', 30, t, t + 2.8);
    o.frequency.exponentialRampToValueAtTime(58, t + 2.3);
    const g = this._gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.22, t + 2.3);
    o.connect(g);
    this._out(g, this.music, 0.1);
    const n = this._noise(this.white, t, t + 2.4, 1, 0.2);
    const hp = this._filter('highpass', 200, 0.7);
    hp.frequency.exponentialRampToValueAtTime(3200, t + 2.3);
    const ng = this._gain(0);
    ng.gain.setValueAtTime(0, t);
    ng.gain.linearRampToValueAtTime(0.05, t + 2.3);
    n.connect(hp);
    hp.connect(ng);
    this._out(ng, this.fx, 0.2);
  }

  _cue_tear(t) {
    // the record torn off: static over the line, the line stops
    this._burst(this.white, t, 0.4, 'highpass', 1800, 0.7, 0.32, this.music, 0.05);
    for (let k = 0; k < 7; k++) this._burst(this.white, t + 0.03 + k * 0.047, 0.012, 'bandpass', 900 + 450 * k, 2, 0.18, this.music, 0);
    if (this._voSrc) {
      try {
        this._voSrc.g.gain.setValueAtTime(this._voSrc.g.gain.value, t + 0.04);
        this._voSrc.g.gain.linearRampToValueAtTime(0, t + 0.07);
      } catch {
        /* ended */
      }
    }
  }

  _cue_lunge(t) {
    // it comes up out of the well: a roar through a sweeping filter, driven hard
    const ws = this.ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      const x = (i / 1023) * 2 - 1;
      curve[i] = Math.tanh(x * 3.2);
    }
    ws.curve = curve;
    const lp = this._filter('lowpass', 300, 2);
    lp.frequency.setValueAtTime(300, t);
    lp.frequency.exponentialRampToValueAtTime(1900, t + 0.22);
    lp.frequency.exponentialRampToValueAtTime(500, t + 0.5);
    const g = this._gain(0);
    this._ad(g.gain, t, 0.3, 0.04, 0.18);
    for (const [f, a] of [
      [68, 0.5],
      [103, 0.35],
      [151, 0.2],
    ]) {
      const o = this._osc('sawtooth', f, t, t + 0.7);
      o.frequency.exponentialRampToValueAtTime(f * 0.7, t + 0.5);
      const og = this._gain(a);
      o.connect(og);
      og.connect(ws);
    }
    const n = this._noise(this.brown, t, t + 0.7, 2, 0.1);
    const ng = this._gain(0.8);
    n.connect(ng);
    ng.connect(ws);
    ws.connect(lp);
    lp.connect(g);
    this._out(g, this.fx, 0.5, 0.3);
  }

  _cue_snuff(t) {
    // the flame goes out (a soft pff), and then nothing: every sound of the film is cut
    this._burst(this.pink, t, 0.07, 'bandpass', 3800, 1.5, 0.05, this.fx, 0);
    const cut = t + 0.08;
    for (const bus of [this.music, this.fx, this.vo]) {
      bus.gain.setValueAtTime(1, cut - 0.02);
      bus.gain.linearRampToValueAtTime(0, cut);
    }
    for (const e of this._live) {
      try {
        if (e.end > cut) e.src.stop(cut + 0.01);
      } catch {
        /* already stopped */
      }
    }
    this._drone = null;
    this._wind = null;
  }

  _cue_preHit(t) {
    for (const bus of [this.music, this.fx, this.vo]) bus.gain.setValueAtTime(1, t - 0.05);
    const hit = t + 0.75;
    // a reversed swell into the hit, cut dead on it
    const n = this._noise(this.white, t, hit, 1, 0.6);
    const lp = this._filter('lowpass', 180, 0.9);
    lp.frequency.setValueAtTime(180, t);
    lp.frequency.exponentialRampToValueAtTime(5200, hit);
    const g = this._gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.2, hit - 0.01);
    g.gain.linearRampToValueAtTime(0, hit);
    n.connect(lp);
    lp.connect(g);
    this._out(g, this.music, 0);
    // a bell played backwards: partials that grow and stop at the hit
    for (const [m, a] of [
      [1, 0.05],
      [2.76, 0.035],
      [5.4, 0.02],
    ]) {
      const o = this._osc('sine', 146.83 * m, t, hit);
      const og = this._gain(0);
      og.gain.setValueAtTime(0.0001, t);
      og.gain.exponentialRampToValueAtTime(a, hit - 0.01);
      og.gain.linearRampToValueAtTime(0, hit);
      o.connect(og);
      this._out(og, this.music, 0);
    }
  }

  _cue_titleHit(t) {
    // THE LANTERN: one hit. A match struck, a sub that falls, a boom, a struck bell with a long tail, the root held under the title.
    this._burst(this.white, t, 0.05, 'bandpass', 3200, 1.2, 0.35, this.music, 0.1);
    this._burst(this.white, t + 0.02, 0.18, 'highpass', 5000, 0.7, 0.06, this.music, 0.2);
    const sub = this._osc('sine', 62, t, t + 5);
    sub.frequency.exponentialRampToValueAtTime(26, t + 2.6);
    const sg = this._gain(0);
    this._ad(sg.gain, t, 0.7, 0.005, 1.4);
    sub.connect(sg);
    this._out(sg, this.music, 0.1);
    this._burst(this.brown, t, 1.6, 'lowpass', 170, 0.8, 0.6, this.music, 0.45, 0, 0.8);
    const parts = [
      [1, 0.17, 2.6],
      [2.76, 0.11, 1.5],
      [5.4, 0.07, 0.9],
      [8.93, 0.045, 0.55],
      [13.34, 0.025, 0.35],
    ];
    for (const [m, a, d] of parts) {
      for (const det of [-0.0012, 0.0012]) {
        const o = this._osc('sine', 146.83 * m * (1 + det), t, t + 9);
        const g = this._gain(0);
        this._ad(g.gain, t, a * 0.6, 0.003, d);
        o.connect(g);
        this._out(g, this.music, 0.55, det * 250);
      }
    }
    // the root, held under the title
    for (const [f, a] of [
      [D2, 0.09],
      [D2 * 2, 0.045],
      [D2 * 3, 0.018],
    ]) {
      const o = this._osc('sine', f, t + 0.2, t + 9);
      const g = this._gain(0);
      g.gain.setValueAtTime(0, t + 0.2);
      g.gain.linearRampToValueAtTime(a, t + 1.6);
      g.gain.setValueAtTime(a, t + 6.4);
      g.gain.linearRampToValueAtTime(0, t + 8.6);
      o.connect(g);
      this._out(g, this.music, 0.3);
    }
  }

  _cue_titleOut(t) {
    // the title embers out: a few soft pops
    for (let k = 0; k < 6; k++) this._burst(this.white, t + 0.2 + k * 0.31 + 0.07 * Math.sin(k * 2.1), 0.01, 'highpass', 3000 + 400 * k, 0.8, 0.03 * (1 - k / 7), this.fx, 0.2, 0.2 * Math.sin(k));
  }

  _cue_lampFlare(t) {
    // the Threshold lamp flares (ahead, left): a gas whoomp
    const f = this._burst(this.brown, t, 0.6, 'lowpass', 220, 0.9, 0.3, this.fx, 0.35, -0.7, 1.6);
    f.frequency.setValueAtTime(220, t);
    f.frequency.exponentialRampToValueAtTime(1300, t + 0.35);
    this._thump(t, 82, 50, 0.25, 0.12, this.fx, 0.3, -0.7);
  }

  _cue_breathIn(t) {
    this._breath(t, 1.05, 0.09, this.fx, 1350, 0);
  }

  _cue_lanternCatch(t) {
    // your lantern catches (left hand): a small ignite, a soft whoomp, the flame's breath again
    this._burst(this.white, t, 0.14, 'bandpass', 2600, 1.4, 0.12, this.fx, 0.08, -0.35);
    this._burst(this.brown, t + 0.04, 0.38, 'lowpass', 420, 0.8, 0.22, this.fx, 0.12, -0.35, 1.5);
    const n = this._noise(this.pink, t + 0.1, t + 6, 1, 1.7);
    const bp = this._filter('bandpass', 950, 0.7);
    const g = this._gain(0);
    g.gain.setValueAtTime(0, t + 0.1);
    g.gain.linearRampToValueAtTime(0.012, t + 1);
    g.gain.linearRampToValueAtTime(0, t + 5.8);
    n.connect(bp);
    bp.connect(g);
    this._out(g, this.fx, 0.03, -0.35);
  }

  _cue_cloth(t) {
    // the head comes up: cloth, the gauntlet's leather
    for (const [dt, a] of [
      [0, 1],
      [0.21, 0.7],
      [0.47, 0.5],
    ]) this._burst(this.pink, t + dt, 0.2, 'bandpass', 1900, 0.6, 0.06 * a, this.fx, 0.03, -0.1);
    const o = this._osc('sawtooth', 180, t + 0.3, t + 0.65);
    o.frequency.linearRampToValueAtTime(150, t + 0.6);
    const bp = this._filter('bandpass', 900, 7);
    const g = this._gain(0);
    this._ad(g.gain, t + 0.3, 0.02, 0.05, 0.08);
    o.connect(bp);
    bp.connect(g);
    this._out(g, this.fx, 0.02, -0.3);
  }

  _cue_heart2(t) {
    this._heartbeat(t, 0.12, this.fx);
    this._heartbeat(t + 0.95, 0.1, this.fx);
  }

  _cue_skipLand(t) {
    this._cue_breathIn(t);
    this._cue_lanternCatch(t + 0.35);
  }

  // ---- the narration ---------------------------------------------------------------------------------------------------------
  /** Fetch + decode every narration clip under `base` (a URL ending in '/'). Resolves when all are tried. */
  loadVoice(base, fetchFn) {
    const f = fetchFn || (typeof fetch === 'function' ? fetch : null);
    if (!f || this._loading) return this._loading || Promise.resolve();
    this._loading = Promise.all(
      VO.map((l) =>
        f(base + l.id + '.ogg')
          .then((r) => (r.ok ? r.arrayBuffer() : null))
          .then((ab) => (ab ? this.ctx.decodeAudioData(ab) : null))
          .then((buf) => {
            if (buf) this.voBufs[l.id] = buf;
          })
          .catch(() => {}),
      ),
    );
    return this._loading;
  }

  /** Play narration clip `id` at `t` (dry and close, a little of the chimney under it). False when it is not decoded yet. */
  voice(id, t) {
    const buf = this.voBufs[id];
    if (!buf || this._dead) return false;
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    const radio = VO_FX[id] === 'radio';
    const hp = this._filter('highpass', radio ? 280 : 90, 0.7);
    const g = this._gain(radio ? 1.15 : 1.0);
    s.connect(hp);
    if (radio) {
      const lp = this._filter('lowpass', 3400, 0.9);
      const pk = this._filter('peaking', 1700, 1.2);
      if (pk.gain) pk.gain.value = 4;
      hp.connect(pk);
      pk.connect(lp);
      lp.connect(g);
    } else hp.connect(g);
    g.connect(this.vo);
    const send = this._gain(0.07);
    g.connect(send);
    send.connect(this.revIn);
    s.start(t);
    this._track(s, t + buf.duration);
    this._voSrc = { s, g };
    return true;
  }

  /** Fade everything out over `fade` s and stop it (the film ended or was skipped). */
  stop(fade) {
    if (this._dead) return;
    this._dead = true;
    const now = this.ctx.currentTime;
    const f = Math.max(0.02, fade || 0.3);
    for (const bus of [this.music, this.fx, this.vo]) {
      bus.gain.cancelScheduledValues(now);
      bus.gain.setValueAtTime(bus.gain.value, now);
      bus.gain.linearRampToValueAtTime(0, now + f);
    }
    for (const e of this._live) {
      try {
        e.src.stop(now + f + 0.05);
      } catch {
        /* already stopped */
      }
    }
    this._live.length = 0;
  }

  /** The whole film at once (an OfflineAudioContext: the trailer): every cue and line at its own time, from film time `from`. */
  scheduleAll(from, to) {
    const a = from || 0;
    const b = to == null ? Infinity : to;
    for (const [t, name] of CUES) if (t >= a && t <= b) this.cue(name, t - a);
    for (const l of VO) if (l.at >= a && l.at <= b) this.voice(l.id, l.at - a);
  }
}

/** The bus events the game emits, and the AudioManager3D methods that answer them (mixed in by audio3d.js). */
export const OPENING_EVENTS = Object.freeze({
  'opening:begin': '_onOpeningBegin',
  'opening:cue': '_onOpeningCue',
  'opening:vo': '_onOpeningVo',
  'opening:skip': '_onOpeningSkip',
  'opening:end': '_onOpeningEnd',
});

const VO_BASE = (() => {
  try {
    return new URL('../../assets/audio/opening/', import.meta.url).href;
  } catch {
    return 'assets/audio/opening/';
  }
})();

export const OPENING_SFX = {
  _openingScore(fresh) {
    if (!this._live || !this._live()) return null;
    if (fresh || !this._opening || this._opening.ctx !== this.ctx || this._opening._dead) {
      this._opening = new OpeningScore(this.ctx, { score: this.busStinger, sfx: this.busPlayer, voice: this.busStinger });
    }
    return this._opening;
  },
  _onOpeningBegin() {
    const o = this._openingScore(true);
    if (o) o.loadVoice(VO_BASE);
  },
  _onOpeningCue(p) {
    const o = this._openingScore(false);
    if (o && p && p.name) o.cue(String(p.name), this.ctx.currentTime + 0.02);
  },
  _onOpeningVo(p) {
    const o = this._openingScore(false);
    if (o && p && p.id) o.voice(String(p.id), this.ctx.currentTime + 0.02);
  },
  _onOpeningSkip() {
    // the film fades to black: so does its sound (the landing's breath and catch start a fresh score)
    if (this._opening) this._opening.stop(0.3);
  },
  _onOpeningEnd(p) {
    const o = this._opening;
    if (o) o.stop(p && p.skipped ? 0.3 : 1.8);
    this._opening = null;
  },
};
