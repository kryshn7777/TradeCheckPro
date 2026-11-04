/* ABYSSAL TETHER 3D — sim/lampholdDirector.js
 * THE DIRECTOR OF CHAPTER II · LAMPHOLD. One object the game steps once per fixed physics step (after Physics3D and Objectives3D) that owns everything in the chapter
 * that is more than data and closed-form movers (docs/abyssal-tether-3d/plans/CHAPTER_II_DIRECTION.md):
 *
 *   CARRIERS    the lifts' floors: a mover flagged `carrier` (a half-extent) carries the player who stands on it (no collision change: after the physics step the
 *               player's height follows the floor); the chain platform of the hook and the express cages are carriers; the Doorman's cage is not (do not be in it).
 *   TOLLS       the Usher answers bells. This turns the game's events (a bell struck, a machine's notch, a brass ring biting, the Great Bell, a gong, a crash) into
 *               `toll:emit` for the Ushers, through the masking of usher3d.js's TollBus; the Ushers it owns hear them.
 *   II-9        THE TOLLING GALLERY: the peal (any five of the eight bells open the way); the Usher answers from 100 m below, climbing a station per toll, and
 *               at the fifth it strikes the Tenor on its landing 12 m under the nave: never within reach of you (the strike waits while you are near).
 *   II-12       THE SNUFFING, the exam: the Quiet; A the Round (the front walks down the stair snuffing a cluster every ~6 s; lethal only if you stand in the
 *               cluster it is snuffing, or in the sphere of a toll you made); B the Well (the Doorman's collar falls, his throat sweeps the stalls; the Great Bell
 *               tolls; the pawl; the clappers; he strikes what you toll); C1 the Span (the Evening draws up the deck behind you); C2 the Lift and the last lamp.
 *               You cannot kill him: you make him open the door, you cross, you ride down while he snuffs the last lamp, and he sits.
 *   II-13       THE HOOK (sim/hook3d.js): the true rest, the chain, the Mere.
 *
 * It never reads the player's velocity for any strike (the Ushers answer tolls); it reads positions only to place a lethal check and to keep the scripted answer
 * of II-9 safe. All state is a function of the run clock and the events: `snapshot()` / `restore()` for the lamps (respawn), `reset(phase)` for a fresh phase.
 *
 *   const d = new LampholdDirector({ level, objectives, bus, diff, text, kill, victory })
 *   d.step(dt, player)           // once per fixed step
 *   d.ushers                     // [{ usher: Usher3D, ... }] for the view; d.hook (HookSequence state), d.phase
 *   d.reset(lamp)                // a new run or a respawn at `lamp` ({ phase } | null)
 *   d.stats
 * Events it emits on the bus: toll:emit, c2:phase {phase}, c2:caption {text, kind}, c2:lamp {id, x, y, z, yaw, label} (a waking lamp reached), lamp:snuff {x, y, z, r, kind},
 * lamp:all (the last lamp), evening:stroke {x, y, z, side}, c2:creak {x, y, z} / c2:crash {x, y, z} (the Span), c2:ratchet / c2:shutter, c2:answer {stage}, c2:tenor,
 * c2:pawl {by}, usher:* (the Ushers'), hook:* (the sequence's).
 * DOM-free, three.js-free, deterministic; runs in Node.
 */
import { Usher3D, TollBus, TOLL_KINDS, USHER_DIFF } from './usher3d.js';
import { HookSequence } from './hook3d.js';
import { moverRef } from './movers3d.js';
import { CONFIG } from './config3d.js';

const EVEN = 6; // s between strokes of the Great Bell
const COLLAR = 2.9; // m: the Head Usher's `pos` is his collar (his reach is measured from it); his feet are this far below

export const DIRECTOR = {
  quietMax: 150, // s in the Gallery before the Round arrives
  roundAhead: 40, // m of path the Round holds back from a player who has outrun it
  tenorSafe: 9, // m: the Tenor's strike waits while you are nearer than this to it
  carrierBand: 0.5, // m over / under a floor within which it catches you
  hookRest: 20, // s in the Soot Throat before the platform will take you (the beds' creak fades)
  collapseBase: 7, // m/s: the Span's front
  collapseGap: { normal: 22, nightmare: 16, abyss: 11 },
  plateLen: 3,
  shutter: { normal: 6.0, nightmare: 5.0, abyss: 3.75 }, // s from the last lamp to the shut door
  lastWhip: { normal: 2, nightmare: 2, abyss: 3 }, // the whip that snuffs the master lamp
  grace: 3, // s after a respawn in which nothing here can kill you
};

const dist3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const inBox = (p, b) => p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY && p.z >= b.minZ && p.z <= b.maxZ;

