/* ABYSSAL TETHER 3D — meta/save.js (E05, Chapter I scope)
 * Versioned save data: settings, best times and records per difficulty, deaths, the checkpoint to continue from and
 * the completion flag. IndexedDB first, localStorage as the fallback / safety copy, an in-memory adapter for Node.
 * Pure ES module: no three.js and no DOM at import time (everything is looked up lazily), so the Node tests load it.
 *
 * ---- Storage -----------------------------------------------------------------------------------------------
 *   IndexedDB  database 'abyssalTether3d' (version 2), object store 'profile', one record under key 'profile'
 *   localStorage  'abyssalTether3d.v2.profile' (JSON), written synchronously on every flush: the copy that survives
 *                 a page kill (pagehide cannot await IndexedDB) and the fallback when IndexedDB is unavailable
 *   load(): reads both and keeps the one with the newest `updatedAt` (IndexedDB wins ties)
 *   today's v1 keys ('abyssalTether3d.v1.*', written by config3d.js Storage) are READ for migration and then kept
 *   in sync as the UI still reads them (see "legacy mirror"); they are never deleted.
 *
 * ---- Schema (schema: 3) --------------------------------------------------------------------------------------
 *   { schema, createdAt, updatedAt, id,                      // id: random profile id (diagnostics only)
 *     settings: { ...Storage.loadSettings() keys... } | null,
 *     run: null | { chapter:'ch1', difficulty, checkpoint:{ x,y,z,yaw,index }, section, time, deaths, deepest,
 *                   savedAt, kind:'checkpoint'|'start', objectives?: [objective ids done] },   // the run to Continue
 *                   (objectives: LEVEL_FUN_PLAN P1, optional; absent = none done; P3: also fixtures done / haul notches)
 *     chapters: { ch1: { reached, completed, completions, firstCompletedAt, lastCompletedAt,
 *                        byDiff: { <diff>: { runs, completions, best, fewestDeaths, deepest, lastTime, lastDeaths,
 *                                            sections: { <section id>: { best, medal } } } } } },
 *     totals: { runs, deaths, deathsByCause:{...}, playTime, completions } }
 *   sections (schema 3, LEVEL_FUN_PLAN item 12): the best whole-section split (s) per section and difficulty and the best
 *   medal it earned ('gold' | 'silver' | 'brass' | null; sim/splits3d.js against data/par-3d.js). Only a section played
 *   whole in one run is recorded (never after a Continue into it, never in Sandbox).
 *
 * ---- Migration ----------------------------------------------------------------------------------------------
 *   migrateProfile(raw, legacy) accepts: null / garbage -> a fresh profile (legacy v1 records imported);
 *   schema 1 shapes; schema 2 (P1: run.objectives kept, every difficulty gets an empty `sections`); a schema-2/3 profile
 *   with missing / wrong-typed fields (each readable record is kept);
 *   a profile from a NEWER schema is kept as-is for reading (never downgraded or overwritten with less).
 *   The storage keys (IndexedDB version 2, 'abyssalTether3d.v2.profile') did not change with schema 3.
 *   importLegacy(kv) builds chapters.ch1.byDiff from today's keys: best.<d>, fewestDeaths.<d>, deepest.<d>,
 *   runs.<d>, completions.<d>, settings.
 *
 * ---- Writes -------------------------------------------------------------------------------------------------
 *   mutate with store.update(fn); writes are debounced (>= 1 s), asynchronous, never inside the frame loop and a
 *   failed write never throws into the game (it emits 'save:error'). flush() writes now (pagehide / pause).
 *
 * ---- Events (store.on / game.bus) ---------------------------------------------------------------------------
 *   save:loaded {source, migrated}   save:changed {reason}   save:written {adapter, bytes}   save:error {message}
 *   continue:changed {available, info}   (when the continue slot is created, updated or cleared)
 *
 * ---- Game wiring: SaveService(game) --------------------------------------------------------------------------
 *   game.save.continueInfo()  -> null | { difficulty, label, section, sectionName, checkpoint, time, deaths, depthMeters, savedAt }
 *   game.save.records(diff)   -> { best, fewestDeaths, deepest, runs, completions }
 *   game.save.chapter('ch1')  -> { reached, completed, completions, byDiff }
 *   game.save.sectionRecords(diff) -> { <section id>: { best, medal } }   (bus 'split' events from game.js fill it)
 *   game.canContinue() / game.continueRun()   (game.js)
 */

import { DIFFICULTY } from '../sim/config3d.js';

export const SAVE_SCHEMA = 3;
export const DB_NAME = 'abyssalTether3d';
export const DB_VERSION = 2;
export const DB_STORE = 'profile';
export const DB_KEY = 'profile';
export const LS_PROFILE_KEY = 'abyssalTether3d.v2.profile';
export const V1_PREFIX = 'abyssalTether3d.v1.';
export const DIFFICULTIES = ['normal', 'nightmare', 'abyss', 'sandbox'];
export const DEATH_CAUSES = ['impact', 'fall', 'hazard', 'creature', 'crush', 'drown', 'kept', 'still'];
/** Section-split medals, best first (sim/splits3d.js SPLIT_MEDALS: gold <= 1.0 x par, silver 1.4 x, brass 2.0 x). */
export const MEDALS = ['gold', 'silver', 'brass'];
const SECTION_ID = /^[a-z][a-z0-9_-]{0,15}$/;
const DEBOUNCE_MS = 1000;

