/* ABYSSAL TETHER 3D — physics3d.js
 * The player body, the two tethers (one per hand) and sphere-vs-box
 * collision, generalised from the 2D game's physics to three dimensions.
 * Game-feel physics, not a rope simulation: predictable and stable.
 *
 * Fixed step (CONFIG.PHYSICS_DT). Per step:
 *   1. timers & control
 *   2. gravity + intent (run / air control / swing pump along the rope
 *      tangent plane / reel / yank)
 *   3. semi-implicit Euler integration with clamps
 *   4. rope constraints (each taut rope: project position back onto its
 *      sphere, strip only the OUTWARD radial velocity; 2 Gauss-Seidel passes
 *      when both hands are tethered)
 *   5. sphere-vs-box collisions, impacts, crumbling ledges, hazards
 *
 * Coordinates: metres, +Y up (three.js). Boxes are {minX,minY,minZ,maxX,maxY,maxZ}.
 * No three.js / DOM dependency (runs in Node).
 */

import { CONFIG, U } from './config3d.js';

const C = CONFIG;
export const HANDS = ['left', 'right'];

// =============================================================================
// Player
// =============================================================================
export class Player3D {
  constructor(x = 0, y = 0, z = 0) {
    this.radius = C.player.radius;
    this.reset(x, y, z);
  }

  reset(x, y, z) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.prevX = x; // previous physics step (render interpolation)
    this.prevY = y;
    this.prevZ = z;
    this.rx = x; // interpolated render position (set by the game each frame)
    this.ry = y;
    this.rz = z;
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
    this.grounded = false;
    this.alive = true;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.stagger = 0;
    this.airTime = 0;
    this.groundTime = 0;
    this.fallPeak = 0; // highest downward speed this airborne phase
    this.groundSolid = null;
    this.lastImpact = 0;
    this.tension = 0; // summed rope tension estimate (feedback)
    this.ropeJolt = 0;
    this.deathCause = null;
    this.landedThisStep = false;
  }

  get speed() {
    return Math.hypot(this.vx, this.vy, this.vz);
  }
  /** Any tether attached. */
  get tethered() {
    return this._tethered === true;
  }
}

// =============================================================================
// Rope — one hand's tether: anchor, length, reel, pump, constraint.
// =============================================================================
export class Rope3D {
  constructor(hand) {
    this.hand = hand;
    this.anchor = null;
    this.length = 0;
    // Scratch from measure(): distance and unit vector anchor → player.
    this.d = 0;
    this.nx = 0;
    this.ny = -1;
    this.nz = 0;
    this.tension = 0;
  }

  get attached() {
    return this.anchor !== null;
  }

  attach(anchor, distance, maxLength) {
    this.anchor = anchor;
    this.length = U.clamp(distance, C.rope.minLength, maxLength);
  }

  detach() {
    this.anchor = null;
    this.length = 0;
    this.tension = 0;
  }

  /** Measures anchor → player; returns true when taut. */
  measure(p) {
    const dx = p.x - this.anchor.x;
    const dy = p.y - this.anchor.y;
    const dz = p.z - this.anchor.z;
    const d = Math.hypot(dx, dy, dz) || 1e-6;
    this.d = d;
    this.nx = dx / d;
    this.ny = dy / d;
    this.nz = dz / d;
    return d >= this.length - C.rope.tautSlack;
  }

  /**
   * Reel: input > 0 reels IN (shorten), < 0 lets OUT. Shortening a taut rope
   * conserves angular momentum about the anchor (v_t·L = const, capped per
   * step), so reeling mid-swing speeds the swing up. Call measure() first.
   */
  reel(p, input, speed, dt, maxLength, taut) {
    if (input > 0.15) {
      if (!taut) this.length = Math.min(this.length, this.d);
      const newLen = Math.max(C.rope.minLength, this.length - speed * input * dt);
      if (taut && newLen < this.length) {
        const vr = p.vx * this.nx + p.vy * this.ny + p.vz * this.nz;
        const tvx = p.vx - vr * this.nx;
        const tvy = p.vy - vr * this.ny;
        const tvz = p.vz - vr * this.nz;
        const gain = Math.min(this.length / newLen, C.rope.reelSpinCap);
        p.vx = vr * this.nx + tvx * gain;
        p.vy = vr * this.ny + tvy * gain;
        p.vz = vr * this.nz + tvz * gain;
      }
      this.length = newLen;
    } else if (input < -0.15) {
      this.length = Math.min(maxLength, this.length + C.rope.reelOutSpeed * -input * dt);
    }
  }

