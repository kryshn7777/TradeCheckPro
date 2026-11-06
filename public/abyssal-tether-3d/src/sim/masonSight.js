/* THE LANTERN — sim/masonSight.js
 * The Mason's two new senses, laid over its sound hunt (sim/creature3d.js), plans: docs/abyssal-tether-3d/plans/MASON_SIGHT.md.
 *
 *   SIGHT ("When the Mason sees the player it chases"). It is blind to the dark but it sees the LANTERN-BEARER: the player counts as
 *   seen when (a) within `sightRange` of the crown, (b) a clear line runs from the crown or a front block to the player's head or
 *   torso (level.segmentBlocked, sampled every `losEvery` s), (c) the lantern is lit (charge > 0, alive) and (d) nothing rules sight
 *   out: a Masons' rest (refuge 1) or the S5 lure niche (refuge 2), the S4 staged sighting, an objective's override (the S7 escape is
 *   already a chase), the withdraw-free hunt gate keeps it out of play, the game says the view is blocked (not playing, a cutscene),
 *   `?sight=off` / the masonSight setting, Sandbox (no creature at all). The first moment of sight starts the NOTICE beat: a
 *   `creature:notice` event (a designed roar + caption), its red eyes flare; `notice` s of CONTINUOUS sight commit it to the chase
 *   (break the line in time and it does not). Chasing: it pursues along the crawl nav at pursue x `pursueMul`, does not stop to
 *   listen, creep or stalk at its menace distance, and strikes by the existing rules (wind-up telegraph, LOS, refuges). It keeps the
 *   chase for `memory` s after it loses sight, then falls back to the sound hunt. While it chases, the hunt gate's scent hold is
 *   kept full: health no longer sends it away.
 *
 *   NEAR ("no more health stuff if the player is kinda near"). While it chases and the player is within `lethalNear` of its crown /
 *   front blocks (and the hunt is lethal), `near` is true: the game suspends healing (no regen, the regen clock frozen, no bag heals)
 *   and the vitals read NO RECOVERY. A Mason strike that connects was already lethal from any hp (creature3d caughtPlayer -> kill);
 *   it still is. Falls, the Usher, the Dresser, the Holdfast and Sandbox are unchanged.
 *
 *   DECOY (the knocker gadget's contract): distract(x, y, z, {duration, strength}) -> accepted. A short listen turn, a crawl to the
 *   point over the nav, an `inspect` s listen within `arrive` m, then back to the sound hunt. While a decoy is live sight is
 *   suppressed for a player farther than `decoyOverride` (inside it the decoy is dropped and the usual rules apply). After a decoy
 *   ends it is WISE for `wise` s: a new decoy lasts half as long and its listen turn is shorter; a knocker it has inspected is
 *   ignored while wise.
 *
 *   BODY + LEASH (MASON_BODY_SIGHT_LEASH.md): within `bodyRange` it also sees your BODY (any lantern, the same line-of-sight test);
 *   `sight.by` reads 'light' | 'body'. A chase that ends up beyond `leashFar`, or whose memory runs out beyond `leashLost`, is a leash
 *   escape: Creature3D._leashWound (hurt 'leash', withdraw, heal, return).
 *
 * Deterministic (no Math.random, no clock but dt), allocation-free per frame (event payloads only on the rare events), Node-safe.
 */

import { CONFIG } from './config3d.js';

/**
 * Per-difficulty numbers (metres, seconds). Unknown keys use normal. (Plain objects: the pacing tool's SIGHT env patches them.)
 *   firstHold  the first notice in a section (and after a respawn) is only a warning: no chase for this long
 *   cooldown   after a chase ends (lost, a rest, a refuge, a decoy) it cannot commit again for this long (it searches by sound)
 *   prowl      the hunt gate (health) no longer keeps it away: while you are well it makes PASSES through a hunting section, in play but
 *              harmless until it sees you: the first `first` s after a section entry / respawn, then every gapMin..gapMax s, `dur` s each
 * MASON_BODY_SIGHT_LEASH.md:
 *   bodyRange  it sees your BODY this close in a clear line whatever the lantern does (lit, hooded, empty); beyond it only the light shows
 *   leashFar   a chase that ends up this far from you is a leash escape (1.3 x sightRange): it is wounded and falls back
 *   leashLost  ... and so is a chase whose memory runs out while you are farther than this (= sightRange: beyond every sense it has)
 *   heal       s the leash wound keeps it out of play (its own timer: not the weapons' fright, not their diminishing window)
 */