export class LampholdDirector {
  constructor({ level, objectives, bus, diff, text, kill, victory } = {}) {
    this.level = level;
    this.O = objectives || null;
    this.bus = bus;
    this.diff = diff || {};
    this.key = this.diff.key && ['normal', 'nightmare', 'abyss', 'sandbox'].includes(this.diff.key) ? this.diff.key : 'normal';
    this.dk = this.key === 'sandbox' ? 'normal' : this.key;
    this.text = text || null;
    this._kill = typeof kill === 'function' ? kill : null;
    this._victory = typeof victory === 'function' ? victory : null;
    const d = (level && level.data) || {};
    this.c2 = d.c2 || {};
    this.T = this.c2.tolling || null;
    this.Q = this.c2.snuffing || null;
    this.H = this.c2.hook || null;
    this.tollBus = new TollBus();
    this.clock = 0;
    this.t = 0; // s since the run began (this.clock mirrors the objectives' clock when there is one)
    this.phase = 'off';
    this.stats = { tolls: 0, kills: 0, snuffs: 0, plates: 0 };
    this.ushers = [];
    this._byId = Object.create(null);
    this._carriers = [];
    this._solid = Object.create(null);
    this._lights = [];
    this._graceT = 0;
    this._offs = [];
    this._buildCarriers();
    this._buildSolids();
    this._buildUshers();
    this.hook = null;
    this._seq = null;
    if (this.H) {
      this._seq = new HookSequence({ bus, chain: { y: this.H.chain.y, drop: this.H.chain.drop, clickEvery: this.H.chain.clickEvery }, water: this.H.water, wallsEndY: this.H.wallsEndY });
      this.hook = this._seq.state;
    }
    this._wire();
    this.reset(null);
  }

  destroy() {
    for (const off of this._offs) if (typeof off === 'function') off();
    this._offs.length = 0;
    for (const e of this.ushers) e.usher.destroy();
  }

  // ---- construction ---------------------------------------------------------------------------------------------------------
  _mover(id) {
    const e = this.O && this.O.movers ? this.O.movers.byId(id) : null;
    return e ? e.m : null;
  }

  _buildCarriers() {
    const raw = (this.level && this.level.data && this.level.data.movers) || [];
    for (const r of raw) if (r && r.carrier) this._carriers.push({ id: r.id, hx: r.carrier, hz: r.carrier, on: false });
  }

  _buildSolids() {
    const by = (id) => this.level.byId && this.level.byId[id];
    const want = ['c2-12-gate', 'c2-12-shutter', 'c2-9-tenor-stand', 'c2-13-water'];
    if (this.Q) for (const p of this.Q.span.plates) want.push(p.id);
    for (const id of want) {
      const s = by(id);
      if (s) this._solid[id] = s;
    }
    // the lamps the Round and the Evening put out: the level's point lights, found by position
    this._lights = ((this.level && this.level.lights) || []).filter((l) => l && isFinite(l.x));
  }

  _mkUsher(id, o) {
    const u = new Usher3D({ id, difficulty: this.key, bus: this.bus, ...o });
    const e = { id, usher: u, head: !!o.head };
    this.ushers.push(e);
    this._byId[id] = e;
    return e;
  }

  _buildUshers() {
    if (this.T) {
      const s = this.T.usher[0];
      this._mkUsher('u-tenor', { x: s.x, y: s.y, z: s.z, hearing: 4 });
    }
    if (this.Q) {
      const path = this.Q.roundPath;
      for (let j = 0; j < 5; j++) {
        const e = this._mkUsher(`u-round-${j}`, { x: path[0].x, y: path[0].y, z: path[0].z, reach: 4.5 });
        e.usher.setPath(path);
        e.usher.setHarmless(j > 0); // the lead snuffs; its four companions only walk with it
      }
      const p = this.Q.pulpit;
      this._mkUsher('u-head', { head: true, x: p.x, y: p.y + COLLAR, z: p.z });
    }
  }

  // ---- the bus ------------------------------------------------------------------------------------------------------------------
  _on(type, fn) {
    if (this.bus && typeof this.bus.on === 'function') this._offs.push(this.bus.on(type, fn));
  }

  _wire() {
    this._on('bell:ring', (e) => this._onBell(e));
    this._on('objective:progress', (e) => this._onProgress(e));
    this._on('grapple:attach', (e) => this._onAttach(e));
    this._on('usher:blow', (e) => this._onBlow(e));
    this._on('usher:snuff', (e) => this._onSnuff(e));
  }

  /** A toll: the game's events and the director's own pass through the masking, then the Ushers hear them. */
  toll(kind, x, y, z, extra) {
    const k = TOLL_KINDS[kind];
    if (!k) return false;
    const t = { x, y, z, loud: k.loud, kind, src: (extra && extra.src) || kind };
    if (extra) {
      if (extra.vx !== undefined) {
        t.vx = extra.vx;
        t.vy = extra.vy;
        t.vz = extra.vz;
      }
      if (extra.park) t.park = true;
    }
    if (!this.tollBus.emit(t, this.t)) return false;
    this.stats.tolls++;
    if (this.bus) {
      this.bus.emit('toll:emit', t);
      this.bus.emit('c2:toll', t);
    }
    return true;
  }