  /**
   * Swing pump: the intended (world, horizontal) acceleration projected onto
   * the plane tangent to the rope sphere, so input always pushes along the
   * arc and never fights the rope. Call measure() first.
   */
  pump(p, ax, az, accel, dt) {
    // a = (ax, 0, az); a_t = a - (a·n) n
    const an = ax * this.nx + az * this.nz;
    p.vx += (ax - an * this.nx) * accel * dt;
    p.vy += (0 - an * this.ny) * accel * dt;
    p.vz += (az - an * this.nz) * accel * dt;
  }

  /**
   * Radial constraint: beyond the rope length → project back onto the sphere
   * and remove only the OUTWARD radial velocity; tangential velocity (the
   * swing) is untouched. Returns the radial speed removed.
   */
  constrain(p) {
    const an = this.anchor;
    const L = this.length;
    const dx = p.x - an.x;
    const dy = p.y - an.y;
    const dz = p.z - an.z;
    const d = Math.hypot(dx, dy, dz);
    if (d <= L || d < 1e-6) {
      this.tension = 0;
      return 0;
    }
    const nx = dx / d;
    const ny = dy / d;
    const nz = dz / d;
    p.x = an.x + nx * L;
    p.y = an.y + ny * L;
    p.z = an.z + nz * L;
    let removed = 0;
    const vr = p.vx * nx + p.vy * ny + p.vz * nz;
    if (vr > 0) {
      p.vx -= vr * nx;
      p.vy -= vr * ny;
      p.vz -= vr * nz;
      removed = vr;
    }
    // Tension estimate: centripetal requirement + gravity along the rope (gravity is -Y).
    const v2 = p.vx * p.vx + p.vy * p.vy + p.vz * p.vz;
    this.tension = Math.max(0, v2 / L - C.player.gravity * ny);
    return removed;
  }
}

// =============================================================================
// TetherSystem — targeting, firing, attach/release for both hands.
// =============================================================================
export class TetherSystem {
  /**
   * @param {Level3D} level
   * @param {object} diff  DIFFICULTY preset
   * @param {EventBus} bus
   * @param {object} settings live settings (aimAssist read per query)
   */
  constructor(level, diff, bus, settings) {
    this.level = level;
    this.diff = diff;
    this.bus = bus;
    this.settings = settings || {};
    this._scratch = [];
    this.hands = {};
    for (const h of HANDS) this.hands[h] = this._makeHand(h);
  }

  _makeHand(hand) {
    return {
      hand,
      rope: new Rope3D(hand),
      target: null, // highlighted anchor for this hand's aim
      held: false,
      buffer: 0,
      extend: 1, // visual extension 0..1
      attachTime: 0,
      miss: null, // { x,y,z, dx,dy,dz, len, t }
      lastAim: null,
    };
  }

  reset() {
    for (const h of HANDS) this.hands[h] = this._makeHand(h);
  }

  /** Any hand attached. */
  get attached() {
    return this.hands.left.rope.attached || this.hands.right.rope.attached;
  }

  anchorOf(hand) {
    return this.hands[hand].rope.anchor;
  }

  maxRopeLength() {
    return this.diff.aimRange + C.rope.maxLengthBonus;
  }

  assist() {
    return U.clamp(this.settings.aimAssist || 1, 0.6, 1.4);
  }