export const SIGHT_TUNE = {
  normal: { sightRange: 30, bodyRange: 12, leashFar: 39, leashLost: 30, heal: 12, notice: 0.5, pursueMul: 1.0, memory: 3, lethalNear: 8, decoyOverride: 5, hearRange: 60, firstHold: 8, cooldown: 20, prowl: { first: 20, gapMin: 50, gapMax: 80, dur: 30 } },
  nightmare: { sightRange: 38, bodyRange: 14, leashFar: 49, leashLost: 38, heal: 10, notice: 0.5, pursueMul: 1.0, memory: 3, lethalNear: 9.5, decoyOverride: 6, hearRange: 66, firstHold: 8, cooldown: 18, prowl: { first: 16, gapMin: 40, gapMax: 65, dur: 35 } },
  abyss: { sightRange: 46, bodyRange: 16, leashFar: 60, leashLost: 46, heal: 8, notice: 0.5, pursueMul: 1.05, memory: 4, lethalNear: 11, decoyOverride: 7, hearRange: 72, firstHold: 6, cooldown: 14, prowl: { first: 12, gapMin: 30, gapMax: 50, dur: 40 } },
};

/** MASON_BODY_SIGHT_LEASH.md, shared: the wound a leash escape deals (hurt(amount, 'leash')). */
export const LEASH = Object.freeze({ amount: 1 });

/** Shared numbers. */
export const SIGHT_COMMON = Object.freeze({
  losEvery: 0.1, // s between line-of-sight samples
  noticeCd: 3, // s: a creature:notice is not repeated sooner (glimpses do not spam the roar)
  flareTime: 0.9, // s the eye flare takes to fade after the notice beat
  front: 3, // spine points (crown first) that can see / count for the near radius
  losClear: 0.3, // m of the line at the player's end that is ignored (the player's own body)
});

export const DECOY_TUNE = Object.freeze({
  turn: 0.8, // s: the listen turn before it moves off toward the knocker
  turnWise: 0.35, // ... when wise
  arrive: 3, // m: within this of the point it stops and inspects
  inspect: 3, // s of inspecting (listening posture, pits lit)
  wise: 20, // s after a decoy ends in which a new one is halved
  wiseMul: 0.5,
  maxDur: 20, // s: the most any call may ask for
  knownRadius: 4, // m: a knocker it inspected is ignored while wise
  stuckNear: 10, // m: closer than this and no progress for `stuckTime` s counts as arrived (the knocker lies off the masonry)
  stuckTime: 2,
  stuckGain: 0.5,
});

const len3 = (x, y, z) => Math.sqrt(x * x + y * y + z * z);
const fin = (v) => typeof v === 'number' && isFinite(v);

