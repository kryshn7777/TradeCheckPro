// Deterministic wrapper around the REAL Player3D / TetherSystem / Physics3D.
// Mirrors how Game3D drives the simulation (CONTRACT3D §8): once per 60 Hz frame
// tethers.updateTargets + tethers.handleInput, then 4 fixed physics steps of
// 1/240 s (jumpPressed only on the first sub-step).
//
// Options (all off by default, so verify's route numbers are unchanged by them):
//   timers:   per-system wall-clock timers (E29), see SystemTimers below
//   creature: also run Creature3D + ThreatSystem3D once per frame after the physics,
//             like Game3D._updateRun (non-lethal: a catch is counted, not applied)
//   record:   keep the per-frame intent log for a replay (V13 determinism)
//
// The game is imported from the folder root.mjs resolves (this checkout, or --root).
import { srcUrl, GAME_ROOT } from './root.mjs';

const { CONFIG, DIFFICULTY, EventBus, SETTINGS_DEFAULTS } = await import(srcUrl('sim/config3d.js'));
const { Player3D, TetherSystem, Physics3D, HANDS } = await import(srcUrl('sim/physics3d.js'));
const { Level3D } = await import(srcUrl('sim/level3d.js'));
const { LEVEL_DATA_3D } = await import(srcUrl('data/level-data-3d.js'));
// LEVEL_FUN_PLAN P1: the section seals (absent in older checkouts given with --root: the sims then run without them).
const { Objectives3D } = await import(srcUrl('sim/objectives3d.js')).catch(() => ({ Objectives3D: null }));

// Experiments: AT3D_ROPE='flightSpeed=80,attachRamp=0.15' overrides CONFIG.rope keys for this process.
if (typeof process !== 'undefined' && process.env && process.env.AT3D_ROPE) {
  for (const kv of process.env.AT3D_ROPE.split(',')) {
    const [k, v] = kv.split('=');
    if (k in CONFIG.rope && isFinite(Number(v))) CONFIG.rope[k] = Number(v);
  }
}

export { CONFIG, DIFFICULTY, EventBus, Player3D, TetherSystem, Physics3D, HANDS, Level3D, LEVEL_DATA_3D, GAME_ROOT, Objectives3D };

export const FRAME = 1 / 60;
export const SUB = 4;
export const DT = CONFIG.PHYSICS_DT;

/** Creature3D / ThreatSystem3D, imported on first use (only the budget / full-stack runs need them). */
let creatureMods = null;
export async function loadCreatureModules() {
  if (!creatureMods) {
    const [c, t] = await Promise.all([import(srcUrl('sim/creature3d.js')), import(srcUrl('sim/threat3d.js'))]);
    creatureMods = { Creature3D: c.Creature3D, ThreatSystem3D: t.ThreatSystem3D };
  }
  return creatureMods;
}

function makeHandIntent() {
  return { aim: null, pressed: false, held: false, released: false, yank: 0 };
}
export function makeIntent() {
  return {
    move: { x: 0, z: 0 },
    reel: 0,
    jumpPressed: false,
    brake: false,
    turnRate: 0,
    hands: { left: makeHandIntent(), right: makeHandIntent() },
    pausePressed: false,
    restartPressed: false,
    confirmPressed: false,
    backPressed: false,
    ui: { ray: null, click: false },
    // the lantern probe (LEVEL_FUN_PLAN P3, Objectives3D.setProbe): where the bot holds its lantern this frame
    probe: { on: false, x: 0, y: 0, z: 0 },
  };
}

const HAND_KEYS = ['target', 'held', 'buffer', 'extend', 'attachTime', 'lastAim', 'flying'];
const ROPE_KEYS = ['anchor', 'length', 'd', 'nx', 'ny', 'nz', 'tension', 'rampT', 'grip'];

// -----------------------------------------------------------------------------
// E29: per-system timers
// -----------------------------------------------------------------------------
/**
 * Systems timed per 60 Hz frame. `physics` is Physics3D.step minus its collision
 * pass and the rope step it calls at its end, so the rows add up to `total`.
 */