  /**
   * Soft targeting along an aim ray {ox,oy,oz,dx,dy,dz} (unit dir). Among
   * anchors within range of the player with line of sight, eligible if the
   * angle to the ray is inside the cone OR the anchor lies within `rayAssist`
   * metres of the ray; best = most aligned (angle + perpendicular offset),
   * with a little stickiness for this hand's current highlight.
   * Returns { anchor, score } or null.
   */
  findTarget(player, aim, hand) {
    if (!aim) return null;
    const range = this.diff.aimRange;
    const cone = this.diff.aimCone * this.assist();
    const assistR = this.diff.rayAssist * this.assist();
    const dl = Math.hypot(aim.dx, aim.dy, aim.dz);
    if (dl < C.targeting.minAimLength) return null;
    const dx = aim.dx / dl;
    const dy = aim.dy / dl;
    const dz = aim.dz / dl;
    const list = this.level.anchorsNear(player.x, player.y, player.z, range, this._scratch);
    const current = hand ? this.hands[hand].target : null;
    const other = hand ? this.hands[hand === 'left' ? 'right' : 'left'].rope.anchor : null;
    let best = null;
    let bestScore = Infinity;
    for (let i = 0; i < list.length; i++) {
      const an = list[i];
      if (an.broken || an === other) continue;
      const pd = Math.hypot(an.x - player.x, an.y - player.y, an.z - player.z);
      if (pd > range || pd < 0.3) continue;
      const ox = an.x - aim.ox;
      const oy = an.y - aim.oy;
      const oz = an.z - aim.oz;
      const t = ox * dx + oy * dy + oz * dz;
      if (t <= 0) continue; // behind the hand
      const px = ox - dx * t;
      const py = oy - dy * t;
      const pz = oz - dz * t;
      const perp = Math.hypot(px, py, pz);
      const ang = Math.atan2(perp, t);
      if (ang > cone && perp > assistR) continue;
      let score = (ang / cone) * 0.6 + (Math.min(perp, assistR * 3) / assistR) * 0.8 + (pd / range) * 0.2;
      if (an === current) score -= C.targeting.stickiness;
      if (score >= bestScore) continue;
      if (this.level.segmentBlocked(player.x, player.y, player.z, an.x, an.y, an.z, C.targeting.losEndClearance)) continue;
      best = an;
      bestScore = score;
    }
    return best ? { anchor: best, score: bestScore } : null;
  }

  /** Refresh each hand's highlight from its aim (once per frame). */
  updateTargets(player, intent) {
    for (const h of HANDS) {
      const st = this.hands[h];
      const aim = intent.hands && intent.hands[h] ? intent.hands[h].aim : null;
      st.lastAim = aim || st.lastAim;
      const found = player.alive && aim ? this.findTarget(player, aim, h) : null;
      st.target = found ? found.anchor : null;
    }
  }

  /**
   * Applies per-hand edges once per frame:
   * intent.hands[h] = { aim, pressed, held, released }.
   */
  handleInput(player, intent, dt) {
    if (!player.alive) return;
    for (const h of HANDS) {
      const hi = intent.hands ? intent.hands[h] : null;
      if (!hi) continue;
      const st = this.hands[h];
      if (hi.pressed) {
        st.held = true;
        this.fire(player, h, hi.aim);
      }
      if (hi.released || (!hi.held && st.held)) {
        st.held = false;
        st.buffer = 0;
        if (st.rope.attached) this.release(player, h, 'input');
      }
      // Buffered fire: a held trigger that whiffed keeps looking briefly.
      if (st.held && !st.rope.attached && st.buffer > 0) {
        st.buffer -= dt;
        const found = this.findTarget(player, hi.aim, h);
        if (found) this.attach(player, h, found.anchor);
      }
    }
  }

  fire(player, hand, aim) {
    const found = this.findTarget(player, aim, hand);
    if (found) {
      this.attach(player, hand, found.anchor);
      return true;
    }
    const st = this.hands[hand];
    const a = aim || st.lastAim;
    if (a) {
      const l = Math.hypot(a.dx, a.dy, a.dz) || 1;
      st.miss = { x: a.ox, y: a.oy, z: a.oz, dx: a.dx / l, dy: a.dy / l, dz: a.dz / l, len: this.diff.aimRange * 0.85, t: 0 };
    }
    st.buffer = C.rope.grappleBuffer;
    this.bus.emit('grapple:miss', { hand, x: player.x, y: player.y, z: player.z });
    return false;
  }

