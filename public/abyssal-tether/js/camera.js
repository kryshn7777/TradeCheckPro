/* ABYSSAL TETHER — camera.js
 * AT.Camera: a smooth vertical-follow camera for the shaft. It owns the
 * world <-> screen mapping (CSS pixels), the parallax transforms the
 * renderer uses for every depth layer, a velocity look-ahead that always
 * shows more of the drop BELOW the player than the climb above, horizontal
 * clamping to the level, and a smooth, decaying noise shake (never constant
 * sway). Scale is chosen so a minimum world area is always visible, which
 * keeps framing stable from phone portrait to ultrawide desktop.
 */
(function (AT) {
  'use strict';

  const U = AT.util;

  /** Hard cap on shake amplitude (world units) — big events stay readable. */
  const MAX_SHAKE = 42;
  /** Shake noise frequency (Hz) — low enough to read as a heavy jolt, not a buzz. */
  const SHAKE_FREQ = 9;
  /**
   * Fraction of the exponential-follow lag (v / followRate) that is fed
   * forward vertically, so a fast fall keeps most of its look-down instead of
   * the camera trailing behind the player. Vertical only: horizontal swing
   * velocity flips constantly and would turn into sway.
   */
  const LAG_COMP_Y = 0.5;
  /** Velocity smoothing rate used for look-ahead (1/s) — swings must not jerk the view. */
  const VEL_SMOOTH = 3.2;
  /** Look-ahead offset smoothing rate (1/s). */
  const LOOK_SMOOTH = 2.4;
  /** The player is always kept inside this vertical band of the view (fraction from the top). */
  const LEASH_TOP = 0.16;
  const LEASH_BOTTOM = 0.74;

  function cfg() {
    return (AT.CONFIG && AT.CONFIG.camera) || {
      minVisibleW: 760,
      minVisibleH: 860,
      minVisibleHTouch: 700,
      followRate: 6.5,
      lookDownBase: 0.13,
      lookAheadVelY: 0.24,
      lookAheadVelX: 0.14,
      maxLookDown: 300,
      maxLookUp: 110,
      maxLookX: 160,
    };
  }

  function finite(v, fallback) {
    return typeof v === 'number' && isFinite(v) ? v : fallback;
  }

  class Camera {
    constructor() {
      // Composed position (follow + shake). Every transform uses these.
      this.x = 0;
      this.y = 0;
      // Smoothly-followed position without shake.
      this.fx = 0;
      this.fy = 0;
      // Current shake offset (world units).
      this.sx = 0;
      this.sy = 0;
      this.scale = 1;
      this.viewW = 760;
      this.viewH = 860;
      this.screenW = 760;
      this.screenH = 860;
      this.dpr = 1;
      this.isTouch = false;
      this.shakeScale = 1;
      this.time = 0;

      // Smoothed velocity + look-ahead offsets.
      this._vx = 0;
      this._vy = 0;
      this._lookX = 0;
      this._lookY = 0;
      this._snapped = false;

      // Shake envelope.
      this._shakeAmp = 0;
      this._shakeDur = 0;
      this._shakeT = 0;
      this._shakeSeed = 1;

      // Values last written by update(); lets us detect external writes to x/y
      // (e.g. a menu attract drift that moves camera.y directly).
      this._cx = 0;
      this._cy = 0;
    }

    /**
     * Recomputes scale so at least minVisibleW × minVisibleH(Touch) world
     * units are visible, whatever the aspect ratio.
     * @param {number} cssW  canvas CSS width (px)
     * @param {number} cssH  canvas CSS height (px)
     * @param {number} dpr   backing-store pixels per CSS px
     * @param {boolean} isTouch smaller visible height on touch so the player is larger
     */
    resize(cssW, cssH, dpr, isTouch) {
      const C = cfg();
      const w = Math.max(1, finite(cssW, this.screenW));
      const h = Math.max(1, finite(cssH, this.screenH));
      if (typeof isTouch === 'boolean') this.isTouch = isTouch;
      const minH = this.isTouch ? C.minVisibleHTouch : C.minVisibleH;
      this.screenW = w;
      this.screenH = h;
      this.dpr = Math.max(0.25, finite(dpr, this.dpr || 1));
      this.scale = Math.max(1e-3, Math.min(w / C.minVisibleW, h / minH));
      this.viewW = w / this.scale;
      this.viewH = h / this.scale;
    }

    /** Jumps straight to a position (no smoothing, look-ahead reset, shake kept). */
    snapTo(x, y) {
      const C = cfg();
      this.fx = finite(x, this.fx);
      this.fy = finite(y, this.fy);
      this._vx = 0;
      this._vy = 0;
      this._lookX = 0;
      this._lookY = C.lookDownBase * this.viewH;
      this._snapped = true;
      this._compose();
    }

    /**
     * Exponential follow of the player's render position with a velocity
     * look-ahead (more space below than above) and horizontal clamping.
     * @param {AT.Player} player
     * @param {number} dt seconds
     * @param {AT.Level} [level]
     */
    follow(player, dt, level) {
      if (!player) return;
      const C = cfg();
      dt = U.clamp(finite(dt, 0), 0, 0.1);
      this._adoptExternalWrites();
      const px = finite(player.rx, finite(player.x, this.fx));
      const py = finite(player.ry, finite(player.y, this.fy));
      const pvx = player.alive === false ? 0 : finite(player.vx, 0);
      const pvy = player.alive === false ? 0 : finite(player.vy, 0);

      if (this._snapped) {
        // First follow after a snap: start from the resting framing so a
        // respawn does not swoop in from the death position.
        this._snapped = false;
        this._vx = pvx;
        this._vy = pvy;
      } else {
        this._vx = U.damp(this._vx, pvx, VEL_SMOOTH, dt);
        this._vy = U.damp(this._vy, pvy, VEL_SMOOTH, dt);
      }

      // Look-ahead: a constant downward bias plus a velocity lead.
      const wantLookY = U.clamp(C.lookDownBase * this.viewH + this._vy * C.lookAheadVelY, -C.maxLookUp, C.maxLookDown);
      const wantLookX = U.clamp(this._vx * C.lookAheadVelX, -C.maxLookX, C.maxLookX);
      this._lookY = U.damp(this._lookY, wantLookY, LOOK_SMOOTH, dt);
      this._lookX = U.damp(this._lookX, wantLookX, LOOK_SMOOTH, dt);

      let tx = px + this._lookX;
      const ty = py + this._lookY + (this._vy / C.followRate) * LAG_COMP_Y;
      tx = this._clampX(tx, level);

      this.fx = U.damp(this.fx, tx, C.followRate, dt);
      this.fy = U.damp(this.fy, ty, C.followRate, dt);

      // Leash: whatever the smoothing does, the player stays comfortably on
      // screen — between LEASH_TOP and LEASH_BOTTOM of the view height. The
      // player's screen fraction is 0.5 + (py − camY) / viewH, so the camera
      // centre must lie in [py − (LEASH_BOTTOM − 0.5)·H, py + (0.5 − LEASH_TOP)·H].
      const minY = py - (LEASH_BOTTOM - 0.5) * this.viewH;
      const maxY = py + (0.5 - LEASH_TOP) * this.viewH;
      if (this.fy < minY) this.fy = minY;
      else if (this.fy > maxY) this.fy = maxY;

      this.fx = this._clampX(this.fx, level);
      this.fy = this._clampY(this.fy, level);
    }

    /** Horizontal clamp: keep the view inside the level when it fits, else centre it. */
    _clampX(x, level) {
      const b = level && level.bounds;
      if (!b || !isFinite(b.x0) || !isFinite(b.x1)) return x;
      const half = this.viewW * 0.5;
      if (b.x1 - b.x0 <= this.viewW) return (b.x0 + b.x1) * 0.5;
      return U.clamp(x, b.x0 + half, b.x1 - half);
    }

    /** Vertical clamp: never frame much more than the solid floor below the bottom. */
    _clampY(y, level) {
      const b = level && level.bounds;
      if (!b || !isFinite(b.y0) || !isFinite(b.y1)) return y;
      const maxY = b.y1 + 260 - this.viewH * 0.5;
      const minY = b.y0 - this.viewH * 0.35;
      if (maxY < minY) return y;
      return U.clamp(y, minY, maxY);
    }

    /**
     * Adds a smooth, decaying shake. Amount is in world units and is scaled by
     * shakeScale (0.25 with reduced shake). Overlapping shakes keep the stronger.
     */
    shake(amount, duration) {
      const amt = U.clamp(finite(amount, 0), 0, MAX_SHAKE) * U.clamp(finite(this.shakeScale, 1), 0, 1);
      const dur = U.clamp(finite(duration, 0.3), 0.05, 3);
      if (amt <= 0) return;
      const cur = this._currentShakeAmp();
      if (amt >= cur) {
        this._shakeAmp = amt;
        this._shakeDur = dur;
        this._shakeT = 0;
        this._shakeSeed = (this._shakeSeed + 7) % 9973;
      } else {
        // Weaker shake during a stronger one: extend the tail slightly.
        const remaining = this._shakeDur - this._shakeT;
        if (dur > remaining) this._shakeDur = this._shakeT + (remaining + dur) * 0.5;
      }
    }

    _currentShakeAmp() {
      if (this._shakeAmp <= 0 || this._shakeDur <= 0) return 0;
      const k = 1 - this._shakeT / this._shakeDur;
      return k <= 0 ? 0 : this._shakeAmp * k * k;
    }

    /** Advances the shake and composes the final camera position. Call once per frame. */
    update(dt) {
      dt = U.clamp(finite(dt, 0), 0, 0.1);
      this._adoptExternalWrites();
      this.time += dt;
      if (this._shakeAmp > 0) {
        this._shakeT += dt;
        if (this._shakeT >= this._shakeDur) {
          this._shakeAmp = 0;
          this.sx = 0;
          this.sy = 0;
        } else {
          const a = this._currentShakeAmp();
          const t = this.time * SHAKE_FREQ;
          this.sx = U.noise1(t, this._shakeSeed) * a;
          this.sy = U.noise1(t + 31.7, this._shakeSeed + 3) * a * 0.8;
        }
      } else {
        this.sx = 0;
        this.sy = 0;
      }
      this._compose();
    }

    _compose() {
      this.x = this.fx + this.sx;
      this.y = this.fy + this.sy;
      this._cx = this.x;
      this._cy = this.y;
    }

    /** If someone wrote camera.x/y directly since our last compose, follow from there. */
    _adoptExternalWrites() {
      if (this.x !== this._cx && isFinite(this.x)) this.fx = this.x - this.sx;
      if (this.y !== this._cy && isFinite(this.y)) this.fy = this.y - this.sy;
      this._cx = this.x;
      this._cy = this.y;
    }

    /** World → CSS px (parallax 1). */
    worldToScreen(x, y, out) {
      const o = out || { x: 0, y: 0 };
      o.x = (x - this.x) * this.scale + this.screenW * 0.5;
      o.y = (y - this.y) * this.scale + this.screenH * 0.5;
      return o;
    }

    /** CSS px → world (parallax 1). */
    screenToWorld(sx, sy, out) {
      const o = out || { x: 0, y: 0 };
      o.x = (sx - this.screenW * 0.5) / this.scale + this.x;
      o.y = (sy - this.screenH * 0.5) / this.scale + this.y;
      return o;
    }

    /**
     * Sets ctx's transform for drawing a layer with parallax factor p in its
     * own layer space: screen = (w − cam·p)·scale + size/2 (then × dpr).
     */
    applyTransform(ctx, parallax) {
      const p = typeof parallax === 'number' ? parallax : 1;
      const s = this.scale * this.dpr;
      ctx.setTransform(
        s,
        0,
        0,
        s,
        (this.screenW * 0.5 - this.x * p * this.scale) * this.dpr,
        (this.screenH * 0.5 - this.y * p * this.scale) * this.dpr,
      );
    }

    /** Visible rect in a layer's space (parallax p), expanded by margin world units. */
    visibleRect(margin, parallax, out) {
      const m = typeof margin === 'number' ? margin : 0;
      const p = typeof parallax === 'number' ? parallax : 1;
      const o = out || { x0: 0, y0: 0, x1: 0, y1: 0 };
      const hw = this.viewW * 0.5;
      const hh = this.viewH * 0.5;
      o.x0 = this.x * p - hw - m;
      o.x1 = this.x * p + hw + m;
      o.y0 = this.y * p - hh - m;
      o.y1 = this.y * p + hh + m;
      return o;
    }
  }

  AT.Camera = Camera;
})((window.AT = window.AT || {}));