  _onBell(e) {
    if (this.phase === 'off' && !this._tolling()) return;
    const id = e && e.id ? String(e.id) : '';
    if (id === 'bell-c2-12-pawl') {
      this._breakPawl('body');
      this.toll('bell', e.x, e.y, e.z, { src: 'pawl' });
      return;
    }
    this.toll('bell', e.x, e.y, e.z, { src: id });
    if (id.indexOf('bell-c2-9-') === 0) this._peal(id);
  }

  _onProgress(e) {
    if (!e) return;
    if (e.fixture === 'clap-c2-12-W' && e.k >= e.of) {
      const g = this.Q.gate.pawl;
      this._holdStrokes = 16; // the Great Bell waits: the Doorman answers the pawl first
      this.toll('bell', g.x, g.y, g.z, { src: 'clapW' });
    } else if (e.fixture === 'clap-c2-12-N' && e.k >= e.of) {
      const g = this.Q.gate.bellN;
      this._holdStrokes = 10;
      this.toll('bell', g.x, g.y, g.z, { src: 'clapN' });
    } else if (e.fixture === this.Q.leverFixture && e.k >= e.of) this._depart();
    else if (e.noise > 0 && e.x !== undefined) this.toll('machine', e.x, e.y, e.z, { src: e.fixture || 'machine' });
  }

  _onAttach(e) {
    const a = e && e.anchor;
    if (!a) return;
    if (this.c2.stopping && a.id === this.c2.stopping.ringId) this._startStopping();
    const brass = a.toll === true || (a.solid && a.solid.tag === 'brass');
    if (a.toll === 'great') return; // the Great Bell's own stroke is the toll
    if (brass) {
      this.toll('ring', e.x, e.y, e.z, { src: 'brass' });
      if (this.bus) this.bus.emit('c2:caption', { text: this._cap('chime'), kind: 'chime' });
    }
  }

  /** II-10 THE STOPPING: the escapement's last ring bitten: 4 s of grinding, then every machine of the beat stands still for 14 s (the din drops to nothing), then runs on. */
  _startStopping() {
    const st = this._stopping;
    const S = this.c2.stopping;
    if (st.started || !S || !this.O || !this.O.movers) return;
    st.started = true;
    st.t0 = this.O.clock + S.telegraph;
    if (this.bus) this.bus.emit('c2:grind', {});
    for (const id of S.movers) {
      const e = this.O.movers.byId(id);
      if (e) {
        e.m.stopAt = st.t0;
        e.m.stopFor = S.dur;
      }
    }
  }

  _stoppingStep() {
    const st = this._stopping;
    const S = this.c2.stopping;
    if (!st.started || !S) return;
    const c = this.O.clock;
    const now = c > st.t0 && c < st.t0 + S.dur;
    for (const L of this.O.lanes) if (S.lanes.indexOf(L.id) >= 0) L.off = now;
    if (now && !st.said) {
      st.said = true;
      if (this.bus) this.bus.emit('c2:stop', {});
    }
  }

  _namesStep(p) {
    const list = this.c2.names;
    if (!list) return;
    for (const n of list) {
      if (this.names.has(n.id)) continue;
      if (Math.hypot(p.x - n.x, p.y - n.y, p.z - n.z) > n.r) continue;
      this.names.add(n.id);
      if (this.bus) this.bus.emit('c2:name', { id: n.id, text: n.text, codex: n.codex, count: this.names.size, of: list.length });
    }
  }

  _onBlow(e) {
    if (!e || !this.Q) return;
    const g = this.Q.gate.pawl;
    if (this._solid['c2-12-gate'] && this._solid['c2-12-gate'].active !== false && Math.hypot(e.x - g.x, e.y - g.y, e.z - g.z) <= (e.r || 2.6) + 1.5) {
      this._breakPawl('whip');
      this._holdStrokes = 0;
    }
    if (this.T && e.id === 'u-tenor') {
      const t = this.T.tenor;
      if (Math.hypot(e.x - t.x, e.y - t.y, e.z - t.z) <= (e.r || 1.8) + 1.5) this._tenorBreaks();
    }
    if (e.id === 'u-head' && this._c2) {
      const cg = this._cageCenter();
      if (cg && Math.hypot(e.x - cg.x, e.y - cg.y, e.z - cg.z) <= (e.r || 2.6) + 2.0) this._cageHit();
    }
  }

  _onSnuff(e) {
    if (!e) return;
    // a lamp goes out where the Round's ring dipped / the Doorman's throat passed
    this._snuffAt(e.x, e.y, e.z, e.r || 2, e.id === 'u-head' ? 'sweep' : 'round');
  }