const isNum = (v) => typeof v === 'number' && isFinite(v);
const posNum = (v) => (isNum(v) && v > 0 ? v : null);
const nonNeg = (v, d = 0) => (isNum(v) && v >= 0 ? v : d);
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

// ------------------------------------------------------------------------------------------------------------
// Profile shape
// ------------------------------------------------------------------------------------------------------------
export function emptyDiffRecord() {
  return { runs: 0, completions: 0, best: null, fewestDeaths: null, deepest: 0, lastTime: null, lastDeaths: null, sections: {} };
}

const medalRank = (m) => (MEDALS.indexOf(m) >= 0 ? MEDALS.length - MEDALS.indexOf(m) : 0);

/** sections (schema 3): { <id>: { best, medal } } with only readable entries (unknown medals become null). */
function cleanSections(sec) {
  const out = {};
  if (!isObj(sec)) return out;
  for (const id of Object.keys(sec)) {
    const r = sec[id];
    if (!SECTION_ID.test(id) || !isObj(r)) continue;
    const best = posNum(r.best);
    const medal = MEDALS.indexOf(r.medal) >= 0 ? r.medal : null;
    if (best || medal) out[id] = { best, medal };
  }
  return out;
}

/** Keeps the faster split and the better medal of two section records. */
function mergeSections(a, b) {
  const out = cleanSections(a);
  const y = cleanSections(b);
  for (const id of Object.keys(y)) {
    const x = out[id];
    if (!x) {
      out[id] = y[id];
      continue;
    }
    out[id] = {
      best: x.best && y[id].best ? Math.min(x.best, y[id].best) : x.best || y[id].best,
      medal: medalRank(y[id].medal) > medalRank(x.medal) ? y[id].medal : x.medal,
    };
  }
  return out;
}

export function emptyChapter() {
  return { reached: true, completed: false, completions: 0, firstCompletedAt: null, lastCompletedAt: null, byDiff: {} };
}

export function defaultProfile(now = Date.now()) {
  return {
    schema: SAVE_SCHEMA,
    id: randomId(),
    createdAt: now,
    updatedAt: now,
    settings: null,
    run: null,
    chapters: { ch1: emptyChapter() },
    totals: { runs: 0, deaths: 0, deathsByCause: {}, playTime: 0, completions: 0 },
  };
}

function randomId() {
  let s = '';
  for (let i = 0; i < 12; i++) s += Math.floor(Math.random() * 36).toString(36);
  return s;
}

/** Reads today's (v1) localStorage-style key/value pairs: getItem(key) -> string|null. */
export function importLegacy(getItem) {
  const get = (k) => {
    try {
      const raw = getItem(V1_PREFIX + k);
      return raw == null ? undefined : JSON.parse(raw);
    } catch {
      return undefined;
    }
  };
  const byDiff = {};
  let any = false;
  for (const d of DIFFICULTIES) {
    const rec = emptyDiffRecord();
    const best = posNum(get(`best.${d}`));
    const fewest = get(`fewestDeaths.${d}`);
    const deepest = get(`deepest.${d}`);
    const runs = get(`runs.${d}`);
    const comps = get(`completions.${d}`);
    if (best) rec.best = best;
    if (isNum(fewest) && fewest >= 0) rec.fewestDeaths = Math.floor(fewest);
    if (isNum(deepest) && deepest > 0) rec.deepest = deepest;
    if (isNum(runs) && runs > 0) rec.runs = Math.floor(runs);
    if (isNum(comps) && comps > 0) rec.completions = Math.floor(comps);
    if (rec.best || rec.fewestDeaths != null || rec.deepest || rec.runs || rec.completions) {
      byDiff[d] = rec;
      any = true;
    }
  }
  const settings = get('settings');
  return { byDiff, settings: isObj(settings) ? settings : null, any: any || isObj(settings) };
}

function cleanDiffRecord(r) {
  const out = emptyDiffRecord();
  if (!isObj(r)) return out;
  out.runs = Math.floor(nonNeg(r.runs));
  out.completions = Math.floor(nonNeg(r.completions));
  out.best = posNum(r.best);
  out.fewestDeaths = isNum(r.fewestDeaths) && r.fewestDeaths >= 0 ? Math.floor(r.fewestDeaths) : null;
  out.deepest = nonNeg(r.deepest);
  out.lastTime = posNum(r.lastTime);
  out.lastDeaths = isNum(r.lastDeaths) && r.lastDeaths >= 0 ? Math.floor(r.lastDeaths) : null;
  out.sections = cleanSections(r.sections);
  return out;
}

function cleanRun(r) {
  if (!isObj(r) || typeof r.difficulty !== 'string' || !isObj(r.checkpoint)) return null;
  const c = r.checkpoint;
  if (!isNum(c.x) || !isNum(c.y) || !isNum(c.z)) return null;
  return {
    chapter: typeof r.chapter === 'string' ? r.chapter : 'ch1',
    difficulty: r.difficulty,
    checkpoint: { x: c.x, y: c.y, z: c.z, yaw: isNum(c.yaw) ? c.yaw : 0, index: isNum(c.index) ? Math.floor(c.index) : -1 },
    section: isNum(r.section) ? Math.floor(r.section) : 0,
    time: nonNeg(r.time),
    deaths: Math.floor(nonNeg(r.deaths)),
    deepest: isNum(r.deepest) ? r.deepest : c.y,
    savedAt: isNum(r.savedAt) ? r.savedAt : 0,
    kind: r.kind === 'start' ? 'start' : 'checkpoint',
    ...cleanObjectives(r.objectives),
  };
}

