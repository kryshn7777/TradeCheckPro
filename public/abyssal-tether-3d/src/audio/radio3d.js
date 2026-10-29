/* ABYSSAL TETHER 3D — radio3d.js (EXPEDITION: the radio voices; docs/abyssal-tether-3d/plans/COMMS.md)
 * PLACEHOLDER VOICE-OVER. There are no recordings in this game: every transmission of sim/comms3d.js is "spoken" by a
 * synthesised voice-substitute (pitched, formant-filtered syllable babble, one per speaker) timed to its subtitle, so the
 * radio has a voice, a rhythm and a speaker you can tell apart until the real VO session replaces it (RELEASE / COMMS.md).
 *
 *   Odessa  warm, unhurried, a falling line (triangle, ~196 Hz)      Tick    quick, bouncy (sawtooth, ~138 Hz)
 *   Maren   dry, measured (triangle, ~176 Hz, narrower formants)      Vesper  the suit, not the radio: flat square-wave syllables,
 *                                                                              a two-tone chime instead of a squelch, no static
 *   the open channel (the S4 echo): your breathing, played back late.
 *
 * The radio chain (FUTURE_STORY_PLAN §2.2): band-passed 350-3200 Hz, light saturation, a squelch click on and off, a static
 * bed whose level follows the signal (louder as the uplink fails), the line's glitch events (static bursts, dropouts: the
 * voice gaps), a 30 % bias to the left ear (the earpiece). The hot mic is off-mic (muffled, no squelch); the voice that is not
 * quite the speaker comes without the radio filter (warm, close, wrong). While a line is on air the music ducks ~6 dB and the
 * ambience ~3 dB; the creature is never ducked (the radio ducks under the cave, never the reverse).
 * Settings › Sound › Radio voices OFF: silent (the subtitles still show every line). Settings › Access › Signal glitches OFF:
 * the static is lowered and the bursts are soft.
 *
 * AudioManager3D owns one Radio (not one of its _mods): build() with the graph, speak(tx) on 'comms:line', end(tx) on
 * 'comms:end', control(dtc, now, game) on the control tick. Per-line nodes are released after the line; nothing per frame.
 */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** Per-speaker voice: base pitch (Hz), syllables / s, wave, phrase glide, pitch jitter, formant scale, level. */
export const VOICES = Object.freeze({
  ODESSA: Object.freeze({ f0: 196, rate: 4.2, wave: 'triangle', glide: -0.12, jitter: 0.07, formant: 1.1, level: 0.95, q: 6 }),
  TICK: Object.freeze({ f0: 138, rate: 5.3, wave: 'sawtooth', glide: 0.04, jitter: 0.17, formant: 1.0, level: 0.72, q: 5 }),
  MAREN: Object.freeze({ f0: 176, rate: 4.0, wave: 'triangle', glide: -0.05, jitter: 0.05, formant: 1.16, level: 0.9, q: 8 }),
  VESPER: Object.freeze({ f0: 116, rate: 4.6, wave: 'square', glide: 0, jitter: 0, formant: 0.92, level: 0.32, q: 11 }),
  UPLINK: Object.freeze({ f0: 0, rate: 0, wave: 'none', glide: 0, jitter: 0, formant: 1, level: 0.8, q: 1 }),
});
// vowel formants [F1, F2] (Hz): a e i o u and a neutral schwa
const VOWEL = [
  [730, 1090],
  [530, 1840],
  [300, 2250],
  [570, 840],
  [330, 900],
  [500, 1500],
];

function hash(n) {
  let x = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}
function vowelOf(ch) {
  switch (ch) {
    case 'a':
      return 0;
    case 'e':
      return 1;
    case 'i':
    case 'y':
      return 2;
    case 'o':
      return 3;
    case 'u':
      return 4;
    default:
      return 5;
  }
}

