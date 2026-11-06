/* THE LANTERN (ABYSSAL TETHER 3D) — meta/trials.js
 * SECTION TRIALS (docs/abyssal-tether-3d/plans/SECTION_TRIALS.md): practise one section from its checkpoint, against par and
 * against your own trial best. This module is the pure part: the storage of the trial bests, the result maths, the clock state.
 *
 * Pure ES module: no three.js, no DOM at import time (storage is looked up lazily), no Math.random, so Node tests load it.
 *
 * ---- Storage ----------------------------------------------------------------------------------------------------
 *   localStorage 'abyssalTether3d.v2.trials.ch<chapter>.<diff>' = JSON { <section id>: { best, untouched, runs } }. Kept APART from
 *   the profile (meta/save.js): a trial never writes the main run save, its splits, medals or ghost. Every function takes an
 *   optional `storage` (anything with getItem / setItem, e.g. memoryStorage() here, or a LocalStorageAdapter's storage) so a test
 *   injects one; every storage error is swallowed (quota, private mode, no storage): a trial best is a nicety, never a failure.
 *   A worse time never overwrites the best; `untouched` is an OR (a clean run of the section, ever).
 *
 * ---- Result ------------------------------------------------------------------------------------------------------
 *   trialResult({ time, par, prevBest, untouched }) -> { time, medal, delta, deltaText, isNew, untouched, par }: the medal by
 *   sim/splits3d.js medalFor against the section's par (data/par-3d.js), the delta against the previous trial best (s, signed).
 */
import { medalFor } from '../sim/splits3d.js';
import { fmtDelta } from '../ui/medals.js';

export const TRIALS_PREFIX = 'abyssalTether3d.v2.trials.';
/** The fixed supply seed of a trial: pickups are seeded 0x7a1a1 + section index (the same layout every attempt). */
export const TRIAL_SEED = 0x7a1a1;
const SECTION_ID = /^[a-z][a-z0-9_-]{0,15}$/;

export function trialKey(chapter, diffKey) {
  return `${TRIALS_PREFIX}ch${Number(chapter) === 2 ? 2 : 1}.${String(diffKey)}`;
}

export function trialSeed(idx) {
  return (TRIAL_SEED + (Math.max(0, idx | 0) | 0)) >>> 0;
}

/** A Storage-like map in memory (tests; a stand-in where localStorage is missing). `failNext` makes the next calls throw. */
export function memoryStorage() {
  const m = new Map();
  return {
    failNext: 0,
    get size() {
      return m.size;
    },
    getItem(k) {
      if (this.failNext > 0) {
        this.failNext--;
        throw new Error('memory storage: injected failure');
      }
      return m.has(k) ? m.get(k) : null;
    },
    setItem(k, v) {
      if (this.failNext > 0) {
        this.failNext--;
        throw new Error('memory storage: injected failure');
      }
      m.set(k, String(v));
    },
    removeItem(k) {
      m.delete(k);
    },
  };
}

function lsOf(storage) {
  if (storage) return storage;
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

const posNum = (v) => (typeof v === 'number' && isFinite(v) && v > 0 ? v : null);

/** The trial bests of a chapter and difficulty: { <section id>: { best, untouched, runs } } (only readable entries). Never throws. */
export function loadTrials(chapter, diffKey, storage = null) {
  const out = {};
  try {
    const s = lsOf(storage);
    if (!s) return out;
    const raw = s.getItem(trialKey(chapter, diffKey));
    const o = raw ? JSON.parse(raw) : null;
    if (!o || typeof o !== 'object' || Array.isArray(o)) return out;
    for (const id of Object.keys(o)) {
      const r = o[id];
      if (!SECTION_ID.test(id) || !r || typeof r !== 'object') continue;
      const best = posNum(r.best);
      if (!best && !r.untouched) continue;
      out[id] = { best, untouched: r.untouched === true, runs: Math.max(0, r.runs | 0) };
    }
  } catch {
    /* swallowed: no trials */
  }
  return out;
}

/**
 * Keeps a finished trial of section `id`: the faster time (a worse one never overwrites), untouched OR'd, the runs counted.
 * @returns {{ best:number|null, previous:number|null, isNew:boolean, untouched:boolean, saved:boolean }}
 */
export function saveTrialBest(chapter, diffKey, id, time, untouched = false, storage = null) {
  const res = { best: null, previous: null, isNew: false, untouched: !!untouched, saved: false };
  if (typeof id !== 'string' || !SECTION_ID.test(id) || !posNum(time)) return res;
  try {
    const s = lsOf(storage);
    if (!s) return res;
    const all = loadTrials(chapter, diffKey, s);
    const cur = all[id] || { best: null, untouched: false, runs: 0 };
    res.previous = cur.best;
    res.isNew = !cur.best || time < cur.best - 1e-9;
    res.best = res.isNew ? time : cur.best;
    res.untouched = cur.untouched || !!untouched;
    all[id] = { best: res.best, untouched: res.untouched, runs: cur.runs + 1 };
    s.setItem(trialKey(chapter, diffKey), JSON.stringify(all));
    res.saved = true;
  } catch {
    /* swallowed: the trial simply is not kept */
  }
  return res;
}

/** The result card's maths: medal against par, the delta vs the previous trial best (s; negative = faster), a new best? */
export function trialResult({ time, par = null, prevBest = null, untouched = false } = {}) {
  const t = posNum(time);
  const p = posNum(par);
  const prev = posNum(prevBest);
  return {
    time: t,
    par: p,
    medal: t ? medalFor(t, p) : null,
    delta: t && prev ? Math.round((t - prev) * 100) / 100 : null,
    deltaText: t && prev ? fmtDelta(t, prev) : null,
    isNew: !!t && (!prev || t < prev - 1e-9),
    untouched: !!t && !!untouched,
  };
}

/** A trial's live state (game.trial): section `idx` of chapter `ch` on `diff`; the clock arms on the first input / movement. */
export function newTrial(idx, diff, ch = 1, id = null) {
  return { idx: Math.max(0, idx | 0), id: id || `s${Math.max(0, idx | 0) + 1}`, diff: String(diff), ch: Number(ch) === 2 ? 2 : 1, t: 0, armed: false, untouched: true, done: false, failed: false, result: null, attempt: 1 };
}

/**
 * The trial clock, once a frame from game.js after the run clock moved (no allocation). Before it arms the run clock is held at 0
 * (the HUD shows the trial clock); `moved` = any input or the body moved off its checkpoint. Returns the run time to keep.
 */
export function trialTick(tr, runTime, moved) {
  if (!tr || tr.done) return runTime;
  if (!tr.armed) {
    if (!moved) return 0;
    tr.armed = true;
    tr.t = 0;
    return 0;
  }
  tr.t = runTime;
  return runTime;
}