  _snuffAt(x, y, z, r, kind) {
    this.stats.snuffs++;
    for (const l of this._lights) if (Math.hypot(l.x - x, l.y - y, l.z - z) <= r + 3 && (l.gain === undefined || l.gain > 0)) l.gain = 0;
    if (this.bus) this.bus.emit('lamp:snuff', { x, y, z, r, kind });
  }

  _cap(key) {
    const c = this.text && this.text.usher && this.text.usher.captions;
    return c && c[key] ? c[key] : '';
  }

  _caption(key) {
    const text = this._cap(key);
    if (text && this.bus) this.bus.emit('c2:caption', { text, kind: key });
  }

  _tolling() {
    return !!this.T;
  }

  // ---- reset / phases -------------------------------------------------------------------------------------------------------------
  /** A new run (lamp null) or a respawn at an arena lamp ({ phase }): every scripted thing goes back to the state of that moment. */
  reset(lamp) {
    this.t = 0;
    this._graceT = DIRECTOR.grace;
    this.tollBus.reset();
    this.phase = 'off';
    this.stats = { tolls: 0, kills: 0, snuffs: 0, plates: 0 };
    for (const l of this._lights) l.gain = 1;
    for (const id of Object.keys(this._solid)) {
      const s = this._solid[id];
      if (id === 'c2-12-shutter' || id === 'c2-13-water') {
        s.active = id === 'c2-13-water';
      } else {
        s.active = true;
        s.fallen = false;
      }
      s.load = 0;
    }
    // II-9
    this._peals = new Set();
    this._stage = 0;
    this._tenorDone = false;
    this._tenorT = -1;
    this._tenorHold = 0;
    // II-12
    this._c2 = false;
    this._quietT = 0;
    this._front = 0; // the Round's lead index along the clusters (how many it has snuffed)
    this._leadBusy = false;
    this._bT = 0;
    this._great = { k: 0, next: 0 };
    this._holdStrokes = 0;
    this._plate = { front: 0, started: false, warned: 0 };
    this.evening = false;
    this.names = new Set(); // the Names found this run (data/chapter2-text.js names; c2.names the places)
    this._stopping = { started: false, t0: 0 };
    if (this.O && this.O.movers && this.c2 && this.c2.stopping) {
      for (const id of this.c2.stopping.movers) {
        const e = this.O.movers.byId(id);
        if (e) {
          e.m.stopAt = 1e9;
          e.m.stopFor = 0;
        }
      }
      for (const L of this.O.lanes) L.off = false;
    }
    this._cage = { started: false, t0: 0, gongs: 0, whips: 0, lampOut: false, shutT: -1, ratchet: false };
    this._doorman = 'pulpit';
    for (const e of this.ushers) {
      e.usher.reset();
      e.usher.command('leave');
    }
    if (this._seq) {
      this._seq.reset();
      const m = this._mover(this.H.chain.moverId);
      if (m) m.startAt = 1e9;
    }
    for (const id of ['mov-c2-12-cage']) {
      const m = this._mover(id);
      if (m) m.startAt = 1e9;
    }
    this._sectionT = 0;
    this._lastSection = -1;
    if (lamp && lamp.phase) this._enterPhase(lamp.phase, true);
  }

  _setPhase(p) {
    if (this.phase === p) return;
    this.phase = p;
    if (this.bus) this.bus.emit('c2:phase', { phase: p });
  }

  _enterPhase(p, fromLamp) {
    const Q = this.Q;
    if (!Q) return;
    const head = this._byId['u-head'].usher;
    const round = [0, 1, 2, 3, 4].map((j) => this._byId[`u-round-${j}`].usher);
    this._c2 = true;
    if (p === 'quiet') {
      head.command('enter');
      head.command('pulpit');
      this._setPhase('quiet');
    } else if (p === 'A') {
      head.command('enter');
      head.command('pulpit');
      this._startRound();
      this._setPhase('A');
      if (this.bus && this.text && this.text.boss) this.bus.emit('c2:caption', { text: this.text.boss.phaseCaptions[0], kind: 'phase' });
    } else if (p === 'B') {
      // the Round is spent: its clusters are dark behind you; the Doorman unbuttons his collar
      this._putOutStair();
      for (const u of round) u.command('leave');
      head.command('enter');
      head.command('collar');
      head.command('sweep', { x: Q.stalls[0].x + 6, y: Q.stalls[0].y + 4, z: Q.stalls[0].z, r: 18 });
      this._bT = 0;
      this._great.k = 0;
      this._setPhase('B');
      if (this.bus && this.text && this.text.boss) this.bus.emit('c2:caption', { text: this.text.boss.phaseCaptions[1], kind: 'phase' });
    } else if (p === 'C1') {
      this._putOutStair();
      for (const u of round) u.command('leave');
      this._breakPawl('lamp', true);
      head.command('enter');
      head.command('relocate', { x: Q.doorman.tower.x, y: Q.doorman.tower.y + COLLAR, z: Q.doorman.tower.z, yaw: 0 });
      head.command('phase', 'C1');
      this._setPhase('C1');
    } else if (p === 'C2') {
      this._putOutStair();
      for (const u of round) u.command('leave');
      this._breakPawl('lamp', true);
      for (const pl of Q.span.plates) this._plateDown(pl.id, true);
      head.command('enter');
      head.setStation(Q.doorman.tower.x, Q.doorman.tower.y + COLLAR, Q.doorman.tower.z, 0);
      head.command('stand');
      head.command('phase', 'C2');
      this._setPhase('C2');
    }
    if (fromLamp) this._graceT = DIRECTOR.grace;
  }

