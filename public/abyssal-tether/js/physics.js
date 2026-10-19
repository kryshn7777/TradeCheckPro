/* ABYSSAL TETHER — physics.js
 * Player state, the grappling tether (soft targeting, attach/release, rope
 * constraint) and circle-vs-AABB collision. This is the heart of the game:
 * everything here favours predictable, stable "game-feel" physics over a
 * faithful rope simulation.
 *
 * Simulation runs at a fixed CONFIG.PHYSICS_DT (240 Hz). Per step:
 *   1. timers / control
 *   2. gravity + player intent (run, air control, swing pump, reel)
 *   3. semi-implicit Euler integration
 *   4. rope radial constraint (project position, strip outward radial velocity)
 *   5. collision resolution against solids, impacts, hazards
 *
 * DOM-free: loadable from Node for level-verification tooling.
 */
(function (AT) {
  'use strict';

  const U = AT.util;
  const C = AT.CONFIG;

  // ===========================================================================
  // Player
  // ===========================================================================
  class Player {
    constructor(x, y) {
      this.radius = C.player.radius;
      this.reset(x || 0, y || 0);
    }

    reset(x, y) {
      this.x = x;
      this.y = y;
      this.prevX = x; // previous physics step (render interpolation)
      this.prevY = y;
      this.rx = x; // interpolated render position (set by Game each frame)
      this.ry = y;
      this.vx = 0;
      this.vy = 0;
      this.grounded = false;
      this.alive = true;
      this.grappleState = 'idle'; // 'idle' | 'attached'
      this.ropeLength = 0;
      this.facing = 1;
      this.coyote = 0;
      this.jumpBuffer = 0;
      this.stagger = 0;
      this.airTime = 0;
      this.groundTime = 0;
      this.fallPeak = 0; // highest downward speed in the current airborne phase
      this.groundSolid = null;
      this.wallContact = 0; // -1 touching a wall on the left, +1 right, 0 none
      this.lastImpact = 0;
      this.tension = 0; // rope tension estimate (u/s^2), for audio/visual feedback
      this.ropeJolt = 0; // radial speed removed by the most recent hard rope catch
      this.deathCause = null;
      this.landedThisStep = false;
    }

    get velocityX() {
      return this.vx;
    }
    set velocityX(v) {
      this.vx = v;
    }
    get velocityY() {
      return this.vy;
    }
    set velocityY(v) {
      this.vy = v;
    }
    get speed() {
      return Math.hypot(this.vx, this.vy);
    }
    /** True when falling freely fast enough that a landing would hurt. */
    get falling() {
      return !this.grounded && this.grappleState !== 'attached' && this.vy > C.player.hardLandingSpeed * 0.6;
    }
  }

  // ===========================================================================
  // GrappleSystem — targeting, firing, attachment, release, fragile anchors.
  // ===========================================================================
  class GrappleSystem {
    /**
     * @param {AT.Level} level
     * @param {object} diff     difficulty preset (AT.DIFFICULTY[key])
     * @param {AT.EventBus} bus
     * @param {object} settings live settings object (aimAssist is read each query)
     */
    constructor(level, diff, bus, settings) {
      this.level = level;
      this.diff = diff;
      this.bus = bus;
      this.settings = settings || AT.SETTINGS_DEFAULTS;
      this._scratch = [];
      this.reset();
    }

    reset() {
      this.anchor = null; // attached anchor object
      this.ropeLength = 0;
      this.target = null; // currently highlighted (would-be) target
      this.targetScore = Infinity;
      this.held = false;
      this.buffer = 0; // remaining time a held press keeps searching
      this.extend = 1; // visual tether extension 0..1
      this.attachTime = 0; // seconds attached to the current anchor
      this.miss = null; // { x, y, dirX, dirY, len, t } whiff animation
      this.lastAim = { x: 0, y: 1 }; // last valid aim direction (unit)
      this.aimPoint = null; // last world aim point
      this.releasedAt = -1;
      this.attachCount = 0;
    }

    get attached() {
      return this.anchor !== null;
    }

    /** Effective cone half-angle (radians) for the current settings. */
    coneHalfAngle() {
      const assist = U.clamp(this.settings.aimAssist || 1, 0.6, 1.4);
      return this.diff.aimCone * assist;
    }

    /**
     * Normalises raw aim into { dirX, dirY, px, py, assist } or null.
     * aim: { mode:'point', x, y, touch } | { mode:'dir', dx, dy }
     */
    resolveAim(player, aim) {
      if (!aim) return null;
      if (aim.mode === 'point') {
        const dx = aim.x - player.x;
        const dy = aim.y - player.y;
        const d = Math.hypot(dx, dy);
        const assistBase = aim.touch ? this.diff.touchAssistRadius : C.targeting.mouseAssistRadius;
        const assist = assistBase * U.clamp(this.settings.aimAssist || 1, 0.6, 1.4);
        if (d < C.targeting.minAimDistance) {
          return { dirX: this.lastAim.x, dirY: this.lastAim.y, px: aim.x, py: aim.y, assist, touch: !!aim.touch };
        }
        return { dirX: dx / d, dirY: dy / d, px: aim.x, py: aim.y, assist, touch: !!aim.touch };
      }
      if (aim.mode === 'dir') {
        const d = Math.hypot(aim.dx, aim.dy);
        if (d < 1e-6) return null;
        return { dirX: aim.dx / d, dirY: aim.dy / d, px: null, py: null, assist: 0, touch: false };
      }
      return null;
    }

    /**
     * Soft targeting: among anchors within range and line of sight, prefer the
     * one best aligned with the intended aim. With a point aim (mouse / direct
     * touch), anchors near the aim point are always eligible even outside the
     * cone, and proximity to the point dominates the score.
     * Returns { anchor, score } or null.
     */
    findTarget(player, aim) {
      const a = this.resolveAim(player, aim);
      if (!a) return null;
      const range = this.diff.aimRange;
      const cone = this.coneHalfAngle();
      const list = this.level.anchorsNear(player.x, player.y, range, this._scratch);
      let best = null;
      let bestScore = Infinity;
      for (let i = 0; i < list.length; i++) {
        const an = list[i];
        if (an.broken) continue;
        const ox = an.x - player.x;
        const oy = an.y - player.y;
        const d = Math.hypot(ox, oy);
        if (d > range || d < 1) continue;
        const ang = U.angleBetween(a.dirX, a.dirY, ox, oy);
        let prox = Infinity;
        if (a.px !== null) prox = Math.hypot(an.x - a.px, an.y - a.py);
        const inCone = ang <= cone;
        const nearPoint = prox <= a.assist;
        if (!inCone && !nearPoint) continue;
        let score;
        if (a.px !== null) {
          // Point aim: proximity to the cursor/finger dominates, alignment next.
          score = (Math.min(prox, a.assist * 3) / Math.max(a.assist, 1)) * 0.9 + (ang / cone) * 0.6 + (d / range) * 0.2;
        } else {
          score = (ang / cone) * 1.0 + (d / range) * 0.3;
        }
        if (an === this.target) score -= C.targeting.stickiness;
        if (score >= bestScore) continue;
        if (this.level.segmentBlocked(player.x, player.y, an.x, an.y, C.targeting.losEndClearance)) continue;
        best = an;
        bestScore = score;
      }
      return best ? { anchor: best, score: bestScore } : null;
    }

    /** Updates the highlighted target from the current aim (call once per frame). */
    updateTarget(player, aim) {
      const a = this.resolveAim(player, aim);
      if (a) {
        this.lastAim.x = a.dirX;
        this.lastAim.y = a.dirY;
        this.aimPoint = a.px !== null ? { x: a.px, y: a.py } : null;
      }
      const found = player.alive ? this.findTarget(player, aim) : null;
      this.target = found ? found.anchor : null;
      this.targetScore = found ? found.score : Infinity;
    }

    /**
     * Applies grapple intent edges. Called once per frame before physics.
     * intent: { grapplePressed, grappleHeld, grappleReleased, grappleTap }
     */
    handleInput(player, intent, aim, dt) {
      if (!player.alive) return;
      if (intent.grappleTap) {
        // Toggle mode: tap fires when free; when attached, a tap on another
        // anchor switches to it, otherwise it releases.
        if (this.anchor) {
          const found = this.findTarget(player, aim);
          if (found && found.anchor !== this.anchor && this._tapNearAnchor(aim, found.anchor)) {
            this.attach(player, found.anchor, true);
          } else {
            this.release(player, 'input');
          }
        } else {
          this.fire(player, aim);
        }
        this.held = false;
        this.buffer = 0;
        return;
      }

      if (intent.grapplePressed) {
        this.held = true;
        if (this.anchor) {
          // A fresh press while attached (second finger, re-click) chains to a new anchor.
          const found = this.findTarget(player, aim);
          if (found && found.anchor !== this.anchor) this.attach(player, found.anchor, true);
        } else {
          this.fire(player, aim);
        }
      }

      if (intent.grappleReleased || (!intent.grappleHeld && this.held)) {
        this.held = false;
        this.buffer = 0;
        if (this.anchor) this.release(player, 'input');
      }

      // Buffered grapple: a held press that found nothing keeps looking briefly,
      // so slightly early clicks still connect.
      if (this.held && !this.anchor && this.buffer > 0) {
        this.buffer -= dt;
        const found = this.findTarget(player, aim);
        if (found) this.attach(player, found.anchor, false);
      }
    }

    _tapNearAnchor(aim, anchor) {
      if (!aim || aim.mode !== 'point') return true;
      const assist = (aim.touch ? this.diff.touchAssistRadius : C.targeting.mouseAssistRadius) * 1.6;
      return Math.hypot(anchor.x - aim.x, anchor.y - aim.y) <= assist;
    }

    fire(player, aim) {
      const found = this.findTarget(player, aim);
      if (found) {
        this.attach(player, found.anchor, false);
        return true;
      }
      // Whiff: show the tether lashing out along the aim and snapping back.
      const a = this.resolveAim(player, aim);
      const dirX = a ? a.dirX : this.lastAim.x;
      const dirY = a ? a.dirY : this.lastAim.y;
      this.miss = { x: player.x, y: player.y, dirX, dirY, len: this.diff.aimRange * 0.85, t: 0 };
      this.buffer = C.rope.grappleBuffer;
      this.bus.emit('grapple:miss', { x: player.x, y: player.y, dirX, dirY });
      return false;
    }

    attach(player, anchor, chained) {
      const prev = this.anchor;
      const d = Math.hypot(player.x - anchor.x, player.y - anchor.y);
      this.anchor = anchor;
      this.ropeLength = U.clamp(d, C.rope.minLength, this.maxRopeLength());
      this.extend = 0;
      this.attachTime = 0;
      this.miss = null;
      this.buffer = 0;
      this.attachCount++;
      player.grappleState = 'attached';
      player.ropeLength = this.ropeLength;
      if (anchor.kind === 'fragile' && !anchor.load) anchor.load = 0;
      this.bus.emit('grapple:fire', { x: player.x, y: player.y, targetX: anchor.x, targetY: anchor.y, hit: true });
      this.bus.emit('grapple:attach', {
        anchor,
        x: anchor.x,
        y: anchor.y,
        speed: player.speed,
        chained: !!chained,
        previous: prev,
        distance: d,
      });
    }

    release(player, reason) {
      if (!this.anchor) return;
      const anchor = this.anchor;
      this.anchor = null;
      this.ropeLength = 0;
      player.grappleState = 'idle';
      player.ropeLength = 0;
      player.tension = 0;
      // A small, predictable boost keeps well-timed releases feeling snappy.
      const sp = player.speed;
      if (reason === 'input' && sp > C.rope.releaseBoostMinSpeed) {
        player.vx *= C.rope.releaseBoost;
        player.vy *= C.rope.releaseBoost;
      }
      this.bus.emit('grapple:release', { anchor, reason: reason || 'input', speed: player.speed, vx: player.vx, vy: player.vy });
    }

    maxRopeLength() {
      return this.diff.aimRange + C.rope.maxLengthBonus;
    }

    /** Per-physics-step bookkeeping: fragile anchor load, animations. */
    step(player, dt) {
      if (this.extend < 1 && this.anchor) {
        const len = Math.max(this.ropeLength, 1);
        this.extend = Math.min(1, this.extend + (C.rope.fireSpeed * dt) / len);
      }
      if (this.miss) {
        this.miss.t += dt;
        if (this.miss.t >= C.rope.missTime) this.miss = null;
      }
      if (!this.anchor) return;
      this.attachTime += dt;
      const an = this.anchor;
      if (an.kind === 'fragile') {
        an.load = (an.load || 0) + dt;
        const life = this.diff.fragileTime * (an.life || 1);
        if (an.load >= life) {
          an.broken = true;
          this.bus.emit('grapple:break', { anchor: an, x: an.x, y: an.y });
          this.release(player, 'break');
        }
      }
    }

    /** 0..1 stress of the attached fragile anchor (for shaking / creaks). */
    anchorStress() {
      const an = this.anchor;
      if (!an || an.kind !== 'fragile') return 0;
      return U.clamp((an.load || 0) / (this.diff.fragileTime * (an.life || 1)), 0, 1);
    }
  }

  // ===========================================================================
  // Physics — fixed-step integrator for the player + rope + collisions.
  // ===========================================================================
  class Physics {
    constructor(level, diff, bus) {
      this.level = level;
      this.diff = diff;
      this.bus = bus;
      this._solids = [];
      this._hazards = [];
    }

    /**
     * Advances the player one fixed step.
     * intent: { moveX:-1..1, moveY:-1..1 (-1 = up / reel in), jumpPressed }
     */
    step(player, grapple, intent, dt) {
      if (!player.alive) return;
      const P = C.player;
      const R = C.rope;

      player.prevX = player.x;
      player.prevY = player.y;
      player.landedThisStep = false;

      // ---- 1. timers & control ------------------------------------------------
      if (player.stagger > 0) player.stagger = Math.max(0, player.stagger - dt);
      const control = player.stagger > 0 ? P.staggerControl : 1;
      const mx = U.clamp(intent.moveX || 0, -1, 1) * control;
      const my = U.clamp(intent.moveY || 0, -1, 1);
      if (mx > 0.1) player.facing = 1;
      else if (mx < -0.1) player.facing = -1;

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
      player.vy += P.gravity * dt;

      const anchor = grapple.anchor;
      let taut = false;
      if (anchor) {
        const dx = player.x - anchor.x;
        const dy = player.y - anchor.y;
        const d = Math.hypot(dx, dy) || 1e-6;
        const nx = dx / d; // unit vector anchor → player
        const ny = dy / d;
        taut = d >= grapple.ropeLength - R.tautSlack;

        // Reel. Reeling in on a taut rope conserves angular momentum about
        // the anchor (v_t * L = const), so shortening mid-swing speeds the
        // swing up — a deliberate, learnable technique (capped per step).
        if (my < -0.15) {
          if (!taut) grapple.ropeLength = Math.min(grapple.ropeLength, d);
          const newLen = Math.max(R.minLength, grapple.ropeLength - R.reelInSpeed * -my * dt);
          if (taut && newLen < grapple.ropeLength) {
            const vr = player.vx * nx + player.vy * ny;
            const tvx = player.vx - vr * nx;
            const tvy = player.vy - vr * ny;
            const gain = Math.min(grapple.ropeLength / newLen, R.reelSpinCap);
            player.vx = vr * nx + tvx * gain;
            player.vy = vr * ny + tvy * gain;
          }
          grapple.ropeLength = newLen;
        } else if (my > 0.15) {
          grapple.ropeLength = Math.min(grapple.maxRopeLength(), grapple.ropeLength + R.reelOutSpeed * my * dt);
        }
        player.ropeLength = grapple.ropeLength;

        // Swing pump: project the horizontal intent onto the rope tangent, so
        // A/D always pushes "along the arc" — never fights the rope.
        if (taut && mx !== 0 && !player.grounded) {
          const tx = -ny;
          const ty = nx;
          const along = mx * tx; // (mx, 0) · t
          player.vx += tx * along * R.pumpAccel * dt;
          player.vy += ty * along * R.pumpAccel * dt;
        }
      }

      // Ground / air control (a taut rope pulling the player off the floor
      // is handled by the constraint below; running still works on slack).
      if (player.grounded) {
        const target = mx * P.runMaxSpeed;
        if (Math.abs(mx) > 0.05) {
          if (Math.abs(player.vx) > P.runMaxSpeed && U.sign(player.vx) === U.sign(mx)) {
            // Keep landing momentum, bleeding it off gently.
            player.vx = U.damp(player.vx, target, P.overspeedFriction, dt);
          } else {
            player.vx = U.approach(player.vx, target, P.runAccel * dt);
          }
        } else {
          player.vx *= Math.exp(-P.groundFriction * dt);
          if (Math.abs(player.vx) < 2) player.vx = 0;
        }
      } else if (!anchor || !taut) {
        // Air control: can steer up to airMaxSpeed but never brakes existing momentum.
        if (Math.abs(mx) > 0.05) {
          const s = U.sign(mx);
          if (player.vx * s < P.airMaxSpeed) {
            player.vx = Math.min(player.vx * s + P.airAccel * Math.abs(mx) * dt, P.airMaxSpeed) * s;
          }
        }
        player.vx *= Math.exp(-P.airDrag * dt);
      }

      // Jump (buffered + coyote time). Not while hanging on a taut rope.
      if (player.jumpBuffer > 0 && player.coyote > 0 && !(anchor && taut)) {
        player.vy = Math.min(player.vy, -P.jumpSpeed);
        player.jumpBuffer = 0;
        player.coyote = 0;
        player.grounded = false;
        this.bus.emit('player:jump', { x: player.x, y: player.y });
      }

      // ---- 3. clamps & integration ---------------------------------------------
      if (!anchor && player.vy > P.maxFallSpeed) player.vy = P.maxFallSpeed;
      const sp = Math.hypot(player.vx, player.vy);
      if (sp > P.maxSpeed) {
        const k = P.maxSpeed / sp;
        player.vx *= k;
        player.vy *= k;
      }
      if (!isFinite(player.vx) || !isFinite(player.vy)) {
        player.vx = 0;
        player.vy = 0;
      }

      player.x += player.vx * dt;
      player.y += player.vy * dt;

      // ---- 4. rope constraint ------------------------------------------------------
      player.tension = 0;
      if (anchor) this.applyRopeConstraint(player, grapple);

      // ---- 5. collisions -------------------------------------------------------------
      this.resolveCollisions(player, grapple, dt);
      if (!player.alive) return;

      if (player.grounded) {
        player.fallPeak = 0;
      } else if (player.vy > player.fallPeak) {
        player.fallPeak = player.vy;
      }

      // Hazards (jagged rebar, blades …): instant death on contact.
      const r = player.radius;
      const hazards = this.level.queryHazards(player.x - r, player.y - r, player.x + r, player.y + r, this._hazards);
      for (let i = 0; i < hazards.length; i++) {
        const hz = hazards[i];
        if (hz.active === false) continue;
        if (U.circleRect(player.x, player.y, r * 0.8, hz)) {
          this.kill(player, grapple, 'hazard');
          return;
        }
      }

      // Fell out of the world.
      if (player.y > this.level.bounds.y1 + P.fallDeathMargin) {
        this.kill(player, grapple, 'fall');
        return;
      }

      grapple.step(player, dt);
    }

    /**
     * Rope as an inextensible-when-taut, slack-when-short constraint:
     * if the player is beyond the rope length, project them back onto the
     * circle and remove only the OUTWARD radial velocity. Tangential velocity
     * (the swing) is untouched, so momentum is preserved and readable.
     */
    applyRopeConstraint(player, grapple) {
      const an = grapple.anchor;
      const L = grapple.ropeLength;
      const dx = player.x - an.x;
      const dy = player.y - an.y;
      const d = Math.hypot(dx, dy);
      if (d <= L || d < 1e-6) return;
      const nx = dx / d;
      const ny = dy / d;
      player.x = an.x + nx * L;
      player.y = an.y + ny * L;
      const vr = player.vx * nx + player.vy * ny;
      if (vr > 0) {
        player.vx -= vr * nx;
        player.vy -= vr * ny;
        if (vr > C.rope.joltFxSpeed) {
          player.ropeJolt = vr;
          this.bus.emit('rope:jolt', { speed: vr, x: player.x, y: player.y });
        }
      }
      // Tension estimate for feedback: centripetal requirement + gravity along the rope.
      const tvx = player.vx;
      const tvy = player.vy;
      const vt2 = tvx * tvx + tvy * tvy;
      player.tension = Math.max(0, vt2 / L + C.player.gravity * ny);
    }

    resolveCollisions(player, grapple, dt) {
      const P = C.player;
      const r = player.radius;
      const wasGrounded = player.grounded;
      player.grounded = false;
      player.groundSolid = null;
      player.wallContact = 0;

      let maxImpact = 0;
      let impactNY = 0;
      let impactNX = 0;
      const solids = this.level.querySolids(player.x - r - 4, player.y - r - 4, player.x + r + 4, player.y + r + 4, this._solids);

      for (let iter = 0; iter < 3; iter++) {
        let any = false;
        for (let i = 0; i < solids.length; i++) {
          const s = solids[i];
          if (s.active === false) continue;
          const cx = U.clamp(player.x, s.x, s.x + s.w);
          const cy = U.clamp(player.y, s.y, s.y + s.h);
          let dx = player.x - cx;
          let dy = player.y - cy;
          const d2 = dx * dx + dy * dy;
          if (d2 >= r * r) continue;
          let nx;
          let ny;
          let pen;
          if (d2 > 1e-8) {
            const d = Math.sqrt(d2);
            nx = dx / d;
            ny = dy / d;
            pen = r - d;
          } else {
            // Centre inside the rect (tunnelled): push out along the shallowest axis,
            // preferring the side we came from.
            const left = player.x - s.x;
            const right = s.x + s.w - player.x;
            const top = player.y - s.y;
            const bottom = s.y + s.h - player.y;
            const m = Math.min(left, right, top, bottom);
            if (m === top || player.prevY < s.y) {
              nx = 0;
              ny = -1;
              pen = top + r;
            } else if (m === bottom) {
              nx = 0;
              ny = 1;
              pen = bottom + r;
            } else if (m === left) {
              nx = -1;
              ny = 0;
              pen = left + r;
            } else {
              nx = 1;
              ny = 0;
              pen = right + r;
            }
          }
          player.x += nx * pen;
          player.y += ny * pen;
          const vn = player.vx * nx + player.vy * ny;
          if (vn < 0) {
            const impact = -vn;
            if (impact > maxImpact) {
              maxImpact = impact;
              impactNX = nx;
              impactNY = ny;
            }
            player.vx -= vn * nx;
            player.vy -= vn * ny;
          }
          if (ny < P.groundNormalY) {
            player.grounded = true;
            player.groundSolid = s;
          } else if (Math.abs(nx) > 0.7) {
            player.wallContact = nx > 0 ? -1 : 1;
          }
          any = true;
        }
        if (!any) break;
      }

      // Crumbling platforms give way after being stood on.
      const gs = player.groundSolid;
      if (gs && gs.kind === 'crumble' && gs.active !== false) {
        gs.load = (gs.load || 0) + dt;
        if (gs.load >= this.diff.crumbleTime * (gs.life || 1)) {
          gs.active = false;
          gs.fallen = true;
          this.bus.emit('platform:crumble', { solid: gs, x: gs.x + gs.w / 2, y: gs.y });
        }
      }

      if (maxImpact <= 0) {
        if (!wasGrounded && player.grounded) player.landedThisStep = true;
        return;
      }
      player.lastImpact = maxImpact;

      const floorish = impactNY < P.lethalNormalY;
      if (floorish && this.diff.impactsLethal && maxImpact >= this.diff.lethalImpact) {
        this.kill(player, grapple, 'impact', maxImpact);
        return;
      }
      if (floorish && !wasGrounded) {
        const hard = maxImpact >= P.hardLandingSpeed;
        if (hard) player.stagger = P.staggerTime;
        player.landedThisStep = true;
        this.bus.emit('player:land', {
          impact: maxImpact,
          hard,
          x: player.x,
          y: player.y + r,
          lethalRatio: maxImpact / this.diff.lethalImpact,
        });
      } else if (!floorish && maxImpact >= P.wallHitFxSpeed) {
        if (maxImpact >= P.hardLandingSpeed) player.stagger = Math.max(player.stagger, P.staggerTime * 0.6);
        this.bus.emit('player:wallhit', { impact: maxImpact, x: player.x, y: player.y, nx: impactNX, ny: impactNY });
      }
    }

    kill(player, grapple, cause, impact) {
      if (!player.alive) return;
      if (grapple && grapple.anchor) grapple.release(player, 'death');
      player.alive = false;
      player.deathCause = cause;
      player.vx = 0;
      player.vy = 0;
      this.bus.emit('player:death', { cause, x: player.x, y: player.y, impact: impact || 0 });
    }
  }

  AT.Player = Player;
  AT.GrappleSystem = GrappleSystem;
  AT.Physics = Physics;
})((window.AT = window.AT || {}));
