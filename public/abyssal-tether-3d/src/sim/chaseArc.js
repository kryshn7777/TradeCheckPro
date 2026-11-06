/* THE LANTERN — sim/chaseArc.js
 * THE CHASE ARC (plans/CHASE_ARC.md): a Mason chase gets a beginning and, above all, a RELEASE. This module only listens to the bus and
 * keeps the book of one chase at a time; the glue (chaseGlue.js) turns its two events into the heartbeat, the exhale, the toast and the
 * music duck.
 *
 *   in   creature:notice  {distance}               the Mason saw your light (sim/masonSight.js): a chase MAY follow (pending)
 *        creature:sight   {on:true}                 it committed: the chase is on                       -> chase:start {}
 *        creature:sight   {on:false, reason}        'lost' (its memory ran out) / 'blocked' (a rest, a decoy, its recovery ...):
 *                                                   the SETTLE window opens (MERGE s). A re-notice / re-commit inside it is the same
 *                                                   chase; when it closes                               -> chase:lost {duration, closest,
 *                                                                                                            knockers, nearMisses}
 *        creature:strike  {hit}                     a miss = a near miss; a hit = it caught you: the chase ends with NO lost
 *        knocker:throw                              a knocker thrown during the chase
 *        player:death                               the chase ends with NO lost (and nothing more until a respawn / a new run)
 *        game:start / game:restart / game:menu / game:respawn / game:victory: forget the chase, silently
 *   update(dt, nearDist)   once a frame while playing: the clock, the settle window, the closest distance (the Mason's
 *                          `sight.nearDist`: the nearest of its crown / front blocks, 1e9 when it is not in play)
 *
 * duration = from the first notice (or the commit, when the notice was on cooldown) to the moment sight was lost (the last sight-off of a
 * merged chase), seconds; closest = metres (the smallest nearDist / notice distance seen from the notice to the lost); knockers and
 * nearMisses are counts. Skitterlings (payload.skit) are not the Mason and are ignored.
 * Deterministic (no Math.random, the clock is the sum of dt), allocation-free per frame; the two payloads are reused objects (copy them).
 */

export const CHASE = Object.freeze({
  merge: 3, // s: a re-notice within this of losing it is the same chase (and the release waits this long)
  pending: 1.5, // s: a notice that does not commit within this was a glimpse, not a chase
  far: 1e8, // nearDist at or beyond this = not measured (the Mason is out of play)
});

export const CHASE_STATE = Object.freeze({ IDLE: 0, PENDING: 1, CHASING: 2, SETTLE: 3 });
const S = CHASE_STATE;
const STATE_NAMES = Object.freeze(['idle', 'pending', 'chasing', 'settle']);

const fin = (v) => typeof v === 'number' && isFinite(v);

export class ChaseArc {
  /** @param {EventBus} bus  the game's bus (on / emit); null = drive it by hand (onNotice ... ) */
  constructor(bus) {
    this.bus = bus || null;
    this.state = S.IDLE;
    this.t = 0; // the arc's clock (sum of dt)
    this.dead = false; // after player:death: nothing until a respawn / new run
    this.startT = 0;
    this.lostT = 0;
    this.pendT = 0; // pending window left
    this.settleT = 0; // settle window left
    this.started = false; // chase:start was emitted for this chase
    this.closest = 1e9;
    this.knockers = 0;
    this.nearMisses = 0;
    this.lastReason = '';
    this.stats = { starts: 0, lost: 0, merged: 0, glimpses: 0, caught: 0, deaths: 0, cancelled: 0 };
    this._startP = {};
    this._lostP = { duration: 0, closest: 0, knockers: 0, nearMisses: 0 };
    this.last = { duration: 0, closest: 0, knockers: 0, nearMisses: 0, at: -1 }; // the last chase:lost (debug / tests)
    this._offs = [];
    if (this.bus && typeof this.bus.on === 'function') {
      const on = (type, fn) => {
        const off = this.bus.on(type, fn);
        if (typeof off === 'function') this._offs.push(off);
      };
      on('creature:notice', (p) => this.onNotice(p));
      on('creature:sight', (p) => (p && p.on ? this.onCommit(p) : this.onSightOff(p ? p.reason : '')));
      on('creature:strike', (p) => this.onStrike(p));
      on('knocker:throw', () => this.onKnocker());
      on('player:death', () => this.onDeath());
      const fresh = () => this.reset();
      on('game:start', fresh);
      on('game:restart', fresh);
      on('game:menu', fresh);
      on('game:respawn', fresh);
      on('game:victory', fresh);
    }
  }

  get stateName() {
    return STATE_NAMES[this.state];
  }
  /** A chase is on (committed and not yet lost). */
  get chasing() {
    return this.state === S.CHASING;
  }
  /** A chase:start went out and its chase:lost (or its silent end) has not happened yet. */
  get live() {
    return this.started && (this.state === S.CHASING || this.state === S.SETTLE || this.state === S.PENDING);
  }

  /** Forget everything (a new run, the menu, a respawn): no event. */
  reset() {
    if (this.started && this.state !== S.IDLE) this.stats.cancelled++;
    this.state = S.IDLE;
    this.dead = false;
    this.started = false;
    this.pendT = 0;
    this.settleT = 0;
  }