/**
 * run.objectives (LEVEL_FUN_PLAN P1): the ids of the objectives done in the saved run; absent when there are none. P3 adds
 * the ratchet of the ones not done yet in the same list of strings: fixture ids done ('lamp-s4a') and haul notches
 * ('cw-s2#2') (Objectives3D.serialize / load).
 */
function cleanObjectives(list) {
  if (!Array.isArray(list)) return {};
  const ids = [];
  for (const id of list) if (typeof id === 'string' && id.length > 0 && id.length <= 40 && ids.length < 64 && ids.indexOf(id) < 0) ids.push(id);
  return ids.length ? { objectives: ids } : {};
}

/** Merges two per-difficulty records, keeping the better of each value (never loses a record). */
export function mergeDiffRecords(a, b) {
  const x = cleanDiffRecord(a);
  const y = cleanDiffRecord(b);
  return {
    runs: Math.max(x.runs, y.runs),
    completions: Math.max(x.completions, y.completions),
    best: x.best && y.best ? Math.min(x.best, y.best) : x.best || y.best,
    fewestDeaths: x.fewestDeaths != null && y.fewestDeaths != null ? Math.min(x.fewestDeaths, y.fewestDeaths) : x.fewestDeaths != null ? x.fewestDeaths : y.fewestDeaths,
    deepest: Math.max(x.deepest, y.deepest),
    lastTime: x.lastTime || y.lastTime,
    lastDeaths: x.lastDeaths != null ? x.lastDeaths : y.lastDeaths,
    sections: mergeSections(x.sections, y.sections),
  };
}

/**
 * Turns whatever was stored into a valid current profile. Never throws.
 * @param {*} raw       the stored record (any shape) or null
 * @param {object} [legacy]  result of importLegacy() for today's keys
 * @returns {{profile:object, migrated:boolean, repaired:boolean, newer:boolean}}
 */
export function migrateProfile(raw, legacy = null, now = Date.now()) {
  let migrated = false;
  let repaired = false;
  const p = defaultProfile(now);
  if (isObj(raw)) {
    if (isNum(raw.schema) && raw.schema > SAVE_SCHEMA) {
      // Written by a newer build: do not rewrite it with fewer fields. Hand it back untouched.
      return { profile: raw, migrated: false, repaired: false, newer: true };
    }
    if (raw.schema !== SAVE_SCHEMA) migrated = true;
    if (typeof raw.id === 'string') p.id = raw.id;
    if (isNum(raw.createdAt)) p.createdAt = raw.createdAt;
    if (isNum(raw.updatedAt)) p.updatedAt = raw.updatedAt;
    if (isObj(raw.settings)) p.settings = raw.settings;
    else if (raw.settings != null) repaired = true;
    if (raw.run != null) {
      p.run = cleanRun(raw.run);
      if (!p.run) repaired = true;
    }
    // chapters (schema 2 / 3; a schema-2 record gains an empty `sections` per difficulty) or a flat schema-1 shape
    const chaptersIn = isObj(raw.chapters) ? raw.chapters : isObj(raw.byDiff) ? { ch1: { byDiff: raw.byDiff } } : isObj(raw.records) ? { ch1: { byDiff: raw.records } } : null;
    if (chaptersIn) {
      for (const id of Object.keys(chaptersIn)) {
        const c = chaptersIn[id];
        if (!isObj(c)) {
          repaired = true;
          continue;
        }
        const ch = emptyChapter();
        ch.reached = c.reached !== false;
        ch.completed = !!c.completed;
        ch.completions = Math.floor(nonNeg(c.completions));
        ch.firstCompletedAt = isNum(c.firstCompletedAt) ? c.firstCompletedAt : null;
        ch.lastCompletedAt = isNum(c.lastCompletedAt) ? c.lastCompletedAt : null;
        if (isObj(c.byDiff)) for (const d of Object.keys(c.byDiff)) ch.byDiff[d] = cleanDiffRecord(c.byDiff[d]);
        else if (c.byDiff != null) repaired = true;
        p.chapters[id] = ch;
      }
    } else if (raw.chapters != null) repaired = true;
    if (isObj(raw.totals)) {
      const t = raw.totals;
      p.totals.runs = Math.floor(nonNeg(t.runs));
      p.totals.deaths = Math.floor(nonNeg(t.deaths));
      p.totals.playTime = nonNeg(t.playTime);
      p.totals.completions = Math.floor(nonNeg(t.completions));
      if (isObj(t.deathsByCause)) for (const k of Object.keys(t.deathsByCause)) if (isNum(t.deathsByCause[k]) && t.deathsByCause[k] >= 0) p.totals.deathsByCause[k] = Math.floor(t.deathsByCause[k]);
    }
  } else if (raw != null) repaired = true;

  if (legacy && legacy.any) {
    // today's Storage keys: copy in, keeping the better value where both exist
    const ch = p.chapters.ch1 || (p.chapters.ch1 = emptyChapter());
    for (const d of Object.keys(legacy.byDiff)) {
      ch.byDiff[d] = mergeDiffRecords(ch.byDiff[d], legacy.byDiff[d]);
      if (legacy.byDiff[d].completions > 0) ch.completed = true;
    }
    if (!p.settings && legacy.settings) p.settings = legacy.settings;
    if (!isObj(raw)) migrated = true;
    p.totals.completions = Math.max(p.totals.completions, sumCompletions(ch));
    p.totals.runs = Math.max(p.totals.runs, sumRuns(ch));
    if (ch.completions < sumCompletions(ch)) ch.completions = sumCompletions(ch);
  }
  if (!p.chapters.ch1) p.chapters.ch1 = emptyChapter();
  p.schema = SAVE_SCHEMA;
  return { profile: p, migrated, repaired, newer: false };
}

