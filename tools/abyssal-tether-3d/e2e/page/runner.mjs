// In-page e2e runner: replays the level bot's verified routes through the LIVE game
// (AT3D.debug.setInput + AT3D.debug.step) with the creature hunting, section by
// section, handling deaths (respawn at the checkpoint, retry that section's route).
// The bot's look-ahead runs on a private Physics3D + bus (no game events, no
// creature) and restores the exact state afterwards, like the Node harness.
import { Bot } from '/__e2e/bot.mjs';
import { ROUTES, SECTION_ROUTE } from '/__e2e/routes.mjs';
import { HANDS, Physics3D } from '/src/sim/physics3d.js';
import { EventBus } from '/src/sim/config3d.js';

const FRAME = 1 / 60;
const SUB = 4;
const HAND_KEYS = ['target', 'held', 'buffer', 'extend', 'attachTime', 'lastAim'];
const ROPE_KEYS = ['anchor', 'length', 'd', 'nx', 'ny', 'nz', 'tension'];
const NOSTATE = { render: false, state: false };

/** The level bot's Sim interface on top of the running Game3D. */
class GameSim {
  constructor(game, api) {
    this.game = game;
    this.api = api;
    this._ghost = false;
    this.ghostMaxLand = 0;
    this.t = 0;
    this.maxLand = 0;
    this.maxLandAt = null;
    this.deaths = 0;
    this.deathCause = null;
    this.attaches = [];
    this.events = [];
    this.ghostBus = new EventBus();
    this.ghostBus.on('player:land', (e) => {
      if (e.lethalRatio > this.ghostMaxLand) this.ghostMaxLand = e.lethalRatio;
    });
    this._ghostPhys = null;
    const bus = game.bus;
    bus.on('player:land', (e) => {
      if (e.lethalRatio > this.maxLand) {
        this.maxLand = e.lethalRatio;
        this.maxLandAt = { x: e.x, y: e.y, z: e.z, t: this.t };
      }
    });
    bus.on('player:death', (e) => {
      this.deaths++;
      this.deathCause = e.cause;
    });
    bus.on('grapple:attach', (e) => {
      this.attaches.push(e.anchor.id);
      this.events.push(['attach', e.hand, e.anchor.id, +this.t.toFixed(2)]);
    });
    this.input = { move: { x: 0, z: 0 }, reel: 0, jumpPressed: false, brake: false, hands: { left: {}, right: {} } };
  }
  get level() {
    return this.game.level;
  }
  get player() {
    return this.game.player;
  }
  get tethers() {
    return this.game.tethers;
  }
  get diff() {
    return this.game.diff;
  }
  get ghost() {
    return this._ghost;
  }
  set ghost(v) {
    v = !!v;
    if (v === this._ghost) return;
    this._ghost = v;
    const T = this.tethers;
    if (v) {
      this._realBus = T.bus;
      T.bus = this.ghostBus;
    } else {
      T.bus = this._realBus;
    }
  }
  _phys() {
    const g = this.game;
    if (!this._ghostPhys || this._ghostPhys.level !== g.level || this._ghostPhys.diff !== g.diff) {
      this._ghostPhys = new Physics3D(g.level, g.diff, this.ghostBus);
      this._ghostPhys.health.god = true; // the look-ahead judges landing speeds only; it takes no damage (as in verify/bot.mjs)
    }
    return this._ghostPhys;
  }
  frame(intent) {
    const p = this.player;
    if (this._ghost) {
      const T = this.tethers;
      const ph = this._phys();
      T.updateTargets(p, intent);
      T.handleInput(p, intent, FRAME);
      const jump = intent.jumpPressed;
      for (let i = 0; i < SUB; i++) {
        intent.jumpPressed = jump && i === 0;
        ph.step(p, T, intent, FRAME / SUB);
        if (!p.alive) break;
      }
      intent.jumpPressed = false;
      return p.alive;
    }
    const o = this.input;
    o.move.x = intent.move.x;
    o.move.z = intent.move.z;
    o.reel = intent.reel;
    o.jumpPressed = !!intent.jumpPressed;
    o.brake = !!intent.brake;
    for (const h of HANDS) {
      const s = intent.hands[h];
      const d = o.hands[h];
      d.aim = s.aim ? { ox: s.aim.ox, oy: s.aim.oy, oz: s.aim.oz, dx: s.aim.dx, dy: s.aim.dy, dz: s.aim.dz } : null;
      d.pressed = !!s.pressed;
      d.held = !!s.held;
      d.released = !!s.released;
      d.yank = s.yank || 0;
    }
    this.api.setInput(o);
    this.api.step(FRAME, NOSTATE);
    intent.jumpPressed = false;
    this.t += FRAME;
    return p.alive;
  }
  snapshot() {
    const p = this.player;
    const keys = Object.keys(p);
    const s = { t: this.t, keys, p: keys.map((k) => p[k]), hands: {}, dyn: [] };
    s.tethered = p._tethered;
    for (const h of HANDS) {
      const st = this.tethers.hands[h];
      const o = {};
      for (const k of HAND_KEYS) o[k] = st[k];
      o.miss = st.miss ? Object.assign({}, st.miss) : null;
      for (const k of ROPE_KEYS) o['r_' + k] = st.rope[k];
      s.hands[h] = o;
    }
    for (const o of this.level.solids) if (o.kind === 'crumble') s.dyn.push(o.active, o.load, o.fallen);
    for (const o of this.level.anchors) if (o.kind === 'fragile') s.dyn.push(o.broken, o.load);
    return s;
  }
  restore(s) {
    const p = this.player;
    this.t = s.t;
    for (let i = 0; i < s.keys.length; i++) p[s.keys[i]] = s.p[i];
    p._tethered = s.tethered;
    for (const h of HANDS) {
      const st = this.tethers.hands[h];
      const o = s.hands[h];
      for (const k of HAND_KEYS) st[k] = o[k];
      st.miss = o.miss ? Object.assign({}, o.miss) : null;
      for (const k of ROPE_KEYS) st.rope[k] = o['r_' + k];
    }
    let j = 0;
    for (const o of this.level.solids) {
      if (o.kind !== 'crumble') continue;
      o.active = s.dyn[j++];
      o.load = s.dyn[j++];
      o.fallen = s.dyn[j++];
    }
    for (const o of this.level.anchors) {
      if (o.kind !== 'fragile') continue;
      o.broken = s.dyn[j++];
      o.load = s.dyn[j++];
    }
  }
  attachedHands() {
    const out = [];
    for (const h of HANDS) if (this.tethers.hands[h].rope.attached) out.push(h);
    return out;
  }
}

