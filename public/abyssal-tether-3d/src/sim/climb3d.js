/* ABYSSAL TETHER 3D — climb3d.js
 * Grip climbing: the player can grab and climb the surfaces the level marks as climbable (level data `climb`: rough masonry
 * courses, chains, sinew roots, rebar, ledge lips). Pure and deterministic: no three.js, no DOM, no Math.random, no clock
 * other than the dt it is stepped with (fixed 1/240 s inside Physics3D.step), no allocation after construction. Runs in Node.
 *
 * VR: HAND-DELTA LOCOMOTION. Holding GRIP (squeeze >= gripOn) with a hand inside `reachVR` of a climb zone anchors that
 * hand at the point where it closed (a world position, `ax/ay/az`). While gripped, the body is driven so that the hand
 * stays on its hold: target = hold - (hand relative to the body), v = (target - body) x track, capped at maxPull. So moving
 * the real hand AWAY from you pulls you toward the hold, pushing it down lifts you, and hands may alternate (let go with one,
 * take a new hold with the other). With both hands gripped the pull is the mean of the two. Letting go of the last hold
 * keeps the (low-passed) pull velocity x throwGain: a hand-over-hand launch / throw. A (jump) while gripping hops off.
 * The tethers keep working (the rope still hangs from its anchor; its pull is overridden while a hand holds: the grip is
 * the stronger of the two, the line is the safety net when it lets go).
 *
 * DESKTOP: hold F within reachDesk of a zone to cling; the body settles to deskHold off the wall and W/S climb up/down,
 * A/D traverse (relative to the view); Space hops off (hopUp / hopOut); letting go of F drops.
 *
 * GRIP STAMINA 0..1 (`stamina`): drains while hanging unsupported (hangDrain) and more while moving (moveDrain), x twoHand
 * with both hands on holds, x wetMul on a wet zone, x diff.climb.drainMul; refills on solid ground (regenGround), a trickle
 * in the air (regenAir). Below warnAt the hold strains (`warn` 0..1: haptics, sound, vignette). At zero the hands slip: both
 * holds are lost ('slip'), the player cannot grip for slipLock s nor before stamina is back to resumeAt.
 *
 * EDGE HOLDS: besides the authored zones, every exposed solid edge (sim/climbEdges.js via level.edgeNear) is a low-grade hold:
 * palm within reachVR of the segment (desktop: body within reachDesk), the closest point on the segment becomes the hold, the
 * stamina drains x edgeMul and two hands do not discount it; an authored zone in reach always wins. Top lips of standable
 * ledges (zone.lip) allow a MANTLE: VR - pulling the hand down near the lip; desktop - W / Space with the head at lip height:
 * the climb carries the body up over the lip and onto the ledge (event 'climb:mantle', release reason 'mantle').
 *
 * Collisions stay with Physics3D (the velocity set here goes through the normal sphere-vs-box resolution); while the grip
 * controls the body, impacts do no damage (Physics3D skips them via player.climbing).
 *
 * Intent (built by InputManager, completed by the Game): intent.climb = {
 *   vr: bool, grab: { left, right } (grip / F held), fwd, side (-1..1, desktop climb axes), rx, rz (view right, horizontal unit),
 *   fx, fz (view forward, horizontal unit),
 *   hands: { left: { ok, x,y,z (hand world), rx,ry,rz (hand relative to the body, set by the Game) }, right: {...} } }
 *
 * Bus events (plain payloads): 'climb:grab' {hand,x,y,z,kind,wet,vr}, 'climb:release' {hand,reason,speed,last},
 * 'climb:scrape' {hand,speed,kind,wet,x,y,z}, 'climb:strain' {level,stamina}, 'climb:slip' {x,y,z}, 'climb:hop' {x,y,z}, 'climb:mantle' {x,y,z,lipY}
 * (grab carries edge: true on a procedural edge hold).
 * reasons: 'input' | 'slip' | 'stretch' | 'zone' | 'hop' | 'mantle' | 'death' | 'reset'.
 *
 * Read-only for the presentation: stamina, warn, holding, mode (0 none, 1 VR, 2 desktop), wet, exhausted, canGrip, speed,
 * hands[h] = { gripping, hover, hoverIn, hx,hy,hz (nearest hold to the hand), ax,ay,az (the hold), zone }.
 */