function sumCompletions(ch) {
  let n = 0;
  for (const d of Object.keys(ch.byDiff)) n += ch.byDiff[d].completions || 0;
  return n;
}
function sumRuns(ch) {
  let n = 0;
  for (const d of Object.keys(ch.byDiff)) n += ch.byDiff[d].runs || 0;
  return n;
}

// ------------------------------------------------------------------------------------------------------------
// Adapters: { name, read() -> Promise<record|null>, write(record) -> Promise<void> }
// ------------------------------------------------------------------------------------------------------------
export class MemoryAdapter {
  constructor(seed = null) {
    this.name = 'memory';
    this.record = seed;
    this.writes = 0;
    this.failNext = 0;
  }
  async read() {
    return this.record ? JSON.parse(JSON.stringify(this.record)) : null;
  }
  async write(rec) {
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error('memory adapter: injected failure');
    }
    this.record = JSON.parse(JSON.stringify(rec));
    this.writes++;
  }
}

export class LocalStorageAdapter {
  constructor(storage = null, key = LS_PROFILE_KEY) {
    this.name = 'localStorage';
    this.storage = storage;
    this.key = key;
  }
  _s() {
    if (this.storage) return this.storage;
    try {
      return typeof localStorage !== 'undefined' ? localStorage : null;
    } catch {
      return null;
    }
  }
  async read() {
    return this.readSync();
  }
  readSync() {
    const s = this._s();
    if (!s) return null;
    try {
      const raw = s.getItem(this.key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }
  async write(rec) {
    this.writeSync(rec);
  }
  writeSync(rec) {
    const s = this._s();
    if (!s) throw new Error('localStorage unavailable');
    s.setItem(this.key, JSON.stringify(rec));
  }
}

export class IndexedDBAdapter {
  constructor(factory = null) {
    this.name = 'indexedDB';
    this.factory = factory;
    this._dbPromise = null;
  }
  _idb() {
    if (this.factory) return this.factory;
    try {
      return typeof indexedDB !== 'undefined' ? indexedDB : null;
    } catch {
      return null;
    }
  }
  _open() {
    if (this._dbPromise) return this._dbPromise;
    this._dbPromise = new Promise((resolve, reject) => {
      const idb = this._idb();
      if (!idb) return reject(new Error('indexedDB unavailable'));
      let req;
      try {
        req = idb.open(DB_NAME, DB_VERSION);
      } catch (err) {
        return reject(err);
      }
      req.onupgradeneeded = () => {
        const db = req.result;
        // v2: 'profile' (one record). 'ghosts' is created for E12 and stays empty until then.
        if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
        if (!db.objectStoreNames.contains('ghosts')) db.createObjectStore('ghosts');
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => {
          db.close();
          this._dbPromise = null;
        };
        resolve(db);
      };
      req.onerror = () => reject(req.error || new Error('indexedDB open failed'));
      req.onblocked = () => reject(new Error('indexedDB open blocked'));
    });
    this._dbPromise.catch(() => {
      this._dbPromise = null;
    });
    return this._dbPromise;
  }
  async read() {
    const db = await this._open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readonly');
      const rq = tx.objectStore(DB_STORE).get(DB_KEY);
      rq.onsuccess = () => resolve(rq.result == null ? null : rq.result);
      rq.onerror = () => reject(rq.error || new Error('indexedDB read failed'));
    });
  }
  async write(rec) {
    const db = await this._open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).put(rec, DB_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('indexedDB write failed'));
      tx.onabort = () => reject(tx.error || new Error('indexedDB write aborted'));
    });
  }
  close() {
    if (!this._dbPromise) return;
    this._dbPromise.then((db) => db.close()).catch(() => {});
    this._dbPromise = null;
  }
}

// ------------------------------------------------------------------------------------------------------------
// SaveStore
// ------------------------------------------------------------------------------------------------------------
export class SaveStore {
  /**
   * @param {object} [o]
   * @param {object} [o.primary]    adapter (default IndexedDBAdapter)
   * @param {object} [o.secondary]  adapter (default LocalStorageAdapter): written synchronously on flush(sync)
   * @param {Function} [o.legacyGetItem]  (key)=>string|null for today's v1 keys (default: localStorage)
   * @param {Function} [o.now]
   * @param {number} [o.debounceMs]
   */
  constructor({ primary = undefined, secondary = undefined, legacyGetItem = undefined, now = () => Date.now(), debounceMs = DEBOUNCE_MS } = {}) {
    this.primary = primary === undefined ? new IndexedDBAdapter() : primary;
    this.secondary = secondary === undefined ? new LocalStorageAdapter() : secondary;
    this.legacyGetItem = legacyGetItem === undefined ? defaultLegacyGetItem() : legacyGetItem;
    this.now = now;
    this.debounceMs = debounceMs;
    this.profile = defaultProfile(now());
    this.loaded = false;
    this.info = { source: 'fresh', migrated: false, repaired: false, newer: false, primaryOk: null, errors: 0 };
    this._h = Object.create(null);
    this._timer = null;
    this._dirty = false;
    this._writing = null;
    this._readOnly = false; // a newer schema's profile is never overwritten
  }