/** Bot with the route loop split into one-frame ticks (same body as Bot.runRoute). */
class StepBot extends Bot {
  tick() {
    const sim = this.sim;
    const it = this.intent;
    if (this.i >= this.route.length) return 'done';
    if (!sim.player.alive) {
      this.fail = `died (${sim.deathCause}) at step ${this.i} ${JSON.stringify(this.route[this.i])}`;
      return 'fail';
    }
    this.frames = (this.frames || 0) + 1;
    if (this.frames > this.maxFrames) {
      this.fail = 'frame budget exhausted';
      return 'fail';
    }
    this.prepIntent(it, this.holding);
    for (const h of this.pendingRelease) this.releaseHand(it, h);
    this.pendingRelease.length = 0;
    for (const h of HANDS) if (this.holding[h] && !sim.tethers.hands[h].rope.attached) this.releaseHand(it, h);
    const step = this.route[this.i];
    const limit = step.t || 25;
    const p = this.p;
    if (this.stepT > limit) {
      this.fail = `timeout at step ${this.i} ${JSON.stringify(step)} pos ${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)} grounded ${p.grounded} att ${this.attachedHands()}`;
      return 'fail';
    }
    let done = false;
    if (step.a) done = this.stepAnchor(it, step);
    else if (step.p) done = this.stepPlatform(it, step);
    else if (step.w) done = this.stepWalk(it, step);
    else if (step.release) {
      this.releaseAll(it);
      done = true;
    } else if (step.goal) done = this.stepGoal(it, step);
    sim.frame(it);
    this.stepT += FRAME;
    if (done) {
      this.lastDone = step;
      this.log.push([this.i, +sim.t.toFixed(2)]);
      this.i++;
      this.stepT = 0;
      this.okStreak = 0;
      this.prevAlong = null;
      this.minD = Infinity;
      this.fromReached = false;
    }
    return this.i >= this.route.length ? 'done' : 'run';
  }
}