export class MasonSense {
  /** @param {Creature3D} c  the Mason (variants: the sense stays off) */
  constructor(c) {
    this.c = c;
    this.tune = SIGHT_TUNE[c.tuneKey] || SIGHT_TUNE.normal;
    this.enabled = !c.v;
    // inputs (game.js every frame; Node: defaults = on, lit, unblocked)
    this.on = true;
    this.lit = true;
    this.blocked = false;
    /** Public read-out (debug / view / tests). */
    this.sight = { on: true, eligible: false, sees: false, notice: 0, noticing: false, chasing: false, lost: 0, lkx: 0, lky: 0, lkz: 0, near: false, nearDist: 1e9, forced: '', by: '' };
    this.decoy = { live: false, x: 0, y: 0, z: 0, left: 0, phase: '', t: 0, turn: 0, wise: false, travel: 0, best: 1e9, bestT: 0 };
    this.stats = { notices: 0, chases: 0, lost: 0, decoys: 0, inspected: 0, timeouts: 0, overridden: 0, refused: 0, nearTime: 0, leashes: 0 };
    this.flare = 0;
    this.wiseT = 0;
    this._kx = 0;
    this._ky = 0;
    this._kz = 0;
    this._knownT = 0;
    this._losT = 0;
    this._vis = false;
    this._noticeCd = 0;
    this._firstT = 0; // > 0: the section's first notice holds the chase off (SIGHT_TUNE.firstHold)
    this._first = true; // the next notice is the section's first (a new section or a respawn)
    this._sec = -1;
    this._coolT = 0; // > 0: no commit (SIGHT_TUNE.cooldown after a chase)
    this._proxy = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, alive: true };
    this.reset();
  }

  /** New run / respawn: no chase, no decoy, not wise. */
  reset() {
    const s = this.sight;
    s.eligible = false;
    s.sees = false;
    s.notice = 0;
    s.noticing = false;
    s.chasing = false;
    s.lost = 0;
    s.near = false;
    s.nearDist = 1e9;
    s.by = '';
    this.decoy.live = false;
    this.decoy.phase = '';
    this.flare = 0;
    this.wiseT = 0;
    this._knownT = 0;
    this._losT = 0;
    this._vis = false;
    this._noticeCd = 0;
    this._firstT = 0;
    this._first = true;
    this._coolT = 0;
  }

  /** game.js per frame: on = sight switched on (?sight=off / setting), lit = the lantern shows, blocked = no view now (cutscene, not playing). */
  setInput(on, lit, blocked) {
    this.on = on !== false;
    this.lit = lit !== false;
    this.blocked = !!blocked;
    this.sight.on = this.on;
  }

  /** Debug: '' = the sim decides, 'see' = always seen when eligible-but-unseen (range/LOS ignored), 'blind' = never seen. */
  force(mode) {
    this.sight.forced = mode === 'see' || mode === 'blind' ? mode : '';
  }

  /** Per frame from Creature3D.update (before the hunt gate). */
  update(dt, player) {
    if (!this.enabled) return;
    const c = this.c;
    const s = this.sight;
    const d = this.decoy;
    if (this.wiseT > 0) this.wiseT -= dt;
    if (this._knownT > 0) this._knownT -= dt;
    if (this._noticeCd > 0) this._noticeCd -= dt;
    if (this._firstT > 0) this._firstT -= dt;
    if (this._coolT > 0) this._coolT -= dt;
    if (c.sectionIndex !== this._sec) {
      this._sec = c.sectionIndex; // a new section: its first notice is a warning only
      this._first = true;
    }
    if (this.flare > 0) this.flare = Math.max(0, this.flare - dt / SIGHT_COMMON.flareTime);
    if (d.live && (!c.inPlay || c.victory || c._withdraw || c._override || c.refuge === 2 || c.sighting)) this.endDecoy('overridden');

    const alive = player.alive !== false;
    const px = player.x;
    const py = player.y;
    const pz = player.z;
    // (inline arithmetic, no helper calls: a double returned from / passed to a call is a heap number per frame)
    let ex = px - c.x;
    let ey = py - c.y;
    let ez = pz - c.z;
    const pd = Math.sqrt(ex * ex + ey * ey + ez * ez);
    // nearest of the crown / front blocks (the near radius is measured there, not only at the head)
    let nd2 = pd * pd;
    const sp = c.body.spine;
    for (let i = 1; i < SIGHT_COMMON.front; i++) {
      ex = px - sp[i * 3];
      ey = py - sp[i * 3 + 1];
      ez = pz - sp[i * 3 + 2];
      const q = ex * ex + ey * ey + ez * ez;
      if (q < nd2) nd2 = q;
    }
    const nd = Math.sqrt(nd2);
    s.nearDist = c.inPlay ? nd : 1e9;

    const decoyHolds = d.live && pd > this.tune.decoyOverride;
    // the pacing waves: it does not see you while it RECOVERS (after a strike, or out of stamina) nor in an entry / respawn grace; the
    // chase ends there and must be noticed again (a fresh warning each wave). The hunt gate's withdraw (also RECOVERING) can still see.
    const resting = (c.state === 'RECOVERING' && !c._withdraw) || c.grace > 0 || this._coolT > 0;
    // `canSee`: it can see you at all; `eligible`: it can also notice / commit (not resting). While it rests or cools down it still
    // SEES you (s.sees: the hunt gate keeps its scent window full: health does not send away a Mason that is looking at you).
    const canSee =
      this.on && !this.blocked && alive && c.active && c.inPlay && !c.victory && !c.sighting && !c._override && c.refuge === 0 && !decoyHolds && s.forced !== 'blind' && !(c._frightT > 0) && !(c._woundT > 0); // (frightened: SOLDIER_WEAPONS.md; leash-wounded)
    const eligible = canSee && !resting;
    s.eligible = eligible;
    if (d.live && !decoyHolds) this.endDecoy('overridden'); // walked up to it: the decoy no longer holds it
    if (!eligible) {
      if (s.chasing) this._drop(false);
      s.notice = 0;
      s.noticing = false;
      s.near = false;
    }
    if (!canSee) {
      s.sees = false;
      s.by = '';
      this._vis = false;
      return;
    }

    // line of sight, sampled
    this._losT -= dt;
    if (this._losT <= 0) {
      this._losT = SIGHT_COMMON.losEvery;
      // the light (lit, within sightRange) or the BODY (within bodyRange, any lantern): one line-of-sight test (MASON_BODY_SIGHT_LEASH.md)
      const light = this.lit && pd <= this.tune.sightRange;
      const body = pd <= this.tune.bodyRange;
      this._vis = s.forced === 'see' || ((light || body) && this._los(player));
      s.by = this._vis ? (light || s.forced === 'see' ? 'light' : 'body') : '';
    }
    s.sees = this._vis;
    if (!eligible) return;

    if (s.sees) {
      s.lkx = px;
      s.lky = py;
      s.lkz = pz;
      if (s.chasing) s.lost = 0;
      else {
        if (!s.noticing) {
          s.noticing = true;
          s.notice = 0;
          this.flare = 1;
          if (this._first) {
            this._first = false;
            this._firstT = this.tune.firstHold; // you just arrived: a warning, not yet a chase
          }
          if (this._noticeCd <= 0) {
            this._noticeCd = SIGHT_COMMON.noticeCd;
            this.stats.notices++;
            c._emit('creature:notice', { x: c.x, y: c.y, z: c.z, distance: pd, commit: this.tune.notice, by: s.by });
          }
        }
        s.notice += dt;
        if (s.notice >= this.tune.notice && this._firstT <= 0) this._commit(pd);
      }
    } else if (s.chasing) {
      s.lost += dt;
      if (s.lost >= this.tune.memory) {
        // MASON_BODY_SIGHT_LEASH.md: lost beyond every sense it has (to distance, not to a wall or the hood): a leash escape
        if (pd > this.tune.leashLost) this._leash(pd);
        else this._drop(true);
      }
    } else {
      s.noticing = false; // the notice needs continuous sight
      s.notice = 0;
    }
    if (s.chasing && pd > this.tune.leashFar) this._leash(pd); // the player got too far away: a leash escape
    const was = s.near;
    s.near = s.chasing && c.lethal && nd <= this.tune.lethalNear;
    if (s.near) this.stats.nearTime += dt;
    if (s.near && !was) c._emit('creature:near', { on: true, x: c.x, y: c.y, z: c.z, distance: nd }); // the caption: [No recovery this close]
  }

  /** Clear line from the crown or a front block to the player's head or torso. */
  _los(p) {
    const px = p.x;
    const py = p.y;
    const pz = p.z;
    const lv = this.c.level;
    if (!lv || typeof lv.segmentBlocked !== 'function') return true;
    const c = this.c;
    const sp = c.body.spine;
    const eye = CONFIG.player.eyeHeight;
    const cl = SIGHT_COMMON.losClear;
    if (!lv.segmentBlocked(c.x, c.y, c.z, px, py + eye, pz, cl)) return true;
    if (!lv.segmentBlocked(c.x, c.y, c.z, px, py, pz, cl)) return true;
    return !lv.segmentBlocked(sp[6], sp[7], sp[8], px, py + eye, pz, cl);
  }

  _commit(pd) {
    const c = this.c;
    const s = this.sight;
    s.chasing = true;
    s.noticing = false;
    s.lost = 0;
    this.stats.chases++;
    c.listening = false;
    c.creeping = false;
    c.staring = false;
    const st = c.state;
    if (st === 'APPROACHING' || st === 'OBSERVING') c._setState('PURSUING');
    c._emit('creature:sight', { on: true, x: c.x, y: c.y, z: c.z, distance: pd });
  }

  _drop(memoryOut, cool = true, reason = '') {
    const s = this.sight;
    const c = this.c;
    s.chasing = false;
    s.noticing = false;
    s.notice = 0;
    s.lost = 0;
    s.near = false;
    if (cool) this._coolT = this.tune.cooldown; // it searches by sound for a while before it can commit again (not after a decoy)
    if (memoryOut) this.stats.lost++;
    c._emit('creature:sight', { on: false, x: c.x, y: c.y, z: c.z, distance: c.distance, reason: reason || (memoryOut ? 'lost' : 'blocked') });
  }

  /**
   * MASON_BODY_SIGHT_LEASH.md: the chase ends because the player got too far (beyond leashFar, or its memory ran out beyond leashLost).
   * A scripted beat: a plain 'lost' drop (with its cooldown), no wound. Otherwise the chase drops with reason 'leash' and NO cooldown
   * (the wound is the cost) and the creature takes the wound (Creature3D._leashWound: hurt, withdraw, heal, return).
   */
  _leash(pd) {
    const c = this.c;
    if (c.scriptedNow) {
      c.stats.leashSkips++;
      this._drop(true);
      return;
    }
    this.stats.leashes++;
    this._drop(false, false, 'leash');
    this._vis = false;
    this.sight.sees = false;
    this.sight.by = '';
    c._leashWound(pd);
  }

  // ---- the decoy (knocker) ----------------------------------------------------------------------------------------------------

  /** Creature3D.distract: see the file header. */
  distract(x, y, z, opts) {
    const c = this.c;
    const d = this.decoy;
    const D = DECOY_TUNE;
    if (!this.enabled || !fin(x) || !fin(y) || !fin(z)) return false;
    if (!c.active || !c.inPlay || c.victory || c.sighting || c._override || c._withdraw || c.refuge === 2 || (c.state === 'ATTACK' && !c.coiledFree)) {
      this.stats.refused++;
      return false;
    }
    const o = opts || null;
    const dur = Math.min(D.maxDur, Math.max(0.5, o && fin(o.duration) ? o.duration : 9));
    const strength = Math.min(2, Math.max(0.25, o && fin(o.strength) ? o.strength : 1));
    if (len3(x - c.x, y - c.y, z - c.z) > this.tune.hearRange * strength) {
      this.stats.refused++;
      return false;
    }
    // the player has walked up to it: the knocker does not pull it off you
    if (len3(c._px - c.x, c._py - c.y, c._pz - c.z) <= this.tune.decoyOverride) {
      this.stats.refused++;
      return false;
    }
    if (this._knownT > 0 && len3(x - this._kx, y - this._ky, z - this._kz) <= D.knownRadius) {
      this.stats.refused++;
      return false;
    }
    const mul = d.live ? (d.wise ? D.wiseMul : 1) : this.wiseT > 0 ? D.wiseMul : 1;
    if (d.live) {
      // a refresh (the knocker clacks again): the point moves, the life is the longest asked
      const moved = len3(x - d.x, y - d.y, z - d.z) > D.arrive;
      d.x = x;
      d.y = y;
      d.z = z;
      d.left = Math.max(d.left, dur * mul);
      if (moved && d.phase === 'inspect') this._travel();
      return true;
    }
    d.live = true;
    d.wise = this.wiseT > 0;
    d.x = x;
    d.y = y;
    d.z = z;
    d.left = dur * mul;
    d.turn = d.wise ? D.turnWise : D.turn;
    d.phase = 'turn';
    d.t = 0;
    d.travel = 0;
    d.best = 1e9;
    d.bestT = 0;
    this.stats.decoys++;
    const s = this.sight;
    if (s.chasing) this._drop(false, false);
    s.noticing = false;
    s.notice = 0;
    c.creeping = false;
    c.staring = false;
    c.burstCommit = false;
    c.listening = true; // the listen turn: pits lit, the crown toward the sound
    c.stateDur = 1e9;
    if (c.state === 'OBSERVING') c.stateTime = 0;
    else c._setState('OBSERVING');
    c._navT = 0;
    c._emit('creature:distracted', { x, y, z, duration: d.left });
    return true;
  }

  _travel() {
    const c = this.c;
    const d = this.decoy;
    d.phase = 'travel';
    d.t = 0;
    d.best = 1e9;
    d.bestT = 0;
    c.listening = false;
    c._setState('APPROACHING');
    c._navT = 0;
  }

  endDecoy(reason) {
    const d = this.decoy;
    if (!d.live) return;
    const c = this.c;
    d.live = false;
    d.phase = '';
    this.wiseT = DECOY_TUNE.wise;
    if (reason === 'inspected') {
      this._kx = d.x;
      this._ky = d.y;
      this._kz = d.z;
      this._knownT = DECOY_TUNE.wise;
      this.stats.inspected++;
    } else if (reason === 'timeout') this.stats.timeouts++;
    else this.stats.overridden++;
    if (c.inPlay && !c._withdraw && c.state === 'OBSERVING') {
      c.listening = false;
      c._setState('APPROACHING');
    }
    c._navT = 0;
    c._emit('creature:decoy:end', { reason, x: d.x, y: d.y, z: d.z });
  }

  /**
   * Creature3D._updateHunt: runs the frame while a decoy holds it (returns true: the normal state machine is skipped this frame).
   */
  decoyStep(dt) {
    const d = this.decoy;
    if (!d.live) return false;
    const c = this.c;
    if (c.state === 'ATTACK' || c.state === 'BURST') return false;
    d.left -= dt;
    if (d.left <= 0) {
      this.endDecoy('timeout');
      return false;
    }
    const dd = len3(d.x - c.x, d.y - c.y, d.z - c.z);
    d.t += dt;
    if (d.phase === 'turn') {
      if (c.state !== 'OBSERVING') c._setState('OBSERVING');
      c.listening = true;
      if (d.t >= d.turn) this._travel();
    } else if (d.phase === 'travel') {
      d.travel += dt;
      if (dd < d.best - DECOY_TUNE.stuckGain) {
        d.best = dd;
        d.bestT = 0;
      } else d.bestT += dt;
      if (dd <= DECOY_TUNE.arrive || (dd <= DECOY_TUNE.stuckNear && d.bestT >= DECOY_TUNE.stuckTime)) {
        d.phase = 'inspect';
        d.t = 0;
        c.listening = true;
        c.stateDur = 1e9;
        c._setState('OBSERVING');
      }
    } else if (d.phase === 'inspect') {
      if (c.state !== 'OBSERVING') c._setState('OBSERVING');
      c.listening = true;
      if (d.t >= DECOY_TUNE.inspect) {
        this.endDecoy('inspected');
        return false;
      }
    }
    // steer toward the knocker (its velocity is nil: the Mason's lead uses the player's, zeroed for this step)
    const q = this._proxy;
    q.x = d.x;
    q.y = d.y;
    q.z = d.z;
    const vx = c._pvx;
    const vy = c._pvy;
    const vz = c._pvz;
    c._pvx = 0;
    c._pvy = 0;
    c._pvz = 0;
    c._decoyGo = d.phase === 'travel';
    c._steerHunt(dt, q, dd, c.y - d.y);
    c._decoyGo = false;
    c._pvx = vx;
    c._pvy = vy;
    c._pvz = vz;
    return true;
  }
}