  _putOutStair() {
    for (const c of this.Q.clusters) this._snuffAt(c.x, c.y, c.z, 2, 'round');
  }

  _startRound() {
    const path = this.Q.roundPath;
    const lead = this._byId['u-round-0'].usher;
    this._front = 0;
    this._leadBusy = false;
    for (let j = 0; j < 5; j++) {
      const u = this._byId[`u-round-${j}`].usher;
      u.setStation(path[0].x, path[0].y, path[0].z, 0);
      u.command('enter');
    }
    void lead;
  }

  // ---- II-9 ---------------------------------------------------------------------------------------------------------------------
  _peal(id) {
    if (this._peals.has(id)) return;
    this._peals.add(id);
    const n = this._peals.size;
    const u = this._byId['u-tenor'];
    if (!u) return;
    if (this.bus) this.bus.emit('c2:answer', { stage: Math.min(4, n) });
    if (n === 1) this._caption('knock');
    if (n >= 2 && n <= 5) {
      const node = this.T.usher[Math.min(this.T.usher.length - 1, n - 2)];
      u.usher.command('leave');
      u.usher.setStation(node.x, node.y, node.z, 0);
      u.usher.command('enter');
      if (n === 2 && this.text && this.text.usher && this.bus) this.bus.emit('c2:caption', { text: this.text.usher.sightingLine, kind: 'sighting' });
    }
  }

  _tenorStep(dt, p) {
    if (!this.T || this._tenorDone) return;
    if (this._tenorT < 0) {
      if (this._peals.size >= this.T.need) this._tenorT = 0; // the way down is open: the Tenor answers the Morning Peal
      return;
    }
    this._tenorT += dt;
    if (this._tenorT < 1.2 || this._tenorStruck) return;
    const t = this.T.tenor;
    // the Usher must be at the landing, and you must be well away from the sphere (it waits for you)
    const u = this._byId['u-tenor'].usher;
    if (u.state === 'OFF') {
      const node = this.T.usher[this.T.usher.length - 1];
      u.setStation(node.x, node.y, node.z, 0);
      u.command('enter');
    }
    if (Math.hypot(p.x - t.x, p.y - t.y, p.z - t.z) < DIRECTOR.tenorSafe) {
      this._tenorHold += dt;
      return;
    }
    this._tenorStruck = true;
    if (this.bus) this.bus.emit('c2:tenor', {});
    this.toll('bell', t.x, t.y, t.z, { src: 'tenor' });
  }

  _tenorBreaks() {
    const s = this._solid['c2-9-tenor-stand'];
    if (s) s.active = false;
    this._tenorDone = true;
    if (this.bus) this.bus.emit('c2:crash', { x: this.T.tenor.x, y: this.T.tenor.y, z: this.T.tenor.z, kind: 'tenor' });
  }

  // ---- II-12 --------------------------------------------------------------------------------------------------------------------
  _breakPawl(by, silent) {
    const g = this._solid['c2-12-gate'];
    if (!g || g.active === false) return;
    g.active = false;
    g.fallen = true;
    if (silent) return;
    const p = this.Q.gate.pawl;
    if (this.bus) this.bus.emit('c2:pawl', { by, x: p.x, y: p.y, z: p.z });
    if (this.dk !== 'normal') this.toll('crash', p.x, p.y, p.z, { src: 'leaf' });
  }

  _plateDown(id, silent) {
    const s = this._solid[id];
    if (!s || s.active === false) return;
    s.active = false;
    s.fallen = true;
    this.stats.plates++;
    if (!silent) {
      const c = { x: (s.minX + s.maxX) / 2, y: s.maxY, z: (s.minZ + s.maxZ) / 2 };
      if (this.bus) this.bus.emit('c2:crash', { x: c.x, y: c.y, z: c.z, kind: 'plate' });
      this.toll('crash', c.x, c.y, c.z, { src: id });
    }
  }