export class Runner {
  /** @param {{idle?: number}} [opts] idle: seconds a "human" stands and looks around after every landing */
  constructor(opts) {
    this.idle = (opts && opts.idle) || 0;
    this.idleLeft = 0;
    this.idles = 0;
    this.api = window.AT3D.debug;
    this.game = window.AT3D.game;
    this.sim = new GameSim(this.game, this.api);
    this.bot = null;
    this.routeIdx = -1;
    this.deaths = [];
    this.failures = [];
    this.routeLog = [];
    this.tries = {};
    this.stopsDone = {};
    this.frames = 0;
    this._deadSeen = false;
    this.aborted = null;
    // A "human" who sees the lunge telegraph (crown flare, roar, haptics) gets moving
    // after a reaction time instead of finishing the look-around.
    this.reactions = 0;
    this.game.bus.on('creature:attack', (e) => {
      if (e && e.gate) return;
      if (this.idleLeft > 0.4) {
        this.idleLeft = 0.4;
        this.reactions++;
      }
    });
    this.game.bus.on('player:death', (e) => {
      const g = this.game;
      this.deaths.push({
        cause: e.cause,
        section: g.sectionIndex,
        route: this.routeIdx >= 0 ? SECTION_ROUTE[this.routeIdx] : null,
        step: this.bot ? this.bot.i : -1,
        x: +e.x.toFixed(1),
        y: +e.y.toFixed(1),
        z: +e.z.toFixed(1),
        time: +g.time.toFixed(2),
        creature: g.creature ? { state: g.creature.state, distance: +g.creature.distance.toFixed(1), reason: g.creature.burstReason, stall: +(g.creature.stallTime || 0).toFixed(1) } : null,
      });
    });
  }

  /** Starts the route of section `idx` (optionally from route step `from`), walking to its checkpoint first. */
  startRoute(idx, from = 0, walkToCheckpoint = true) {
    const g = this.game;
    const key = SECTION_ROUTE[idx];
    const sec = g.level.sections[idx];
    const cp = idx === 0 ? g.level.spawn : sec.checkpoint;
    const route = ROUTES[key].slice(from);
    if (walkToCheckpoint) route.unshift({ w: [cp.x, cp.z], tol: 0.4, t: 8 });
    this.routeIdx = idx;
    this.bot = new StepBot(this.sim, route, {});
    this.routeT0 = g.time;
    this.tries[key] = (this.tries[key] || 0) + 1;
    return key;
  }

  _blank() {
    this.api.setInput({});
    this.api.step(FRAME, NOSTATE);
  }