  on(type, fn) {
    (this._h[type] || (this._h[type] = [])).push(fn);
    return () => this.off(type, fn);
  }
  off(type, fn) {
    const l = this._h[type];
    if (!l) return;
    const i = l.indexOf(fn);
    if (i >= 0) l.splice(i, 1);
  }
  _emit(type, payload = {}) {
    const l = this._h[type];
    if (!l) return;
    for (const fn of l.slice()) {
      try {
        fn(payload, type);
      } catch {
        /* a listener must not break the store */
      }
    }
  }

  /** Reads both adapters, keeps the newest, migrates, and imports today's keys. Never rejects. */
  async load() {
    let a = null;
    let b = null;
    if (this.primary) {
      try {
        a = await this.primary.read();
        this.info.primaryOk = true;
      } catch {
        this.info.primaryOk = false;
        this.info.errors++;
      }
    }
    if (this.secondary) {
      try {
        b = await this.secondary.read();
      } catch {
        this.info.errors++;
      }
    }
    const ts = (r) => (isObj(r) && isNum(r.updatedAt) ? r.updatedAt : -1);
    let raw = null;
    let source = 'fresh';
    if (a && b) {
      raw = ts(b) > ts(a) ? b : a;
      source = raw === a ? this.primary.name : this.secondary.name;
    } else if (a || b) {
      raw = a || b;
      source = a ? this.primary.name : this.secondary.name;
    }
    let legacy = null;
    try {
      legacy = this.legacyGetItem ? importLegacy(this.legacyGetItem) : null;
    } catch {
      legacy = null;
    }
    const res = migrateProfile(raw, legacy, this.now());
    this.profile = res.profile;
    this.info.source = raw ? source : legacy && legacy.any ? 'legacy' : 'fresh';
    this.info.migrated = res.migrated;
    this.info.repaired = res.repaired;
    this.info.newer = res.newer;
    this._readOnly = res.newer;
    this.loaded = true;
    this._emit('save:loaded', { source: this.info.source, migrated: res.migrated, repaired: res.repaired });
    if ((res.migrated || res.repaired || !raw) && !this._readOnly) this._schedule(0);
    return this.profile;
  }

  /** Applies fn(profile) and schedules a write. fn may return false to signal "no change". */
  update(fn, reason = 'update') {
    if (this._readOnly) return false;
    let changed;
    try {
      changed = fn(this.profile);
    } catch (err) {
      this.info.errors++;
      this._emit('save:error', { message: String((err && err.message) || err) });
      return false;
    }
    if (changed === false) return false;
    this.profile.updatedAt = this.now();
    this._schedule(this.debounceMs);
    this._emit('save:changed', { reason });
    return true;
  }

  _schedule(ms) {
    this._dirty = true;
    if (this._timer) return;
    this._timer = setTimeout(() => {
      this._timer = null;
      this.flush();
    }, ms);
    if (this._timer && typeof this._timer.unref === 'function') this._timer.unref();
  }

  /**
   * Writes now. `sync` (pagehide / freeze) also writes the localStorage copy before returning, because an
   * IndexedDB transaction started in a dying page may never finish.
   * @returns {Promise<boolean>} true when at least one adapter stored it
   */
  async flush({ sync = false } = {}) {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    if (!this._dirty || this._readOnly) return false;
    this._dirty = false;
    const rec = JSON.parse(JSON.stringify(this.profile));
    let ok = false;
    let adapter = null;
    // the safety copy first (synchronous when the adapter supports it)
    if (this.secondary) {
      try {
        if (typeof this.secondary.writeSync === 'function') this.secondary.writeSync(rec);
        else await this.secondary.write(rec);
        ok = true;
        adapter = this.secondary.name;
      } catch {
        this.info.errors++;
      }
    }
    if (this.primary && !sync) {
      const prev = this._writing || Promise.resolve();
      this._writing = prev.then(async () => {
        try {
          await this.primary.write(rec);
          ok = true;
          adapter = this.primary.name;
          this.info.primaryOk = true;
        } catch (err) {
          this.info.primaryOk = false;
          this.info.errors++;
          this._emit('save:error', { message: String((err && err.message) || err), adapter: this.primary.name });
        }
      });
      await this._writing;
    } else if (this.primary && sync) {
      // fire and forget: best effort
      this.primary.write(rec).catch(() => {});
    }
    if (ok) this._emit('save:written', { adapter, bytes: JSON.stringify(rec).length });
    else this._emit('save:error', { message: 'no adapter could store the profile' });
    return ok;
  }

  // ---- reads --------------------------------------------------------------------------------------------------
  chapter(id = 'ch1') {
    return this.profile.chapters[id] || null;
  }
  records(diff, chapter = 'ch1') {
    const ch = this.chapter(chapter);
    const r = ch && ch.byDiff[diff];
    return r ? Object.assign({}, r, { sections: cleanSections(r.sections) }) : emptyDiffRecord();
  }
  _diff(diff, chapter = 'ch1') {
    const ch = this.profile.chapters[chapter] || (this.profile.chapters[chapter] = emptyChapter());
    return ch.byDiff[diff] || (ch.byDiff[diff] = emptyDiffRecord());
  }

