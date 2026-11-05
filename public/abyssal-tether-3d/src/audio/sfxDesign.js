/* THE LANTERN (ABYSSAL TETHER 3D) — sfxDesign.js
 * The designed-SFX engine: every sound effect is a named RECIPE (layers of tones, filtered noise bands, struck-metal
 * partials and grit tick trains with numeric envelopes), tied to one game event, scaled by that event's data (`k`, 0..1:
 * impact speed, rope tension, damage ...) and varied DETERMINISTICALLY: a round-robin counter, a left/right alternation or
 * a hash of the event's data (surface + position). Nothing in here calls Math.random; the same inputs give the same sound.
 * Design + tables: docs/abyssal-tether-3d/plans/SFX_DESIGN.md. The recipes live in sfxBank.js.
 *
 * Three parts:
 *   1. determinism helpers  hash32 / hashPos / hashStr, SeqRng (a seeded stream that replaces Math.random in the audio
 *                           modules), SfxCounters (round-robin counters, one integer slot per recipe, made at registration)
 *   2. resolveRecipe()      PURE: recipe + k + variant -> a preallocated Plan of plain numbers (layer frequencies, gains,
 *                           envelope times, every grit tick). The WebAudio scheduler and the offline test renderer both read
 *                           the Plan, so what the tests measure is what the game plays.
 *   3. SfxEngine            schedules a Plan on one pooled one-shot voice of the AudioManager3D host (its _begin voice cap,
 *                           priority stealing and HRTF budget), adds distance / air absorption / occlusion / speed-of-sound
 *                           delay for world sounds, enforces per-recipe instance caps, and routes bus events to recipes.
 *
 * Extension points (for other modules: the roach critters, the cinematic): registerSfx(id, recipe) adds a recipe,
 * registerRoute(type, fn) routes one more bus event (fn(payload, engine) calls engine.play). See SFX_DESIGN.md §6.
 *
 * Hot path rules: play() allocates no JS objects (the Plan, the option scratch and the host's spatial scratch are reused);
 * the only allocations are the WebAudio nodes a one-shot needs, which the host disconnects when the voice ends. Noise comes
 * from the host's three shared looping buffers (white / pink / brown), started at a deterministic offset.
 */

// ===========================================================================
// 1. Determinism
// ===========================================================================

/** 32-bit integer hash (murmur3 finaliser) → uint32. */
export function hash32(n) {
  let x = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return x >>> 0;
}

/** hash32 → [0, 1). */
export function hashUnit(n) {
  return hash32(n) / 4294967296;
}

/** Combines two integers into one hash (order matters). */
export function hashMix(a, b) {
  return hash32(Math.imul(a | 0, 0x27d4eb2d) ^ (b | 0));
}

/** A position quantised to `cell` metres → uint32 (the same patch of floor always hashes the same). */
export function hashPos(x, y, z, cell) {
  const c = cell > 0 ? cell : 1;
  if (!(x === x && y === y && z === z)) return 0;
  return hash32(Math.imul(Math.floor(x / c), 73856093) ^ Math.imul(Math.floor(y / c), 19349663) ^ Math.imul(Math.floor(z / c), 83492791));
}

