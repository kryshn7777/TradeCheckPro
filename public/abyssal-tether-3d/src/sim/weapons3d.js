/* THE LANTERN (ABYSSAL TETHER 3D) — weapons3d.js
 * THE SOLDIERS' WEAPONS (plans/SOLDIER_WEAPONS.md). Owner: "you can find random grenades or weapons of previous dead soldiers. You can
 * use that to hurt the mason. You can use that to hurt the skitterlings. The grenade instantly damages it and makes it frightened and
 * goes away for some time. The guns do the same as well."
 *
 * Lore: an earlier expedition's security detail went down armed and did not come back; their kit lies by their bodies (sim/pickups3d.js
 * pickWeapons). Iron does not kill what the walls are made of, but it HURTS it, and the Mason flees what hurts it.
 *
 *   GRENADE (ITEM.GRENADE, cap 3)  thrown exactly like the knocker (G held = charge, the same arc; VR: pulled from the bag and thrown by
 *       the hand; touch: a tap lob). The fuse is lit on the throw: WEAPONS.grenade.fuse = 2.2 s with a sizzle ('grenade:fizz' every
 *       0.3 s), it bounces and settles like the knocker (heavier: restitution 0.3), and goes off when the fuse ends, or at once on a hard
 *       hit (>= 2.5 m/s) within 1.1 m of the Mason's body / 0.7 m of a skitterling. The blast (radius 6.5 m): an EFFECT per target, 1
 *       within 2.5 m falling to 0.55 at the edge, x 0.35 when masonry stands between (level.segmentBlocked); >= 0.3 counts:
 *         the Mason       frighten(withdraw[diff] x (0.6 + 0.4 effect)) + hurt (it screeches, recoils, climbs away and stays away);
 *                         in a scripted beat it only staggers (Creature3D.frighten decides)
 *         a skitterling   killed (SkitterGroup.kill: a gory splat, out of the group)
 *         the swarm       roaches.burstAt: the swarm scatters from the crack
 *         YOU             within 2 m with a clear line: lethal (1.0 of health); out to the radius up to 0.45 falling to 0, x the line's
 *                         damping (pendingDamage, the game applies it through Health3D.damage(cause 'blast'); a death is a 'hazard' death)
 *   SERVICE REVOLVER (ITEM.SIDEARM: the count is ROUNDS, found with 6, cap 12)  fired along the aim (desktop: the view centre; VR: the
 *       hand that drew it, on the grip's release; touch: the view). Hitscan to 45 m against the level (the first solid stops it), the
 *       Mason's generous hit volumes (Creature3D.rayHit: the crown and front blocks x1.6) and the skitterlings (SkitterGroup.rayHit). One
 *       round per shot, fireCooldown 0.45 s, an empty cylinder clicks. The Mason hit: frighten(withdraw x 0.7) + hurt. A skitterling hit:
 *       killed. A shot is LOUD: unless it hit the Mason, Creature3D.hearShot wakes it to the shooter (sound, not sight) or brings its next
 *       prowl pass close: shooting blindly costs you.
 *
 * Pure and deterministic: no three.js, no DOM, no Math.random, no allocation per frame (the slots, the event payloads and the scratch are
 * reused). Node runs it for the tests.
 *
 * Bus events: 'grenade:throw' {x,y,z,vx,vy,vz,speed}, 'grenade:bounce' {x,y,z,speed,kind,ny}, 'grenade:fizz' {x,y,z,left},
 *   'grenade:blast' {x,y,z,radius,mason,skitters,self,lethal}, 'revolver:fire' {x,y,z,dx,dy,dz,hit,hx,hy,hz,dist,left},
 *   'revolver:dry' {}, 'weapon:hit' {target,source,x,y,z}, 'weapon:refuse' {kind,reason}.
 */

import { CONFIG } from './config3d.js';
import { ITEM } from './inventory3d.js';
import { ballistic } from './knocker3d.js';