  /**
   * Runs up to maxFrames frames. Stops early for: 'victory', 'abort', or a
   * screenshot moment in `stops` (sighting | close5 | close7 | death), each once.
   */
  run(maxFrames, stops) {
    const g = this.game;
    const want = new Set(stops || []);
    for (let f = 0; f < maxFrames; f++) {
      this.frames++;
      if (g.state === 'victory') {
        this.bot = null;
        return { status: 'victory' };
      }
      if (g.victoryT >= 0) {
        this._blank();
        continue;
      }
      if (g.state === 'dead') {
        if (want.has('death') && !this.stopsDone.death && g._deathShown) {
          this.stopsDone.death = true;
          return { status: 'stop', why: 'death' };
        }
        if (g.deathT >= 0.8) {
          this.api.setInput({ confirmPressed: true });
          this.api.step(FRAME, NOSTATE);
          this.api.setInput({});
          if (g.state === 'playing') {
            const idx = Math.max(0, g.checkpoint.index);
            const key = SECTION_ROUTE[idx];
            if ((this.tries[key] || 0) >= 12) {
              this.aborted = `too many attempts at ${key}`;
              return { status: 'abort', why: this.aborted };
            }
            this.startRoute(idx, 0, true);
          }
          continue;
        }
        this._blank();
        continue;
      }
      if (g.state !== 'playing') {
        this.aborted = `unexpected state ${g.state}`;
        return { status: 'abort', why: this.aborted };
      }
      if (!this.bot) {
        this.aborted = 'no route';
        return { status: 'abort', why: this.aborted };
      }
      if (this.idleLeft > 0) {
        // Standing on a ledge reading the next move (stopped, no tether): the creature keeps hunting.
        this.idleLeft -= FRAME;
        this.api.setInput({ brake: true });
        this.api.step(FRAME, NOSTATE);
        continue;
      }
      const r = this.bot.tick();
      if (this.idle > 0 && this.bot && this.bot.lastDone && this.bot.lastDone.p) {
        const gs = g.player.groundSolid;
        this.bot.lastDone = null;
        // Nobody lingers on a ledge that is visibly crumbling under them.
        if (!gs || gs.kind !== 'crumble') {
          this.idleLeft = this.idle;
          this.idles++;
        }
      }
      if (r === 'done') {
        const key = SECTION_ROUTE[this.routeIdx];
        this.routeLog.push({ route: key, t: +(g.time - this.routeT0).toFixed(1), at: +g.time.toFixed(1) });
        if (this.routeIdx + 1 < SECTION_ROUTE.length) this.startRoute(this.routeIdx + 1, 0, true);
        else {
          this.bot = null;
          // Goal reached (the route ends in the goal box): let the gate slam play out.
          for (let k = 0; k < 60 * 6 && g.state !== 'victory'; k++) this._blank();
          return { status: g.state === 'victory' ? 'victory' : 'abort', why: g.state };
        }
      } else if (r === 'fail' && g.state === 'playing' && g.player.alive) {
        // Not a death: the bot lost the line (e.g. knocked off it). Back to the checkpoint.
        const key = SECTION_ROUTE[this.routeIdx];
        this.failures.push({ route: key, fail: this.bot.fail, time: +g.time.toFixed(1) });
        if ((this.tries[key] || 0) >= 12) {
          this.aborted = `too many attempts at ${key}`;
          return { status: 'abort', why: this.aborted };
        }
        g.pause();
        g.respawn();
        this.api.setInput({});
        this.startRoute(Math.max(0, g.checkpoint.index), 0, true);
      }
      // Screenshot moments.
      const c = g.creature;
      if (c && want.size) {
        if (want.has('sighting') && !this.stopsDone.sighting && c.sighting && c.sighting.t > c.sighting.duration * 0.42) {
          this.stopsDone.sighting = true;
          return { status: 'stop', why: 'sighting' };
        }
        const close = c.inPlay && c.body && c.body.visible && c.distance < 13 && g.player.alive;
        if (close && want.has('close5') && !this.stopsDone.close5 && g.sectionIndex === 4) {
          this.stopsDone.close5 = true;
          return { status: 'stop', why: 'close5' };
        }
        if (close && want.has('close7') && !this.stopsDone.close7 && g.sectionIndex === 6) {
          this.stopsDone.close7 = true;
          return { status: 'stop', why: 'close7' };
        }
      }
    }
    return { status: 'running' };
  }

  summary() {
    const g = this.game;
    return {
      state: g.state,
      time: +g.time.toFixed(2),
      deathsGame: g.deaths,
      deaths: this.deaths,
      failures: this.failures,
      routes: this.routeLog,
      tries: this.tries,
      section: g.sectionIndex,
      route: this.routeIdx >= 0 ? SECTION_ROUTE[this.routeIdx] : null,
      step: this.bot ? this.bot.i : -1,
      player: { x: +g.player.x.toFixed(1), y: +g.player.y.toFixed(1), z: +g.player.z.toFixed(1) },
      relocations: g.creature && g.creature.stats ? g.creature.stats.relocations : null,
      creatureStats: g.creature && g.creature.stats ? Object.assign({}, g.creature.stats) : null,
      maxLand: +this.sim.maxLand.toFixed(2),
      idles: this.idles,
      reactions: this.reactions,
      frames: this.frames,
      aborted: this.aborted,
    };
  }
}