/** FNV-1a string hash → uint32 (recipe ids; computed at registration, not per play). */
export function hashStr(s) {
  let h = 0x811c9dc5;
  const str = String(s);
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * A seeded stream of numbers in [0, 1) (mulberry32). The audio modules draw their small envelope / timing jitter from one
 * of these instead of Math.random, so a run sounds the same every time it is replayed with the same inputs.
 */
export class SeqRng {
  constructor(seed) {
    this.seed = seed >>> 0;
    this.s = this.seed;
    this.n = 0;
  }
  reset(seed) {
    if (seed !== undefined) this.seed = seed >>> 0;
    this.s = this.seed;
    this.n = 0;
  }
  next() {
    this.n++;
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a, b) {
    return a + this.next() * (b - a);
  }
}

/** Round-robin counters keyed by recipe id; slots are created at registration, so counting never allocates. */
export class SfxCounters {
  constructor() {
    this.c = Object.create(null);
  }
  ensure(id) {
    if (!(id in this.c)) this.c[id] = 0;
  }
  /** Returns the current count of `id` and advances it. */
  bump(id) {
    const v = this.c[id] | 0;
    this.c[id] = (v + 1) % 1048576;
    return v;
  }
  reset() {
    for (const k in this.c) this.c[k] = 0;
  }
}

/**
 * The designed variation offsets (in -1..1): variant v detunes by pitch·VAR[v], scales the level by 1 − level·|VAR[v+3]|
 * and stretches the inner timing by 1 + time·VAR[v+5]. Eight fixed, hand-spread values instead of a random draw.
 */
export const VAR = Object.freeze([0, 0.62, -0.48, 0.31, -0.85, 0.94, -0.2, 0.55]);

// ===========================================================================
// 2. Recipes → Plans (pure)
// ===========================================================================

export const LAYER = Object.freeze({ TONE: 1, NOISE: 2, MODAL: 3, TICKS: 4 });
export const WAVES = Object.freeze(['sine', 'triangle', 'square', 'sawtooth']);
export const NOISES = Object.freeze(['white', 'pink', 'brown']);
export const FILTERS = Object.freeze(['bandpass', 'lowpass', 'highpass']);
export const BUSES = Object.freeze(['player', 'ui', 'stinger', 'ambient', 'creature', 'psych']);
export const SPACES = Object.freeze(['head', 'hand', 'world']);
export const RULES = Object.freeze(['cycle', 'alt', 'hash', 'fixed']);

export const MAX_LAYERS = 10;
export const MAX_PARTIALS = 6;
export const MAX_TICKS = 24;
/** Node budget of one designed voice (oscillators + noise sources + filters + gains). Checked by the tests. */
export const MAX_NODES = 34;
/** A layer's decay tail is scheduled out to this many time-constants (−52 dB) before the voice ends. */
export const TAIL_TC = 6;

/** Lerp a recipe field: a number, or [atK0, atK1] interpolated by k. */
export function lerpK(v, k, dflt) {
  if (typeof v === 'number') return v;
  if (v && v.length === 2) return v[0] + (v[1] - v[0]) * k;
  return dflt;
}

// A resolved layer keeps its real-valued numbers in one Float64Array (resolveRecipe writes raw doubles: no number boxing,
// no allocation per play); the named getters are for the scheduler, the tests and the offline renderer.
const X_RATE = 0;
const X_AT = 1;
const X_A = 2;
const X_H = 3;
const X_D = 4;
const X_G = 5;
const X_F = 6;
const X_F2 = 7;
const X_SW = 8;
const X_Q = 9;
const X_LR = 10;
const X_LD = 11;
const X_END = 12;

/** One resolved layer: plain numbers only (preallocated, reused for every play). */
class LayerPlan {
  constructor() {
    this.type = 0;
    this.wave = 0; // WAVES index (tone)
    this.src = 0; // NOISES index (noise / ticks)
    this.ftype = 0; // FILTERS index (noise)
    this.x = new Float64Array(13); // rate, at, a, h, d, g, f, f2, sw, q, lfoRate, lfoDepth, end
    this.np = 0; // modal partial count
    this.pf = new Float32Array(MAX_PARTIALS); // partial frequency (Hz)
    this.pg = new Float32Array(MAX_PARTIALS); // partial peak
    this.pd = new Float32Array(MAX_PARTIALS); // partial decay time-constant
    this.nt = 0; // tick count
    this.tt = new Float32Array(MAX_TICKS); // tick times (s, from the voice start)
    this.tf = new Float32Array(MAX_TICKS); // tick band centre
    this.tg = new Float32Array(MAX_TICKS); // tick peak
  }
  /** noise playback rate */
  get rate() {
    return this.x[X_RATE];
  }
  /** start (s, from the voice start) */
  get at() {
    return this.x[X_AT];
  }
  /** attack (s) */
  get a() {
    return this.x[X_A];
  }
  /** hold (s) */
  get h() {
    return this.x[X_H];
  }
  /** decay time-constant (s) */
  get d() {
    return this.x[X_D];
  }
  /** peak gain */
  get g() {
    return this.x[X_G];
  }
  /** frequency (Hz) */
  get f() {
    return this.x[X_F];
  }
  /** sweep target (Hz; = f when the layer does not sweep) */
  get f2() {
    return this.x[X_F2];
  }
  /** sweep time-constant (s) */
  get sw() {
    return this.x[X_SW];
  }
  get q() {
    return this.x[X_Q];
  }
  get lfoRate() {
    return this.x[X_LR];
  }
  get lfoDepth() {
    return this.x[X_LD];
  }
  /** when this layer is silent (s) */
  get end() {
    return this.x[X_END];
  }
}

/** A resolved recipe: what one play schedules. */
export class Plan {
  constructor() {
    this.n = 0;
    this.layers = [];
    for (let i = 0; i < MAX_LAYERS; i++) this.layers.push(new LayerPlan());
    this.variant = 0;
    this.nodes = 0; // WebAudio nodes the scheduler will create
    this.x = new Float64Array(3); // dur, level, k
  }
  /** voice length (s) */
  get dur() {
    return this.x[0];
  }
  /** out gain */
  get level() {
    return this.x[1];
  }
  get k() {
    return this.x[2];
  }
}

const idx = (list, v, dflt) => {
  const i = list.indexOf(v);
  return i >= 0 ? i : dflt;
};

// Lerpable layer numbers live in one Float64Array per layer as [atK0, atK1] pairs (resolveRecipe reads them inline: no calls
// returning doubles, so no number boxing in the hot path).
const AT = 0;
const AA = 2;
const HH = 4;
const DD = 6;
const GG = 8;
const FF = 10;
const F2 = 12;
const SW = 14;
const QQ = 16;
const LR = 18;
const LD = 20;
const NN = 22;
const SPAN = 24;
const NUMS = 26;

function pair(out, i, v, dflt) {
  if (typeof v === 'number') {
    out[i] = v;
    out[i + 1] = v;
  } else if (v && v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'number') {
    out[i] = v[0];
    out[i + 1] = v[1];
  } else {
    out[i] = dflt;
    out[i + 1] = dflt;
  }
}

/**
 * Normalises an authored recipe (sfxBank.js) once at registration: indices instead of names, every lerpable number as a
 * [atK0, atK1] pair in a Float64Array, defaults filled, the id hash. Throws on what cannot be scheduled.
 */
export function compileRecipe(id, r) {
  if (!r || !Array.isArray(r.layers) || r.layers.length === 0) throw new Error(`sfx ${id}: no layers`);
  if (r.layers.length > MAX_LAYERS) throw new Error(`sfx ${id}: ${r.layers.length} layers > ${MAX_LAYERS}`);
  const vary = r.vary || {};
  const layers = r.layers.map((L, i) => {
    const type = LAYER[String(L.t || '').toUpperCase()];
    if (!type) throw new Error(`sfx ${id}: layer ${i} has unknown type ${L.t}`);
    if (type === LAYER.MODAL && (!L.r || L.r.length < 1 || L.r.length > MAX_PARTIALS)) throw new Error(`sfx ${id}: layer ${i} partials`);
    const v = new Float64Array(NUMS);
    pair(v, AT, L.at, 0);
    pair(v, AA, L.a, 0.002);
    pair(v, HH, L.h, 0);
    pair(v, DD, L.d, 0.05);
    pair(v, GG, L.g, 0.5);
    pair(v, FF, L.f, type === LAYER.TICKS ? 1500 : 440);
    const hasF2 = L.f2 !== undefined && L.f2 !== null;
    if (hasF2) pair(v, F2, L.f2, v[FF]);
    else if (type === LAYER.TICKS) {
      v[F2] = v[FF] * 2;
      v[F2 + 1] = v[FF + 1] * 2;
    } else {
      v[F2] = v[FF];
      v[F2 + 1] = v[FF + 1];
    }
    pair(v, SW, L.sw, 0.05);
    pair(v, QQ, L.q, 1);
    pair(v, LR, L.lfo ? L.lfo[0] : 0, 0);
    pair(v, LD, L.lfo ? L.lfo[1] : 0, 0);
    pair(v, NN, L.n, 4);
    pair(v, SPAN, L.span, 0.1);
    const np = type === LAYER.MODAL ? L.r.length : 0;
    const pr = new Float64Array(MAX_PARTIALS);
    const pm = new Float64Array(MAX_PARTIALS);
    const pk = new Float64Array(MAX_PARTIALS);
    for (let j = 0; j < np; j++) {
      pr[j] = L.r[j];
      pm[j] = L.m && typeof L.m[j] === 'number' ? L.m[j] : 1 / (j + 1);
      pk[j] = L.dk && typeof L.dk[j] === 'number' ? L.dk[j] : 1 / (1 + 0.5 * j);
    }
    return Object.freeze({
      type,
      wave: idx(WAVES, L.w || 'sine', 0),
      src: idx(NOISES, L.src || 'white', 0),
      ftype: idx(FILTERS, L.ft || 'bandpass', 0),
      rate: L.rate || 1,
      v,
      sweep: hasF2 && type !== LAYER.TICKS,
      np,
      pr,
      pm,
      pk,
      falloff: L.falloff || 0,
      minK: L.minK || 0,
      maxK: L.maxK === undefined ? 1.01 : L.maxK,
      seed: (hashMix(hashStr(id) + i * 131, 0) & 0x3fffffff) | 0,
    });
  });
  const lv = new Float64Array(2);
  pair(lv, 0, r.level, 0.5);
  return Object.freeze({
    id,
    hid: hashStr(id),
    bus: idx(BUSES, r.bus || 'player', 0),
    busName: r.bus || 'player',
    prio: r.prio === undefined ? 1 : r.prio,
    gap: r.gap === undefined ? 0.04 : r.gap,
    lv,
    send: typeof r.send === 'number' ? r.send : r.send && r.send.length === 2 ? r.send[1] : 0,
    space: idx(SPACES, r.space || 'head', 0),
    preset: r.preset || 'near',
    floor: r.floor || 0,
    occlude: r.occlude !== false,
    maxInst: r.maxInst || 0,
    rule: idx(RULES, vary.rule || 'cycle', 0),
    nVar: Math.max(1, Math.min(8, vary.n || 4)),
    vPitch: vary.pitch === undefined ? 0.04 : vary.pitch,
    vLevel: vary.level === undefined ? 0.1 : vary.level,
    vTime: vary.time === undefined ? 0.1 : vary.time,
    caption: r.caption || null,
    note: r.note || '',
    layers: Object.freeze(layers),
  });
}

/** 24-bit hash (small integer: no boxing) of n. */
function h24(n) {
  let x = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 8) & 0xffffff;
}