  // ---- writes (each is one update(), i.e. one debounced write) ---------------------------------------------------
  recordSettings(settings) {
    return this.update((p) => {
      if (!isObj(settings)) return false;
      const next = {};
      for (const k of Object.keys(settings)) {
        const v = settings[k];
        if (typeof v === 'number' ? isFinite(v) : typeof v === 'boolean' || typeof v === 'string') next[k] = v;
      }
      if (JSON.stringify(next) === JSON.stringify(p.settings)) return false;
      p.settings = next;
      return true;
    }, 'settings');
  }

  /** A run begins: counts it, and replaces the continue slot with the start of this run. */
  runStarted({ difficulty, checkpoint, section = 0, savesRun = true }) {
    return this.update((p) => {
      const rec = this._diff(difficulty);
      rec.runs++;
      p.totals.runs++;
      const ch = this.chapter();
      if (ch) ch.reached = true;
      p.run = savesRun ? cleanRun({ chapter: 'ch1', difficulty, checkpoint, section, time: 0, deaths: 0, deepest: checkpoint.y, savedAt: this.now(), kind: 'start' }) : null;
      return true;
    }, 'run:start');
  }

  /** A checkpoint was reached (or progress worth keeping): the Continue point. */
  checkpointReached({ difficulty, checkpoint, section, time, deaths, deepest, objectives }) {
    return this.update((p) => {
      const run = cleanRun({ chapter: 'ch1', difficulty, checkpoint, section, time, deaths, deepest, objectives, savedAt: this.now(), kind: 'checkpoint' });
      if (!run) return false;
      p.run = run;
      return true;
    }, 'checkpoint');
  }

  /** Time and death counters of the live run, saved with the checkpoint (cheap, same debounced write). */
  runProgress({ time, deaths, deepest }) {
    return this.update((p) => {
      if (!p.run) return false;
      p.run.time = nonNeg(time, p.run.time);
      p.run.deaths = Math.floor(nonNeg(deaths, p.run.deaths));
      if (isNum(deepest) && deepest < p.run.deepest) p.run.deepest = deepest;
      p.run.savedAt = this.now();
      return true;
    }, 'progress');
  }

  /** An objective was done (a seal opened): the Continue slot keeps the run's list (LEVEL_FUN_PLAN P1). */
  runObjectives(objectives) {
    return this.update((p) => {
      if (!p.run) return false;
      const o = cleanObjectives(objectives);
      if (o.objectives) p.run.objectives = o.objectives;
      else delete p.run.objectives;
      p.run.savedAt = this.now();
      return true;
    }, 'progress');
  }

  /**
   * A section was played whole in one run (bus 'split', sim/splits3d.js): keeps the faster split and the better medal.
   * Returns { best, previous, isNew } (isNew: this split is the new best).
   */
  sectionSplit({ difficulty, section, time, medal = null }) {
    const res = { best: null, previous: null, isNew: false };
    if (!difficulty || typeof section !== 'string' || !SECTION_ID.test(section) || !posNum(time)) return res;
    this.update(() => {
      const rec = this._diff(difficulty);
      if (!isObj(rec.sections)) rec.sections = {};
      const cur = rec.sections[section] || { best: null, medal: null };
      res.previous = cur.best;
      const m = MEDALS.indexOf(medal) >= 0 ? medal : null;
      const best = cur.best && cur.best <= time ? cur.best : time;
      res.isNew = best === time && cur.best !== time;
      res.best = best;
      rec.sections[section] = { best, medal: medalRank(m) > medalRank(cur.medal) ? m : cur.medal };
      return true;
    }, 'split');
    return res;
  }

  /** The best splits and medals of one difficulty: { <section id>: { best, medal } } (a copy). */
  sectionRecords(diff, chapter = 'ch1') {
    const ch = this.chapter(chapter);
    const r = ch && ch.byDiff[diff];
    return r && isObj(r.sections) ? cleanSections(r.sections) : {};
  }

  deathRecorded({ cause, difficulty, deepestMeters }) {
    return this.update((p) => {
      p.totals.deaths++;
      const k = typeof cause === 'string' ? cause : 'impact';
      p.totals.deathsByCause[k] = (p.totals.deathsByCause[k] || 0) + 1;
      if (isNum(deepestMeters) && difficulty) {
        const rec = this._diff(difficulty);
        if (deepestMeters > rec.deepest) rec.deepest = deepestMeters;
      }
      return true;
    }, 'death');
  }

  depthReached(difficulty, meters) {
    return this.update(() => {
      if (!isNum(meters) || !difficulty) return false;
      const rec = this._diff(difficulty);
      if (meters <= rec.deepest) return false;
      rec.deepest = meters;
      return true;
    }, 'depth');
  }

  /** The goal was reached. `recorded` is false in Sandbox (no records). */
  completed({ difficulty, time, deaths, deepestMeters, recorded = true }) {
    return this.update((p) => {
      const rec = this._diff(difficulty);
      rec.lastTime = posNum(time);
      rec.lastDeaths = Math.floor(nonNeg(deaths));
      if (isNum(deepestMeters) && deepestMeters > rec.deepest) rec.deepest = deepestMeters;
      if (recorded) {
        rec.completions++;
        if (posNum(time) && (rec.best == null || time < rec.best)) rec.best = time;
        if (rec.fewestDeaths == null || deaths < rec.fewestDeaths) rec.fewestDeaths = Math.floor(nonNeg(deaths));
        const ch = this.chapter();
        ch.completed = true;
        ch.completions++;
        const t = this.now();
        if (!ch.firstCompletedAt) ch.firstCompletedAt = t;
        ch.lastCompletedAt = t;
        p.totals.completions++;
      }
      p.run = null; // a finished run has nothing to continue
      return true;
    }, 'complete');
  }