  attach(player, hand, anchor) {
    const st = this.hands[hand];
    const prev = st.rope.anchor;
    const d = Math.hypot(player.x - anchor.x, player.y - anchor.y, player.z - anchor.z);
    st.rope.attach(anchor, d, this.maxRopeLength());
    st.extend = 0;
    st.attachTime = 0;
    st.miss = null;
    st.buffer = 0;
    if (anchor.kind === 'fragile' && !anchor.load) anchor.load = 0;
    this.bus.emit('grapple:attach', { hand, anchor, x: anchor.x, y: anchor.y, z: anchor.z, speed: player.speed, previous: prev, distance: d });
  }

  release(player, hand, reason) {
    const st = this.hands[hand];
    if (!st.rope.attached) return;
    const anchor = st.rope.anchor;
    st.rope.detach();
    const otherAttached = this.hands[hand === 'left' ? 'right' : 'left'].rope.attached;
    // A small, predictable boost keeps well-timed releases snappy (only when
    // letting go completely).
    if (reason === 'input' && !otherAttached && player.speed > C.rope.releaseBoostMinSpeed) {
      player.vx *= C.rope.releaseBoost;
      player.vy *= C.rope.releaseBoost;
      player.vz *= C.rope.releaseBoost;
    }
    this.bus.emit('grapple:release', { hand, anchor, reason: reason || 'input', speed: player.speed });
  }

  releaseAll(player, reason) {
    for (const h of HANDS) this.release(player, h, reason);
  }

  /** Per-step bookkeeping: visual extension, whiffs, fragile anchors. */
  step(player, dt) {
    for (const h of HANDS) {
      const st = this.hands[h];
      if (st.miss) {
        st.miss.t += dt;
        if (st.miss.t >= C.rope.missTime) st.miss = null;
      }
      const rope = st.rope;
      if (!rope.attached) continue;
      if (st.extend < 1) st.extend = Math.min(1, st.extend + (C.rope.fireSpeed * dt) / Math.max(rope.length, 0.5));
      st.attachTime += dt;
      const an = rope.anchor;
      if (an.kind === 'fragile') {
        an.load = (an.load || 0) + dt;
        if (an.load >= this.diff.fragileTime * (an.life || 1)) {
          an.broken = true;
          this.bus.emit('grapple:break', { hand: h, anchor: an, x: an.x, y: an.y, z: an.z });
          this.release(player, h, 'break');
        }
      }
    }
  }

  /** 0..1 stress of a hand's fragile anchor. */
  anchorStress(hand) {
    const an = this.hands[hand].rope.anchor;
    if (!an || an.kind !== 'fragile') return 0;
    return U.clamp((an.load || 0) / (this.diff.fragileTime * (an.life || 1)), 0, 1);
  }
}

// =============================================================================
// Physics3D — fixed-step integrator.
// =============================================================================
export class Physics3D {
  constructor(level, diff, bus) {
    this.level = level;
    this.diff = diff;
    this.bus = bus;
    this._solids = [];
    this._hazards = [];
  }