/**
 * Recipe (compiled) + intensity k (0..1) + variant → `plan` (returned). Pure and allocation-free: two calls with the same
 * arguments give identical plans. `nyq` caps every frequency (the context's Nyquist margin).
 */
export function resolveRecipe(rec, kIn, variant, plan, nyq) {
  const k = kIn > 0 ? (kIn < 1 ? kIn : 1) : 0;
  const top = Math.max(20, nyq > 0 ? nyq : 21600); // a float64 (a tagged phi here would box every clamped frequency)
  const vi = (((variant | 0) % 8) + 8) % 8;
  const pm = 1 + rec.vPitch * VAR[vi];
  const va = VAR[(vi + 3) & 7];
  const lm = 1 - rec.vLevel * (va < 0 ? -va : va);
  const tm = 1 + rec.vTime * VAR[(vi + 5) & 7];
  const lv = rec.lv;
  plan.x[2] = k;
  plan.variant = vi;
  plan.x[1] = (lv[0] + (lv[1] - lv[0]) * k) * lm;
  let n = 0;
  plan.x[0] = 0;
  let nodes = 0;
  const layers = rec.layers;
  for (let i = 0; i < layers.length; i++) {
    const L = layers[i];
    if (k < L.minK || k > L.maxK) continue;
    const v = L.v;
    const P = plan.layers[n++];
    const x = P.x;
    P.type = L.type;
    P.wave = L.wave;
    P.src = L.src;
    P.ftype = L.ftype;
    x[X_RATE] = L.rate;
    const at = (v[AT] + (v[AT + 1] - v[AT]) * k) * tm;
    x[X_AT] = at;
    let a = v[AA] + (v[AA + 1] - v[AA]) * k;
    a = a > 0.0005 ? a : 0.0005;
    x[X_A] = a;
    let h = (v[HH] + (v[HH + 1] - v[HH]) * k) * tm;
    h = h > 0 ? h : 0;
    x[X_H] = h;
    let d = v[DD] + (v[DD + 1] - v[DD]) * k;
    d = d > 0.002 ? d : 0.002;
    x[X_D] = d;
    let g = v[GG] + (v[GG + 1] - v[GG]) * k;
    g = g > 0 ? g : 0;
    x[X_G] = g;
    let f = (v[FF] + (v[FF + 1] - v[FF]) * k) * pm;
    f = Math.min(Math.max(f, 20), top);
    x[X_F] = f;
    let f2 = (v[F2] + (v[F2 + 1] - v[F2]) * k) * pm;
    f2 = Math.min(Math.max(f2, 20), top);
    x[X_F2] = L.sweep ? f2 : f;
    const sw = v[SW] + (v[SW + 1] - v[SW]) * k;
    x[X_SW] = sw > 0.002 ? sw : 0.002;
    const q = v[QQ] + (v[QQ + 1] - v[QQ]) * k;
    x[X_Q] = q > 0.0001 ? q : 0.0001;
    const lr = v[LR] + (v[LR + 1] - v[LR]) * k;
    x[X_LR] = lr;
    let ld = v[LD] + (v[LD + 1] - v[LD]) * k;
    ld = ld > 0 ? (ld < 1 ? ld : 1) : 0;
    x[X_LD] = ld;
    P.np = 0;
    P.nt = 0;
    let end = at + a + h + d * TAIL_TC;
    const lfo = ld > 0 && lr > 0 ? 3 : 0;
    if (L.type === 1) {
      nodes += 2 + lfo;
    } else if (L.type === 2) {
      nodes += 3 + lfo;
    } else if (L.type === 3) {
      const np = L.np;
      P.np = np;
      let longest = 0;
      for (let j = 0; j < np; j++) {
        let pf = f * L.pr[j];
        pf = Math.min(Math.max(pf, 20), top);
        P.pf[j] = pf;
        P.pg[j] = g * L.pm[j];
        const pd = d * L.pk[j];
        P.pd[j] = pd;
        if (pd > longest) longest = pd;
      }
      end = at + a + longest * TAIL_TC;
      nodes += 2 * np;
    } else if (L.type === 4) {
      let nt = Math.round(v[NN] + (v[NN + 1] - v[NN]) * k);
      nt = nt < 1 ? 1 : nt > MAX_TICKS ? MAX_TICKS : nt;
      P.nt = nt;
      const span = (v[SPAN] + (v[SPAN + 1] - v[SPAN]) * k) * tm;
      const seed = (L.seed + vi * 7919) | 0;
      const step = span / nt;
      const fo = L.falloff;
      let tt = at;
      let lastT = at;
      for (let j = 0; j < nt; j++) {
        const u0 = h24(seed + j * 3) / 16777216;
        const u1 = h24(seed + j * 3 + 1) / 16777216;
        const u2 = h24(seed + j * 3 + 2) / 16777216;
        const fall = nt > 1 ? j / (nt - 1) : 0;
        P.tt[j] = tt;
        lastT = tt;
        let tf = (f + (f2 - f) * u1) * (1 - fo * 0.4 * fall);
        tf = Math.min(Math.max(tf, 20), top);
        P.tf[j] = tf;
        P.tg[j] = g * (1 - fo * fall) * (0.6 + 0.4 * u2);
        tt += step * (0.45 + 1.1 * u0);
      }
      end = lastT + 0.004 + d * TAIL_TC;
      nodes += 3;
    }
    x[X_END] = end;
    if (end > plan.x[0]) plan.x[0] = end;
  }
  plan.n = n;
  plan.nodes = nodes;
  return plan;
}

