/* ABYSSAL TETHER 3D — platform/loadProfile.js
 * The loading profile (docs/abyssal-tether-3d/plans/LOADING_OPTIMIZATION.md): `?loadprof=1` only. Times the boot phases, the
 * level build, the dressing job, the GLB / texture arrivals, the shader precompiles and every frame's main-thread cost, counts the
 * long tasks and samples the JS heap, all into window.AT3D.loadProfile (report() gives the compact table the profile script reads).
 * Without the flag nothing here runs: lpWrap / lpMark are no-ops and no observer is installed.
 *
 * Method timers wrap INSTANCE methods from the outside (lpWrap(obj, names, prefix)): the profiled modules need no code of their own.
 */

export const LOADPROF_ON = typeof location !== 'undefined' && /[?&]loadprof=1\b/.test(location.search || '');

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function heapMB() {
  const m = typeof performance !== 'undefined' && performance.memory;
  return m && m.usedJSHeapSize ? +(m.usedJSHeapSize / 1048576).toFixed(1) : null;
}

/** The live profile (window.AT3D.loadProfile). */
export const PROFILE = {
  on: LOADPROF_ON,
  marks: {}, // name -> ms since navigation start (first occurrence)
  heap: {}, // name -> MB at that mark
  methods: {}, // 'prefix.name' -> { n, total, max, first }
  longtasks: { n: 0, total: 0, max: 0, list: [] },
  frames: { n: 0, total: 0, max: 0, over12: 0, over33: 0, hist: [] },
  windows: {}, // label -> { from, until, n, max, total, over12, over33 }
  slow: [], // [method, start ms, ms] of every timed call over 40 ms
  _open: [],
  report,
  window: openWindow,
};

/** A named phase boundary (performance.mark + the time since navigation start + the heap). */
export function lpMark(name) {
  if (!LOADPROF_ON) return;
  const t = now();
  try {
    performance.mark('at3d:' + name);
  } catch {
    /* no user timing */
  }
  if (!(name in PROFILE.marks)) {
    PROFILE.marks[name] = +t.toFixed(1);
    PROFILE.heap[name] = heapMB();
  }
}

function record(key, ms) {
  const m = PROFILE.methods[key] || (PROFILE.methods[key] = { n: 0, total: 0, max: 0, first: +now().toFixed(1) });
  m.n++;
  m.total += ms;
  if (ms > m.max) m.max = ms;
  if (ms > 40 && PROFILE.slow.length < 600) PROFILE.slow.push([key, +(now() - ms).toFixed(0), +ms.toFixed(0)]); // [what, start, ms]
}

/** Times obj[name] (each of names) into PROFILE.methods[prefix + '.' + name]; a returned promise is timed to its settlement too. */
export function lpWrap(obj, names, prefix) {
  if (!LOADPROF_ON || !obj) return;
  for (const name of names) {
    const fn = obj[name];
    if (typeof fn !== 'function' || fn.__lp) continue;
    const key = `${prefix}.${name}`;
    const w = function (...args) {
      const t0 = now();
      let out;
      try {
        out = fn.apply(this, args);
      } finally {
        record(key, now() - t0);
      }
      if (out && typeof out.then === 'function') {
        Promise.resolve(out).then(
          () => record(key + '~async', now() - t0),
          () => record(key + '~async', now() - t0),
        );
      }
      return out;
    };
    w.__lp = true;
    obj[name] = w;
  }
}

/** Every frame's main-thread cost (the game's frame callback), and into each open window. */
export function lpFrame(ms) {
  if (!LOADPROF_ON) return;
  const F = PROFILE.frames;
  F.n++;
  F.total += ms;
  if (ms > F.max) F.max = ms;
  if (ms > 12) F.over12++;
  if (ms > 33) F.over33++;
  const t = now();
  for (const w of PROFILE._open) {
    if (t > w.until) continue;
    w.n++;
    w.total += ms;
    if (ms > w.max) w.max = ms;
    if (ms > 12) w.over12++;
    if (ms > 33) w.over33++;
  }
}

