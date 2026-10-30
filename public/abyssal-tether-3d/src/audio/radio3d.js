/* ABYSSAL TETHER 3D — radio3d.js (EXPEDITION: the radio voices; docs/abyssal-tether-3d/plans/COMMS.md, VO_SCRIPT.md)
 * VOICE CLIPS. A line with a clip in assets/audio/voice/manifest.json (tools/abyssal-tether-3d/build_voices.py: today AI
 * placeholder voices, Kokoro-82M text-to-speech; a human recording of a line replaces its clip with no code change) speaks that
 * clip through the radio chain below; the director (sim/comms3d.js) times the line and its subtitle by the clip (the hook
 * voiceFor(id): only a clip already decoded counts). The clips load lazily (VoiceBank: the manifest, then the current section's
 * lines, the next section's, the lines heard anywhere; an LRU of decoded seconds), never at boot.
 * THE BABBLE (the fallback: no clip for the line, not loaded yet, or it failed): a synthesised voice-substitute (pitched,
 * formant-filtered syllable babble, one per speaker) timed to its subtitle, so the radio always has a voice and a rhythm.
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
 * Settings › Sound › Radio voices OFF: silent (the subtitles still show every line, timed by their text; no clip is fetched).
 * `?comms=off`: no clip is fetched. Settings › Access › Signal glitches OFF: the static is lowered and the bursts are soft.
 * A clip keeps every signal effect: the static bed, the static bursts, the dropouts (the voice gaps; the clip runs on under
 * them), the stuck word (the word's first 0.28 s twice more: three sources over the word timing), and the not-quite voice (the
 * clip slower and lower, doubled by a second copy a hair faster and 22 ms late, without the radio filter).
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
  ELIAS: Object.freeze({ f0: 104, rate: 4.0, wave: 'triangle', glide: -0.03, jitter: 0.05, formant: 0.97, level: 0.7, q: 6 }),
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

// ---- voice clips ---------------------------------------------------------------------------------------------------------
/** The clips and their manifest, relative to the page (like assets/textures/manifest.json). */
export const VOICE_BASE = 'assets/audio/voice/';
/** Seconds of decoded clips kept (an LRU: the current section, the next and the anywhere lines fit; ~10 MB at 24 kHz). */
export const VOICE_CACHE_S = 110;
/** A clip's gain into its chain (the clips are normalised to -23 LUFS; the babble's VOICES[].level does not apply). */
export const CLIP_LEVEL = Object.freeze({ ODESSA: 1, TICK: 1, MAREN: 1, VESPER: 0.8, ELIAS: 0.92, UPLINK: 1 });
/** At most this many clips loading at once. */
const VOICE_PARALLEL = 2;
/** The not-quite voice's second copy: a hair faster (a slow beat against the first), this late (s), this loud. */
const DOUBLE_RATE = 1.012;
const DOUBLE_DELAY = 0.022;
const DOUBLE_GAIN = 0.45;

function commsOffUrl() {
  try {
    return typeof location !== 'undefined' && /[?&]comms=off\b/.test(location.search || '');
  } catch {
    return false;
  }
}

function defaultLoad(url, as) {
  if (typeof fetch !== 'function') return Promise.reject(new Error('no fetch'));
  return fetch(url).then((r) => {
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    return as === 'json' ? r.json() : r.arrayBuffer();
  });
}

/**
 * The clips: the manifest (fetched once), the decoded AudioBuffers (an LRU of VOICE_CACHE_S seconds; the clip on air is never
 * evicted), the loading queue (the wanted section's lines first). io: { load(url, 'json' | 'buffer') -> Promise, decode(ArrayBuffer)
 * -> Promise<AudioBuffer>, base }. Nothing here runs per frame: it works on section entries and line starts.
 */
export class VoiceBank {
  constructor(io) {
    const o = io || {};
    this.base = o.base || VOICE_BASE;
    this.load = o.load || defaultLoad;
    this.decode = o.decode || null;
    this.manifest = null;
    this.state = 'idle'; // idle | loading | ready | failed (no manifest: every line keeps the babble)
    this.bufs = new Map(); // id -> { buf, used, s }
    this.pending = new Set();
    this.failed = new Set();
    this.queue = [];
    this.active = 0;
    this.seconds = 0;
    this.clock = 0;
    this.section = 0;
    this.pinned = null;
    this.loaded = 0;
    this.ready = null;
  }

  /** Fetch the manifest (once), then the wanted section's clips. */
  start() {
    if (this.state !== 'idle') return this.ready;
    this.state = 'loading';
    this.ready = Promise.resolve()
      .then(() => this.load(this.base + 'manifest.json', 'json'))
      .then((m) => {
        if (!m || typeof m !== 'object' || !m.lines || typeof m.lines !== 'object') throw new Error('bad voice manifest');
        this.manifest = m;
        this.state = 'ready';
        this.want(this.section);
      })
      .catch(() => {
        this.state = 'failed';
      });
    return this.ready;
  }