/** Problems with a compiled recipe (empty when sound): used by the tests and by registerSfx in debug builds. */
export function validateRecipe(rec, nyq) {
  const out = [];
  const plan = new Plan();
  for (const k of [0, 0.5, 1]) {
    for (let v = 0; v < rec.nVar; v++) {
      resolveRecipe(rec, k, v, plan, nyq || 21600);
      if (!(plan.dur > 0 && plan.dur < 12)) out.push(`${rec.id}: duration ${plan.dur} at k=${k}`);
      if (!(plan.level > 0 && plan.level <= 2.5)) out.push(`${rec.id}: level ${plan.level}`);
      if (plan.nodes > MAX_NODES) out.push(`${rec.id}: ${plan.nodes} nodes > ${MAX_NODES}`);
      for (let i = 0; i < plan.n; i++) {
        const L = plan.layers[i];
        for (const key of ['at', 'a', 'h', 'd', 'g', 'f', 'f2', 'sw', 'q', 'end']) {
          if (!Number.isFinite(L[key])) out.push(`${rec.id}: layer ${i} ${key} not finite`);
        }
        if (L.g > 2) out.push(`${rec.id}: layer ${i} gain ${L.g}`);
        if (L.at < 0) out.push(`${rec.id}: layer ${i} negative start`);
      }
    }
  }
  if (rec.prio < 0 || rec.prio > 3) out.push(`${rec.id}: priority ${rec.prio}`);
  return out;
}