/** Opens a measuring window: the frames of the next `ms` milliseconds (the longest frame after a section warp, after Start). */
function openWindow(label, ms) {
  const t = now();
  const w = { label, from: +t.toFixed(1), until: t + ms, n: 0, total: 0, max: 0, over12: 0, over33: 0, lt: PROFILE.longtasks.n };
  PROFILE.windows[label] = w;
  PROFILE._open.push(w);
  return w;
}

function round(o) {
  const out = {};
  for (const k of Object.keys(o)) out[k] = typeof o[k] === 'number' ? +o[k].toFixed(1) : o[k];
  return out;
}

/** The compact profile: phase marks, the 40 costliest methods, long tasks, frames, windows, GLB / texture / module resources. */
function report() {
  const methods = Object.entries(PROFILE.methods)
    .map(([k, v]) => [k, round(v)])
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 40);
  const res = { js: { n: 0, kb: 0, maxEnd: 0 }, glb: [], ktx2: { n: 0, kb: 0, maxEnd: 0 }, other: { n: 0, kb: 0 } };
  try {
    for (const e of performance.getEntriesByType('resource')) {
      const kb = (e.encodedBodySize || e.transferSize || 0) / 1024;
      const n = e.name || '';
      if (/\.m?js(\?|$)/.test(n)) {
        res.js.n++;
        res.js.kb += kb;
        res.js.maxEnd = Math.max(res.js.maxEnd, e.responseEnd);
      } else if (/\.glb(\?|$)/.test(n)) res.glb.push({ f: n.split('/').pop(), start: +e.startTime.toFixed(0), end: +e.responseEnd.toFixed(0), kb: +kb.toFixed(0) });
      else if (/\.ktx2(\?|$)/.test(n)) {
        res.ktx2.n++;
        res.ktx2.kb += kb;
        res.ktx2.maxEnd = Math.max(res.ktx2.maxEnd, e.responseEnd);
      } else {
        res.other.n++;
        res.other.kb += kb;
      }
    }
  } catch {
    /* no resource timing */
  }
  res.js = round(res.js);
  res.ktx2 = round(res.ktx2);
  res.other = round(res.other);
  const lt = PROFILE.longtasks;
  const windows = {};
  for (const [k, w] of Object.entries(PROFILE.windows)) windows[k] = round({ n: w.n, max: w.max, mean: w.n ? w.total / w.n : 0, over12: w.over12, over33: w.over33, longtasks: lt.n - w.lt });
  return {
    marks: PROFILE.marks,
    heap: Object.assign({}, PROFILE.heap, { now: heapMB() }),
    methods,
    longtasks: round({ n: lt.n, total: lt.total, max: lt.max }),
    frames: round({ n: PROFILE.frames.n, max: PROFILE.frames.max, mean: PROFILE.frames.n ? PROFILE.frames.total / PROFILE.frames.n : 0, over12: PROFILE.frames.over12, over33: PROFILE.frames.over33 }),
    windows,
    slow: PROFILE.slow,
    resources: res,
  };
}

const GAME_METHODS = ['_loadModules', '_enterAttract', '_loadTextureManifest', '_ensureLevelView', '_setupHandsView', '_setupHealthFx', '_setupBodyView', '_setupBagViews', '_setupDresserView', '_setupHoldfastView', '_setupComms', '_loadCreatureKit', '_precompile', '_buildWorld', '_updateViews', '_render', '_updateRun', '_enterSection'];
const RENDERER_METHODS = ['buildLevel', 'precompile', 'applyTextures', 'render', 'update'];
const LEVELVIEW_METHODS = ['build', '_buildSolids', '_buildHazards', '_buildAnchors', '_buildDecor', '_mergeBands', '_packBands', '_mergeLodRecs', '_buildDressing', '_buildColossal', '_buildLightGlows', '_pumpDressing', '_flushDressing', '_flushDecals', '_emitKitPlan', '_collideDecor', '_buildCogs', '_buildLinks', 'setKit', 'setProps', '_rebuildFar', 'update', 'finishDressing'];