  /** Adds play time of an abandoned / interrupted run (seconds). */
  playTimeAdded(seconds) {
    return this.update((p) => {
      if (!isNum(seconds) || seconds <= 0) return false;
      p.totals.playTime += seconds;
      return true;
    }, 'playtime');
  }

  clearRun() {
    return this.update((p) => {
      if (!p.run) return false;
      p.run = null;
      return true;
    }, 'run:clear');
  }

  /** Test / settings-screen reset: wipes everything but the profile id. */
  reset() {
    return this.update((p) => {
      const fresh = defaultProfile(this.now());
      for (const k of Object.keys(p)) delete p[k];
      Object.assign(p, fresh, { id: fresh.id });
      return true;
    }, 'reset');
  }

  close() {
    if (this._timer) clearTimeout(this._timer);
    this._timer = null;
    if (this.primary && typeof this.primary.close === 'function') this.primary.close();
  }
}

function defaultLegacyGetItem() {
  try {
    if (typeof localStorage === 'undefined') return null;
    return (k) => localStorage.getItem(k);
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------------------------------------------------
// Game wiring
// ------------------------------------------------------------------------------------------------------------
/** The v1 keys config3d.js Storage writes (the UI still reads them): kept in step with the profile. */
export function mirrorToLegacy(profile, storage) {
  if (!storage) return 0;
  let n = 0;
  const set = (k, v) => {
    try {
      storage.setItem(V1_PREFIX + k, JSON.stringify(v));
      n++;
    } catch {
      /* quota */
    }
  };
  const get = (k) => {
    try {
      const raw = storage.getItem(V1_PREFIX + k);
      return raw == null ? undefined : JSON.parse(raw);
    } catch {
      return undefined;
    }
  };
  const ch = profile.chapters && profile.chapters.ch1;
  if (!ch) return 0;
  for (const d of Object.keys(ch.byDiff)) {
    const r = ch.byDiff[d];
    const best = get(`best.${d}`);
    if (r.best && !(isNum(best) && best > 0 && best <= r.best)) set(`best.${d}`, r.best);
    const fewest = get(`fewestDeaths.${d}`);
    if (r.fewestDeaths != null && !(isNum(fewest) && fewest <= r.fewestDeaths)) set(`fewestDeaths.${d}`, r.fewestDeaths);
    const deepest = get(`deepest.${d}`);
    if (r.deepest > 0 && !(isNum(deepest) && deepest >= r.deepest)) set(`deepest.${d}`, r.deepest);
    const runs = get(`runs.${d}`);
    if (r.runs > 0 && !(isNum(runs) && runs >= r.runs)) set(`runs.${d}`, r.runs);
    const comps = get(`completions.${d}`);
    if (r.completions > 0 && !(isNum(comps) && comps >= r.completions)) set(`completions.${d}`, r.completions);
  }
  return n;
}

/**
 * Binds a SaveStore to a Game3D: restores v1 keys from the profile, then follows the game's bus events.
 * Everything is try/catch-guarded: saving can never break play.
 */
export class SaveService {
  constructor(game, { store = null, legacyStorage = undefined } = {}) {
    this.game = game;
    this.store = store || new SaveStore();
    this.legacyStorage = legacyStorage === undefined ? safeLocalStorage() : legacyStorage;
    this._offs = [];
    this.ready = false;
    this._counted = 0; // seconds of the live run already added to totals.playTime
  }

  /** Adds the play time since the last call (run clock deltas; never double counts). */
  _countTime() {
    const t = this.game.time;
    if (t > this._counted) this.store.playTimeAdded(t - this._counted);
    this._counted = t;
  }

  async init() {
    const g = this.game;
    await this.store.load();
    const bus = g.bus;
    const fwd = (t) => this._offs.push(this.store.on(t, (p) => bus.emit(t, p)));
    ['save:loaded', 'save:changed', 'save:written', 'save:error'].forEach(fwd);
    // v1 keys <- profile (e.g. localStorage was cleared but IndexedDB survived)
    mirrorToLegacy(this.store.profile, this.legacyStorage);
    this._wire(bus);
    this.ready = true;
    bus.emit('continue:changed', { available: !!this.continueInfo(), info: this.continueInfo() });
    return this;
  }

  /** Persisted settings (profile copy), or null. Newer of profile / v1 is the caller's choice; the game keeps v1. */
  savedSettings() {
    return this.store.profile.settings;
  }

  records(diff) {
    return this.store.records(diff);
  }
  sectionRecords(diff) {
    return this.store.sectionRecords(diff);
  }
  chapter(id = 'ch1') {
    return this.store.chapter(id);
  }
  get profile() {
    return this.store.profile;
  }
  flush(opts) {
    return this.store.flush(opts);
  }

  /** The Continue slot, shaped for the menu; null when there is nothing to continue. */
  continueInfo() {
    const run = this.store.profile.run;
    if (!run || run.chapter !== 'ch1') return null;
    if (run.kind === 'start' && !(run.time > 0)) return null; // a run that never left the start has nothing to continue
    const diff = DIFFICULTY[run.difficulty];
    return {
      chapter: run.chapter,
      difficulty: run.difficulty,
      label: (diff && diff.label) || run.difficulty,
      section: run.section,
      sectionName: this._sectionName(run.section),
      checkpoint: Object.assign({}, run.checkpoint),
      time: run.time,
      deaths: run.deaths,
      depthMeters: Math.max(0, Math.round(-run.deepest)),
      savedAt: run.savedAt,
      objectives: Array.isArray(run.objectives) ? run.objectives.slice() : [],
    };
  }

  _sectionName(i) {
    try {
      const lvl = this.game.level;
      const s = lvl && lvl.sections && lvl.sections[i];
      return s && s.name ? s.name : null;
    } catch {
      return null;
    }
  }

  _wire(bus) {
    const g = this.game;
    const on = (t, fn) =>
      this._offs.push(
        bus.on(t, (e) => {
          try {
            fn(e || {});
          } catch (err) {
            g._fault && g._fault('save', err);
          }
        }),
      );
    const saves = () => !!(g.diff && g.diff.checkpoints !== 'none' && g.diff.recordTimes !== false);
    on('game:start', (e) => {
      if (g._continuing) {
        this._counted = g._continuing.time || 0;
        return; // Continue re-enters the saved run: keep its slot, count no new run
      }
      const cp = g.checkpoint;
      this._counted = 0;
      this.store.runStarted({ difficulty: e.difficulty || g.difficultyKey, checkpoint: cp, section: Math.max(0, g.sectionIndex), savesRun: saves() });
    });
    on('checkpoint', () => {
      this._countTime();
      if (!saves()) return;
      this.store.checkpointReached({ difficulty: g.difficultyKey, checkpoint: g.checkpoint, section: g.sectionIndex, time: g.time, deaths: g.deaths, deepest: g.deepest, objectives: g.objectives ? g.objectives.serialize() : null });
    });
    on('objective:done', () => {
      if (saves() && g.objectives) this.store.runObjectives(g.objectives.serialize());
    });
    // LEVEL_FUN_PLAN P3: the ratchet survives a Continue too (lamps lit, haul notches: sim/objectives3d.js serialize)
    on('objective:progress', () => {
      if (saves() && g.objectives) this.store.runObjectives(g.objectives.serialize());
    });
    // a section played whole in this run (game.js / sim/splits3d.js): best split and medal per section (schema 3)
    on('split', (e) => {
      if (e.recorded) this.store.sectionSplit({ difficulty: e.difficulty || g.difficultyKey, section: e.section, time: e.time, medal: e.medal });
    });
    on('game:continue', (e) => {
      // a continued run is the same run: keep its slot, count nothing new
      this._counted = (e.info && e.info.time) || 0;
      this.store.update((p) => {
        if (p.run) p.run.savedAt = this.store.now();
        return true;
      }, 'continue');
    });
    on('player:death', (e) => {
      this._countTime();
      this.store.deathRecorded({ cause: e.cause, difficulty: g.difficultyKey, deepestMeters: Math.max(0, Math.round(-g.deepest)), time: g.time });
      if (saves()) this.store.runProgress({ time: g.time, deaths: g.deaths, deepest: g.deepest });
    });
    on('game:victory', (e) => {
      this._countTime();
      this.store.completed({ difficulty: e.difficultyKey || g.difficultyKey, time: e.time, deaths: e.deaths, deepestMeters: e.deepestMeters, recorded: e.recorded !== false });
      this.store.flush();
    });
    on('settings:changed', (e) => {
      if (e.settings) this.store.recordSettings(e.settings);
    });
    on('game:pause', () => {
      this._countTime();
      if (saves() && g._runActive && g._runActive()) this.store.runProgress({ time: g.time, deaths: g.deaths, deepest: g.deepest });
      this.store.flush();
    });
    on('game:menu', () => {
      this.store.flush();
    });
    // continue slot changes -> one event for the menu
    this._offs.push(
      this.store.on('save:changed', (p) => {
        if (/^(run:|checkpoint|death|complete|continue|reset)/.test(p.reason)) bus.emit('continue:changed', { available: !!this.continueInfo(), info: this.continueInfo() });
      }),
    );
    // lifecycle: a dying page must not lose the checkpoint
    if (typeof document !== 'undefined') {
      const hide = () => {
        if (saves() && g._runActive && g._runActive()) this.store.runProgress({ time: g.time, deaths: g.deaths, deepest: g.deepest });
        this.store.flush({ sync: true });
      };
      const vis = () => {
        if (document.hidden) hide();
      };
      document.addEventListener('visibilitychange', vis);
      window.addEventListener('pagehide', hide);
      document.addEventListener('freeze', hide);
      this._offs.push(() => {
        document.removeEventListener('visibilitychange', vis);
        window.removeEventListener('pagehide', hide);
        document.removeEventListener('freeze', hide);
      });
    }
  }

  dispose() {
    for (const off of this._offs.splice(0)) {
      try {
        off();
      } catch {
        /* ignore */
      }
    }
    this.store.flush({ sync: true });
    this.store.close();
  }
}

function safeLocalStorage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/** Stand-in used when this module could not load: Continue is simply never offered. */
export function nullSave() {
  return {
    isNull: true,
    ready: false,
    profile: null,
    continueInfo: () => null,
    records: () => emptyDiffRecord(),
    sectionRecords: () => ({}),
    chapter: () => null,
    savedSettings: () => null,
    flush: () => Promise.resolve(false),
    dispose() {},
  };
}