// ===========================================================================
// 3. The engine
// ===========================================================================

const HAND_PAN = { left: -0.35, right: 0.35 };

/** Reused play options (call engine.opts() to get it cleared). */
class PlayOpts {
  constructor() {
    this.clear();
  }
  clear() {
    this.x = NaN;
    this.y = NaN;
    this.z = NaN;
    this.dist = NaN; // a distance hint when there is no position
    this.hand = '';
    this.pan = 0;
    this.key = 0; // variant hash input ('hash' rule)
    this.gain = 1;
    this.delay = 0;
    return this;
  }
}

export class SfxEngine {
  /**
   * @param {object} host  AudioManager3D (or a test double): ctx, _begin, _vOsc, _vNoise, _vFilter, _vGain, _commit,
   *                       _spatial, _floor, _at, _countAlive, bus* nodes, _white / _pink / _brown, _game, _lx/_ly/_lz, _nyq
   * @param {object} bank  { RECIPES: {id: recipe}, ROUTES: {type: fn}, HOOKS: {type: fn} } (sfxBank.js)
   */
  constructor(host, bank) {
    this.host = host;
    this.recipes = Object.create(null);
    this.routes = Object.create(null); // bus events this engine subscribes to itself
    this.hooks = Object.create(null); // events the host forwards (take()) instead of playing its own legacy sound
    this.counters = new SfxCounters();
    this.plan = new Plan();
    this._o = new PlayOpts();
    this.played = 0;
    this.refused = 0;
    this.lastId = '';
    this.broken = false;
    this.offs = [];
    this.bus = null;
    this.state = bank && typeof bank.STATE === 'function' ? bank.STATE() : {}; // the routes' memory (the foot, the jet voice, the flicker clock)
    this.updateFn = null;
    this._kp = { k: 0 }; // takeK scratch
    if (bank) {
      if (typeof bank.UPDATE === 'function') this.updateFn = bank.UPDATE;
      const R = bank.RECIPES || {};
      for (const id of Object.keys(R)) this.registerSfx(id, R[id]);
      const routes = bank.ROUTES || {};
      for (const t of Object.keys(routes)) this.routes[t] = routes[t];
      const hooks = bank.HOOKS || {};
      for (const t of Object.keys(hooks)) this.hooks[t] = hooks[t];
    }
  }