/** Every number of the weapons (tune here). */
export const WEAPONS = Object.freeze({
  grenade: Object.freeze({
    cap: 3, // CONFIG.bag.caps[ITEM.GRENADE]
    fuse: 2.2, // s from the throw
    fizzEvery: 0.3, // s between 'grenade:fizz' (the sizzle follows it)
    radius: 6.5, // m: the blast
    full: 2.5, // m: full effect inside this
    edge: 0.55, // effect at the radius
    losDamp: 0.35, // x when masonry stands between
    hitMin: 0.3, // the least effect that counts
    contact: 1.1, // m to the Mason's nearest block: a hard hit goes off
    contactSkit: 0.7, // m to a skitterling
    contactSpeed: 2.5, // m/s: a hit at least this fast
    cooldown: 1.0, // s between two throws
    maxProps: 3, // slots
    gravity: CONFIG.player.gravity,
    drag: 0.08,
    radiusObj: 0.05,
    restitution: 0.3,
    friction: 0.55,
    restVn: 1.2,
    restVt: 0.7,
    settleMax: 1.5,
    substep: 1 / 120,
    spin: 2.0,
    lostDrop: 80, // m below the throw: it falls on, it still goes off (far below, heard)
    hurt: 2, // wounds a full blast deals the Mason
    flash: 0.18, // s the blast is drawn
  }),
  self: Object.freeze({ lethal: 2.0, max: 0.45 }), // you: within `lethal` m (clear line) the blast kills; out to the radius up to `max`
  withdraw: Object.freeze({ normal: 40, sandbox: 40, nightmare: 32, abyss: 24 }), // s the Mason stays away after a full grenade hit
  revolver: Object.freeze({
    cap: 12, // CONFIG.bag.caps[ITEM.SIDEARM] (rounds)
    cooldown: 0.45, // s between two shots
    range: 45, // m
    shotMul: 0.7, // x the grenade's withdraw
    hurt: 1,
    pad: 1.15, // x the Mason's hit volumes (Creature3D.rayHit)
  }),
});

export const GSTATE = Object.freeze({ FREE: 0, HELD: 1, FLIGHT: 2, REST: 3, BLAST: 4 });

/** The withdraw (s) a full grenade hit asks for on a difficulty key. */
export function withdrawFor(diffKey, source) {
  const W = WEAPONS.withdraw;
  const base = W[diffKey] != null ? W[diffKey] : W.normal;
  return source === 'shot' ? base * WEAPONS.revolver.shotMul : base;
}

/** The blast's effect at distance d (m) with a clear line (1 inside `full`, `edge` at the radius, 0 beyond). */
export function blastEffect(d) {
  const G = WEAPONS.grenade;
  if (!(d <= G.radius)) return 0;
  if (d <= G.full) return 1;
  return 1 - ((1 - G.edge) * (d - G.full)) / (G.radius - G.full);
}

/** The damage (0..1 of health) the blast deals the player at distance d; `clear` = no masonry between. */
export function selfDamage(d, clear) {
  const G = WEAPONS.grenade;
  const S = WEAPONS.self;
  if (!(d <= G.radius)) return 0;
  if (d < S.lethal && clear) return 1;
  const k = d < S.lethal ? 1 : 1 - (d - S.lethal) / (G.radius - S.lethal);
  return S.max * k * (clear ? 1 : G.losDamp);
}

const _hit = { t: 0, solid: null, x: 0, y: 0, z: 0 };
const _bs = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
const _n = { x: 0, y: 0, z: 0 };
const _np = { x: 0, y: 0, z: 0, d: 0 };
const _sk = { t: -1 };

/** Outward face normal of an axis-aligned box at a point on its surface, against the travel direction (allocation-free). */
function faceNormal(s, x, y, z, dx, dy, dz, out) {
  let best = Math.abs(x - s.minX);
  let ax = 0;
  let sg = -1;
  let d = Math.abs(x - s.maxX);
  if (d < best) (best = d), (ax = 0), (sg = 1);
  d = Math.abs(y - s.minY);
  if (d < best) (best = d), (ax = 1), (sg = -1);
  d = Math.abs(y - s.maxY);
  if (d < best) (best = d), (ax = 1), (sg = 1);
  d = Math.abs(z - s.minZ);
  if (d < best) (best = d), (ax = 2), (sg = -1);
  d = Math.abs(z - s.maxZ);
  if (d < best) (best = d), (ax = 2), (sg = 1);
  out.x = ax === 0 ? sg : 0;
  out.y = ax === 1 ? sg : 0;
  out.z = ax === 2 ? sg : 0;
  if (out.x * dx + out.y * dy + out.z * dz > 0) {
    out.x = -out.x;
    out.y = -out.y;
    out.z = -out.z;
  }
  return out;
}