import { CONFIG } from './config3d.js';

const K = CONFIG.climb;
export const CLIMB_HANDS = ['left', 'right'];

const MODE_NONE = 0;
const MODE_VR = 1;
const MODE_DESK = 2;

function makeHand() {
  return { needRelease: false, gripping: false, hover: false, hoverIn: false, hx: 0, hy: 0, hz: 0, ax: 0, ay: 0, az: 0, zone: null, hzone: null };
}

/** Closest point of a zone box to (x, y, z) and the distance, written into out. */
function closest(z, x, y, zz, out) {
  const cx = x < z.minX ? z.minX : x > z.maxX ? z.maxX : x;
  const cy = y < z.minY ? z.minY : y > z.maxY ? z.maxY : y;
  const cz = zz < z.minZ ? z.minZ : zz > z.maxZ ? z.maxZ : zz;
  const dx = x - cx;
  const dy = y - cy;
  const dz = zz - cz;
  out.x = cx;
  out.y = cy;
  out.z = cz;
  out.d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  return out;
}

export class Climb3D {
  /**
   * @param {Level3D} level   level.climbNear(x, y, z, r, out) lists the zones
   * @param {object} diff     DIFFICULTY preset (reads diff.climb.drainMul)
   * @param {EventBus|null} bus
   */
  constructor(level, diff, bus) {
    this.level = level;
    this.diff = diff || {};
    this.bus = bus || null;
    const dm = this.diff.climb && this.diff.climb.drainMul;
    this.drainMul = dm > 0 ? dm : 1;
    this.hands = { left: makeHand(), right: makeHand() };
    this._list = [];
    this._elist = [];
    this._near = { zone: null, x: 0, y: 0, z: 0, d: 0 };
    this._tmp = { x: 0, y: 0, z: 0, d: 0 };
    this.sv = { x: 0, y: 0, z: 0 }; // low-passed pull velocity (what a release inherits)
    this.reset();
  }

  /** Full stamina, nothing held (a new run, a respawn, a warp). */
  reset() {
    this.stamina = 1;
    this.exhausted = false;
    this.lock = 0;
    this.hopLock = 0;
    this.warn = 0;
    this.holding = false;
    this.mode = MODE_NONE;
    this.wet = false;
    this.speed = 0;
    this.canGrip = true;
    this.edgeHold = false; // the grip is on procedural edges only (drains faster)
    this.mantling = false;
    this._mz = null;
    this._mt = 0;
    this.clock = 0;
    this._strainT = 0;
    this._scrapeT = 0;
    this._zone = null; // desktop: the zone being climbed
    this._nx = 0;
    this._ny = 0;
    this._nz = 0;
    this.sv.x = 0;
    this.sv.y = 0;
    this.sv.z = 0;
    for (const h of CLIMB_HANDS) {
      const st = this.hands[h];
      st.needRelease = false;
      st.gripping = false;
      st.hover = false;
      st.hoverIn = false;
      st.zone = null;
      st.hzone = null;
    }
  }

  /** State for a look-ahead (clone -> simulate -> restore). */
  snapshot() {
    return [this.stamina, this.exhausted ? 1 : 0, this.lock, this.hopLock];
  }

  restore(s) {
    if (!s || s.length < 4) return;
    this.reset();
    this.stamina = s[0];
    this.exhausted = s[1] === 1;
    this.lock = s[2];
    this.hopLock = s[3];
  }

  get gripCount() {
    return (this.hands.left.gripping ? 1 : 0) + (this.hands.right.gripping ? 1 : 0);
  }