  /**
   * One fixed step.
   * intent: {
   *   move: {x, z}  world-space horizontal intent, |move| ≤ 1 (already rotated by head yaw)
   *   reel: -1..1   (+ = reel in all tethered hands)
   *   jumpPressed, brake (bool: stop on the ground)
   *   hands: { left: { yank 0..1 }, right: { yank 0..1 } }
   * }
   */
  step(player, tethers, intent, dt) {
    if (!player.alive) return;
    const P = C.player;
    const R = C.rope;

    player.prevX = player.x;
    player.prevY = player.y;
    player.prevZ = player.z;
    player.landedThisStep = false;

    // ---- 1. timers & control ------------------------------------------------
    if (player.stagger > 0) player.stagger = Math.max(0, player.stagger - dt);
    const control = player.stagger > 0 ? P.staggerControl : 1;
    let mx = intent.move ? intent.move.x || 0 : 0;
    let mz = intent.move ? intent.move.z || 0 : 0;
    const ml = Math.hypot(mx, mz);
    if (ml > 1) {
      mx /= ml;
      mz /= ml;
    }
    mx *= control;
    mz *= control;
    const moving = ml > 0.05;

    if (player.grounded) {
      player.coyote = P.coyoteTime;
      player.groundTime += dt;
      player.airTime = 0;
    } else {
      player.coyote = Math.max(0, player.coyote - dt);
      player.airTime += dt;
      player.groundTime = 0;
    }
    if (intent.jumpPressed) player.jumpBuffer = P.jumpBuffer;
    else player.jumpBuffer = Math.max(0, player.jumpBuffer - dt);

    // ---- 2. forces -------------------------------------------------------------
    player.vy -= P.gravity * dt;

    let anyTaut = false;
    let attached = false;
    for (const h of HANDS) {
      const rope = tethers.hands[h].rope;
      if (!rope.attached) continue;
      attached = true;
      const taut = rope.measure(player);
      anyTaut = anyTaut || taut;
      // Grip on a tethered hand yanks that rope in hard; otherwise the shared reel axis.
      const yank = intent.hands && intent.hands[h] ? intent.hands[h].yank || 0 : 0;
      if (yank > 0.15) rope.reel(player, 1, R.yankSpeed * yank, dt, tethers.maxRopeLength(), taut);
      else rope.reel(player, intent.reel || 0, R.reelInSpeed, dt, tethers.maxRopeLength(), taut);
      if (taut && moving && !player.grounded) rope.pump(player, mx, mz, R.pumpAccel, dt);
    }
    player._tethered = attached;

    if (player.grounded) {
      if (intent.brake && !attached) {
        const k = Math.exp(-P.groundFriction * P.brakeFactor * dt);
        player.vx *= k;
        player.vz *= k;
      } else if (moving) {
        const tx = mx * P.runMaxSpeed;
        const tz = mz * P.runMaxSpeed;
        const hs = Math.hypot(player.vx, player.vz);
        if (hs > P.runMaxSpeed && player.vx * mx + player.vz * mz > 0) {
          player.vx = U.damp(player.vx, tx, P.overspeedFriction, dt);
          player.vz = U.damp(player.vz, tz, P.overspeedFriction, dt);
        } else {
          // Approach the target velocity along the difference vector.
          const ex = tx - player.vx;
          const ez = tz - player.vz;
          const el = Math.hypot(ex, ez);
          const step = P.runAccel * dt;
          if (el <= step) {
            player.vx = tx;
            player.vz = tz;
          } else {
            player.vx += (ex / el) * step;
            player.vz += (ez / el) * step;
          }
        }
      } else {
        const k = Math.exp(-P.groundFriction * dt);
        player.vx *= k;
        player.vz *= k;
        if (Math.hypot(player.vx, player.vz) < 0.05) {
          player.vx = 0;
          player.vz = 0;
        }
      }
    } else if (!anyTaut) {
      // Air control: steer up to airMaxSpeed along the intent, never braking momentum.
      if (moving) {
        const along = player.vx * mx + player.vz * mz; // speed along intent (mx,mz may be < 1)
        const im = Math.hypot(mx, mz) || 1;
        if (along / im < P.airMaxSpeed) {
          player.vx += mx * P.airAccel * dt;
          player.vz += mz * P.airAccel * dt;
        }
      }
      const k = Math.exp(-P.airDrag * dt);
      player.vx *= k;
      player.vz *= k;
    }

    // Jump (buffered + coyote). Not while hanging on a taut rope.
    if (player.jumpBuffer > 0 && player.coyote > 0 && !anyTaut) {
      player.vy = Math.max(player.vy, P.jumpSpeed);
      player.jumpBuffer = 0;
      player.coyote = 0;
      player.grounded = false;
      this.bus.emit('player:jump', { x: player.x, y: player.y, z: player.z });
    }

    // ---- 3. clamps & integration ---------------------------------------------
    if (!attached && player.vy < -P.maxFallSpeed) player.vy = -P.maxFallSpeed;
    const sp = player.speed;
    if (sp > P.maxSpeed) {
      const k = P.maxSpeed / sp;
      player.vx *= k;
      player.vy *= k;
      player.vz *= k;
    }
    if (!isFinite(player.vx) || !isFinite(player.vy) || !isFinite(player.vz)) {
      player.vx = 0;
      player.vy = 0;
      player.vz = 0;
    }
    player.x += player.vx * dt;
    player.y += player.vy * dt;
    player.z += player.vz * dt;

    // ---- 4. rope constraints ------------------------------------------------------
    player.tension = 0;
    if (attached) {
      const passes = tethers.hands.left.rope.attached && tethers.hands.right.rope.attached ? 2 : 1;
      let jolt = 0;
      for (let pass = 0; pass < passes; pass++) {
        for (const h of HANDS) {
          const rope = tethers.hands[h].rope;
          if (!rope.attached) continue;
          jolt = Math.max(jolt, rope.constrain(player));
        }
      }
      if (passes === 2) {
        // Two ropes can ask for lengths no position satisfies (e.g. both reeled
        // in toward far-apart anchors). Reeling then stalls: a rope still
        // stretched after solving gives out to the achievable length, so the
        // constraints never fight and pump energy into the body.
        for (const h of HANDS) {
          const rope = tethers.hands[h].rope;
          const d = Math.hypot(player.x - rope.anchor.x, player.y - rope.anchor.y, player.z - rope.anchor.z);
          if (d > rope.length + 0.02) rope.length = d;
        }
      }
      for (const h of HANDS) player.tension += tethers.hands[h].rope.tension;
      if (jolt > R.joltFxSpeed) {
        player.ropeJolt = jolt;
        this.bus.emit('rope:jolt', { speed: jolt, x: player.x, y: player.y, z: player.z });
      }
    }

    // ---- 5. collisions --------------------------------------------------------------
    this.resolveCollisions(player, tethers, dt);
    if (!player.alive) return;

    if (player.grounded) player.fallPeak = 0;
    else if (-player.vy > player.fallPeak) player.fallPeak = -player.vy;

    const r = player.radius;
    const hz = this.level.queryHazards(player.x - r, player.y - r, player.z - r, player.x + r, player.y + r, player.z + r, this._hazards);
    for (let i = 0; i < hz.length; i++) {
      if (hz[i].active === false) continue;
      if (U.sphereBox(player.x, player.y, player.z, r * 0.8, hz[i])) {
        this.kill(player, tethers, 'hazard');
        return;
      }
    }

    if (player.y < this.level.bounds.minY - P.fallDeathMargin) {
      this.kill(player, tethers, 'fall');
      return;
    }

    tethers.step(player, dt);
  }