export const TIMED_SYSTEMS = ['targets', 'input', 'physics', 'collide', 'rope', 'objectives', 'creature', 'threat'];

/**
 * Wall-clock time per system per frame (ms), preallocated: one Float64Array row
 * per system, `capacity` frames. Look-ahead (ghost) frames are not timed; the first
 * `warmup` frames (JIT warm-up) are timed but not recorded.
 *
 * Whole-frame rows: `total` (wall clock), `cpu` (process CPU time over the same frame)
 * and `cost` = min(total, cpu) per frame. On a busy machine the wall clock also counts
 * the time the process sat descheduled, and the process CPU time also counts V8's
 * helper threads (concurrent GC); the smaller of the two is the frame's own cost, which
 * is what the budget gate reads.
 */
export class SystemTimers {
  constructor(capacity = 60 * 600, warmup = 300) {
    this.names = TIMED_SYSTEMS.concat(['total', 'cpu', 'cost']);
    this.capacity = capacity;
    this.warmup = warmup;
    this.skipped = 0;
    this.rows = this.names.map(() => new Float64Array(capacity));
    this.cur = new Float64Array(this.names.length);
    this.calls = new Float64Array(this.names.length);
    this.n = 0;
    this.overflow = 0;
    this.idx = {};
    this.names.forEach((k, i) => (this.idx[k] = i));
  }
  add(i, ms) {
    this.cur[i] += ms;
    this.calls[i]++;
  }
  endFrame(totalMs, cpuMs) {
    this.cur[this.idx.total] = totalMs;
    this.cur[this.idx.cpu] = cpuMs;
    this.cur[this.idx.cost] = Math.min(totalMs, cpuMs);
    if (this.skipped < this.warmup) {
      this.skipped++;
      this.calls.fill(0);
    } else if (this.n < this.capacity) {
      for (let i = 0; i < this.cur.length; i++) this.rows[i][this.n] = this.cur[i];
      this.n++;
    } else this.overflow++;
    this.cur.fill(0);
  }
  /** { system: { mean, p50, p95, p99, max } } in ms per frame, plus frames. */
  summary() {
    const out = { frames: this.n, warmupFrames: this.skipped, overflow: this.overflow, perFrameMs: {} };
    for (let i = 0; i < this.names.length; i++) {
      const a = Array.from(this.rows[i].subarray(0, this.n)).sort((x, y) => x - y);
      const q = (p) => (a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))] : 0);
      const sum = a.reduce((s, v) => s + v, 0);
      out.perFrameMs[this.names[i]] = {
        mean: +(a.length ? sum / a.length : 0).toFixed(4),
        p50: +q(0.5).toFixed(4),
        p95: +q(0.95).toFixed(4),
        p99: +q(0.99).toFixed(4),
        max: +(a.length ? a[a.length - 1] : 0).toFixed(4),
        callsPerFrame: +(this.n ? this.calls[i] / this.n : 0).toFixed(2),
      };
    }
    return out;
  }
}

const now = () => performance.now();

/** Instance-level timing wrappers (no source changes to the game; ghost frames pass straight through). */
function instrument(sim, timers) {
  const T = sim.tethers;
  const ph = sim.physics;
  const I = timers.idx;
  const wrap = (obj, name, slot) => {
    const orig = obj[name];
    obj[name] = function (...args) {
      if (sim.ghost) return orig.apply(this, args);
      const t0 = now();
      const r = orig.apply(this, args);
      timers.add(slot, now() - t0);
      return r;
    };
  };
  wrap(T, 'updateTargets', I.targets);
  wrap(T, 'handleInput', I.input);
  wrap(T, 'step', I.rope);
  wrap(ph, 'resolveCollisions', I.collide);
  if (sim.objectives) wrap(sim.objectives, 'step', I.objectives);
  // physics = step − collide − rope (both are called from inside step)
  const step = ph.step;
  ph.step = function (...args) {
    if (sim.ghost) return step.apply(this, args);
    const c0 = timers.cur[I.collide];
    const r0 = timers.cur[I.rope];
    const t0 = now();
    const r = step.apply(this, args);
    const inner = timers.cur[I.collide] - c0 + (timers.cur[I.rope] - r0);
    timers.add(I.physics, now() - t0 - inner);
    return r;
  };
}