function makeSlot(i) {
  return { i, state: GSTATE.FREE, seq: 0, hand: '', x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, throwY: 0, fuse: 0, fizz: 0, flight: 0, firstHit: -1, bounces: 0, floorY: NaN, floorSolid: null, rest: null, yaw: 0, spin: 0, spinRate: 0, t: 0 };
}

export class Weapons3D {
  /** @param {EventBus|null} bus */
  constructor(bus) {
    this.bus = bus || null;
    this.enabled = true;
    this.diffKey = 'normal';
    this.slots = [];
    for (let i = 0; i < WEAPONS.grenade.maxProps; i++) this.slots.push(makeSlot(i));
    this.held = -1; // VR: the grenade slot in a hand
    this.revolverHand = ''; // VR: the hand holding the revolver ('' none)
    this.cooldown = 0; // s until the next grenade throw
    this.fireCooldown = 0; // s until the next shot
    this.seq = 0;
    this.time = 0;
    this.lastRefusal = '';
    this.pendingDamage = 0; // the blast's damage to the player since the last takeDamage()
    this.stats = { thrown: 0, blasts: 0, masonHits: 0, skitterKills: 0, shots: 0, dry: 0, misses: 0, selfHits: 0, selfLethal: 0, heard: 0 };
    this._p = {
      throw: { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, speed: 0 },
      bounce: { x: 0, y: 0, z: 0, speed: 0, kind: '', ny: 0 },
      fizz: { x: 0, y: 0, z: 0, left: 0 },
      blast: { x: 0, y: 0, z: 0, radius: WEAPONS.grenade.radius, mason: 0, skitters: 0, self: 0, lethal: false },
      fire: { x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 0, hit: '', hx: 0, hy: 0, hz: 0, dist: 0, left: 0 },
      dry: { kind: ITEM.SIDEARM },
      hit: { target: '', source: '', x: 0, y: 0, z: 0 },
      refuse: { kind: 0, reason: '' },
    };
  }

  /** Clears every grenade in the world (a new run, a respawn, a warp). The bag counts are the Inventory's business. */
  reset() {
    for (const s of this.slots) {
      s.state = GSTATE.FREE;
      s.rest = null;
      s.floorSolid = null;
      s.hand = '';
    }
    this.held = -1;
    this.revolverHand = '';
    this.cooldown = 0;
    this.fireCooldown = 0;
    this.pendingDamage = 0;
  }

  /** Grenades flying / fizzing (the view and the debug read it). */
  get live() {
    let n = 0;
    for (const s of this.slots) if (s.state === GSTATE.FLIGHT || s.state === GSTATE.REST) n++;
    return n;
  }

  /** Why `kind` (ITEM.GRENADE | ITEM.SIDEARM) cannot be used now ('' when it can). ctx {dead, busy}. */
  refusal(kind, count, ctx) {
    if (!this.enabled) return 'off';
    if (ctx && ctx.dead) return 'dead';
    if (ctx && ctx.busy) return 'busy';
    if (!(count > 0)) return 'empty';
    if (kind === ITEM.SIDEARM) return this.fireCooldown > 0 ? 'cooldown' : '';
    if (this.cooldown > 0) return 'cooldown';
    if (!this._freeSlot()) return 'active';
    return '';
  }

  _refuse(kind, why) {
    this.lastRefusal = why;
    const p = this._p.refuse;
    p.kind = kind;
    p.reason = why;
    this._emit('weapon:refuse', p);
  }

  /** The health fraction the blasts took off the player since the last call. */
  takeDamage() {
    const d = this.pendingDamage;
    this.pendingDamage = 0;
    return d;
  }

  // ---- the grenade -----------------------------------------------------------------------------------------------------------

  /** Throws one: refuses (event + false) or takes one from `inv` and launches it, fuse lit. inv null = no bag (debug / tests). */
  tryThrow(inv, ctx, x, y, z, vx, vy, vz) {
    const count = inv ? inv.counts[ITEM.GRENADE] : 1;
    const why = this.refusal(ITEM.GRENADE, count, ctx);
    if (why) {
      this._refuse(ITEM.GRENADE, why);
      return false;
    }
    if (inv && !inv.take(ITEM.GRENADE)) {
      this._refuse(ITEM.GRENADE, 'empty');
      return false;
    }
    this.lastRefusal = '';
    const s = this.held >= 0 ? this.slots[this.held] : this._freeSlot();
    this._launch(s, x, y, z, vx, vy, vz);
    return true;
  }