  resolveCollisions(player, tethers, dt) {
    const P = C.player;
    const r = player.radius;
    const wasGrounded = player.grounded;
    player.grounded = false;
    player.groundSolid = null;

    let maxImpact = 0;
    let impactNY = 0;
    const preDown = Math.max(0, -player.vy); // downward speed before contact
    let floorFall = 0;
    const solids = this.level.querySolids(player.x - r - 0.2, player.y - r - 0.2, player.z - r - 0.2, player.x + r + 0.2, player.y + r + 0.2, player.z + r + 0.2, this._solids);

    for (let iter = 0; iter < 3; iter++) {
      let any = false;
      for (let i = 0; i < solids.length; i++) {
        const s = solids[i];
        if (s.active === false) continue;
        const cx = U.clamp(player.x, s.minX, s.maxX);
        const cy = U.clamp(player.y, s.minY, s.maxY);
        const cz = U.clamp(player.z, s.minZ, s.maxZ);
        const dx = player.x - cx;
        const dy = player.y - cy;
        const dz = player.z - cz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= r * r) continue;
        let nx;
        let ny;
        let nz;
        let pen;
        if (d2 > 1e-10) {
          const d = Math.sqrt(d2);
          nx = dx / d;
          ny = dy / d;
          nz = dz / d;
          pen = r - d;
        } else {
          // Centre inside the box: push out along the shallowest axis, preferring "up"
          // when we came from above.
          const faces = [
            [player.x - s.minX, -1, 0, 0],
            [s.maxX - player.x, 1, 0, 0],
            [player.y - s.minY, 0, -1, 0],
            [s.maxY - player.y, 0, 1, 0],
            [player.z - s.minZ, 0, 0, -1],
            [s.maxZ - player.z, 0, 0, 1],
          ];
          let bestF = faces[0];
          for (const f of faces) if (f[0] < bestF[0]) bestF = f;
          if (player.prevY >= s.maxY) bestF = faces[3];
          nx = bestF[1];
          ny = bestF[2];
          nz = bestF[3];
          pen = bestF[0] + r;
        }
        player.x += nx * pen;
        player.y += ny * pen;
        player.z += nz * pen;
        const vn = player.vx * nx + player.vy * ny + player.vz * nz;
        if (vn < 0) {
          const impact = -vn;
          if (impact > maxImpact) {
            maxImpact = impact;
            impactNY = ny;
          }
          // Lethality on floor-ish contacts uses the pre-contact fall speed weighted by
          // how floor-like the contact is, so clipping a ledge corner cannot save a fall.
          if (ny > P.lethalNormalY) {
            const fall = preDown * U.smoothstep(P.lethalNormalY, 0.75, ny);
            if (fall > floorFall) floorFall = fall;
          }
          player.vx -= vn * nx;
          player.vy -= vn * ny;
          player.vz -= vn * nz;
        }
        if (ny > P.groundNormalY) {
          player.grounded = true;
          player.groundSolid = s;
        }
        any = true;
      }
      if (!any) break;
    }