/**
 * The syllable plan of one line (pure; allocation per line only): [{ t, dur, f0, f1, f2, amp }] in seconds from the start of the
 * speech, scaled to end at `speak` (the subtitle's timing, sim/comms3d.js speakTime). Word gaps, longer pauses at , . ? ! and
 * a rise on a question; the speaker's pitch, rate and phrase glide; deterministic from the text and `seed`.
 */
export function babblePlan(text, speaker, speak, seed) {
  const V = VOICES[speaker] || VOICES.TICK;
  const out = [];
  if (!V.rate) return out;
  const s = String(text).toLowerCase();
  let t = 0;
  let k = 0;
  let inVowel = false;
  let wordSyl = 0;
  const step = 1 / V.rate;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const letter = ch >= 'a' && ch <= 'z';
    const digit = ch >= '0' && ch <= '9';
    const vowel = letter && 'aeiouy'.indexOf(ch) >= 0;
    if ((vowel && !inVowel) || (digit && (i === 0 || !(s[i - 1] >= '0' && s[i - 1] <= '9')))) {
      const h = hash((seed | 0) + k * 7919 + i);
      const dur = step * (V.jitter ? 0.82 + 0.36 * h : 1) * 0.86;
      const vi = digit ? 5 : vowelOf(ch);
      out.push({ t, dur, f0: V.f0 * (1 + V.jitter * (2 * h - 1)), f1: VOWEL[vi][0] * V.formant, f2: VOWEL[vi][1] * V.formant, amp: 0.75 + 0.25 * hash(k + 31) });
      t += step * (V.jitter ? 0.85 + 0.3 * h : 1);
      k++;
      wordSyl++;
    }
    inVowel = vowel;
    if (ch === ' ') {
      if (wordSyl === 0 && out.length) t += step * 0.3;
      wordSyl = 0;
      t += step * 0.18;
    } else if (ch === ',' || ch === ';' || ch === ':' || ch === '—') t += 0.16;
    else if (ch === '.' || ch === '!') t += 0.24;
    else if (ch === '?') {
      // a question rises on its last two syllables
      for (let j = Math.max(0, out.length - 2); j < out.length; j++) out[j].f0 *= 1.12 + 0.08 * (j - out.length + 2);
      t += 0.24;
    }
  }
  if (!out.length) return out;
  // the phrase glide (Odessa's falling line, Tick's lift) and the fit to the subtitle's speech time
  const n = out.length;
  for (let j = 0; j < n; j++) out[j].f0 *= 1 + V.glide * (j / Math.max(1, n - 1) - 0.3);
  const total = out[n - 1].t + out[n - 1].dur;
  const k2 = clamp((speak > 0 ? speak : total) / Math.max(0.1, total), 0.6, 1.6);
  for (let j = 0; j < n; j++) {
    out[j].t *= k2;
    out[j].dur *= k2;
  }
  return out;
}

const SQUELCH = 0.09; // s of squelch before the voice
const STATIC_IDLE = 0;

export class Radio {
  /** @param {object} mgr AudioManager3D (ctx, master, spaceIn, _white, _pink, _filter, _gainNode, _loop, _knob, _gate, settings) */
  constructor(mgr) {
    this.m = mgr;
    this.broken = false;
    this.cur = null; // { tx, nodes, sources, t0, end }
    this.lines = 0; // lines spoken (tests)
    this.duck = 0; // 0..1 smoothed "a line is on air"
    this._staticT = 0;
  }