  /** Extension point: adds (or replaces) a recipe. Returns the compiled recipe. */
  registerSfx(id, recipe) {
    const rec = compileRecipe(id, recipe);
    this.recipes[id] = rec;
    this.counters.ensure(id);
    return rec;
  }

  /** Extension point: one more bus event this engine plays (fn(payload, engine)); subscribed at once when attached. */
  registerRoute(type, fn) {
    if (typeof fn !== 'function') return;
    const had = type in this.routes;
    this.routes[type] = fn;
    if (this.bus && !had) this._sub(type);
  }

  /** Subscribes the routes on the bus. Handlers run only once the host's context is built. */
  attach(bus) {
    if (!bus || typeof bus.on !== 'function' || this.bus) return;
    this.bus = bus;
    for (const type of Object.keys(this.routes)) this._sub(type);
  }

  _sub(type) {
    const off = this.bus.on(type, (p) => {
      if (this.broken || !this.host._built) return;
      const fn = this.routes[type];
      try {
        fn(p && typeof p === 'object' ? p : EMPTY, this, type);
      } catch (err) {
        this._fail(type, err);
      }
    });
    if (typeof off === 'function') this.offs.push(off);
  }

  /** Per-frame hook (AudioManager3D._update): the bank's continuous logic. */
  update(dt, game) {
    if (this.broken || !this.updateFn || !this.host._built) return;
    try {
      this.updateFn(this, dt, game);
    } catch (err) {
      this._fail('update', err);
    }
  }