// -----------------------------------------------------------------------------
// V13: intent log (record / replay) and trajectory hash
// -----------------------------------------------------------------------------
const AIM_W = 7; // has, ox, oy, oz, dx, dy, dz
const HAND_W = 4 + AIM_W; // pressed, held, released, yank, aim
const PROBE_W = 4; // on, x, y, z (the lantern probe, LEVEL_FUN_PLAN P3)
export const INTENT_W = 5 + 2 * HAND_W + PROBE_W; // move.x, move.z, reel, jump, brake, hands, probe

function writeIntent(buf, o, it) {
  buf[o] = it.move.x;
  buf[o + 1] = it.move.z;
  buf[o + 2] = it.reel;
  buf[o + 3] = it.jumpPressed ? 1 : 0;
  buf[o + 4] = it.brake ? 1 : 0;
  let k = o + 5;
  for (const h of HANDS) {
    const hi = it.hands[h];
    buf[k] = hi.pressed ? 1 : 0;
    buf[k + 1] = hi.held ? 1 : 0;
    buf[k + 2] = hi.released ? 1 : 0;
    buf[k + 3] = hi.yank || 0;
    const a = hi.aim;
    buf[k + 4] = a ? 1 : 0;
    if (a) {
      buf[k + 5] = a.ox;
      buf[k + 6] = a.oy;
      buf[k + 7] = a.oz;
      buf[k + 8] = a.dx;
      buf[k + 9] = a.dy;
      buf[k + 10] = a.dz;
    }
    k += HAND_W;
  }
  const pr = it.probe;
  buf[k] = pr && pr.on ? 1 : 0;
  buf[k + 1] = pr ? pr.x : 0;
  buf[k + 2] = pr ? pr.y : 0;
  buf[k + 3] = pr ? pr.z : 0;
}

/** Fills `it` (from makeIntent()) with logged frame `f`. */
export function readIntent(buf, f, it) {
  const o = f * INTENT_W;
  it.move.x = buf[o];
  it.move.z = buf[o + 1];
  it.reel = buf[o + 2];
  it.jumpPressed = buf[o + 3] === 1;
  it.brake = buf[o + 4] === 1;
  let k = o + 5;
  for (const h of HANDS) {
    const hi = it.hands[h];
    hi.pressed = buf[k] === 1;
    hi.held = buf[k + 1] === 1;
    hi.released = buf[k + 2] === 1;
    hi.yank = buf[k + 3];
    if (buf[k + 4] === 1) {
      if (!hi.aim) hi.aim = { ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: 0 };
      hi.aim.ox = buf[k + 5];
      hi.aim.oy = buf[k + 6];
      hi.aim.oz = buf[k + 7];
      hi.aim.dx = buf[k + 8];
      hi.aim.dy = buf[k + 9];
      hi.aim.dz = buf[k + 10];
    } else hi.aim = null;
    k += HAND_W;
  }
  if (!it.probe) it.probe = { on: false, x: 0, y: 0, z: 0 };
  it.probe.on = buf[k] === 1;
  it.probe.x = buf[k + 1];
  it.probe.y = buf[k + 2];
  it.probe.z = buf[k + 3];
  return it;
}

