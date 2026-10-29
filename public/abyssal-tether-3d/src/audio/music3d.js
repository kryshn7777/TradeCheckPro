/* ABYSSAL TETHER 3D — music3d.js
 * The adaptive score: original, generative, sparse and quiet. Silence is part of the score.
 *
 *   threat (ThreatSystem3D.value 0..1) → layers
 *     calm      nothing but a rare motif: the five-note phrase (5 b6 5 b3 1 over the section root: phrygian colour)
 *               on a glass-harmonica / detuned-bell timbre, one statement every ~75 s, plus one at a section's first
 *               entry. A designed hush, not an absence.
 *     uneasy    + strings-like pad swells (four detuned saws through a slow low-pass; the second pair slides from an
 *               open fifth toward a minor second as threat rises), the motif every ~25 s
 *     hunted    + a sub-bass pulse (a slow throb that is NOT the heartbeat), the motif in fragments and as a bell with a
 *               ghost echo, every ~12 s
 *   silence   when the creature listens / lingers (mgr._silence → 1) the whole score drops out in 0.2 s and returns
 *             over ~3 s after the creature moves on; the ambience thins at the same time (mgr._thin)
 *   stingers  creature sighting, strike (hit or near miss) and the gate slam: a dissonant bell cluster and a sub drop;
 *             after a strike / slam the score stays out for a few seconds
 *
 * Cost: 5 persistent oscillators (gated while silent) + ≤ 3 note voices of 4 oscillators. No per-frame allocation:
 * notes are created when they sound (every few seconds at most), the control tick only updates AudioParams.
 */
import { MOTIF, PHRYGIAN, rng32, semitone, smooth, lerp } from './dsp3d.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const MUSIC = {
  level: 0.9, // music bus gain (the master volume applies on top)
  noteLevel: 0.2, // peak per note before the bus
  maxNotes: 3, // concurrent note voices
  gapCalm: 75, // s between motif statements at zero threat
  gapHunted: 12, // ... at full threat
  firstDelay: 9, // s after a section's first entry
  padLevel: 0.05,
  subLevel: 0.26,
  afterStrike: 4.5, // s of score silence after a strike
  afterGate: 7,
};

export class Music {
  constructor(mgr) {
    this.m = mgr;
    this.rng = rng32(0xa17e);
    this.root = 65.41;
    this.gap = MUSIC.firstDelay;
    this.phrase = null; // {notes: [{f, vel}], idx, nextT, bell, echo, repeat}
    this.subT = 0;
    this.duckUntil = 0;
    this.level = 0;
    this.notesPlayed = 0;
    this.phrasesPlayed = 0;
    this.stingers = 0;
    this.lastNote = 0;
    this.lastVariant = '';
    this.padOn = false;
    this.subOn = false;
    this.swellClock = 0;
    this.tvS = 0;
  }

  build() {
    const m = this.m;
    this.bus = m._gainNode(0);
    this.bus.connect(m.muffle);
    this.kBus = m._knob(this.bus.gain, 0, 0.001);
    this.send = m._gainNode(0.45);
    this.bus.connect(this.send);
    this.send.connect(m.spaceIn);
    // sub-bass pulse
    const sub = m._osc('triangle', 55);
    const subLp = m._filter('lowpass', 170, 0.5);
    this.subG = m._gainNode(0);
    sub.connect(subLp);
    subLp.connect(this.subG);
    this.subG.connect(this.bus);
    this.sub = sub;
    this.gSub = m._gate([sub, subLp]);
    this.kSubQ = m._knob(subLp.frequency, 170, 2, 0.01);
    // strings-like pad: two detuned pairs
    this.padLp = m._filter('lowpass', 420, 0.4);
    this.padG = m._gainNode(0);
    this.padLp.connect(this.padG);
    this.padG.connect(this.bus);
    this.pad = [];
    const ratios = [1, 1.0042, 1.5, 1.4935];
    for (let k = 0; k < 4; k++) {
      const o = m._osc('sawtooth', 130 * ratios[k]);
      o.connect(this.padLp);
      this.pad.push({ o, kf: m._knob(o.frequency, 130 * ratios[k], 0.05, 0.002) });
    }
    this.kPadG = m._knob(this.padG.gain, 0, 0.0005);
    this.kPadLp = m._knob(this.padLp.frequency, 420, 2, 0.01);
    this.gPad = m._gate(...this.pad.map((p) => [p.o, this.padLp]));
  }