    // Crumbling ledges give way after being stood on.
    const gs = player.groundSolid;
    if (gs && gs.kind === 'crumble' && gs.active !== false) {
      gs.load = (gs.load || 0) + dt;
      if (gs.load >= this.diff.crumbleTime * (gs.life || 1)) {
        gs.active = false;
        gs.fallen = true;
        this.bus.emit('platform:crumble', { solid: gs, x: (gs.minX + gs.maxX) / 2, y: gs.maxY, z: (gs.minZ + gs.maxZ) / 2 });
      }
    }

    if (maxImpact <= 0 && floorFall <= 0) {
      if (!wasGrounded && player.grounded) player.landedThisStep = true;
      return;
    }
    player.lastImpact = maxImpact;
    const floorish = impactNY > P.lethalNormalY;
    const lethalMeasure = Math.max(floorish ? maxImpact : 0, floorFall);
    if (this.diff.impactsLethal && lethalMeasure >= this.diff.lethalImpact) {
      this.kill(player, tethers, 'impact', lethalMeasure);
      return;
    }
    if (floorish && !wasGrounded) {
      const hard = maxImpact >= P.hardLandingSpeed;
      if (hard) player.stagger = P.staggerTime;
      player.landedThisStep = true;
      this.bus.emit('player:land', { impact: maxImpact, hard, x: player.x, y: player.y - r, z: player.z, lethalRatio: maxImpact / this.diff.lethalImpact });
    } else if (!floorish && maxImpact >= P.wallHitFxSpeed) {
      if (maxImpact >= P.hardLandingSpeed) player.stagger = Math.max(player.stagger, P.staggerTime * 0.6);
      this.bus.emit('player:wallhit', { impact: maxImpact, x: player.x, y: player.y, z: player.z });
    }
  }

  kill(player, tethers, cause, impact) {
    if (!player.alive) return;
    if (tethers) tethers.releaseAll(player, 'death');
    player.alive = false;
    player.deathCause = cause;
    player.vx = 0;
    player.vy = 0;
    player.vz = 0;
    this.bus.emit('player:death', { cause, x: player.x, y: player.y, z: player.z, impact: impact || 0 });
  }
}