  /** VR: a grenade pulled from the bag sits in `hand` (taken from the bag only when thrown). */
  hold(hand, x, y, z, count, ctx) {
    if (this.held >= 0) return true;
    const why = this.refusal(ITEM.GRENADE, count, ctx);
    if (why) {
      this._refuse(ITEM.GRENADE, why);
      return false;
    }
    const s = this._freeSlot();
    s.state = GSTATE.HELD;
    s.hand = hand;
    s.x = x;
    s.y = y;
    s.z = z;
    s.spin = 0;
    this.held = s.i;
    return true;
  }

  moveHeld(x, y, z, yaw) {
    if (this.held < 0) return;
    const s = this.slots[this.held];
    s.x = x;
    s.y = y;
    s.z = z;
    if (yaw === yaw) s.yaw = yaw;
  }

  putBack() {
    if (this.held < 0) return false;
    const s = this.slots[this.held];
    s.state = GSTATE.FREE;
    s.hand = '';
    this.held = -1;
    return true;
  }

  _freeSlot() {
    for (const s of this.slots) if (s.state === GSTATE.FREE || (s.state === GSTATE.BLAST && s.t > WEAPONS.grenade.flash)) return s;
    return null;
  }

  _launch(s, x, y, z, vx, vy, vz) {
    const G = WEAPONS.grenade;
    if (this.held === s.i) this.held = -1;
    s.state = GSTATE.FLIGHT;
    s.hand = '';
    s.seq = ++this.seq;
    s.x = x;
    s.y = y;
    s.z = z;
    s.vx = vx;
    s.vy = vy;
    s.vz = vz;
    s.throwY = y;
    s.fuse = G.fuse;
    s.fizz = 0;
    s.flight = 0;
    s.firstHit = -1;
    s.bounces = 0;
    s.floorY = NaN;
    s.floorSolid = null;
    s.rest = null;
    s.t = 0;
    const sp = Math.sqrt(vx * vx + vy * vy + vz * vz);
    s.yaw = Math.atan2(-vx, -vz);
    s.spin = 0;
    s.spinRate = sp * G.spin;
    this.cooldown = G.cooldown;
    this.stats.thrown++;
    const p = this._p.throw;
    p.x = x;
    p.y = y;
    p.z = z;
    p.vx = vx;
    p.vy = vy;
    p.vz = vz;
    p.speed = sp;
    this._emit('grenade:throw', p);
  }