/** Game3D hooks (bootMinimal): its boot / frame methods, the frame cost of every loop callback, windows after Start and each warp. */
export function lpAttachGame(game) {
  if (!LOADPROF_ON || !game) return;
  lpInstall();
  lpMark('bootMinimal');
  lpWrap(game, GAME_METHODS, 'game');
  const loop = game._loop;
  if (typeof loop === 'function' && !loop.__lp) {
    game._loop = function (time, frame) {
      const t0 = now();
      try {
        return loop.call(this, time, frame);
      } finally {
        lpFrame(now() - t0);
      }
    };
    game._loop.__lp = true;
  }
  for (const [name, label] of [
    ['start', 'start'],
    ['_warp', 'warp'],
  ]) {
    const fn = game[name];
    if (typeof fn !== 'function') continue;
    game[name] = function (...args) {
      const t0 = now();
      const out = fn.apply(this, args);
      record(`game.${name}`, now() - t0);
      openWindow(label === 'warp' ? `warp${args[0] | 0}` : label, label === 'warp' ? 2000 : 3000);
      lpMark(label === 'warp' ? `warp${args[0] | 0}` : 'start');
      return out;
    };
  }
}

/** Renderer3D + LevelView hooks (after the renderer exists): the level build, the dressing job, the asset arrivals. */
export function lpAttachRenderer(game) {
  if (!LOADPROF_ON || !game || !game.renderer) return;
  const r = game.renderer;
  lpWrap(r, RENDERER_METHODS, 'r3d');
  if (r.lighting) lpWrap(r.lighting, ['setLevel', 'loadGI', 'sweep'], 'lighting');
  const lv = r.levelView;
  if (lv) {
    lpWrap(lv, LEVELVIEW_METHODS, 'lv');
    if (lv._boards) lpWrap(lv._boards, ['build', 'update'], 'boards');
    for (const [name, mark] of [
      ['setKit', 'envKit'],
      ['setProps', 'props'],
    ]) {
      const fn = lv[name];
      lv[name] = function (...args) {
        lpMark(mark + 'Arrived');
        const out = fn.apply(this, args);
        lpMark(mark + 'Done');
        return out;
      };
    }
    const pump = lv._pumpDressing;
    lv._pumpDressing = function (ms) {
      const out = pump.call(this, ms);
      if (!this._dressJob) lpMark('dressingDone');
      return out;
    };
  }
  if (game.bus && typeof game.bus.on === 'function') {
    for (const ev of ['assets:kit', 'assets:rig', 'assets:skitterRig', 'game:boot']) game.bus.on(ev, () => lpMark(ev));
  }
}

/** Installs the long-task observer and exposes the profile (window.AT3D.loadProfile). Safe to call more than once. */
export function lpInstall() {
  if (!LOADPROF_ON || PROFILE._installed) return PROFILE;
  PROFILE._installed = true;
  try {
    if (typeof window !== 'undefined') {
      window.AT3D = window.AT3D || {};
      window.AT3D.loadProfile = PROFILE;
    }
  } catch {
    /* no window */
  }
  try {
    const po = new PerformanceObserver((list) => {
      const lt = PROFILE.longtasks;
      for (const e of list.getEntries()) {
        lt.n++;
        lt.total += e.duration;
        if (e.duration > lt.max) lt.max = e.duration;
        if (lt.list.length < 400) lt.list.push([+e.startTime.toFixed(0), +e.duration.toFixed(0)]);
      }
    });
    po.observe({ type: 'longtask', buffered: true });
  } catch {
    /* no long-task API (Firefox, Safari) */
  }
  return PROFILE;
}