  _cageCenter(ahead = 0) {
    const m = this._mover('mov-c2-12-cage');
    if (!m) return null;
    const q = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
    moverRef(m, (this.O ? this.O.clock : this.t) + ahead, q);
    return { x: q.x, y: q.y + 1.5, z: q.z, vx: q.vx, vy: q.vy, vz: q.vz };
  }

  /** A toll at the cage's centre. The Doorman leads what he hears: he aims at the toll plus its velocity x (Listen + Coil), so the toll carries the velocity that brings
   *  the cage from where it is now to where it will be when his whip lands (the closed form of the lift: he is old, and so is the machine). */
  _cageToll(kind, src) {
    const now = this._cageCenter(0);
    if (!now) return false;
    const k = USHER_DIFF[this.dk] || USHER_DIFF.normal;
    const L = k.listen + k.coil;
    const then = this._cageCenter(L);
    return this.toll(kind, now.x, now.y, now.z, { src, vx: (then.x - now.x) / L, vy: (then.y - now.y) / L, vz: (then.z - now.z) / L });
  }

  _depart() {
    const c = this._cage;
    if (c.started || this.phase !== 'C2') return;
    c.started = true;
    c.t0 = this.O ? this.O.clock : this.t;
    const m = this._mover('mov-c2-12-cage');
    if (m) m.startAt = c.t0;
    this._cageToll('gong', 'gong0');
    if (this.bus) this.bus.emit('c2:caption', { text: this.text && this.text.boss ? this.text.boss.phaseCaptions[3] : '', kind: 'phase' });
  }

  _cageHit() {
    const c = this._cage;
    c.whips++;
    if (c.whips >= DIRECTOR.lastWhip[this.dk] && !c.lampOut) {
      c.lampOut = true;
      this.evening = true; // the Evening has ended: every lamp in Lamphold is out
      if (this.bus) {
        this.bus.emit('lamp:all', {});
      }
      c.shutT = DIRECTOR.shutter[this.dk];
      c.ratchet = false;
      // the Evening ends: he withdraws and sits
      const head = this._byId['u-head'].usher;
      head.command('seat');
    }
  }

  _doormanStep(dt, p) {
    const Q = this.Q;
    const head = this._byId['u-head'].usher;
    const rim = Q.rim;
    switch (this.phase) {
      case 'quiet':
        this._quietT += dt;
        if (this._quietT > DIRECTOR.quietMax || !this._near(p, Q.gallery, 14)) this._enterPhase('A');
        break;
      case 'A': {
        this._roundStep(dt, p);
        if (this._near(p, rim, 10) && p.y < rim.y + 3) {
          this._emitLamp(Q.lamps[0]);
          this._enterPhase('B');
        }
        break;
      }
      case 'B': {
        this._bT += dt;
        if (this._holdStrokes > 0) this._holdStrokes -= dt;
        // the Great Bell is released after the sweep (15 s): a stroke every 6 s, W / E alternating (the pendulum is closed form: the strokes are its apexes)
        if (this._bT >= 15) {
          const k = Math.floor((this._bT - 15) / EVEN);
          while (this._great.k <= k) {
            const i = this._great.k;
            const east = i % 2 === 0;
            const ap = east ? Q.greatBell.apexE : Q.greatBell.apexW;
            const ring = this._ringPos();
            this._great.k++;
            if (this._holdStrokes > 0) continue; // the pawl's answer is pending
            const yy = ring ? ring.y : Q.rim.y + 3;
            if (this.bus) this.bus.emit('evening:stroke', { x: ap.x, y: yy, z: ap.z, side: east ? 'E' : 'W' });
            this.toll('great', ap.x, yy, ap.z, { src: 'great' });
          }
        }
        // across the Well: the player is past the gate (on the Span)
        if (this._onSpan(p) >= 1) {
          this._emitLamp(Q.lamps[1]);
          this._breakPawl('lamp', true);
          this._enterPhase('C1');
        }
        break;
      }
      case 'C1': {
        const idx = this._onSpan(p);
        this._plateStep(dt, idx);
        if (this._near(p, Q.tower.landing, 6) && p.y > Q.tower.landing.y - 2) {
          this._emitLamp(Q.lamps[2]);
          this._enterPhase('C2');
        }
        break;
      }
      case 'C2':
        this._cageStep(dt, p);
        break;
      default:
        break;
    }
    void head;
  }

  _ringPos() {
    const m = this._mover('mov-c2-12-great');
    if (!m) return null;
    const a = this.level.byId && this.level.byId['c2-12-great-ring'];
    return a ? { x: a.x, y: a.y, z: a.z } : null;
  }

  _near(p, b, r) {
    return Math.hypot(p.x - b.x, p.z - b.z) <= r && Math.abs(p.y - b.y) <= r + 4;
  }