/** FNV-1a over the exact float64 bits of the player state, frame by frame. */
export class TrajectoryHash {
  constructor() {
    this.f64 = new Float64Array(7);
    this.u8 = new Uint8Array(this.f64.buffer);
    this.h = 0x811c9dc5;
    this.frames = 0;
  }
  add(p) {
    const f = this.f64;
    f[0] = p.x;
    f[1] = p.y;
    f[2] = p.z;
    f[3] = p.vx;
    f[4] = p.vy;
    f[5] = p.vz;
    f[6] = (p.alive ? 1 : 0) + (p.grounded ? 2 : 0);
    let h = this.h;
    const u = this.u8;
    for (let i = 0; i < u.length; i++) {
      h ^= u[i];
      h = Math.imul(h, 0x01000193);
    }
    this.h = h >>> 0;
    this.frames++;
  }
  get hex() {
    return this.h.toString(16).padStart(8, '0');
  }
}

// -----------------------------------------------------------------------------
export class Sim {
  constructor(level, diffKey, opts = {}) {
    this.level = level;
    this.diffKey = diffKey;
    this.diff = DIFFICULTY[diffKey];
    this.bus = new EventBus();
    this.settings = Object.assign({}, SETTINGS_DEFAULTS, opts.settings || {});
    this.player = new Player3D(0, 0, 0);
    this.tethers = new TetherSystem(level, this.diff, this.bus, this.settings);
    this.physics = new Physics3D(level, this.diff, this.bus);
    this.ghost = false; // true during look-ahead: listeners ignore events
    this.t = 0;
    this.maxLand = 0;
    this.maxLandAt = null;
    this.deaths = 0;
    this.deathCause = null;
    this.attaches = [];
    this.events = [];
    this.trace = [];
    this.traceEvery = 6;
    this._frameNo = 0;
    this.playerKeys = Object.keys(this.player);
    this.dynSolids = level.solids.filter((s) => s.kind === 'crumble');
    // Seals and objectives (sim/objectives3d.js), stepped after every physics step like Game3D._stepPhysics. Look-ahead frames
    // emit to a silent bus and snapshot() / restore() carry the state, so a ghost never opens a seal for real.
    // opts.objectives === false: a sim without them (every seal open, today's level).
    this.objectives = Objectives3D && opts.objectives !== false ? new Objectives3D(level, this.diff, this.bus) : null;
    // P4: a rockfall lane hurts (and kills) through the run's physics, as in Game3D
    if (this.objectives) this.objectives.physics = this.physics;
    // P6: the wind squalls push through Physics3D (a pure function of the objectives' clock: the look-ahead, a re-run and a
    // replay agree). The bots play with them ON (the game's default setting); opts.squalls === false, settings.windSqualls
    // false or AT3D_SQUALLS=0 stills them.
    if (this.objectives) {
      const env = typeof process !== 'undefined' && process.env ? process.env.AT3D_SQUALLS : undefined;
      this.objectives.setSqualls(opts.squalls !== false && this.settings.windSqualls !== false && env !== '0');
      this.physics.wind = this.objectives;
    }
    this.laneHits = []; // [t, lane id] of the real run (LEVEL_FUN_PLAN P4: a bot route is never struck)
    this._quietBus = new EventBus();
    this.objEvents = []; // [t, type, id] of the real run
    this.objHash = 0x811c9dc5; // FNV of the objective event sequence (V13)
    if (!this.objectives) level.sealSolids && level.sealSolids.forEach((s) => (s.active = false));
    this.dynAnchors = level.anchors.filter((a) => a.kind === 'fragile');
    this.hash = new TrajectoryHash();
    this.timers = null;
    this.creature = null;
    this.threat = null;
    this.creatureCatches = 0;
    this.log = null;
    this.logFrames = 0;
    if (opts.record) this.log = new Float64Array(INTENT_W * (opts.recordFrames || 60 * 600));
    this.bus.on('player:land', (e) => {
      if (this.ghost) {
        if (e.lethalRatio > this.ghostMaxLand) this.ghostMaxLand = e.lethalRatio;
        return;
      }
      if (e.lethalRatio > this.maxLand) {
        this.maxLand = e.lethalRatio;
        this.maxLandAt = { x: e.x, y: e.y, z: e.z, t: this.t };
      }
    });
    this.bus.on('player:death', (e) => {
      if (this.ghost) return;
      this.deaths++;
      this.deathCause = e.cause;
      this.events.push(['death', e.cause, +this.t.toFixed(2), +e.x.toFixed(1), +e.y.toFixed(1), +e.z.toFixed(1), +(e.impact || 0).toFixed(1)]);
    });
    this._secIdx = 0; // section / checkpoint bookkeeping, as Game3D._enterSection (a new checkpoint heals)
    this._cpIdx = 0;
    this.damageLog = []; // health:damage events of the real run: [t, cause, amount (hp), hp after, speed]
    this.bus.on('health:damage', (e) => {
      if (this.ghost) return;
      this.damageLog.push([+this.t.toFixed(2), e.cause, +(e.amount * 100).toFixed(1), +(e.hp * 100).toFixed(1), +(e.speed || 0).toFixed(1)]);
    });
    this.bus.on('grapple:attach', (e) => {
      if (this.ghost) return;
      this.attaches.push(e.anchor.id);
      this.events.push(['attach', e.hand, e.anchor.id, +this.t.toFixed(2), +e.distance.toFixed(1)]);
    });
    // Every hook shot at an anchor of the real run: [section of the body, anchor id, distance body -> anchor at the trigger]
    // (verify.mjs reach floors, LEVEL_FUN_PLAN item 5: the targeting distance a line needs, against the section's reach).
    this.shots = [];
    this.bus.on('rope:fire', (e) => {
      if (this.ghost || !e.target) return;
      this.shots.push([this.level.sectionIndexAt(e.y), e.target.id, Math.hypot(e.x - e.target.x, e.y - e.target.y, e.z - e.target.z)]);
    });
    this.bus.on('grapple:release', (e) => {
      if (this.ghost) return;
      this.events.push(['release', e.hand, e.anchor.id, +this.t.toFixed(2), e.reason]);
    });
    this.bus.on('grapple:break', (e) => !this.ghost && this.events.push(['break', e.anchor.id, +this.t.toFixed(2)]));
    this.bus.on('platform:crumble', (e) => !this.ghost && this.events.push(['crumble', e.solid.id, +this.t.toFixed(2)]));
    this.bus.on('grapple:miss', (e) => !this.ghost && this.events.push(['miss', e.hand, +this.t.toFixed(2)]));
    const objEvent = (type) => (e) => {
      if (this.ghost) return;
      const id = String(e.id);
      this.objEvents.push([+this.t.toFixed(2), type, id]);
      this.events.push([type, id, +this.t.toFixed(2)]);
      let h = this.objHash;
      const s = `${type}:${id}@${this._frameNo}`;
      for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
      this.objHash = h >>> 0;
    };
    this.bus.on('objective:done', objEvent('objective'));
    this.bus.on('seal:land', objEvent('seal:land'));
    // P3 verbs: every fixture done / haul notch (id = the fixture) and every bell strike, in the V13 hash too
    this.bus.on('objective:progress', (e) => objEvent(`progress:${e.verb}`)({ id: `${e.fixture || e.id}:${e.k}` }));
    this.bus.on('bell:ring', objEvent('bell'));
    // P4: the rockfall lanes (deterministic functions of the run clock) and a stone striking the player
    this.bus.on('lane:on', objEvent('lane'));
    this.bus.on('lane:hit', (e) => {
      if (this.ghost) return;
      this.laneHits.push([+this.t.toFixed(2), e.id]);
      objEvent('lane:hit')(e);
    });
    if (opts.timers) {
      this.timers = opts.timers instanceof SystemTimers ? opts.timers : new SystemTimers();
      instrument(this, this.timers);
    }
    if (opts.creature) this._initCreature(opts.creature);
  }