  /** Nearest hold to a point within r (fills this._near); returns the zone or null. Authored zones win over procedural edges. */
  _nearest(x, y, z, r) {
    const lv = this.level;
    const list = lv && typeof lv.climbNear === 'function' ? lv.climbNear(x, y, z, r, this._list) : this._list;
    let best = null;
    let bd = r;
    const t = this._tmp;
    const nr = this._near;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      closest(c, x, y, z, t);
      if (t.d <= bd) {
        bd = t.d;
        best = c;
        nr.x = t.x;
        nr.y = t.y;
        nr.z = t.z;
        nr.d = t.d;
      }
    }
    if (!best && lv && typeof lv.edgeNear === 'function') {
      const el = lv.edgeNear(x, y, z, r, this._elist);
      for (let i = 0; i < el.length; i++) {
        const c = el[i];
        if (c.src.active === false) continue; // a ledge that has crumbled away
        closest(c, x, y, z, t);
        if (t.d <= bd) {
          bd = t.d;
          best = c;
          nr.x = t.x;
          nr.y = t.y;
          nr.z = t.z;
          nr.d = t.d;
        }
      }
    }
    nr.zone = best;
    return best;
  }

  _emit(type, payload) {
    if (this.bus) this.bus.emit(type, payload);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Per frame (not per step): which hand could take a hold right now. Drives the handhold highlight and decides whether
  // the grip is a climb grab or the rope yank. Idempotent.
  // ---------------------------------------------------------------------------------------------------------------
  probe(p, ci) {
    this.canGrip = this.lock <= 0 && this.hopLock <= 0 && !this.exhausted && this.stamina >= K.minStart;
    const L = this.hands.left;
    const R = this.hands.right;
    if (!ci || !p || !p.alive) {
      L.hover = R.hover = L.hoverIn = R.hoverIn = false;
      return;
    }
    if (ci.vr) {
      for (let i = 0; i < 2; i++) {
        const st = this.hands[CLIMB_HANDS[i]];
        const hi = ci.hands[CLIMB_HANDS[i]];
        st.hover = false;
        st.hoverIn = false;
        if (!hi.ok || st.gripping) continue;
        const hx = p.x + hi.rx;
        const hy = p.y + hi.ry;
        const hz = p.z + hi.rz;
        const z = this._nearest(hx, hy, hz, K.hoverReachVR);
        if (z) {
          const n = this._near;
          st.hover = true;
          st.hoverIn = n.d <= K.reachVR;
          st.hx = n.x;
          st.hy = n.y;
          st.hz = n.z;
          st.hzone = z;
        }
      }
    } else {
      L.hover = R.hover = L.hoverIn = R.hoverIn = false;
      if (this.holding) return;
      const z = this._nearest(p.x, p.y, p.z, K.reachDesk + 0.25);
      if (z) {
        const n = this._near;
        for (let i = 0; i < 2; i++) {
          const st = this.hands[CLIMB_HANDS[i]];
          st.hover = true;
          st.hoverIn = n.d <= K.reachDesk;
          st.hx = n.x;
          st.hy = n.y;
          st.hz = n.z;
          st.hzone = z;
        }
      }
    }
  }

  /** True when this hand's grip is a climb grab (not the rope yank) this frame. Call after probe(). */
  suppressYank(hand) {
    const st = this.hands[hand];
    return st.gripping || (st.hoverIn && this.canGrip);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // One physics step. Returns true when the grip controls the body's velocity this step (Physics3D then skips the
  // impact damage of the contacts it resolves). `intent` is the physics intent (jumpPressed, climb).
  // ---------------------------------------------------------------------------------------------------------------
  step(p, intent, dt) {
    this.clock += dt;
    if (this.lock > 0) this.lock -= dt;
    if (this.hopLock > 0) this.hopLock -= dt;
    const ci = intent ? intent.climb : null;
    let ctl = false;
    this.speed = 0;
    if (!p.alive) {
      if (this.holding) this._endAll(p, 'death', false);
    } else if (this.mantling) {
      ctl = this._stepMantle(p, dt);
    } else if (ci) {
      if (this.holding && (this.mode === MODE_VR) !== !!ci.vr) this._endAll(p, 'reset', false);
      ctl = ci.vr ? this._stepVR(p, intent, ci, dt) : this._stepDesk(p, intent, ci, dt);
    } else if (this.holding) {
      this._endAll(p, 'reset', false);
    }
    this._stamina(p, dt, ctl);
    if (this.holding && this.stamina <= 0) {
      this._emit('climb:slip', { x: p.x, y: p.y, z: p.z });
      this.exhausted = true;
      this.lock = K.slipLock;
      this.hands.left.needRelease = true;
      this.hands.right.needRelease = true;
      this._endAll(p, 'slip', false);
      ctl = false;
    }
    return ctl;
  }

  // ---- VR -------------------------------------------------------------------------------------------------------
  _stepVR(p, intent, ci, dt) {
    const canGrip = this.lock <= 0 && this.hopLock <= 0 && !this.exhausted && this.stamina >= K.minStart;
    // 1. releases and new holds
    for (let i = 0; i < 2; i++) {
      const h = CLIMB_HANDS[i];
      const st = this.hands[h];
      const hi = ci.hands[h];
      let want = ci.grab[h] && hi.ok;
      if (!want) st.needRelease = false;
      else if (st.needRelease) want = false; // a hold lost by force is not retaken until the grip has been let go of
      if (st.gripping) {
        if (!want) {
          this._letGo(p, h, 'input');
        } else {
          const dx = st.ax - hi.rx - p.x;
          const dy = st.ay - hi.ry - p.y;
          const dz = st.az - hi.rz - p.z;
          if (dx * dx + dy * dy + dz * dz > K.maxStretch * K.maxStretch) {
            st.needRelease = true;
            this._letGo(p, h, 'stretch');
          }
        }
      } else if (want && canGrip) {
        const hx = p.x + hi.rx;
        const hy = p.y + hi.ry;
        const hz = p.z + hi.rz;
        const z = this._nearest(hx, hy, hz, K.reachVR);
        if (z) {
          const nr = this._near;
          const edge = z.edge === true; // an edge hold: the hand snaps to the closest point of the segment
          st.gripping = true;
          st.zone = z;
          st.ax = edge ? nr.x : hx;
          st.ay = edge ? nr.y : hy;
          st.az = edge ? nr.z : hz;
          if (!this.holding) {
            this.holding = true;
            this.mode = MODE_VR;
            this.sv.x = p.vx;
            this.sv.y = p.vy;
            this.sv.z = p.vz;
          }
          this.wet = z.wet;
          this._emit('climb:grab', { hand: h, x: st.ax, y: st.ay, z: st.az, kind: z.kind, wet: z.wet, vr: true, edge });
        }
      }
    }
    if (!this.holding) return false;
    // 2. hop off (A / jump while gripping)
    if (intent.jumpPressed) {
      this._hop(p, 0.8, 0.35);
      return false;
    }
    // 3. pull
    let ex = 0;
    let ey = 0;
    let ez = 0;
    let n = 0;
    let wet = false;
    for (let i = 0; i < 2; i++) {
      const h = CLIMB_HANDS[i];
      const st = this.hands[h];
      if (!st.gripping) continue;
      const hi = ci.hands[h];
      ex += st.ax - hi.rx - p.x;
      ey += st.ay - hi.ry - p.y;
      ez += st.az - hi.rz - p.z;
      n++;
      if (st.zone && st.zone.wet) wet = true;
    }
    if (n === 0) return false;
    this.wet = wet;
    const k = K.track / n;
    let vx = ex * k;
    let vy = ey * k;
    let vz = ez * k;
    const sp = Math.sqrt(vx * vx + vy * vy + vz * vz);
    if (sp > K.maxPull) {
      const f = K.maxPull / sp;
      vx *= f;
      vy *= f;
      vz *= f;
    }
    p.vx = vx;
    p.vy = vy;
    p.vz = vz;
    this.speed = sp > K.maxPull ? K.maxPull : sp;
    const a = Math.min(1, dt / K.throwSmooth);
    this.sv.x += (vx - this.sv.x) * a;
    this.sv.y += (vy - this.sv.y) * a;
    this.sv.z += (vz - this.sv.z) * a;
    // pulling the hand down on a standable lip with the body near its height: carry the body over
    if (this.sv.y > K.mantleVy) {
      for (let i = 0; i < 2; i++) {
        const st = this.hands[CLIMB_HANDS[i]];
        const z = st.gripping ? st.zone : null;
        if (z && z.lip && p.y > z.maxY - K.mantleBelow && p.y < z.maxY + 0.2) {
          this._beginMantle(p, z);
          return true;
        }
      }
    }
    this._scrape(dt, this.speed, p, this.hands.left.gripping ? 'left' : 'right');
    return true;
  }

  // ---- desktop --------------------------------------------------------------------------------------------------
  _stepDesk(p, intent, ci, dt) {
    const raw = ci.grab.left || ci.grab.right;
    const latch = this.hands.right; // after a hop or a slip F must be let go of before the next cling
    if (!raw) latch.needRelease = false;
    const want = raw && !latch.needRelease;
    if (!this.holding) {
      if (!want || this.lock > 0 || this.hopLock > 0 || this.exhausted || this.stamina < K.minStart) return false;
      const z = this._nearest(p.x, p.y, p.z, K.reachDesk);
      if (!z) return false;
      const nr = this._near;
      this.holding = true;
      this.mode = MODE_DESK;
      this._zone = z;
      this.sv.x = this.sv.y = this.sv.z = 0;
      for (let i = 0; i < 2; i++) {
        const st = this.hands[CLIMB_HANDS[i]];
        st.gripping = true;
        st.zone = z;
        st.ax = nr.x;
        st.ay = nr.y;
        st.az = nr.z;
      }
      this.wet = z.wet;
      this._emit('climb:grab', { hand: 'right', x: nr.x, y: nr.y, z: nr.z, kind: z.kind, wet: z.wet, vr: false, edge: z.edge === true });
    } else {
      if (!want) {
        p.vx *= 0.3;
        p.vy *= 0.3;
        p.vz *= 0.3;
        this._endAll(p, 'input', false);
        return false;
      }
      if (intent.jumpPressed) {
        if (this._deskLip(p, this._zone)) {
          this._beginMantle(p, this._zone);
          return true;
        }
        this._hop(p, 1, 1);
        return false;
      }
      const z = this._nearest(p.x, p.y, p.z, K.reachDesk + 0.3);
      if (!z) {
        this._endAll(p, 'zone', false);
        return false;
      }
      if (z !== this._zone) {
        this._zone = z;
        this.hands.left.zone = this.hands.right.zone = z;
      }
      const nr = this._near;
      for (let i = 0; i < 2; i++) {
        const st = this.hands[CLIMB_HANDS[i]];
        st.ax = nr.x;
        st.ay = nr.y;
        st.az = nr.z;
      }
    }
    // wall frame
    const z = this._zone;
    this.wet = z.wet;
    let nx = z.nx;
    let ny = z.ny;
    let nz = z.nz;
    let sep;
    let hold = K.deskHold;
    if (z.edge) {
      // an edge: the body hangs off the two faces it joins (their outward axes p, q); beside a face the normal is that face's,
      // round the corner it is the radial of the corner line. The edge runs along z.ea.
      if ((ci.fwd || 0) > 0 && this._deskLip(p, z)) {
        this._beginMantle(p, z);
        return true;
      }
      const ea = z.ea;
      const pa = (ea + 1) % 3;
      const qa = (ea + 2) % 3;
      const sp = pa === 0 ? Math.sign(z.ux) : pa === 1 ? Math.sign(z.uy) : Math.sign(z.uz);
      const sq = qa === 0 ? Math.sign(z.ux) : qa === 1 ? Math.sign(z.uy) : Math.sign(z.uz);
      const c0 = pa === 0 ? z.minX : pa === 1 ? z.minY : z.minZ;
      const c1 = qa === 0 ? z.minX : qa === 1 ? z.minY : z.minZ;
      const u = ((pa === 0 ? p.x : pa === 1 ? p.y : p.z) - c0) * sp;
      const v = ((qa === 0 ? p.x : qa === 1 ? p.y : p.z) - c1) * sq;
      let ou = 0;
      let ov = 0;
      if (v <= 0) {
        ou = 1;
        sep = u;
      } else if (u <= 0) {
        ov = 1;
        sep = v;
      } else {
        sep = Math.sqrt(u * u + v * v);
        ou = u / sep;
        ov = v / sep;
      }
      const au = ou * sp;
      const av = ov * sq;
      nx = (pa === 0 ? au : 0) + (qa === 0 ? av : 0);
      ny = (pa === 1 ? au : 0) + (qa === 1 ? av : 0);
      nz = (pa === 2 ? au : 0) + (qa === 2 ? av : 0);
      this._nx = nx;
      this._ny = ny;
      this._nz = nz;
    } else if (z.ax < 0) {
      // a chain: hang off it, the normal points from its axis to the body
      const cx = (z.minX + z.maxX) * 0.5;
      const cz = (z.minZ + z.maxZ) * 0.5;
      let dx = p.x - cx;
      let dz = p.z - cz;
      const dl = Math.sqrt(dx * dx + dz * dz);
      if (dl > 1e-4) {
        dx /= dl;
        dz /= dl;
      } else {
        dx = ci.rx;
        dz = ci.rz;
      }
      nx = dx;
      ny = 0;
      nz = dz;
      sep = dl;
      hold = K.deskHold + 0.12;
    } else {
      sep = z.ax === 0 ? (p.x - z.face) * nx : z.ax === 1 ? (p.y - z.face) * ny : (p.z - z.face) * nz;
    }
    let cvx = 0;
    let cvy = 0;
    let cvz = 0;
    const fwd = ci.fwd || 0;
    const side = ci.side || 0;
    if (ny < -0.5 || ny > 0.5) {
      // an overhead surface: traverse in the horizontal plane
      cvx = (ci.fx * fwd + ci.rx * side) * K.deskSide;
      cvz = (ci.fz * fwd + ci.rz * side) * K.deskSide;
    } else {
      cvy = fwd > 0 ? fwd * K.deskUp : fwd * K.deskDown;
      // tangent along the surface, signed so +side goes to the view's right
      let tx = nz;
      let tz = -nx;
      if (tx * ci.rx + tz * ci.rz < 0) {
        tx = -tx;
        tz = -tz;
      }
      cvx = tx * side * K.deskSide;
      cvz = tz * side * K.deskSide;
    }
    // stay on the zone: no moving out past its edges
    if (z.edge) {
      if (z.ea === 1) {
        if (cvy > 0 && p.y > z.maxY + 0.15) cvy = 0;
        if (cvy < 0 && p.y < z.minY - 0.05) cvy = 0;
      } else {
        if (cvy > 0 && p.y > z.maxY + 0.15) cvy = 0;
        if (z.ea === 0) {
          if (cvx > 0 && p.x > z.maxX + 0.1) cvx = 0;
          if (cvx < 0 && p.x < z.minX - 0.1) cvx = 0;
        } else {
          if (cvz > 0 && p.z > z.maxZ + 0.1) cvz = 0;
          if (cvz < 0 && p.z < z.minZ - 0.1) cvz = 0;
        }
      }
    } else if (z.ax >= 0) {
      if (cvy > 0 && p.y > z.maxY + 0.15) cvy = 0;
      if (cvy < 0 && p.y < z.minY - 0.05) cvy = 0;
      if (z.ax !== 0) {
        if (cvx > 0 && p.x > z.maxX + 0.1) cvx = 0;
        if (cvx < 0 && p.x < z.minX - 0.1) cvx = 0;
      }
      if (z.ax !== 2) {
        if (cvz > 0 && p.z > z.maxZ + 0.1) cvz = 0;
        if (cvz < 0 && p.z < z.minZ - 0.1) cvz = 0;
      }
    } else {
      if (cvy > 0 && p.y > z.maxY + 0.15) cvy = 0;
      if (cvy < 0 && p.y < z.minY - 0.05) cvy = 0;
    }
    // settle to the hold distance along the normal
    let vn = (hold - sep) * K.deskSnap;
    if (vn > 2.5) vn = 2.5;
    else if (vn < -2.5) vn = -2.5;
    p.vx = cvx + nx * vn;
    p.vy = cvy + ny * vn;
    p.vz = cvz + nz * vn;
    const sp = Math.sqrt(cvx * cvx + cvy * cvy + cvz * cvz);
    this.speed = sp;
    this._scrape(dt, sp, p, 'right');
    return true;
  }

  // ---- shared ---------------------------------------------------------------------------------------------------
  _scrape(dt, speed, p, hand) {
    if (speed < K.moveSound) {
      this._scrapeT = 0;
      return;
    }
    this._scrapeT -= dt;
    if (this._scrapeT > 0) return;
    this._scrapeT = K.scrapePeriod;
    const st = this.hands[hand];
    this._emit('climb:scrape', { hand, speed, kind: st.zone ? st.zone.kind : 'masonry', wet: this.wet, x: p.x, y: p.y, z: p.z });
  }

  _hop(p, ux, ox) {
    // away from the surface and up
    let nx = this._zone ? this._zone.nx : 0;
    let nz = this._zone ? this._zone.nz : 0;
    if (this.mode === MODE_VR || !this._zone) {
      nx = 0;
      nz = 0;
    } else if (this._zone.edge) {
      const hl = Math.sqrt(this._nx * this._nx + this._nz * this._nz) || 1;
      nx = this._nx / hl;
      nz = this._nz / hl;
    } else if (this._zone.ax < 0) {
      const cx = (this._zone.minX + this._zone.maxX) * 0.5;
      const cz = (this._zone.minZ + this._zone.maxZ) * 0.5;
      const dx = p.x - cx;
      const dz = p.z - cz;
      const dl = Math.sqrt(dx * dx + dz * dz) || 1;
      nx = dx / dl;
      nz = dz / dl;
    }
    const sx = this.sv.x;
    const sy = this.sv.y;
    const sz = this.sv.z;
    this.emitRelease(p, 'hop', 'right');
    this._clear();
    p.vx = (this.mode === MODE_VR ? sx : 0) + nx * K.hopOut * ox;
    p.vy = (this.mode === MODE_VR ? Math.max(sy, 0) : 0) + K.hopUp * ux;
    p.vz = (this.mode === MODE_VR ? sz : 0) + nz * K.hopOut * ox;
    p.jumpBuffer = 0;
    p.coyote = 0;
    p.grounded = false;
    this.hopLock = K.hopLock;
    this.hands.left.needRelease = true;
    this.hands.right.needRelease = true;
    this._emit('climb:hop', { x: p.x, y: p.y, z: p.z });
    this.mode = MODE_NONE;
  }

  /** Desktop: is this hold a standable lip with the head at (or above) its height and the body not yet over it? */
  _deskLip(p, z) {
    if (!z || !z.lip) return false;
    const head = p.y + CONFIG.player.eyeHeight;
    return head >= z.maxY - K.mantleHead && p.y < z.maxY + 0.2;
  }

  _beginMantle(p, z) {
    this.mantling = true;
    this._mz = z;
    this._mt = 0;
    this._emit('climb:mantle', { x: p.x, y: p.y, z: p.z, lipY: z.maxY });
  }

  /** The assist: rise past the lip, then walk onto the ledge. Returns true while the climb drives the body. */
  _stepMantle(p, dt) {
    const z = this._mz;
    this._mt += dt;
    if (!z || z.src.active === false || this._mt > K.mantleTime) {
      this._endMantle(p, false);
      return false;
    }
    const d = (p.x - z.minX) * z.mx + (p.z - z.minZ) * z.mz; // m onto the ledge from the lip line
    if (d >= 0.45 && p.y >= z.maxY + 0.3) {
      this._endMantle(p, true);
      return false;
    }
    if (p.y < z.maxY + 0.42) {
      p.vx = 0;
      p.vz = 0;
      p.vy = K.mantleUp;
    } else {
      p.vx = z.mx * K.mantleIn;
      p.vz = z.mz * K.mantleIn;
      p.vy = 0;
    }
    this.speed = K.mantleUp;
    return true;
  }

  _endMantle(p, done) {
    const z = this._mz;
    this.mantling = false;
    this._mz = null;
    this._endAll(p, 'mantle', false);
    this.hands.left.needRelease = true;
    this.hands.right.needRelease = true;
    p.vx = done && z ? z.mx * 1.2 : 0;
    p.vy = 0;
    p.vz = done && z ? z.mz * 1.2 : 0;
  }

  emitRelease(p, reason, hand) {
    this._emit('climb:release', { hand, reason, speed: Math.sqrt(this.sv.x * this.sv.x + this.sv.y * this.sv.y + this.sv.z * this.sv.z), last: true, x: p.x, y: p.y, z: p.z });
  }

  _clear() {
    this.mantling = false;
    this._mz = null;
    for (const h of CLIMB_HANDS) {
      const st = this.hands[h];
      st.gripping = false;
      st.zone = null;
    }
    this.holding = false;
    this.wet = false;
    this._zone = null;
    this._strainT = 0;
    this._scrapeT = 0;
  }

  /** One hand lets go (VR). The last one ends the hold (a throw on 'input'). */
  _letGo(p, hand, reason) {
    const st = this.hands[hand];
    if (!st.gripping) return;
    st.gripping = false;
    st.zone = null;
    const other = this.hands[hand === 'left' ? 'right' : 'left'];
    if (other.gripping) {
      this._emit('climb:release', { hand, reason, speed: 0, last: false, x: p.x, y: p.y, z: p.z });
      return;
    }
    this._endAll(p, reason, true, hand);
  }

  /** Ends the hold (no hand left). `throws`: inherit the pull velocity. */
  _endAll(p, reason, throws, hand) {
    const sp = Math.sqrt(this.sv.x * this.sv.x + this.sv.y * this.sv.y + this.sv.z * this.sv.z);
    const wasVR = this.mode === MODE_VR;
    // one event per hand that was still holding (the others first), the last of them carries last: true
    const L = this.hands.left.gripping;
    const R = this.hands.right.gripping;
    const primary = hand || (R ? 'right' : 'left');
    if (L && primary !== 'left') this._emit('climb:release', { hand: 'left', reason, speed: 0, last: false, x: p.x, y: p.y, z: p.z });
    if (R && primary !== 'right') this._emit('climb:release', { hand: 'right', reason, speed: 0, last: false, x: p.x, y: p.y, z: p.z });
    this._emit('climb:release', { hand: primary, reason, speed: sp, last: true, x: p.x, y: p.y, z: p.z });
    this._clear();
    this.mode = MODE_NONE;
    if (wasVR && p.alive) {
      if (throws && reason === 'input') {
        const f = K.throwGain;
        let vx = this.sv.x * f;
        let vy = this.sv.y * f;
        let vz = this.sv.z * f;
        const s = Math.sqrt(vx * vx + vy * vy + vz * vz);
        if (s > K.throwMax) {
          const g = K.throwMax / s;
          vx *= g;
          vy *= g;
          vz *= g;
        }
        p.vx = vx;
        p.vy = vy;
        p.vz = vz;
      } else if (reason === 'slip' || reason === 'stretch' || reason === 'zone') {
        p.vx = this.sv.x * 0.5;
        p.vy = this.sv.y * 0.5;
        p.vz = this.sv.z * 0.5;
      }
    }
    this.sv.x = this.sv.y = this.sv.z = 0;
  }

  /** Lets go of everything from outside (death, respawn, a debug warp). */
  release(p, reason) {
    if (this.holding) this._endAll(p, reason || 'reset', false);
  }

  _stamina(p, dt, ctl) {
    let st = this.stamina;
    const gripping = this.holding;
    if (gripping && !p.grounded) {
      let d = K.hangDrain + K.moveDrain * Math.min(1.5, this.speed / K.moveRef);
      const L = this.hands.left;
      const R = this.hands.right;
      // edge-only grip (no authored hold under either hand) is the low grade: faster drain, no two-hand discount
      const eh = (!L.gripping || (L.zone !== null && L.zone.edge === true)) && (!R.gripping || (R.zone !== null && R.zone.edge === true));
      this.edgeHold = eh;
      if (eh) d *= K.edgeMul;
      else if (this.gripCount > 1) d *= K.twoHand;
      if (this.wet) d *= K.wetMul;
      st -= d * this.drainMul * dt;
    } else if (gripping) {
      st += K.regenGrip * dt;
    } else {
      st += (p.grounded ? K.regenGround : K.regenAir) * dt;
    }
    this.stamina = st < 0 ? 0 : st > 1 ? 1 : st;
    if (this.exhausted && this.stamina >= K.resumeAt) this.exhausted = false;
    this.canGrip = this.lock <= 0 && this.hopLock <= 0 && !this.exhausted && this.stamina >= K.minStart;
    if (gripping && !p.grounded && ctl) {
      const w = 1 - this.stamina / K.warnAt;
      this.warn = w < 0 ? 0 : w > 1 ? 1 : w;
    } else if (this.warn > 0) {
      this.warn = Math.max(0, this.warn - dt * 2);
    }
    if (gripping && this.warn > 0.02) {
      this._strainT -= dt;
      if (this._strainT <= 0) {
        this._strainT = K.strainPeriod + (K.strainFast - K.strainPeriod) * this.warn;
        this._emit('climb:strain', { level: this.warn, stamina: this.stamina });
      }
    }
  }
}

/** Distance from a point to a zone box (tests and the verifier). */
export function zoneDistance(z, x, y, zz) {
  return closest(z, x, y, zz, { x: 0, y: 0, z: 0, d: 0 }).d;
}