  setSection(index, first) {
    const m = this.m;
    this.root = m._sec.root;
    this.sectionIndex = index | 0;
    if (first) this.gap = Math.min(this.gap, MUSIC.firstDelay);
    this.phrase = null; // never carry a half-phrase across a key change
  }

  /** Re-seeds the score (a new run) so a run's music is a function of its seed. */
  reseed(seed) {
    this.rng = rng32((seed >>> 0) ^ 0xa17e);
    this.gap = MUSIC.firstDelay;
    this.phrase = null;
    this.duckUntil = 0;
  }

  /** Keeps the score out for `s` seconds (after a strike, the gate, a sighting). */
  duck(s) {
    const t = this.m.ctx ? this.m.ctx.currentTime : 0;
    this.duckUntil = Math.max(this.duckUntil, t + s);
    this.phrase = null;
  }

  control(dtc, now, game, c) {
    const m = this.m;
    const tv = c.tv;
    this.tvS += (tv - this.tvS) * Math.min(1, dtc * 1.2);
    const th = this.tvS;
    const allowed = c.playing && !c.dead && !c.victory && !c.ducked;
    const ducked = now < this.duckUntil;
    // ---- bus: out in 0.2 s when the creature listens, back over ~3 s ----
    const sil = clamp(1 - 1.5 * c.silence, 0, 1);
    const user = m.settings && typeof m.settings.musicVolume === 'number' ? clamp(m.settings.musicVolume, 0, 1) : 1;
    const tgt = allowed && !ducked ? MUSIC.level * sil * user * (m._radioDuck > 0 ? m._radioDuck : 1) : 0; // (EXPEDITION: ~-6 dB under the radio)
    this.level = tgt;
    this.kBus.set(tgt, now, tgt < this.kBus.last ? 0.12 : 2.2);

    // ---- pad swells ----
    this.swellClock += dtc;
    const swell = Math.pow(0.5 + 0.5 * Math.sin((this.swellClock * 6.2832) / (19 + 4 * Math.sin(this.swellClock * 0.013))), 2);
    const padT = allowed ? MUSIC.padLevel * smooth(0.07, 0.55, th) * (0.3 + 0.7 * swell) * (m._reduced ? 0.8 : 1) : 0;
    const base = this.root * 2;
    const second = lerp(1.5, 1.0595, smooth(0.35, 1, th)); // fifth → minor second
    this.pad[0].kf.set(base, now, 1.5);
    this.pad[1].kf.set(base * 1.0042, now, 1.5);
    this.pad[2].kf.set(base * second, now, 1.5);
    this.pad[3].kf.set(base * second * 0.9958, now, 1.5);
    this.kPadLp.set(380 + 760 * smooth(0.2, 0.9, th) + 240 * swell, now, 0.6);
    this.kPadG.set(padT, now, padT < this.kPadG.last ? 0.4 : 1.8);
    m._driveGate(this.gPad, this.kPadG.last > 0.0004, dtc);
    this.padOn = this.kPadG.last > 0.0004;

    // ---- sub-bass pulse ----
    const subWant = allowed && !ducked && th > 0.24 && c.silence < 0.3;
    this.subOn = subWant;
    m._driveGate(this.gSub, subWant || this.subG.gain.value > 0.002, dtc);
    if (subWant) {
      this.subT -= dtc;
      if (this.subT <= 0) {
        this.subT = lerp(2.9, 1.45, smooth(0.25, 1, th)) * (0.92 + 0.16 * this.rng());
        this._pulse(now, MUSIC.subLevel * smooth(0.2, 0.7, th) * (m._reduced ? 0.85 : 1));
      }
    }

    // ---- the motif ----
    if (!allowed || ducked || c.silence > 0.04) {
      // Hold the clock while the score is out (the hush must not be followed at once by a phrase), abort a half phrase.
      this.phrase = null;
      return;
    }
    if (this.phrase) {
      if (now >= this.phrase.nextT) this._advance(now, th);
    } else {
      this.gap -= dtc;
      if (this.gap <= 0) this._begin(now, th);
    }
  }