  /**
   * Creature + threat like Game3D (needs `await loadCreatureModules()` first). Look-ahead
   * events go to a private bus so the creature only hears what really happened.
   */
  _initCreature(o) {
    if (!creatureMods) throw new Error('Sim({ creature }): call await loadCreatureModules() first');
    const seed = typeof o === 'object' && o.seed !== undefined ? o.seed : 0x9e3779b1;
    this.creature = new creatureMods.Creature3D(this.level, this.diff, this.bus, { seed: seed >>> 0 });
    this.threat = new creatureMods.ThreatSystem3D(this.bus);
    this.threatCtx = { player: this.player, creature: this.creature, tethers: this.tethers, diff: this.diff, level: this.level };
    this.runClock = 0;
    this.ghostBus = new EventBus();
    this.ghostBus.on('player:land', (e) => {
      if (e.lethalRatio > this.ghostMaxLand) this.ghostMaxLand = e.lethalRatio;
    });
    let ghost = false;
    Object.defineProperty(this, 'ghost', {
      get: () => ghost,
      set: (v) => {
        ghost = !!v;
        const bus = ghost ? this.ghostBus : this.bus;
        this.tethers.bus = bus;
        this.physics.bus = bus;
      },
    });
  }

  /**
   * Respawn-style start: player standing still at (x,y,z), fresh level state. Every seal is closed except those of the
   * sections above `doneThrough` (default: the section of y), as a Continue / warp to that checkpoint would leave them.
   */
  spawn(x, y, z, doneThrough) {
    this.level.reset();
    if (this.objectives) {
      this.objectives.reset();
      this.objectives.markDoneThrough(doneThrough !== undefined ? doneThrough : this.level.sectionIndexAt(y));
      this.objectives.reapply();
    }
    this.objEvents = [];
    this.objHash = 0x811c9dc5;
    this.laneHits = [];
    this.player.reset(x, y, z);
    this.tethers.reset();
    this.t = 0;
    this.maxLand = 0;
    this.deaths = 0;
    this.attaches = [];
    this.events = [];
    this.shots = [];
    this.damageLog = [];
    this.physics.health.reset();
    this._secIdx = this.level.sectionIndexAt(y);
    this._cpIdx = this.level.checkpointFor(this._secIdx, this.diff.checkpoints).index;
    this.trace = [];
    this.hash = new TrajectoryHash();
    this.logFrames = 0;
    if (this.creature) {
      this.creature.reset(this.player);
      this.threat.reset();
      this.runClock = 0;
    }
  }