  /**
   * Advances the grenades (flight, fuse, blast) and the cooldowns. creature: the Mason (frighten / hurt / nearestPoint), skitters: the
   * SkitterGroup (kill), roaches: the swarm (burstAt), player: {x,y,z,alive} (the self rule). Any may be null.
   */
  update(dt, level, creature, skitters, roaches, player) {
    if (!(dt > 0)) return;
    this.time += dt;
    if (this.cooldown > 0) this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.fireCooldown > 0) this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    const G = WEAPONS.grenade;
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (s.state === GSTATE.BLAST) {
        s.t += dt;
        if (s.t > G.flash * 4) s.state = GSTATE.FREE;
        continue;
      }
      if (s.state !== GSTATE.FLIGHT && s.state !== GSTATE.REST) continue;
      s.fuse -= dt;
      s.fizz -= dt;
      if (s.state === GSTATE.FLIGHT) this._fly(s, dt, level);
      else if (s.rest && s.rest.active === false) {
        s.rest = null; // the ledge under it crumbled: it falls again
        s.state = GSTATE.FLIGHT;
        s.vx = s.vy = s.vz = 0;
        s.flight = 0;
        s.firstHit = -1;
      }
      if (s.state === GSTATE.FLIGHT && this._contact(s, creature, skitters)) s.fuse = 0; // a hard hit on it: it goes off at once
      if (s.fuse <= 0) {
        this._blast(s, level, creature, skitters, roaches, player);
        continue;
      }
      if (s.fizz <= 0) {
        s.fizz = G.fizzEvery;
        const p = this._p.fizz;
        p.x = s.x;
        p.y = s.y;
        p.z = s.z;
        p.left = s.fuse;
        this._emit('grenade:fizz', p);
      }
    }
  }

  /** A hard hit on the Mason's body or a skitterling in flight. */
  _contact(s, creature, skitters) {
    const G = WEAPONS.grenade;
    const v2 = s.vx * s.vx + s.vy * s.vy + s.vz * s.vz;
    if (v2 < G.contactSpeed * G.contactSpeed) return false;
    if (creature && creature.active && creature.inPlay && typeof creature.nearestPoint === 'function') {
      creature.nearestPoint(s.x, s.y, s.z, _np);
      if (_np.d <= G.contact) return true;
    }
    if (skitters && skitters.slots) {
      for (let i = 0; i < skitters.slots.length; i++) {
        const c = skitters.slots[i];
        if (!c.on) continue;
        const dx = c.x - s.x;
        const dy = c.y - s.y;
        const dz = c.z - s.z;
        if (dx * dx + dy * dy + dz * dz <= G.contactSkit * G.contactSkit) return true;
      }
    }
    return false;
  }

  _fly(s, dt, level) {
    const G = WEAPONS.grenade;
    let left = dt;
    while (left > 1e-9 && s.state === GSTATE.FLIGHT) {
      const h = left > G.substep ? G.substep : left;
      left -= h;
      s.flight += h;
      s.spin += s.spinRate * h;
      const b = ballistic(s.x, s.y, s.z, s.vx, s.vy, s.vz, h, _bs, G.drag, G.gravity);
      const mx = b.x - s.x;
      const my = b.y - s.y;
      const mz = b.z - s.z;
      const len = Math.sqrt(mx * mx + my * my + mz * mz);
      let hit = null;
      if (level && typeof level.raycast === 'function' && len > 1e-7) hit = level.raycast(s.x, s.y, s.z, mx, my, mz, len + G.radiusObj, _hit);
      if (hit && hit.t < len + G.radiusObj) {
        const ux = mx / len;
        const uy = my / len;
        const uz = mz / len;
        const n = faceNormal(hit.solid, hit.x, hit.y, hit.z, ux, uy, uz, _n);
        const tt = Math.max(0, hit.t - G.radiusObj);
        s.x += ux * tt + n.x * 0.002;
        s.y += uy * tt + n.y * 0.002;
        s.z += uz * tt + n.z * 0.002;
        const vn = b.vx * n.x + b.vy * n.y + b.vz * n.z;
        if (vn < 0) {
          const tx = b.vx - vn * n.x;
          const ty = b.vy - vn * n.y;
          const tz = b.vz - vn * n.z;
          s.vx = tx * G.friction - vn * G.restitution * n.x;
          s.vy = ty * G.friction - vn * G.restitution * n.y;
          s.vz = tz * G.friction - vn * G.restitution * n.z;
          s.spinRate *= 0.5;
          if (s.firstHit < 0) s.firstHit = s.flight;
          s.bounces++;
          if (-vn > 0.9) {
            const p = this._p.bounce;
            p.x = s.x;
            p.y = s.y;
            p.z = s.z;
            p.speed = -vn;
            p.kind = hit.solid && hit.solid.kind ? hit.solid.kind : 'stone';
            p.ny = n.y;
            this._emit('grenade:bounce', p);
          }
          if (n.y > 0.7) {
            s.floorY = hit.y;
            s.floorSolid = hit.solid;
            const vt = Math.sqrt(s.vx * s.vx + s.vz * s.vz);
            if (-vn < G.restVn && vt < G.restVt) {
              this._settle(s, hit.x, hit.y, hit.z, hit.solid);
              return;
            }
          }
        } else {
          s.vx = b.vx;
          s.vy = b.vy;
          s.vz = b.vz;
        }
      } else {
        s.x = b.x;
        s.y = b.y;
        s.z = b.z;
        s.vx = b.vx;
        s.vy = b.vy;
        s.vz = b.vz;
      }
      if (s.firstHit >= 0 && s.flight - s.firstHit > G.settleMax && s.floorY === s.floorY && s.y - s.floorY < 0.6 && s.vy <= 0.5) {
        this._settle(s, s.x, s.floorY, s.z, s.floorSolid);
        return;
      }
      if (s.throwY - s.y > G.lostDrop) {
        // far down the shaft: it stops being simulated where it is (it still goes off on its fuse, heard far below)
        s.state = GSTATE.REST;
        s.rest = null;
        s.vx = s.vy = s.vz = 0;
        return;
      }
    }
  }

  _settle(s, x, y, z, solid) {
    s.x = x;
    s.y = y + WEAPONS.grenade.radiusObj;
    s.z = z;
    s.vx = s.vy = s.vz = 0;
    s.spinRate = 0;
    s.rest = solid || null;
    s.state = GSTATE.REST;
  }

  /** The line from the blast to a point: 1 clear, losDamp through masonry. */
  _los(level, x, y, z, tx, ty, tz) {
    if (!level || typeof level.segmentBlocked !== 'function') return 1;
    return level.segmentBlocked(x, y, z, tx, ty, tz, 0.3) ? WEAPONS.grenade.losDamp : 1;
  }

  _blast(s, level, creature, skitters, roaches, player) {
    const G = WEAPONS.grenade;
    const x = s.x;
    const y = s.y + 0.15; // (a hair above the floor it lies on: the floor itself never blocks the line)
    const z = s.z;
    s.state = GSTATE.BLAST;
    s.t = 0;
    s.rest = null;
    this.stats.blasts++;
    const p = this._p.blast;
    p.x = s.x;
    p.y = s.y;
    p.z = s.z;
    p.mason = 0;
    p.skitters = 0;
    p.self = 0;
    p.lethal = false;
    // the Mason: the nearest of its blocks
    if (creature && creature.active && (creature.inPlay || creature.sighting) && typeof creature.frighten === 'function' && typeof creature.nearestPoint === 'function') {
      creature.nearestPoint(x, y, z, _np);
      const e = blastEffect(_np.d) * this._los(level, x, y, z, _np.x, _np.y, _np.z);
      if (e >= G.hitMin) {
        const got = creature.frighten(withdrawFor(this.diffKey, 'grenade') * (0.6 + 0.4 * e), 'grenade', x, z);
        if (got >= 0) {
          creature.hurt(G.hurt * e, 'grenade');
          p.mason = e;
          this.stats.masonHits++;
          this._hitEvent('mason', 'grenade', _np.x, _np.y, _np.z);
        }
      }
    }
    // the skitterlings
    if (skitters && skitters.slots && typeof skitters.kill === 'function') {
      for (let i = 0; i < skitters.slots.length; i++) {
        const c = skitters.slots[i];
        if (!c.on) continue;
        const dx = c.x - x;
        const dy = c.y - y;
        const dz = c.z - z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (blastEffect(d) * this._los(level, x, y, z, c.x, c.y, c.z) < G.hitMin) continue;
        const cx = c.x;
        const cy = c.y;
        const cz = c.z;
        if (skitters.kill(i, 'grenade')) {
          p.skitters++;
          this.stats.skitterKills++;
          this._hitEvent('skitter', 'grenade', cx, cy, cz);
        }
      }
    }
    // the swarm scatters from the cracks
    if (roaches && typeof roaches.burstAt === 'function') {
      try {
        roaches.burstAt(x, y, z, true);
      } catch {
        /* the swarm is decoration */
      }
    }
    // you
    if (player && player.alive !== false) {
      const dx = player.x - x;
      const dy = player.y - y;
      const dz = player.z - z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d <= G.radius) {
        const clear = this._los(level, x, y, z, player.x, player.y, player.z) === 1;
        const dmg = selfDamage(d, clear);
        if (dmg > 0) {
          this.pendingDamage += dmg;
          this.stats.selfHits++;
          if (dmg >= 1) this.stats.selfLethal++;
          p.self = dmg;
          p.lethal = dmg >= 1;
        }
      }
    }
    this._emit('grenade:blast', p);
  }

  // ---- the revolver -----------------------------------------------------------------------------------------------------------

  /**
   * Fires one round from (ox,oy,oz) along the unit (dx,dy,dz). Refuses ('off' | 'dead' | 'busy' | 'empty' (a dry click) | 'cooldown')
   * or takes a round from `inv` (null: no bag) and resolves the hit at once. Returns the target hit: 'mason' | 'skitter' | 'wall' | ''
   * (the empty air), or null when refused.
   */
  fire(inv, ctx, ox, oy, oz, dx, dy, dz, level, creature, skitters) {
    const R = WEAPONS.revolver;
    const count = inv ? inv.counts[ITEM.SIDEARM] : 1;
    const why = this.refusal(ITEM.SIDEARM, count, ctx);
    if (why) {
      if (why === 'empty' && this.enabled) {
        this.stats.dry++;
        this.fireCooldown = R.cooldown;
        this._emit('revolver:dry', this._p.dry);
      }
      this._refuse(ITEM.SIDEARM, why);
      return null;
    }
    if (inv && !inv.take(ITEM.SIDEARM)) {
      this._refuse(ITEM.SIDEARM, 'empty');
      return null;
    }
    this.lastRefusal = '';
    this.fireCooldown = R.cooldown;
    this.stats.shots++;
    const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (!(l > 1e-6)) {
      dx = 0;
      dy = 0;
      dz = -1;
    } else {
      dx /= l;
      dy /= l;
      dz /= l;
    }
    // the level: the first solid stops the round
    let tw = R.range;
    let wall = false;
    if (level && typeof level.raycast === 'function') {
      const h = level.raycast(ox, oy, oz, dx, dy, dz, R.range, _hit);
      if (h && h.t <= R.range) {
        tw = h.t;
        wall = true;
      }
    }
    let target = '';
    let best = tw;
    let ti = -1;
    if (creature && creature.active && typeof creature.rayHit === 'function') {
      const t = creature.rayHit(ox, oy, oz, dx, dy, dz, tw, R.pad);
      if (t >= 0 && t <= best) {
        best = t;
        target = 'mason';
      }
    }
    if (skitters && typeof skitters.rayHit === 'function') {
      const i = skitters.rayHit(ox, oy, oz, dx, dy, dz, best, _sk);
      if (i >= 0 && _sk.t >= 0 && _sk.t <= best) {
        best = _sk.t;
        target = 'skitter';
        ti = i;
      }
    }
    const hx = ox + dx * best;
    const hy = oy + dy * best;
    const hz = oz + dz * best;
    if (target === 'mason') {
      const got = creature.frighten(withdrawFor(this.diffKey, 'shot'), 'shot', ox, oz);
      if (got >= 0) creature.hurt(R.hurt, 'shot');
      this.stats.masonHits++;
      this._hitEvent('mason', 'shot', hx, hy, hz);
    } else if (target === 'skitter') {
      if (skitters.kill(ti, 'shot')) {
        this.stats.skitterKills++;
        this._hitEvent('skitter', 'shot', hx, hy, hz);
      }
    } else {
      this.stats.misses++;
      if (wall) target = 'wall';
    }
    // LOUD: unless it struck the Mason (now frightened), it wakes to the shooter
    if (target !== 'mason' && creature && typeof creature.hearShot === 'function' && creature.hearShot(ox, oy, oz)) this.stats.heard++;
    const p = this._p.fire;
    p.x = ox;
    p.y = oy;
    p.z = oz;
    p.dx = dx;
    p.dy = dy;
    p.dz = dz;
    p.hit = target;
    p.hx = hx;
    p.hy = hy;
    p.hz = hz;
    p.dist = best;
    p.left = inv ? inv.counts[ITEM.SIDEARM] : 0;
    this._emit('revolver:fire', p);
    return target;
  }

  _hitEvent(target, source, x, y, z) {
    const p = this._p.hit;
    p.target = target;
    p.source = source;
    p.x = x;
    p.y = y;
    p.z = z;
    this._emit('weapon:hit', p);
  }

  _emit(type, payload) {
    if (this.bus) this.bus.emit(type, payload);
  }

  /** Read-out for the debug API / tests (allocates: not for the frame loop). */
  debugState() {
    const r = (v) => Math.round(v * 1000) / 1000;
    const names = ['free', 'held', 'flight', 'rest', 'blast'];
    return {
      enabled: this.enabled,
      diff: this.diffKey,
      cooldown: r(this.cooldown),
      fireCooldown: r(this.fireCooldown),
      held: this.held,
      revolverHand: this.revolverHand,
      refusal: this.lastRefusal,
      stats: Object.assign({}, this.stats),
      slots: this.slots.map((s) => ({ state: names[s.state], x: r(s.x), y: r(s.y), z: r(s.z), fuse: r(s.fuse), bounces: s.bounces })),
    };
  }
}