  _pulse(now, peak) {
    const g = this.subG.gain;
    const f = this.sub.frequency;
    const t = now + 0.01;
    try {
      g.cancelScheduledValues(t);
      f.cancelScheduledValues(t);
      f.setValueAtTime(this.root * 1.0, t);
      f.setTargetAtTime(this.root * 0.94, t + 0.2, 0.3);
      g.setTargetAtTime(peak, t, 0.16);
      g.setTargetAtTime(0, t + 0.42, 0.32);
    } catch (err) {
      this.m._warn('sub', err);
    }
  }

  _begin(now, th) {
    const r = this.rng;
    // variant by threat
    let variant = 'full';
    if (th > 0.6) variant = r() < 0.7 ? 'fragment' : 'low';
    else if (th > 0.3) variant = r() < 0.5 ? 'fragment' : r() < 0.5 ? 'full' : 'echo';
    else if (r() < 0.2) variant = 'echo';
    const st = MOTIF.steps;
    const notes = [];
    const n = variant === 'fragment' ? 3 : 5;
    const oct = variant === 'low' ? 0.5 : 1;
    const repeat = variant === 'fragment' && th > 0.6 ? 2 : 1;
    for (let k = 0; k < n; k++) {
      // Rare inflection: one note leans to the neighbouring phrygian degree (the phrase is recognisable, not rote).
      let s = st[k];
      if (k === 3 && r() < 0.25) s = PHRYGIAN[2];
      notes.push({ f: semitone(this.root * 4 * oct, s), vel: MOTIF.vel[k], dur: MOTIF.dur[k] * (0.9 + 0.2 * r()) });
    }
    this.phrase = { notes, idx: 0, nextT: now + 0.05, bell: variant !== 'full' && variant !== 'low', echo: variant === 'echo' || (variant === 'fragment' && th > 0.5), repeat, loop: 0, variant };
    this.lastVariant = variant;
    this.phrasesPlayed++;
  }

  _advance(now, th) {
    const p = this.phrase;
    const note = p.notes[p.idx];
    this._note(note.f, note.vel * (0.55 + 0.45 * smooth(0, 0.7, th)), p.bell, 0);
    if (p.echo) this._note(note.f * 1.5, note.vel * 0.3, true, 0.72);
    this.lastNote = note.f;
    p.idx++;
    p.nextT = now + note.dur * (p.bell ? 0.8 : 1);
    if (p.idx >= p.notes.length) {
      p.loop++;
      if (p.loop < p.repeat) p.idx = 0;
      else {
        this.phrase = null;
        const base = lerp(MUSIC.gapCalm, MUSIC.gapHunted, smooth(0.05, 0.75, th));
        this.gap = base * (0.7 + 0.7 * this.rng());
        if (this.m._reduced) this.gap *= 1.3;
      }
    }
  }

  /** One glass-harmonica / bell note: two detuned sines + an octave and a bell partial. */
  _note(f, vel, bell, delay) {
    const m = this.m;
    if (!m._live() || m._countAlive('mnote') >= MUSIC.maxNotes) return;
    const dur = bell ? 7.5 : 8.5;
    const lvl = MUSIC.noteLevel * clamp(vel, 0, 1.2);
    const pan = (this.rng() - 0.5) * 0.9;
    const v = m._begin('mnote', 0, 0, dur + delay, this.bus, lvl, pan, 0.8, 0, null);
    if (!v) return;
    const t = v.t0 + delay;
    const g = m._vGain(v, 0);
    if (bell) {
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(1, t + 0.006);
      g.gain.setTargetAtTime(0, t + 0.006, 1.5);
    } else {
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(1, t + 0.22); // glass harmonica: a bowed, slow bloom
      g.gain.setTargetAtTime(0.0, t + 0.5, 1.9);
    }
    g.connect(v.out);
    const parts = bell ? [[1, 1], [1.0045, 0.8], [2.003, 0.3], [2.76, 0.16]] : [[1, 1], [1.0045, 0.85], [2.003, 0.22], [3.01, 0.07]];
    for (let k = 0; k < parts.length; k++) {
      const o = m._vOsc(v, 'sine', f * parts[k][0], t);
      const pg = m._vGain(v, parts[k][1]);
      o.connect(pg);
      pg.connect(g);
      if (bell && k >= 2) {
        // upper bell partials die quickly
        pg.gain.setValueAtTime(parts[k][1], t);
        pg.gain.setTargetAtTime(0, t + 0.01, k === 3 ? 0.35 : 0.8);
      }
    }
    m._commit(v);
    this.notesPlayed++;
  }