  /** take() for an event whose only datum is an intensity (the footsteps). */
  takeK(type, k) {
    this._kp.k = k;
    return this.take(type, this._kp);
  }

  /**
   * The host's legacy handlers call this first: true when the designed recipe handled (played, or deliberately silenced)
   * the event, so the legacy synth is skipped; false falls back to the legacy sound.
   */
  take(type, p) {
    if (this.broken) return false;
    const fn = this.hooks[type];
    if (!fn) return false;
    try {
      return fn(p && typeof p === 'object' ? p : EMPTY, this, type) !== false;
    } catch (err) {
      this._fail(type, err);
      return false;
    }
  }

  _fail(where, err) {
    this.broken = true; // the legacy synth carries on; one warning
    if (this.host && typeof this.host._warn === 'function') this.host._warn(`sfx ${where}`, err);
  }

  /** The cleared, reused options object for the next play(). */
  opts() {
    return this._o.clear();
  }

  /** Variant for a play of `rec` under its rule. */
  variantFor(rec, o) {
    if (rec.rule === 3) return 0; // fixed
    if (rec.rule === 2) return hashMix(rec.hid, o ? o.key | 0 : 0) % rec.nVar; // hash of the event's data
    return this.counters.bump(rec.id) % rec.nVar; // cycle / alt
  }

  /**
   * Plays recipe `id` at intensity k (0..1). `o` from opts() (or null): world position, hand, pan, hash key, gain, delay.
   * Returns the voice, or null (unknown id, instance cap, rate limit, voice cap, audio not running).
   */
  play(id, k, o) {
    const h = this.host;
    const rec = this.recipes[id];
    if (!rec || !h || !h._built) return null;
    const opt = o || this.opts();
    if (rec.maxInst > 0 && h._countAlive(id) >= rec.maxInst) {
      this.refused++;
      return null;
    }
    const variant = this.variantFor(rec, opt);
    const plan = resolveRecipe(rec, k, variant, this.plan, h._nyq);
    if (plan.n === 0) return null;
    let level = plan.level * (opt.gain > 0 ? opt.gain : 0);
    if (!(level > 0)) return null;
    let pan = 0;
    let send = rec.send;
    let cutoff = 0;
    let pos = null;
    let delay = opt.delay > 0 ? opt.delay : 0;
    if (rec.space === 2 && opt.x === opt.x && opt.y === opt.y && opt.z === opt.z) {
      const sp = h._spatial(opt.x, opt.y, opt.z, opt.dist);
      if (sp.ok) {
        pos = h._at(opt.x, opt.y, opt.z);
        if (rec.floor > 0) level *= h._floor(rec.preset, sp.d, rec.floor);
        send = Math.min(0.9, send + 0.35 * (1 - Math.exp(-sp.d / 45)));
        if (sp.d > 10) cutoff = sp.cutoff; // air absorption
        if (rec.occlude && sp.d > 2.5 && this._occluded(opt.x, opt.y, opt.z)) {
          level *= 0.55;
          cutoff = cutoff > 0 ? Math.min(cutoff, 1100) : 1100;
        }
        delay += sp.delay;
      }
    } else if (rec.space === 1) {
      pan = HAND_PAN[opt.hand] || opt.pan || 0;
    } else {
      pan = opt.pan || 0;
    }
    const bus = this._bus(rec.bus);
    const v = h._begin(id, rec.prio, rec.gap, plan.dur + delay, bus, level, pan, send, cutoff, pos, rec.preset, rec.bus === 3);
    if (!v) {
      this.refused++;
      return null;
    }
    this._schedule(v, v.t0 + delay, plan);
    h._commit(v);
    this.played++;
    this.lastId = id;
    return v;
  }

  _bus(i) {
    const h = this.host;
    switch (i) {
      case 1:
        return h.busUi;
      case 2:
        return h.busStinger;
      case 3:
        return h.busAmbient;
      case 4:
        return h.busCreature;
      case 5:
        return h.busPsych;
      default:
        return h.busPlayer;
    }
  }

