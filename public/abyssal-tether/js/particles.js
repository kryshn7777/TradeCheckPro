/* ABYSSAL TETHER — particles.js
 * AT.ParticleSystem: a pooled, capped, allocation-free particle field.
 * Two jobs: (1) ambient dust / ash / pale motes that fill the air around the
 * view (wrapping around the camera so density stays constant even during a
 * 1500 u/s fall, and thickening subtly with threat), and (2) short gameplay
 * bursts driven by the event bus — tether sparks, crumbling debris, landing
 * dust, wall chips, death wisps and debris raining from above on rumbles.
 * Storage is struct-of-arrays (typed arrays) with swap-remove, so a frame
 * never allocates. Two render layers: 'back' (slight parallax, dimmer) and
 * 'front' (gameplay depth).
 */
(function (AT) {
  'use strict';

  const U = AT.util;

  const CAPACITY = 500;
  const CAPACITY_REDUCED = 150;
  /** Parallax factor of the 'back' layer. */
  const BACK_P = 0.82;

  // Particle kinds.
  const K_DUST = 0;
  const K_SPARK = 1;
  const K_DEBRIS = 2;
  const K_CHIP = 3;
  const K_WISP = 4;
  const K_ASH = 5;
  const K_MOTE = 6; // ambient pale glowing speck
  const K_FLOAT = 7; // ambient drifting dust mote

  const KIND_BY_NAME = { dust: K_DUST, sparks: K_SPARK, debris: K_DEBRIS, chips: K_CHIP, wisps: K_WISP, ash: K_ASH };

  // Colour table (index = tone). Pre-built strings: no per-frame string work.
  const TONES = [
    '#8f857a', // 0 dust (warm grey)
    '#ffd7a0', // 1 spark hot
    '#e0a050', // 2 spark amber
    '#3a352f', // 3 debris dark stone
    '#5b544b', // 4 debris light stone
    '#6d665c', // 5 chip
    '#120f12', // 6 wisp (near-black, faint violet)
    '#9a948a', // 7 ash light
    '#4a4642', // 8 ash dark
    '#b8f0e0', // 9 mote (sickly bone-verdigris)
    '#c9beac', // 10 floating dust (pale)
    '#2a2622', // 11 debris darkest
  ];

  class ParticleSystem {
    /**
     * @param {AT.EventBus} bus
     * @param {object} settings live settings object (reducedEffects read at use time)
     */
    constructor(bus, settings) {
      this.bus = bus || null;
      this.settings = settings || AT.SETTINGS_DEFAULTS || {};
      const n = CAPACITY;
      this.x = new Float32Array(n);
      this.y = new Float32Array(n);
      this.vx = new Float32Array(n);
      this.vy = new Float32Array(n);
      this.life = new Float32Array(n); // remaining seconds
      this.max = new Float32Array(n); // initial life
      this.size = new Float32Array(n);
      this.grow = new Float32Array(n); // size change per second
      this.rot = new Float32Array(n);
      this.spin = new Float32Array(n);
      this.drag = new Float32Array(n);
      this.grav = new Float32Array(n);
      this.alpha = new Float32Array(n);
      this.phase = new Float32Array(n);
      this.kind = new Uint8Array(n);
      this.layer = new Uint8Array(n); // 0 = back, 1 = front
      this.ambient = new Uint8Array(n);
      this.tone = new Uint8Array(n);
      this.settled = new Uint8Array(n);
      this.count = 0;
      this.ambientCount = [0, 0];
      this.time = 0;
      this.threat = 0;
      this._evict = 0;
      this._rng = U.rng(0x5eed1);
      this._view = { x0: 0, y0: 0, x1: 0, y1: 0 };
      this._viewBack = { x0: 0, y0: 0, x1: 0, y1: 0 };
      this._haveView = false;
      this._solids = [];
      this._unsub = [];
      this._bindBus();
    }

    _bindBus() {
      const bus = this.bus;
      if (!bus || typeof bus.on !== 'function') return;
      const on = (type, fn) => this._unsub.push(bus.on(type, fn));
      on('grapple:attach', (e) => {
        const an = e.anchor || {};
        const x = num(e.x, an.x);
        const y = num(e.y, an.y);
        if (an.kind === 'fragile') {
          this.burst('chips', x, y, { count: 7, speed: 220 });
          this.burst('dust', x, y, { count: 4, spread: 10 });
        } else {
          const sp = num(e.speed, 0);
          this.burst('sparks', x, y, { count: 9 + Math.min(10, sp / 120) });
          this.burst('dust', x, y, { count: 2, spread: 6 });
        }
      });
      on('grapple:break', (e) => {
        this.burst('debris', num(e.x, 0), num(e.y, 0), { count: 9, spread: 10 });
        this.burst('dust', num(e.x, 0), num(e.y, 0), { count: 7, spread: 14 });
      });
      on('platform:crumble', (e) => {
        const s = e.solid;
        if (s && isFinite(s.w)) {
          const n = U.clamp(Math.round(s.w / 14), 6, 26);
          for (let i = 0; i < n; i++) {
            const px = s.x + this._rng() * s.w;
            const py = s.y + this._rng() * Math.max(4, s.h);
            this._spawnBurst(K_DEBRIS, px, py, 0, 1, 1, 0);
          }
          this.burst('dust', s.x + s.w * 0.5, s.y + s.h * 0.5, { count: 10, spread: s.w * 0.45 });
        } else {
          this.burst('debris', num(e.x, 0), num(e.y, 0), { count: 12, spread: 40 });
        }
      });
      on('player:land', (e) => {
        const impact = num(e.impact, 0);
        const n = U.clamp(Math.round(impact / 85), 2, 18);
        this.burst('dust', num(e.x, 0), num(e.y, 0), { count: n, spread: 8, impact, ground: true });
        if (e.hard) this.burst('chips', num(e.x, 0), num(e.y, 0), { count: 4, speed: 180, dirX: 0, dirY: -1 });
      });
      on('player:wallhit', (e) => {
        const nx = num(e.nx, 0);
        const ny = num(e.ny, 0);
        const r = (AT.CONFIG && AT.CONFIG.player && AT.CONFIG.player.radius) || 14;
        const cx = num(e.x, 0) - nx * r;
        const cy = num(e.y, 0) - ny * r;
        const n = U.clamp(Math.round(num(e.impact, 300) / 110), 3, 10);
        this.burst('chips', cx, cy, { count: n, dirX: nx, dirY: ny, speed: 160 + num(e.impact, 0) * 0.2 });
        this.burst('dust', cx, cy, { count: 3, spread: 6 });
      });
      on('player:death', (e) => {
        this.burst('wisps', num(e.x, 0), num(e.y, 0), { count: 16 });
        this.burst('dust', num(e.x, 0), num(e.y, 0), { count: 8, spread: 10 });
      });
      on('creature:burst', (e) => {
        const d = num(e.distance, 2000);
        if (d < 2400) this._rainFromAbove(Math.round(U.lerp(14, 4, U.clamp(d / 2400, 0, 1))), num(e.x, NaN));
      });
      on('trigger:debris', (e) => {
        const data = e.data || {};
        this._rainFromAbove(U.clamp(num(data.count, 16), 1, 60), num(data.x, NaN));
      });
      on('trigger:rumble', (e) => {
        const data = e.data || {};
        this._rainFromAbove(U.clamp(num(data.count, 9), 1, 40), num(data.x, NaN));
      });
    }

    /** Unsubscribes from the bus (if the system is discarded). */
    destroy() {
      for (const off of this._unsub) {
        try {
          off();
        } catch {
          /* ignore */
        }
      }
      this._unsub.length = 0;
    }

    /** Removes every particle (ambient refills on the next update). */
    reset() {
      this.count = 0;
      this.ambientCount[0] = 0;
      this.ambientCount[1] = 0;
      this._haveView = false;
    }

    get capacity() {
      return this.settings && this.settings.reducedEffects ? CAPACITY_REDUCED : CAPACITY;
    }

    /**
     * Allocates a slot. Bursts may evict (round-robin) when full; ambient
     * spawns simply fail when full. Returns the index or -1.
     */
    _alloc(evict) {
      const cap = this.capacity;
      if (this.count < cap) return this.count++;
      if (!evict || this.count === 0) return -1;
      // Prefer evicting an ambient particle.
      for (let tries = 0; tries < 8; tries++) {
        this._evict = (this._evict + 1) % this.count;
        if (this.ambient[this._evict]) break;
      }
      const i = this._evict;
      if (this.ambient[i]) this.ambientCount[this.layer[i]]--;
      return i;
    }

    _kill(i) {
      if (this.ambient[i]) this.ambientCount[this.layer[i]]--;
      const last = --this.count;
      if (i !== last) {
        this.x[i] = this.x[last];
        this.y[i] = this.y[last];
        this.vx[i] = this.vx[last];
        this.vy[i] = this.vy[last];
        this.life[i] = this.life[last];
        this.max[i] = this.max[last];
        this.size[i] = this.size[last];
        this.grow[i] = this.grow[last];
        this.rot[i] = this.rot[last];
        this.spin[i] = this.spin[last];
        this.drag[i] = this.drag[last];
        this.grav[i] = this.grav[last];
        this.alpha[i] = this.alpha[last];
        this.phase[i] = this.phase[last];
        this.kind[i] = this.kind[last];
        this.layer[i] = this.layer[last];
        this.ambient[i] = this.ambient[last];
        this.tone[i] = this.tone[last];
        this.settled[i] = this.settled[last];
      }
    }

    _init(i, kind, layer, x, y, vx, vy, life, size, tone, alpha) {
      this.kind[i] = kind;
      this.layer[i] = layer;
      this.ambient[i] = 0;
      this.settled[i] = 0;
      this.x[i] = x;
      this.y[i] = y;
      this.vx[i] = vx;
      this.vy[i] = vy;
      this.life[i] = life;
      this.max[i] = life;
      this.size[i] = size;
      this.grow[i] = 0;
      this.rot[i] = 0;
      this.spin[i] = 0;
      this.drag[i] = 0;
      this.grav[i] = 0;
      this.alpha[i] = alpha;
      this.phase[i] = this._rng() * 100;
      this.tone[i] = tone;
    }

    /**
     * Emits a burst of `kind` at world (x, y).
     * @param {'dust'|'sparks'|'debris'|'chips'|'wisps'|'ash'} kind
     * @param {number} x
     * @param {number} y
     * @param {object} [opts] { count, spread, speed, dirX, dirY, impact, ground }
     */
    burst(kind, x, y, opts) {
      const k = KIND_BY_NAME[kind];
      if (k === undefined || !isFinite(x) || !isFinite(y)) return;
      const o = opts || {};
      const reduced = this.settings && this.settings.reducedEffects;
      let count = Math.round(num(o.count, 8) * (reduced ? 0.5 : 1));
      count = U.clamp(count, 1, 80);
      const spread = num(o.spread, 4);
      const dirX = num(o.dirX, 0);
      const dirY = num(o.dirY, 0);
      const speed = num(o.speed, 0);
      for (let n = 0; n < count; n++) {
        const px = x + (this._rng() * 2 - 1) * spread;
        const py = y + (this._rng() * 2 - 1) * spread * (k === K_DUST && o.ground ? 0.2 : 1);
        if (k === K_DUST && o.ground) {
          // Landing puffs roll out sideways along the floor.
          const i = this._alloc(true);
          if (i < 0) return;
          const side = n % 2 === 0 ? -1 : 1;
          const imp = U.clamp(num(o.impact, 400) / 900, 0.2, 1.4);
          this._init(i, K_DUST, 1, px, py - 2, side * (40 + this._rng() * 160) * imp, -(8 + this._rng() * 40) * imp, 0.6 + this._rng() * 0.6, 3 + this._rng() * 4, 0, 0.32);
          this.grow[i] = 9 + this._rng() * 8;
          this.drag[i] = 3.2;
          this.grav[i] = -12;
        } else {
          this._spawnBurst(k, px, py, dirX, dirY, 1, speed);
        }
      }
    }

    /** One burst particle with kind-specific motion. */
    _spawnBurst(k, x, y, dirX, dirY, scale, speed) {
      const i = this._alloc(true);
      if (i < 0) return;
      const r = this._rng;
      const ang = r() * Math.PI * 2;
      const hasDir = dirX !== 0 || dirY !== 0;
      switch (k) {
        case K_SPARK: {
          const sp = (speed || 260) + r() * 380;
          this._init(i, k, 1, x, y, Math.cos(ang) * sp, Math.sin(ang) * sp - 90, 0.18 + r() * 0.32, 1.1 + r() * 0.9, r() < 0.4 ? 1 : 2, 1);
          this.grav[i] = 980;
          this.drag[i] = 2.4;
          break;
        }
        case K_DEBRIS: {
          this._init(i, k, 1, x, y, (r() * 2 - 1) * 90, -40 + r() * 80, 1.6 + r() * 1.2, (2.5 + r() * 5.5) * scale, r() < 0.5 ? 3 : r() < 0.5 ? 4 : 11, 1);
          this.grav[i] = 1550;
          this.drag[i] = 0.2;
          this.rot[i] = r() * 6.28;
          this.spin[i] = (r() * 2 - 1) * 9;
          break;
        }
        case K_CHIP: {
          let dx = Math.cos(ang);
          let dy = Math.sin(ang);
          if (hasDir) {
            // Cone around the surface normal.
            const base = Math.atan2(dirY, dirX) + (r() * 2 - 1) * 0.9;
            dx = Math.cos(base);
            dy = Math.sin(base);
          }
          const sp = (speed || 180) * (0.5 + r() * 0.8);
          this._init(i, k, 1, x, y, dx * sp, dy * sp - 60, 0.45 + r() * 0.5, 1.4 + r() * 2.2, r() < 0.5 ? 5 : 4, 1);
          this.grav[i] = 1300;
          this.drag[i] = 0.8;
          this.rot[i] = r() * 6.28;
          this.spin[i] = (r() * 2 - 1) * 16;
          break;
        }
        case K_WISP: {
          const sp = 30 + r() * 90;
          this._init(i, k, 1, x, y, Math.cos(ang) * sp, Math.sin(ang) * sp - 50, 1.0 + r() * 0.9, 5 + r() * 6, 6, 0.55);
          this.grow[i] = 14 + r() * 12;
          this.drag[i] = 1.8;
          this.grav[i] = -40;
          break;
        }
        case K_ASH: {
          this._init(i, k, 1, x, y, (r() * 2 - 1) * 40, -20 + r() * 40, 1.6 + r() * 1.6, 1.5 + r() * 1.8, r() < 0.5 ? 7 : 8, 0.7);
          this.grav[i] = 60;
          this.drag[i] = 1.2;
          break;
        }
        case K_DUST:
        default: {
          const sp = 20 + r() * 70;
          this._init(i, K_DUST, 1, x, y, Math.cos(ang) * sp, Math.sin(ang) * sp * 0.6 - 10, 0.7 + r() * 0.8, 3 + r() * 4, 0, 0.28);
          this.grow[i] = 8 + r() * 10;
          this.drag[i] = 2.6;
          this.grav[i] = -6;
          break;
        }
      }
    }

    /** Debris raining in from above the current view (rumbles, creature bursts). */
    _rainFromAbove(count, nearX) {
      if (!this._haveView) return;
      const v = this._view;
      const w = v.x1 - v.x0;
      const reduced = this.settings && this.settings.reducedEffects;
      const n = Math.round(count * (reduced ? 0.5 : 1));
      for (let k = 0; k < n; k++) {
        const r = this._rng;
        let x = v.x0 + r() * w;
        if (isFinite(nearX) && nearX > v.x0 && nearX < v.x1 && r() < 0.6) x = nearX + (r() * 2 - 1) * w * 0.2;
        const y = v.y0 - 30 - r() * 420;
        const i = this._alloc(true);
        if (i < 0) return;
        const big = r() < 0.3;
        this._init(i, K_DEBRIS, 1, x, y, (r() * 2 - 1) * 30, 60 + r() * 260, 2.6 + r(), big ? 4 + r() * 6 : 1.5 + r() * 2.5, big ? 3 : 4, 1);
        this.grav[i] = 1300;
        this.drag[i] = 0.15;
        this.rot[i] = r() * 6.28;
        this.spin[i] = (r() * 2 - 1) * 7;
        if (!big && r() < 0.5) {
          // Grit trails: tiny, slower, slightly translucent.
          this.kind[i] = K_ASH;
          this.tone[i] = 7;
          this.alpha[i] = 0.55;
          this.grav[i] = 500;
        }
      }
    }

    /**
     * Advances every particle and keeps the ambient field topped up around the view.
     * @param {number} dt
     * @param {AT.Camera} camera
     * @param {number} threat 0..1
     * @param {AT.Level} [level] used for cheap debris-on-platform bounces
     */
    update(dt, camera, threat, level) {
      dt = U.clamp(num(dt, 0), 0, 0.1);
      this.time += dt;
      this.threat = U.clamp(num(threat, 0), 0, 1);
      if (camera && typeof camera.visibleRect === 'function') {
        camera.visibleRect(60, 1, this._view);
        camera.visibleRect(60, BACK_P, this._viewBack);
        this._haveView = true;
      }

      // Trim overflow (e.g. reducedEffects toggled on) — drop newest first.
      const cap = this.capacity;
      while (this.count > cap) this._kill(this.count - 1);

      const t = this.time;
      const agitation = 1 + this.threat * 1.6;
      // Slow global air current: never constant, never strong.
      const windX = U.noise1(t * 0.07, 11) * 10 * agitation;
      const solids = this._solids;

      for (let i = this.count - 1; i >= 0; i--) {
        if (this.ambient[i]) {
          this._updateAmbient(i, dt, windX, agitation);
          continue;
        }
        let life = this.life[i] - dt;
        if (life <= 0) {
          this._kill(i);
          continue;
        }
        this.life[i] = life;
        const k = this.kind[i];
        const drag = Math.exp(-this.drag[i] * dt);
        let vx = this.vx[i] * drag;
        let vy = this.vy[i] * drag + this.grav[i] * dt;
        if (k === K_WISP) vx += U.noise1(t * 1.3 + this.phase[i], 3) * 30 * dt;
        if (k === K_ASH) vx += Math.sin(t * 3 + this.phase[i]) * 40 * dt;
        let x = this.x[i] + vx * dt;
        let y = this.y[i] + vy * dt;
        this.size[i] = Math.max(0.3, this.size[i] + this.grow[i] * dt);
        this.rot[i] += this.spin[i] * dt;

        // Debris/chips bounce once or twice on platforms, then settle and fade.
        if ((k === K_DEBRIS || k === K_CHIP) && level && typeof level.querySolids === 'function' && vy > 0 && !this.settled[i]) {
          const list = level.querySolids(x - 1, y - 1, x + 1, y + 1, solids);
          for (let s = 0; s < list.length; s++) {
            const so = list[s];
            if (so.active === false) continue;
            if (x >= so.x && x <= so.x + so.w && y >= so.y && this.y[i] <= so.y + 2) {
              y = so.y - this.size[i] * 0.3;
              if (vy > 160) {
                vy *= -0.28;
                vx *= 0.55;
                this.spin[i] *= 0.5;
              } else {
                vy = 0;
                vx = 0;
                this.spin[i] = 0;
                this.grav[i] = 0;
                this.settled[i] = 1;
                if (life > 0.9) this.life[i] = life = 0.9;
              }
              break;
            }
          }
        }
        this.vx[i] = vx;
        this.vy[i] = vy;
        this.x[i] = x;
        this.y[i] = y;
      }

      if (this._haveView) this._topUpAmbient(dt);
    }

    _updateAmbient(i, dt, windX, agitation) {
      const k = this.kind[i];
      const ph = this.phase[i];
      const t = this.time;
      let vx = this.vx[i];
      let vy = this.vy[i];
      if (k === K_ASH) {
        vx = windX + Math.sin(t * 1.7 + ph) * 14 * agitation;
        vy = this.grav[i] * (0.8 + 0.4 * agitation);
      } else if (k === K_MOTE) {
        vx = windX * 0.5 + U.noise1(t * 0.4 + ph, 5) * 12;
        vy = U.noise1(t * 0.35 + ph, 9) * 10 - 3;
      } else {
        vx = windX + U.noise1(t * 0.25 + ph, 7) * 8 * agitation;
        vy = U.noise1(t * 0.22 + ph, 13) * 6 * agitation + 2;
      }
      this.vx[i] = vx;
      this.vy[i] = vy;
      let x = this.x[i] + vx * dt;
      let y = this.y[i] + vy * dt;
      // Wrap around the view so density stays constant while the camera moves.
      const v = this.layer[i] === 1 ? this._view : this._viewBack;
      const w = v.x1 - v.x0;
      const h = v.y1 - v.y0;
      if (w > 0 && h > 0) {
        if (x < v.x0) x += w * Math.ceil((v.x0 - x) / w);
        else if (x > v.x1) x -= w * Math.ceil((x - v.x1) / w);
        if (y < v.y0) y += h * Math.ceil((v.y0 - y) / h);
        else if (y > v.y1) y -= h * Math.ceil((y - v.y1) / h);
      }
      this.x[i] = x;
      this.y[i] = y;
      // Ambient particles breathe in and out instead of dying.
      this.life[i] += dt;
    }

    _topUpAmbient(dt) {
      const reduced = this.settings && this.settings.reducedEffects;
      const v = this._view;
      const area = ((v.x1 - v.x0) * (v.y1 - v.y0)) / (1650 * 980);
      const areaK = U.clamp(area, 0.55, 1.6);
      const th = this.threat;
      const targetFront = Math.round((reduced ? 16 : 44) * areaK * (1 + th * 0.9));
      const targetBack = Math.round((reduced ? 14 : 70) * areaK * (1 + th * 0.6));
      // Spawn a few per frame (no visible popping: they fade in).
      let budget = Math.max(2, Math.round(dt * 600));
      while (budget-- > 0 && this.ambientCount[1] < targetFront) {
        if (!this._spawnAmbient(1)) break;
      }
      budget = Math.max(2, Math.round(dt * 600));
      while (budget-- > 0 && this.ambientCount[0] < targetBack) {
        if (!this._spawnAmbient(0)) break;
      }
      // Too many (threat fell / view shrank): retire a few gently.
      if (this.ambientCount[1] > targetFront + 6) this._retireAmbient(1);
      if (this.ambientCount[0] > targetBack + 6) this._retireAmbient(0);
    }

    _spawnAmbient(layer) {
      const i = this._alloc(false);
      if (i < 0) return false;
      const r = this._rng;
      const v = layer === 1 ? this._view : this._viewBack;
      const x = v.x0 + r() * (v.x1 - v.x0);
      const y = v.y0 + r() * (v.y1 - v.y0);
      const roll = r();
      const th = this.threat;
      if (roll < 0.05 + th * 0.04) {
        // Rare pale motes — the place is not entirely dead.
        this._init(i, K_MOTE, layer, x, y, 0, 0, 0, layer ? 1.4 + r() * 1.2 : 1 + r() * 0.8, 9, layer ? 0.5 : 0.3);
      } else if (roll < 0.42 + th * 0.25) {
        this._init(i, K_ASH, layer, x, y, 0, 0, 0, layer ? 1.6 + r() * 2.2 : 1 + r() * 1.4, r() < 0.5 ? 7 : 8, layer ? 0.5 : 0.32);
        this.grav[i] = 10 + r() * 26;
      } else {
        this._init(i, K_FLOAT, layer, x, y, 0, 0, 0, layer ? 1 + r() * 1.6 : 0.7 + r() * 1.1, 10, layer ? 0.32 : 0.2);
      }
      this.ambient[i] = 1;
      this.life[i] = 0; // age (fade-in)
      this.max[i] = 6 + r() * 10; // breathing period
      this.ambientCount[layer]++;
      return true;
    }

    _retireAmbient(layer) {
      for (let i = this.count - 1; i >= 0; i--) {
        if (this.ambient[i] && this.layer[i] === layer) {
          this._kill(i);
          return;
        }
      }
    }

    /**
     * Draws one layer. Sets its own transform via the camera.
     * @param {CanvasRenderingContext2D} ctx
     * @param {AT.Camera} camera
     * @param {'back'|'front'} layer
     */
    render(ctx, camera, layer) {
      if (!ctx || !camera || this.count === 0) return;
      const L = layer === 'back' ? 0 : 1;
      camera.applyTransform(ctx, L === 0 ? BACK_P : 1);
      const v = L === 1 ? this._view : this._viewBack;
      const minPx = 1 / Math.max(0.05, camera.scale); // ≥ 1 CSS px
      let lastTone = -1;
      ctx.globalCompositeOperation = 'source-over';
      for (let i = 0; i < this.count; i++) {
        if (this.layer[i] !== L) continue;
        const x = this.x[i];
        const y = this.y[i];
        if (x < v.x0 || x > v.x1 || y < v.y0 || y > v.y1) continue;
        const k = this.kind[i];
        let a = this.alpha[i];
        if (this.ambient[i]) {
          // Fade in over 1 s, then breathe slowly.
          const age = this.life[i];
          const fade = age < 1 ? age : 1;
          a *= fade * (0.55 + 0.45 * Math.sin((age / this.max[i]) * 6.283 + this.phase[i]));
        } else {
          const lt = this.life[i] / this.max[i];
          if (k === K_DUST || k === K_WISP) a *= lt * (2 - lt) * (lt < 0.85 ? 1 : (1 - lt) / 0.15);
          else if (k === K_SPARK) a *= Math.min(1, lt * 2.2);
          else a *= lt < 0.25 ? lt / 0.25 : 1;
        }
        if (a <= 0.01) continue;
        const tone = this.tone[i];
        if (tone !== lastTone) {
          ctx.fillStyle = TONES[tone];
          ctx.strokeStyle = TONES[tone];
          lastTone = tone;
        }
        ctx.globalAlpha = a > 1 ? 1 : a;
        const s = Math.max(this.size[i], minPx);
        if (k === K_SPARK) {
          // Streak along velocity.
          const vx = this.vx[i];
          const vy = this.vy[i];
          ctx.lineWidth = Math.max(s * 0.8, minPx);
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x - vx * 0.022, y - vy * 0.022);
          ctx.stroke();
        } else if (k === K_DEBRIS || k === K_CHIP) {
          // Small rotated quad (irregular: one corner pulled in).
          const c = Math.cos(this.rot[i]) * s * 0.5;
          const sn = Math.sin(this.rot[i]) * s * 0.5;
          ctx.beginPath();
          ctx.moveTo(x + c - sn, y + sn + c);
          ctx.lineTo(x - c - sn, y - sn + c);
          ctx.lineTo(x - c + sn * 0.6, y - sn - c * 0.6);
          ctx.lineTo(x + c + sn, y + sn - c);
          ctx.closePath();
          ctx.fill();
        } else {
          const h = s * 0.5;
          ctx.fillRect(x - h, y - h, s, s);
        }
      }
      ctx.globalAlpha = 1;
    }
  }

  function num(v, fallback) {
    return typeof v === 'number' && isFinite(v) ? v : fallback;
  }

  ParticleSystem.BACK_PARALLAX = BACK_P;
  AT.ParticleSystem = ParticleSystem;
})((window.AT = window.AT || {}));