  /** One 60 Hz frame with the given intent (mutated: edges cleared after). */
  frame(intent) {
    const p = this.player;
    const T = this.tethers;
    const real = !this.ghost;
    const timers = real ? this.timers : null;
    const c0 = timers ? process.cpuUsage() : null;
    const t0 = timers ? now() : 0;
    if (real && this.log && (this.logFrames + 1) * INTENT_W <= this.log.length) writeIntent(this.log, this.logFrames++ * INTENT_W, intent);
    T.updateTargets(p, intent);
    T.handleInput(p, intent, FRAME);
    const jump = intent.jumpPressed;
    const O = this.objectives;
    if (O) {
      O.bus = real ? this.bus : this._quietBus;
      const pr = intent.probe;
      O.setProbe(pr ? pr.x : 0, pr ? pr.y : 0, pr ? pr.z : 0, !!(pr && pr.on)); // as Game3D: once per frame
    }
    for (let i = 0; i < SUB; i++) {
      intent.jumpPressed = jump && i === 0;
      this.physics.step(p, T, intent, DT);
      if (O) O.step(DT, p, T, intent, this.t);
      if (!p.alive) break;
    }
    intent.jumpPressed = false;
    if (real) this._checkpoint(p);
    if (real && this.creature) this._stepCreature(timers);
    if (timers) {
      const wall = now() - t0;
      const c = process.cpuUsage(c0);
      timers.endFrame(wall, (c.user + c.system) / 1000);
    }
    this.t += FRAME;
    if (real) {
      this.hash.add(p);
      if (this._frameNo++ % this.traceEvery === 0) this.trace.push(p.x, p.y, p.z);
    }
    return p.alive;
  }