  entry(id) {
    const L = this.manifest && this.manifest.lines;
    return L && Object.prototype.hasOwnProperty.call(L, id) ? L[id] : null;
  }

  has(id) {
    return this.bufs.has(id);
  }

  /** The decoded clip of `id` (marked as used), or null. */
  buffer(id) {
    const b = this.bufs.get(id);
    if (!b) return null;
    b.used = ++this.clock;
    return b.buf;
  }

  /** Queue the lines of `section`, then of the next section, then the lines heard anywhere. */
  want(section) {
    this.section = section | 0;
    if (this.state !== 'ready') return;
    const L = this.manifest.lines;
    const q = [];
    for (const pass of [this.section, this.section + 1, -1]) for (const id in L) if ((L[id].s == null ? -1 : L[id].s | 0) === pass) q.push(id);
    this.queue = q;
    this._evict();
    this._pump();
  }

  /** A line asked for before its clip was ready: load it next (for its next time on air). */
  request(id) {
    if (this.state !== 'ready' || !this.entry(id) || this.bufs.has(id) || this.pending.has(id) || this.failed.has(id)) return;
    this.queue.unshift(id);
    this._pump();
  }

  _pump() {
    while (this.active < VOICE_PARALLEL && this.queue.length) {
      const id = this.queue.shift();
      const e = this.entry(id);
      if (!e || !this.decode || this.bufs.has(id) || this.pending.has(id) || this.failed.has(id)) continue;
      this.active++;
      this.pending.add(id);
      Promise.resolve()
        .then(() => this.load(this.base + e.f, 'buffer'))
        .then((ab) => this.decode(ab))
        .then((buf) => this._put(id, buf, e))
        .catch(() => {
          this.failed.add(id); // this session: the babble speaks it
        })
        .then(() => {
          this.pending.delete(id);
          this.active--;
          this._pump();
        });
    }
  }

  _put(id, buf, e) {
    if (!buf || !(buf.duration > 0)) throw new Error('empty clip');
    this.bufs.set(id, { buf, used: ++this.clock, s: e.s == null ? -1 : e.s | 0 });
    this.seconds += buf.duration;
    this.loaded++;
    this._evict();
  }

  /** Over the budget: drop the least recently used clip outside the wanted sections (never the one on air). */
  _evict() {
    while (this.seconds > VOICE_CACHE_S && this.bufs.size > 1) {
      let worst = null;
      let wk = 0;
      for (const [id, b] of this.bufs) {
        if (id === this.pinned) continue;
        const keep = b.s === this.section || b.s === this.section + 1 || b.s < 0 ? 1e12 : 0;
        if (worst === null || keep + b.used < wk) {
          worst = id;
          wk = keep + b.used;
        }
      }
      if (worst === null) break;
      this.seconds -= this.bufs.get(worst).buf.duration;
      this.bufs.delete(worst);
    }
  }
}

export class Radio {
  /** @param {object} mgr AudioManager3D (ctx, master, spaceIn, _white, _pink, _filter, _gainNode, _loop, _knob, _gate, settings) */
  constructor(mgr) {
    this.m = mgr;
    this.broken = false;
    this.cur = null; // { tx, nodes, sources, t0, end }
    this.lines = 0; // lines spoken (tests)
    this.duck = 0; // 0..1 smoothed "a line is on air"
    this._staticT = 0;
    this.bank = null; // the voice clips (VoiceBank), made at build()
    this.clips = 0; // lines spoken from a clip (tests)
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
    // the voice clips: the manifest and the Threshold's lines start loading now (the first user gesture, after boot)
    this.bank = new VoiceBank({ decode: this._decoder() });
    if (this._clipsWanted()) this.bank.start();
  }

  get enabled() {
    const s = this.m.settings;
    return !(s && s.radioVoices === false);
  }

  _clipsWanted() {
    return this.enabled && !commsOffUrl();
  }

  /** Decoding at 24 kHz (an OfflineAudioContext) halves the memory of a decoded clip; the live context otherwise. */
  _decoder() {
    const ctx = this.m.ctx;
    let dc = ctx;
    try {
      const OAC = typeof OfflineAudioContext === 'function' ? OfflineAudioContext : null;
      if (OAC && !this.m._offline) dc = new OAC(1, 1, 24000);
    } catch {
      dc = ctx;
    }
    if (!dc || typeof dc.decodeAudioData !== 'function') return null;
    return (ab) => dc.decodeAudioData(ab);
  }

  /** A section entered: its clips (and the next section's) load first. */
  prefetch(section) {
    const b = this.bank;
    if (!b || !this._clipsWanted()) return;
    b.section = section | 0;
    if (b.state === 'idle') b.start();
    else b.want(section);
  }