  /** Masonry between the listener and the source (the level's line-of-sight query, the last 0.6 m ignored). */
  _occluded(x, y, z) {
    const h = this.host;
    const lv = h._game && h._game.level;
    if (!lv || typeof lv.segmentBlocked !== 'function') return false;
    try {
      return lv.segmentBlocked(h._lx, h._ly, h._lz, x, y, z, 0.6);
    } catch {
      return false;
    }
  }

  _noise(src) {
    const h = this.host;
    return src === 1 ? h._pink : src === 2 ? h._brown : h._white;
  }

  /** Builds the plan's layers on voice v starting at t. */
  _schedule(v, t, plan) {
    const h = this.host;
    for (let i = 0; i < plan.n; i++) {
      const L = plan.layers[i];
      const t0 = t + L.at;
      if (L.type === LAYER.TONE) {
        const o = h._vOsc(v, WAVES[L.wave], L.f, t0);
        if (L.f2 !== L.f) o.frequency.setTargetAtTime(L.f2, t0, L.sw);
        const g = h._vGain(v, 0);
        env(g.gain, t0, L.g, L.a, L.h, L.d);
        o.connect(g);
        this._out(v, g, L, t0);
      } else if (L.type === LAYER.NOISE) {
        const n = h._vNoise(v, this._noise(L.src), t0, L.rate);
        const f = h._vFilter(v, FILTERS[L.ftype], L.f, L.q);
        if (L.f2 !== L.f) f.frequency.setTargetAtTime(L.f2, t0, L.sw);
        const g = h._vGain(v, 0);
        env(g.gain, t0, L.g, L.a, L.h, L.d);
        n.connect(f);
        f.connect(g);
        this._out(v, g, L, t0);
      } else if (L.type === LAYER.MODAL) {
        for (let j = 0; j < L.np; j++) {
          const o = h._vOsc(v, 'sine', L.pf[j], t0);
          const g = h._vGain(v, 0);
          env(g.gain, t0, L.pg[j], L.a, 0, L.pd[j]);
          o.connect(g);
          g.connect(v.out);
        }
      } else if (L.type === LAYER.TICKS) {
        const n = h._vNoise(v, this._noise(L.src), t + L.tt[0], L.rate);
        const f = h._vFilter(v, 'bandpass', L.tf[0], L.q);
        const g = h._vGain(v, 0);
        n.connect(f);
        f.connect(g);
        g.connect(v.out);
        g.gain.setValueAtTime(0, t + L.tt[0]);
        for (let j = 0; j < L.nt; j++) {
          const tj = t + L.tt[j];
          f.frequency.setValueAtTime(L.tf[j], tj);
          g.gain.setTargetAtTime(L.tg[j], tj, 0.0007);
          g.gain.setTargetAtTime(0, tj + 0.003, L.d);
        }
      }
    }
  }

  /** Layer output, through an amplitude flutter (tremolo) when the layer has one. */
  _out(v, g, L, t0) {
    if (!(L.lfoDepth > 0 && L.lfoRate > 0)) {
      g.connect(v.out);
      return;
    }
    const h = this.host;
    const m = h._vGain(v, 1 - L.lfoDepth * 0.5);
    const lfo = h._vOsc(v, 'sine', L.lfoRate, t0);
    const depth = h._vGain(v, L.lfoDepth * 0.5);
    lfo.connect(depth);
    depth.connect(m.gain);
    g.connect(m);
    m.connect(v.out);
  }

  /** Short state for debugState(). */
  debug() {
    return { played: this.played, refused: this.refused, last: this.lastId, broken: this.broken, recipes: Object.keys(this.recipes).length };
  }

  dispose() {
    for (const off of this.offs) {
      try {
        off();
      } catch {
        // ignore
      }
    }
    this.offs.length = 0;
  }
}

const EMPTY = Object.freeze({});

/** Envelope: 0 → peak (linear, `a`), hold `h`, then exponential decay (time-constant `d`). */
export function env(param, t, peak, a, h, d) {
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(peak, t + a);
  if (h > 0) param.setValueAtTime(peak, t + a + h);
  param.setTargetAtTime(0, t + a + h, d);
}