  /** Which plate of the Span the player is on (index), or -1: the standing plate (feet within 1.5 m over a plate's top and inside its footprint). */
  _onSpan(p) {
    const plates = this.Q.span.plates;
    let best = -1;
    for (let i = 0; i < plates.length; i++) {
      const s = this._solid[plates[i].id];
      if (!s) continue;
      if (p.x >= s.minX - 0.3 && p.x <= s.maxX + 0.3 && p.z >= s.minZ - 0.3 && p.z <= s.maxZ + 0.3 && p.y - s.maxY < 2.2 && p.y - s.maxY > -0.6) best = i;
    }
    return best;
  }

  _roundStep(dt, p) {
    const path = this.Q.roundPath;
    const clusters = this.Q.clusters;
    const lead = this._byId['u-round-0'].usher;
    // the companions walk behind the lead along the same path
    for (let j = 1; j < 5; j++) {
      const u = this._byId[`u-round-${j}`].usher;
      if (u.state === 'STAND' || u.state === 'OFF') {
        const k = Math.max(0, this._front - 1.2 * j);
        const t = path[Math.min(path.length - 1, 3 + Math.floor(k))];
        if (t) u.command('walk', { x: t.x, y: t.y, z: t.z });
      }
    }
    // the lead: snuff the next cluster, unless the player is so far ahead that the Round would only be walking (hold it back)
    const pIdx = this._pathIndex(p);
    const k = this._front;
    if (k >= clusters.length) return;
    if (lead.state === 'STAND' && !this._leadBusy) {
      if (k - pIdx < DIRECTOR.roundAhead / 8 + 1 || pIdx < 0) {
        const c = clusters[k];
        lead.command('snuffAt', { x: c.x, y: c.y, z: c.z });
        this._leadBusy = true;
      }
    } else if (this._leadBusy && lead.state === 'STAND') {
      // the job ended: the cluster is out
      const c = clusters[k];
      this._snuffAt(c.x, c.y, c.z, 2, 'round');
      this._front = k + 1;
      this._leadBusy = false;
    }
    void dt;
  }