  /** The director's hook (sim/comms3d.js CommsDirector.voice): the manifest entry of a clip ready to play now, or null. */
  voiceFor(id) {
    const b = this.bank;
    if (!b || !this.enabled) return null;
    if (b.state === 'idle') {
      if (this._clipsWanted()) b.start();
      return null;
    }
    const e = b.entry(id);
    if (!e) return null;
    if (!b.has(id)) {
      b.request(id);
      return null;
    }
    return e;
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
    const own = tx.speaker === 'ELIAS'; // the player's own voice in the suit: dry, no radio, no squelch, no chime
    const dryVoice = local || own || tx.kind === 'notquite';
    const off = tx.kind === 'offmic';
    const V = VOICES[tx.speaker] || VOICES.TICK;
    // the line's clip when the director timed it by one (else, or if it is gone: the babble)
    const buf = tx.voice && this.bank ? this.bank.buffer(tx.id) : null;
    const lvl = (buf ? CLIP_LEVEL[tx.speaker] || 1 : V.level) * (off ? 0.42 : 1);
    const out = ctx.createGain();
    out.gain.value = lvl * (tx.kind === 'notquite' ? 1.15 : 1);
    nodes.push(out);
    let tail = out;
    if (off) {
      const mlp = m._filter('lowpass', 1100, 0.5);
      nodes.push(mlp);
      out.connect(mlp);
      tail = mlp;
    }
    tail.connect(dryVoice ? this.dry : this.inp);
    const speakT = buf ? clamp(tx.speak || buf.duration, 0.3, 12) : clamp(tx.speak || 1, 0.5, 6);
    // a clip of the suit starts after its chime (a real first syllable under the chime would be masked)
    const vStart = t0 + (buf && local ? 0.16 : local || own || off || tx.kind === 'notquite' ? 0.05 : SQUELCH);
    const end = vStart + speakT + 0.25;
    // squelch on / off (the radio), or the suit's two-tone chime (Vesper)
    if (local) {
      this._chime(t0, nodes, sources, out);
    } else if (!off && !own && tx.kind !== 'notquite') {
      this._squelch(t0, nodes, sources);
      this._squelch(vStart + speakT + 0.06, nodes, sources);
    }
    if (tx.kind === 'echo') this._breaths(vStart, speakT, nodes, sources, out);
    else if (buf) this._clip(tx, buf, vStart, nodes, sources, out, tx.kind === 'notquite');
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
      out.gain.linearRampToValueAtTime(lvl, a + e.dur + 0.04);
    }
    for (let i = 0; i < sources.length; i++) sources[i].stop(end + 0.3);
    this.cur = { tx, nodes, sources, t0, vStart, end, dry: dryVoice, clip: !!buf };
    this.lines++;
    if (buf) {
      this.clips++;
      this.bank.pinned = tx.id; // never evicted while on air
    }
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

  /**
   * A recorded line: the clip from vStart (slower and lower for the not-quite voice, tx.voiceRate). The stuck word (tx.stuck:
   * { a: the word's onset, s: one repeat }, in clip time) plays as three sources: [0, a + s), [a, a + s), [a, end). The voice
   * that is not quite the speaker gets a second copy a hair faster and 22 ms late under it (the doubling).
   */
  _clip(tx, buf, vStart, nodes, sources, out, warm) {
    const ctx = this.m.ctx;
    const rate = tx.voiceRate > 0 ? tx.voiceRate : 1;
    const st = tx.stuck;
    const D = buf.duration;
    const n = st && st.s > 0 && st.a >= 0 && st.a + st.s < D ? 3 : 1;
    let t = vStart;
    for (let k = 0; k < n; k++) {
      const from = n === 1 || k === 0 ? 0 : st.a;
      const len = n === 1 ? D : k === 0 ? st.a + st.s : k === 1 ? st.s : D - st.a;
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.playbackRate.value = rate;
      s.connect(out);
      s.start(t, from, len);
      nodes.push(s);
      sources.push(s);
      t += len / rate;
    }
    if (warm && n === 1) {
      const s2 = ctx.createBufferSource();
      s2.buffer = buf;
      s2.playbackRate.value = rate * DOUBLE_RATE;
      const g = ctx.createGain();
      g.gain.value = DOUBLE_GAIN;
      s2.connect(g);
      g.connect(out);
      s2.start(vStart + DOUBLE_DELAY);
      nodes.push(s2, g);
      sources.push(s2);
    }
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
    if (this.bank) this.bank.pinned = null;
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
    const b = this.bank;
    return {
      lines: this.lines,
      clips: this.clips,
      on: !!this.cur,
      id: this.cur ? this.cur.tx.id : null,
      clip: !!(this.cur && this.cur.clip),
      nodes: this.cur ? this.cur.nodes.length : 0,
      duck: +this.duck.toFixed(3),
      enabled: this.enabled,
      voice: b ? { state: b.state, resident: b.bufs.size, seconds: +b.seconds.toFixed(1), loaded: b.loaded, failed: b.failed.size, pending: b.pending.size } : null,
    };
  }
}