  /** Game3D._enterSection: reaching a deeper checkpoint (per the difficulty's policy) restores health. */
  _checkpoint(p) {
    const si = this.level.sectionIndexAt(p.y);
    if (si === this._secIdx || si < 0) return;
    this._secIdx = si;
    const cp = this.level.checkpointFor(si, this.diff.checkpoints);
    if (cp && cp.index > this._cpIdx) {
      this._cpIdx = cp.index;
      this.physics.health.heal(CONFIG.health.checkpointHeal);
    }
  }

  _stepCreature(timers) {
    const I = timers && timers.idx;
    this.runClock += FRAME;
    let t0 = timers ? now() : 0;
    this.creature.update(FRAME, this.player, this.runClock);
    if (this.creature.caughtPlayer) {
      this.creature.caughtPlayer = false; // non-lethal here: counted, not applied
      this.creatureCatches++;
    }
    if (timers) {
      const t1 = now();
      timers.add(I.creature, t1 - t0);
      t0 = t1;
    }
    this.threat.update(FRAME, this.threatCtx);
    if (timers) timers.add(I.threat, now() - t0);
  }

  /** Replays a recorded intent log into this (fresh, spawned) sim. Returns the number of frames played. */
  replay(log, frames) {
    const it = makeIntent();
    for (let f = 0; f < frames; f++) {
      readIntent(log, f, it);
      this.frame(it);
    }
    return frames;
  }

  snapshot() {
    const p = this.player;
    const s = { t: this.t, p: new Array(this.playerKeys.length), hands: {}, dyn: [] };
    for (let i = 0; i < this.playerKeys.length; i++) s.p[i] = p[this.playerKeys[i]];
    s.tethered = p._tethered;
    s.health = this.physics.health.snapshot();
    for (const h of HANDS) {
      const st = this.tethers.hands[h];
      const o = {};
      for (const k of HAND_KEYS) o[k] = st[k];
      o.miss = st.miss ? Object.assign({}, st.miss) : null;
      o.flT = st.flightObj.t;
      o.flDur = st.flightObj.dur;
      o.flTarget = st.flightObj.target;
      for (const k of ROPE_KEYS) o['r_' + k] = st.rope[k];
      s.hands[h] = o;
    }
    for (const o of this.dynSolids) s.dyn.push(o.active, o.load, o.fallen);
    for (const o of this.dynAnchors) s.dyn.push(o.broken, o.load);
    if (this.objectives) s.obj = this.objectives.snapshot();
    return s;
  }

  restore(s) {
    const p = this.player;
    this.t = s.t;
    for (let i = 0; i < this.playerKeys.length; i++) p[this.playerKeys[i]] = s.p[i];
    p._tethered = s.tethered;
    this.physics.health.restore(s.health);
    for (const h of HANDS) {
      const st = this.tethers.hands[h];
      const o = s.hands[h];
      for (const k of HAND_KEYS) st[k] = o[k];
      st.miss = o.miss ? Object.assign({}, o.miss) : null;
      st.flightObj.t = o.flT;
      st.flightObj.dur = o.flDur;
      st.flightObj.target = o.flTarget;
      for (const k of ROPE_KEYS) st.rope[k] = o['r_' + k];
    }
    let j = 0;
    for (const o of this.dynSolids) {
      o.active = s.dyn[j++];
      o.load = s.dyn[j++];
      o.fallen = s.dyn[j++];
    }
    for (const o of this.dynAnchors) {
      o.broken = s.dyn[j++];
      o.load = s.dyn[j++];
    }
    if (this.objectives && s.obj) this.objectives.restore(s.obj);
  }

  /** Damage taken this run (hp points, 100 = full health): hits, total, lowest hp, the events. */
  damageReport() {
    const h = this.physics.health;
    return {
      hits: h.hits,
      total: +(h.totalDamage * 100).toFixed(1),
      minHp: +(h.minHp * 100).toFixed(1),
      endHp: +(h.hp * 100).toFixed(1),
      events: this.damageLog,
    };
  }

  attachedHands() {
    const out = [];
    for (const h of HANDS) if (this.tethers.hands[h].rope.attached) out.push(h);
    return out;
  }
}