  build() {
    const m = this.m;
    const ctx = m.ctx;
    // the output: its own bus straight to the master (the muffle closes on death; the radio is cut then anyway)
    this.bus = m._gainNode(1);
    this.bus.connect(m.master);
    this.kBus = m._knob(this.bus.gain, 1, 0.002);
    // the radio chain: band-pass, a little presence, light saturation, the earpiece bias
    this.inp = m._gainNode(1);
    const hp = m._filter('highpass', 350, 0.7);
    const lp = m._filter('lowpass', 3200, 0.9);
    const pk = m._filter('peaking', 1800, 1.1);
    pk.gain.value = 4;
    const sh = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * 1.8) / Math.tanh(1.8);
    }
    sh.curve = curve;
    sh.oversample = 'none';
    this.pan = m._makePanner(-0.3);
    this.inp.connect(hp);
    hp.connect(lp);
    lp.connect(pk);
    pk.connect(sh);
    sh.connect(this.pan);
    this.pan.connect(this.bus);
    // the suit (Vesper) and the voice that is not quite the speaker: no radio filter
    this.dry = m._gainNode(1);
    const dlp = m._filter('lowpass', 5200, 0.6);
    this.dry.connect(dlp);
    dlp.connect(this.bus);
    this.drySend = m._gainNode(0.25);
    this.dry.connect(this.drySend);
    if (m.spaceIn) this.drySend.connect(m.spaceIn);
    // the static bed: band-passed white noise, gated off while silent
    const nz = m._loop(m._white, 1);
    const nbp = m._filter('bandpass', 2300, 0.55);
    this.staticG = m._gainNode(0);
    nz.connect(nbp);
    nbp.connect(this.staticG);
    this.staticG.connect(this.pan);
    this.kStatic = m._knob(this.staticG.gain, 0, 0.0004);
    this.gStatic = m._gate([nz, nbp]);
  }

  get enabled() {
    const s = this.m.settings;
    return !(s && s.radioVoices === false);
  }

  /** A transmission goes on air (sim/comms3d.js tx). */
  speak(tx) {
    const m = this.m;
    if (!tx || !this.enabled || !m._live || !m._live()) return;
    this._release(true);
    const ctx = m.ctx;
    const now = ctx.currentTime;
    const t0 = now + 0.02;
    const nodes = [];
    const sources = [];
    const local = tx.speaker === 'VESPER';
    const dryVoice = local || tx.kind === 'notquite';
    const off = tx.kind === 'offmic';
    const V = VOICES[tx.speaker] || VOICES.TICK;
    const out = ctx.createGain();
    out.gain.value = V.level * (off ? 0.42 : 1) * (tx.kind === 'notquite' ? 1.15 : 1);
    nodes.push(out);
    let tail = out;
    if (off) {
      const mlp = m._filter('lowpass', 1100, 0.5);
      nodes.push(mlp);
      out.connect(mlp);
      tail = mlp;
    }
    tail.connect(dryVoice ? this.dry : this.inp);
    const speakT = clamp(tx.speak || 1, 0.5, 6);
    const vStart = t0 + (local || off || tx.kind === 'notquite' ? 0.05 : SQUELCH);
    const end = vStart + speakT + 0.25;
    // squelch on / off (the radio), or the suit's two-tone chime (Vesper)
    if (local) {
      this._chime(t0, nodes, sources, out);
    } else if (!off && tx.kind !== 'notquite') {
      this._squelch(t0, nodes, sources);
      this._squelch(vStart + speakT + 0.06, nodes, sources);
    }
    if (tx.kind === 'echo') this._breaths(vStart, speakT, nodes, sources, out);
    else this._voice(tx, vStart, speakT, nodes, sources, out, tx.kind === 'notquite');
    // dropouts: the voice gaps (the static fills them)
    const g = tx.glitches || [];
    for (let i = 0; i < g.length; i++) {
      const e = g[i];
      if (e.kind !== 'dropout' || dryVoice) continue;
      const a = vStart + e.t;
      out.gain.setValueAtTime(out.gain.value, a);
      out.gain.linearRampToValueAtTime(0, a + 0.03);
      out.gain.setValueAtTime(0, a + e.dur);
      out.gain.linearRampToValueAtTime(V.level * (off ? 0.42 : 1), a + e.dur + 0.04);
    }
    for (let i = 0; i < sources.length; i++) sources[i].stop(end + 0.3);
    this.cur = { tx, nodes, sources, t0, vStart, end, dry: dryVoice };
    this.lines++;
  }

  /** The line left the air (it ended, or was cut by danger / a pause / a death). */
  end(tx) {
    const c = this.cur;
    if (!c || (tx && c.tx && tx.n !== c.tx.n)) return;
    if (tx && !tx.cut) return; // a natural end: the scheduled tail plays out and _release collects it
    const now = this.m.ctx.currentTime;
    for (let i = 0; i < c.nodes.length; i++) {
      const n = c.nodes[i];
      if (n.gain && i === 0) {
        try {
          n.gain.cancelScheduledValues(now);
          n.gain.setTargetAtTime(0, now, 0.015);
        } catch {
          /* ignore */
        }
      }
    }
    for (let i = 0; i < c.sources.length; i++) {
      try {
        c.sources[i].stop(now + 0.09);
      } catch {
        /* already stopping */
      }
    }
    c.end = Math.min(c.end, now + 0.1);
  }

  _voice(tx, vStart, speakT, nodes, sources, out, warm) {
    const m = this.m;
    const ctx = m.ctx;
    const V = VOICES[tx.speaker] || VOICES.TICK;
    const plan = babblePlan(tx.text, tx.speaker, speakT, tx.n);
    if (!plan.length) return;
    const osc = ctx.createOscillator();
    osc.type = V.wave;
    const pitch = warm ? 0.86 : 1;
    osc.frequency.value = plan[0].f0 * pitch;
    const f1 = m._filter('bandpass', plan[0].f1, V.q);
    const f2 = m._filter('bandpass', plan[0].f2, V.q + 2);
    const g2 = ctx.createGain();
    g2.gain.value = 0.55;
    const env = ctx.createGain();
    env.gain.value = 0;
    osc.connect(f1);
    osc.connect(f2);
    f1.connect(env);
    f2.connect(g2);
    g2.connect(env);
    env.connect(out);
    nodes.push(osc, f1, f2, g2, env);
    sources.push(osc);
    const P = env.gain;
    P.setValueAtTime(0, vStart);
    for (let i = 0; i < plan.length; i++) {
      const s = plan[i];
      const a = vStart + s.t;
      const fr = s.f0 * pitch;
      if (V.jitter) {
        osc.frequency.setTargetAtTime(fr, a, 0.018);
        f1.frequency.setTargetAtTime(s.f1, a, 0.02);
        f2.frequency.setTargetAtTime(s.f2, a, 0.02);
      } else {
        osc.frequency.setValueAtTime(fr, a);
        f1.frequency.setValueAtTime(s.f1, a);
        f2.frequency.setValueAtTime(s.f2, a);
      }
      P.setTargetAtTime(s.amp, a, 0.012);
      P.setTargetAtTime(0, a + s.dur * (V.jitter ? 0.7 : 0.62), V.jitter ? 0.03 : 0.012);
    }
    P.setTargetAtTime(0, vStart + speakT, 0.03);
    osc.start(vStart - 0.01);
  }

  /** The S4 echo: two of your breaths, a beat late, on the channel. */
  _breaths(vStart, speakT, nodes, sources, out) {
    const m = this.m;
    const ctx = m.ctx;
    const n = ctx.createBufferSource();
    n.buffer = m._pink;
    n.loop = true;
    const bp = m._filter('bandpass', 950, 0.8);
    const g = ctx.createGain();
    g.gain.value = 0;
    n.connect(bp);
    bp.connect(g);
    g.connect(out);
    nodes.push(n, bp, g);
    sources.push(n);
    const P = g.gain;
    const gap = Math.max(1.2, speakT / 2.2);
    for (let k = 0; k < 2; k++) {
      const a = vStart + 0.2 + k * gap;
      P.setValueAtTime(0, a);
      P.linearRampToValueAtTime(0.9, a + 0.55); // in
      P.linearRampToValueAtTime(0.15, a + 0.75);
      P.linearRampToValueAtTime(0.7, a + 0.95); // out
      P.linearRampToValueAtTime(0, a + 1.5);
      bp.frequency.setValueAtTime(1150, a);
      bp.frequency.linearRampToValueAtTime(800, a + 1.4);
    }
    n.start(vStart);
  }

  /** The squelch: a short burst of noise and a click. */
  _squelch(t, nodes, sources) {
    const m = this.m;
    const ctx = m.ctx;
    const n = ctx.createBufferSource();
    n.buffer = m._white;
    const bp = m._filter('bandpass', 3000, 0.9);
    const g = ctx.createGain();
    g.gain.value = 0;
    n.connect(bp);
    bp.connect(g);
    g.connect(this.inp);
    nodes.push(n, bp, g);
    sources.push(n);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.32, t + 0.004);
    g.gain.setTargetAtTime(0, t + 0.012, 0.018);
    n.start(t);
  }

  /** Vesper: a soft two-tone chime from the suit (no radio). */
  _chime(t, nodes, sources, out) {
    const ctx = this.m.ctx;
    for (let k = 0; k < 2; k++) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = k ? 1318.5 : 987.8;
      const g = ctx.createGain();
      g.gain.value = 0;
      o.connect(g);
      g.connect(out);
      nodes.push(o, g);
      sources.push(o);
      const a = t + k * 0.07;
      g.gain.setValueAtTime(0, a);
      g.gain.linearRampToValueAtTime(0.16, a + 0.008);
      g.gain.setTargetAtTime(0, a + 0.01, 0.05);
      o.start(a);
    }
  }

  _release(force) {
    const c = this.cur;
    if (!c) return;
    const now = this.m.ctx.currentTime;
    if (!force && now < c.end + 0.35) return;
    if (force && now < c.end) {
      for (let i = 0; i < c.sources.length; i++) {
        try {
          c.sources[i].stop(now + 0.03);
        } catch {
          /* already stopping */
        }
      }
    }
    for (let i = 0; i < c.nodes.length; i++) {
      try {
        c.nodes[i].disconnect();
      } catch {
        /* ignore */
      }
    }
    c.nodes.length = 0;
    c.sources.length = 0;
    this.cur = null;
  }

  /** Control tick: the static bed (signal, glitch bursts, dropouts), the ducking signal, collecting a finished line. */
  control(dtc, now, game) {
    const c = this.cur;
    const on = !!(c && now < c.end) && this.enabled;
    this.duck += ((on ? 1 : 0) - this.duck) * Math.min(1, dtc * (on ? 8 : 2.5));
    this.m._radioDuck = 1 - 0.5 * this.duck; // music: about -6 dB
    this.m._radioDuckAmb = 1 - 0.3 * this.duck; // ambience: about -3 dB
    let lvl = STATIC_IDLE;
    if (on && !c.dry) {
      const cm = game && game.comms;
      const sig = cm && typeof cm.signal === 'number' ? cm.signal : 1;
      const soft = this.m.settings && this.m.settings.signalGlitches === false;
      lvl = (0.006 + 0.05 * (1 - sig)) * (soft ? 0.35 : 1);
      const tx = c.tx;
      const tl = now - c.vStart;
      const g = tx.glitches || [];
      for (let i = 0; i < g.length; i++) {
        const e = g[i];
        if (tl >= e.t && tl < e.t + e.dur) lvl = Math.max(lvl, e.kind === 'static' ? (soft ? 0.05 : 0.16) : e.kind === 'dropout' ? (soft ? 0.03 : 0.085) : lvl);
      }
    }
    this.kStatic.set(lvl, now, lvl > this.kStatic.last ? 0.012 : 0.05);
    this.m._driveGate(this.gStatic, lvl > 0 || this.kStatic.last > 0.0005, dtc);
    if (c && now >= c.end + 0.35) this._release(false);
  }

  /** Debug: what the radio is doing. */
  debug() {
    return { lines: this.lines, on: !!this.cur, id: this.cur ? this.cur.tx.id : null, nodes: this.cur ? this.cur.nodes.length : 0, duck: +this.duck.toFixed(3), enabled: this.enabled };
  }
}