  /** Musical stingers: 'sighting' | 'strike' | 'gate'. */
  stinger(kind) {
    const m = this.m;
    if (!m._live()) return;
    this.stingers++;
    const root = this.root;
    const spec = kind === 'gate'
      ? { lvl: 0.9, sub: [58, 22, 1.8], notes: [1, 16 / 15, 45 / 32, 1.5, 2], mul: 2, dur: 9 }
      : kind === 'strike'
        ? { lvl: 0.6, sub: [64, 26, 0.9], notes: [1, 16 / 15, 45 / 32], mul: 4, dur: 5 }
        : { lvl: 0.4, sub: [root, root * 0.9, 2.4], notes: [1, 45 / 32, 16 / 15], mul: 4, dur: 8 };
    const v = m._begin('mst_' + kind, 2, kind === 'gate' ? 3 : kind === 'strike' ? 1.2 : 4, spec.dur, m.busStinger, spec.lvl, 0, 0.7, 0, null);
    if (!v) return;
    const t = v.t0;
    // sub drop / swell
    const so = m._vOsc(v, 'sine', spec.sub[0], t);
    so.frequency.exponentialRampToValueAtTime(spec.sub[1], t + spec.sub[2]);
    const sg = m._vGain(v, 0);
    if (kind === 'sighting') m._swell(sg.gain, t, 0.5, 1.4, 0.4, 0.9);
    else m._perc(sg.gain, t, 0.9, 0.004, 0.35 + spec.sub[2] * 0.15);
    so.connect(sg);
    sg.connect(v.out);
    // dissonant bell cluster
    const cg = m._vGain(v, 0);
    if (kind === 'sighting') m._swell(cg.gain, t + 0.2, 0.28, 1.6, 0.5, 1.3);
    else m._perc(cg.gain, t + 0.01, 0.4, 0.004, 1.4);
    cg.connect(v.out);
    for (let k = 0; k < spec.notes.length; k++) {
      const f = root * spec.mul * spec.notes[k];
      const o = m._vOsc(v, 'sine', f, t);
      const o2 = m._vOsc(v, 'sine', f * 2.76, t);
      const g1 = m._vGain(v, 1 / spec.notes.length);
      const g2 = m._vGain(v, 0.22 / spec.notes.length);
      g2.gain.setTargetAtTime(0, t + 0.01, 0.5);
      o.connect(g1);
      o2.connect(g2);
      g1.connect(cg);
      g2.connect(cg);
    }
    m._commit(v);
    this.duck(kind === 'gate' ? MUSIC.afterGate : kind === 'strike' ? MUSIC.afterStrike : 6);
  }

  debug(out) {
    out.level = +this.level.toFixed(3);
    out.pad = this.padOn;
    out.sub = this.subOn;
    out.phrase = this.phrase ? this.phrase.variant : null;
    out.nextPhraseIn = this.phrase ? 0 : +Math.max(0, this.gap).toFixed(1);
    out.notes = this.notesPlayed;
    out.phrases = this.phrasesPlayed;
    out.stingers = this.stingers;
    out.lastNoteHz = +this.lastNote.toFixed(1);
    out.variant = this.lastVariant;
    return out;
  }
}