  detach() {
    for (const off of this._offs) off();
    this._offs.length = 0;
  }

  _fresh(dist) {
    this.startT = this.t;
    this.lostT = this.t;
    this.closest = fin(dist) && dist < CHASE.far ? dist : 1e9;
    this.knockers = 0;
    this.nearMisses = 0;
    this.started = false;
    this.lastReason = '';
  }

  _near(d) {
    if (d < this.closest && d >= 0 && d < CHASE.far) this.closest = d;
  }

  onNotice(p) {
    if (this.dead) return;
    const d = p && fin(p.distance) ? p.distance : NaN;
    if (this.state === S.IDLE) {
      this._fresh(d);
      this.state = S.PENDING;
      this.pendT = CHASE.pending;
    } else if (this.state === S.SETTLE) {
      // a re-notice inside the merge window: hold the release open long enough for its commit
      if (this.settleT < CHASE.pending) this.settleT = CHASE.pending;
      if (fin(d)) this._near(d);
    } else if (fin(d)) this._near(d);
  }

  onCommit(p) {
    if (this.dead) return;
    const d = p && fin(p.distance) ? p.distance : NaN;
    if (this.state === S.IDLE) this._fresh(d); // the notice was on its cooldown: the chase starts at the commit
    else if (fin(d)) this._near(d);
    if (this.state === S.SETTLE) this.stats.merged++;
    this.state = S.CHASING;
    this.pendT = 0;
    this.settleT = 0;
    if (!this.started) {
      this.started = true;
      this.stats.starts++;
      if (this.bus) this.bus.emit('chase:start', this._startP);
    }
  }

  onSightOff(reason) {
    if (this.dead || this.state !== S.CHASING) return;
    this.state = S.SETTLE;
    this.lostT = this.t;
    this.settleT = CHASE.merge;
    this.lastReason = reason === 'lost' || reason === 'blocked' ? reason : 'lost';
  }

  onStrike(p) {
    if (this.dead || this.state === S.IDLE || (p && p.skit)) return;
    if (p && p.hit) {
      // it caught you: that is not an escape. No release.
      this.stats.caught++;
      this.state = S.IDLE;
      this.started = false;
      return;
    }
    this.nearMisses++;
    if (p && fin(p.distance)) this._near(p.distance);
  }

  onKnocker() {
    if (this.dead || this.state === S.IDLE) return;
    this.knockers++;
  }

  onDeath() {
    if (this.state !== S.IDLE) this.stats.deaths++;
    this.state = S.IDLE;
    this.started = false;
    this.dead = true;
  }

  /** Per frame while playing. nearDist: the Mason's crown / front-block distance to the player (m), >= 1e8 = not measured. */
  update(dt, nearDist) {
    if (this.state === S.IDLE) return;
    if (!(dt > 0)) dt = 0;
    this.t += dt;
    if (fin(nearDist)) this._near(nearDist);
    if (this.state === S.PENDING) {
      this.pendT -= dt;
      if (this.pendT <= 0) {
        this.state = S.IDLE; // a glimpse broken in time: no chase
        this.stats.glimpses++;
      }
    } else if (this.state === S.SETTLE) {
      this.settleT -= dt;
      if (this.settleT <= 0) this._lost();
    }
  }

  /** The release: it really is gone. */
  _lost() {
    this.state = S.IDLE;
    if (!this.started || this.dead) return;
    this.started = false;
    this.stats.lost++;
    const L = this._lostP;
    L.duration = Math.max(0, this.lostT - this.startT);
    L.closest = this.closest;
    L.knockers = this.knockers;
    L.nearMisses = this.nearMisses;
    const R = this.last;
    R.duration = L.duration;
    R.closest = L.closest;
    R.knockers = L.knockers;
    R.nearMisses = L.nearMisses;
    R.at = this.t;
    if (this.bus) this.bus.emit('chase:lost', L);
  }

  /** Debug / tests: start a chase now (as a commit at `dist` m). */
  forceStart(dist) {
    this.dead = false;
    this.onCommit({ on: true, distance: fin(dist) ? dist : 12 });
    return this.chasing;
  }

  /** Debug / tests: lose it now (skips the settle window). Returns true when a chase:lost went out. */
  forceLost() {
    if (this.state === S.CHASING) this.onSightOff('lost');
    if (this.state !== S.SETTLE) return false;
    const before = this.stats.lost;
    this._lost();
    return this.stats.lost > before;
  }

  debugState() {
    return {
      state: this.stateName,
      t: Math.round(this.t * 100) / 100,
      started: this.started,
      dead: this.dead,
      elapsed: this.state === S.IDLE ? 0 : Math.round(((this.state === S.SETTLE ? this.lostT : this.t) - this.startT) * 100) / 100,
      closest: this.closest < CHASE.far ? Math.round(this.closest * 100) / 100 : null,
      knockers: this.knockers,
      nearMisses: this.nearMisses,
      settle: Math.round(Math.max(0, this.settleT) * 100) / 100,
      last: Object.assign({}, this.last),
      stats: Object.assign({}, this.stats),
    };
  }
}