  /** The cluster index nearest under the player (a float-ish index into the clusters), or -1. */
  _pathIndex(p) {
    const cl = this.Q.clusters;
    let best = -1;
    let bd = 1e9;
    for (let i = 0; i < cl.length; i++) {
      const d = Math.hypot(p.x - cl[i].x, p.z - cl[i].z) + Math.abs(p.y - cl[i].y) * 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return bd < 30 ? best : -1;
  }

  _plateStep(dt, idx) {
    const st = this._plate;
    const plates = this.Q.span.plates;
    if (!st.started) {
      if (idx >= 10) {
        st.started = true;
        if (this.bus) this.bus.emit('c2:caption', { text: this.text && this.text.boss ? this.text.boss.phaseCaptions[2] : '', kind: 'phase' });
      } else return;
    }
    const gap = Math.max(0, (idx - st.front) * DIRECTOR.plateLen);
    const target = DIRECTOR.collapseGap[this.dk];
    const v = Math.min(12, Math.max(3, DIRECTOR.collapseBase * (1 + (0.5 * (gap - target)) / target)));
    st.front += (v * dt) / DIRECTOR.plateLen;
    // warn 0.7 s ahead of the next plate to fall
    const warnIdx = Math.floor(st.front + (0.7 * v) / DIRECTOR.plateLen);
    while (st.warned <= warnIdx && st.warned < plates.length) {
      const pl = plates[st.warned];
      if (this.bus) this.bus.emit('c2:creak', { x: pl.x, y: pl.y, z: pl.z });
      st.warned++;
    }
    while (Math.floor(st.front) > this.stats.plates - 1 && this.stats.plates < plates.length - 1) this._plateDown(plates[Math.max(0, this.stats.plates)].id);
  }

  _cageStep(dt, p) {
    const c = this._cage;
    const Q = this.Q;
    if (!c.started) return;
    const clock = this.O ? this.O.clock : this.t;
    const e = clock - c.t0;
    const cg = this._cageCenter();
    // a gong plate every 5 m of the shaft: the cage's shoe strikes it
    const travelled = Math.max(0, Q.tower.landing.y - (cg ? cg.y - 1.5 : Q.tower.landing.y));
    while (c.gongs < Math.floor(travelled / 5) && cg) {
      c.gongs++;
      this._cageToll('gong', `gong${c.gongs}`);
    }
    if (c.shutT >= 0) {
      c.shutT -= dt;
      if (c.shutT <= 1.5 && !c.ratchet) {
        c.ratchet = true;
        if (this.bus) this.bus.emit('c2:ratchet', {});
      }
      if (c.shutT <= 0) {
        c.shutT = -1;
        const sh = this._solid['c2-12-shutter'];
        if (sh) {
          sh.active = true;
          sh.fallen = false;
        }
        if (this.bus) this.bus.emit('c2:shutter', {});
        // shut out: above the shutter in the shaft
        const t = Q.tower.throat;
        if (Math.abs(p.x - t.x) < 5.5 && Math.abs(p.z - t.z) < 5.5 && p.y > t.y + 2.4) this._killPlayer('usher');
      }
    }
    void e;
  }

  _emitLamp(l) {
    if (this.bus && l) this.bus.emit('c2:lamp', { id: l.id, x: l.x, y: l.y, z: l.z, yaw: l.yaw || 0, label: l.label, phase: l.phase });
  }

  _killPlayer(cause) {
    if (this._graceT > 0) return;
    this.stats.kills++;
    if (this._kill) this._kill(cause);
  }

  // ---- carriers -------------------------------------------------------------------------------------------------------------------
  _carry(p) {
    if (!this.O || !this.O.movers) return;
    const r = CONFIG.player.radius;
    const clock = this.O.clock;
    for (const c of this._carriers) {
      const m = this._mover(c.id);
      if (!m) continue;
      moverRef(m, clock, _q);
      const stand = _q.y + r;
      const inside = Math.abs(p.x - _q.x) <= c.hx && Math.abs(p.z - _q.z) <= c.hz;
      if (inside && p.y <= stand + DIRECTOR.carrierBand && p.y >= stand - DIRECTOR.carrierBand - Math.max(0, -_q.vy) * 0.03 && p.vy <= _q.vy + 3) {
        p.y = stand;
        p.vy = _q.vy;
        p.grounded = true;
        c.on = true;
      } else c.on = false;
    }
  }

  /** The chain platform's height now (the Mere view lifts the near throat to its eye height). */
  chainY() {
    if (!this.H || !this.O) return 0;
    const m = this._mover(this.H.chain.moverId);
    if (!m) return this.H.chain.y;
    moverRef(m, this.O.clock, _q);
    return _q.y;
  }

  /** Is the player standing on the carrier `id` (the chain platform)? */
  onCarrier(id) {
    for (const c of this._carriers) if (c.id === id) return c.on;
    return false;
  }

  // ---- II-13 --------------------------------------------------------------------------------------------------------------------
  _hookStep(dt, p) {
    const seq = this._seq;
    if (!seq || !this.H) return;
    const m = this._mover(this.H.chain.moverId);
    if (!m) return;
    moverRef(m, this.O.clock, _q);
    const on = this.onCarrier(this.H.chain.moverId) && this._sectionT >= DIRECTOR.hookRest;
    const splash = p.y < this.H.water.y + 1.2;
    seq.update(dt, { onPad: on, platformY: _q.y, splash: splash && seq.started });
    if (seq.wantsStart) {
      m.startAt = this.O.clock;
      seq.begin();
    }
    if (seq.state.phase === 'end' && !this._hookDone) {
      this._hookDone = true;
      if (this._victory) this._victory();
    }
  }

  // ---- the step -------------------------------------------------------------------------------------------------------------------
  step(dt, p) {
    this.t += dt;
    this.clock = this.O ? this.O.clock : this.t;
    if (this._graceT > 0) this._graceT = Math.max(0, this._graceT - dt);
    // the Ushers
    for (const e of this.ushers) e.usher.step(dt);
    if (!p || !p.alive) return;
    this._carry(p);
    const si = this.level.sectionIndexAt(p.y);
    if (si !== this._lastSection) {
      this._lastSection = si;
      this._sectionT = 0;
      if (si === 11 && this.phase === 'off' && this.Q) this._enterPhase('quiet');
    }
    this._sectionT += dt;
    this._namesStep(p);
    if (this._stopping.started && this.O) this._stoppingStep();
    // the sections' scripts
    if (si === 8) this._tenorStep(dt, p);
    if (this.Q && this._c2 && si >= 11 && si <= 12 && this.phase !== 'off') this._doormanStep(dt, p);
    if (si === 12) {
      this._hookStep(dt, p);
      const w = this._solid['c2-13-water'];
      if (w && w.active === false) w.active = true;
    }
    // the sphere kills: only inside a sphere that is lethal now (the Ushers decide), never in the grace
    if (this._graceT <= 0) {
      for (const e of this.ushers) {
        if (e.usher.lethalAt(p.x, p.y, p.z)) {
          this._killPlayer('usher');
          break;
        }
      }
    }
  }

  // ---- snapshots (the lamps: a respawn restores the phase's start; the bots' look-ahead) --------------------------------
  /** The phase to restore on a respawn: the arena lamp nearest to a checkpoint position, or null. */
  lampFor(cp) {
    if (!this.Q || !cp) return null;
    let best = null;
    let bd = 1e9;
    for (const l of this.Q.lamps) {
      const d = Math.hypot(l.x - cp.x, l.y - cp.y, l.z - cp.z);
      if (d < bd) {
        bd = d;
        best = l;
      }
    }
    return best && bd < 6 ? best : null;
  }
}

const _q = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
