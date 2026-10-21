/* ABYSSAL TETHER 3D — renderGovernor.js
 * `renderer.governor`: the frame-time hook of the lighting tiers (no three.js, no DOM: Node-testable).
 */

function num(v, fb) {
  return typeof v === 'number' && isFinite(v) ? v : fb;
}

/**
 * Frame-time hook for the lighting tiers: `renderer.governor.update(frameMs)`.
 *
 * XR has its own governor (platform/governor.js: foveation, viewport scale, fx tier, ?gov=): when Game3D owns an active
 * one, THIS object does not step anything, it just mirrors its level (`level`, 'change' events) and Lighting maps that
 * level onto the lighting levers (≥ 2: wet glint off and far detail ×0.85, ≥ 3: `low` tier). Without a platform
 * governor (desktop, tests, a game that does not start one) update() runs a small stepping governor of its own:
 * down fast (≥ 20 % of the last 48 frames over 1.3× the target, at most one step per second), up slowly (8 s calm,
 * p95 within 8 % of the target, one step at a time, the wait doubling after a recovery that did not hold).
 */
export class RenderGovernor {
  constructor(r3d, { targetHz = 72 } = {}) {
    this.r3d = r3d;
    this.target = 1000 / targetHz;
    this.max = 3;
    this._level = 0;
    this._ring = new Float32Array(48);
    this._sorted = new Float32Array(48);
    this._n = 0;
    this._head = 0;
    this._clock = 0;
    this._lastDown = -1e9;
    this._calmSince = 0;
    this._recoverAfter = 8;
    this._recoveredAt = -1e9;
    this._ext = -1;
    this.listeners = [];
    this.stats = { frames: 0, avgMs: 0, degrades: 0, recovers: 0 };
  }

  /** The headset's frame rate changed (72 / 90): the frame-time target of the internal stepping follows. */
  setTargetHz(hz) {
    if (hz > 20 && hz < 240) this.target = 1000 / hz;
  }

  /** The platform governor of the running Game3D, if any (and active). */
  get external() {
    const g = this.r3d._game && this.r3d._game.governor;
    return g && g.active !== false && typeof g.level === 'number' ? g : null;
  }

  get level() {
    const e = this.external;
    return e ? e.level : this._level;
  }

  get mode() {
    return this.external ? 'platform' : 'internal';
  }

  /** Subscribes to level changes ({ level, from, why }); returns the unsubscribe function. */
  on(fn) {
    this.listeners.push(fn);
    return () => {
      const i = this.listeners.indexOf(fn);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  _emit(from, why) {
    const ev = { level: this.level, from, why };
    for (const fn of this.listeners.slice()) {
      try {
        fn(ev);
      } catch {
        /* listener faults never reach the frame loop */
      }
    }
    const bus = this.r3d._bus;
    if (bus && typeof bus.emit === 'function') bus.emit('gfx:level', ev);
  }

  setLevel(n, why = 'manual') {
    n = Math.max(0, Math.min(this.max, n | 0));
    const from = this._level;
    if (n !== from) {
      this._level = n;
      this._reset();
      this._emit(from, why);
    }
    return this.level;
  }

  _reset() {
    this._n = 0;
    this._head = 0;
    this._calmSince = this._clock;
  }

  /** One call per frame with the real frame time in milliseconds. Returns the current level. */
  update(frameMs) {
    const ms = num(frameMs, 0);
    this.stats.frames++;
    this.stats.avgMs += (ms - this.stats.avgMs) * 0.03;
    const ext = this.external;
    if (ext) {
      if (ext.level !== this._ext) {
        const from = this._ext;
        this._ext = ext.level;
        if (from >= 0) this._emit(from, 'platform');
      }
      return ext.level;
    }
    this._ext = -1;
    if (!(ms > 0) || ms > 250) {
      this._reset(); // hitches (loading, suspended page) say nothing about steady cost
      return this._level;
    }
    this._clock += ms / 1000;
    this._ring[this._head] = ms;
    this._head = (this._head + 1) % this._ring.length;
    if (this._n < this._ring.length) this._n++;
    if (this._n < this._ring.length / 2) return this._level;
    let miss = 0;
    for (let i = 0; i < this._n; i++) if (this._ring[i] > this.target * 1.3) miss++;
    if (miss >= 8 && miss / this._n >= 0.2) {
      this._calmSince = this._clock;
      if (this._level < this.max && this._clock - this._lastDown >= 1) {
        if (this._clock - this._recoveredAt < 25) this._recoverAfter = Math.min(120, this._recoverAfter * 2);
        this._lastDown = this._clock;
        this.stats.degrades++;
        this.setLevel(this._level + 1, 'degrade');
      }
      return this._level;
    }
    const floor = this.r3d.settings && this.r3d.settings.reducedEffects ? 3 : 0;
    if (this._level > floor && this._clock - this._calmSince >= this._recoverAfter) {
      const s = this._sorted;
      for (let i = 0; i < this._n; i++) s[i] = this._ring[i];
      for (let i = 1; i < this._n; i++) {
        const v = s[i];
        let j = i - 1;
        while (j >= 0 && s[j] > v) {
          s[j + 1] = s[j];
          j--;
        }
        s[j + 1] = v;
      }
      if (s[Math.min(this._n - 1, Math.floor(0.95 * this._n))] <= this.target * 1.08) {
        this._recoveredAt = this._clock;
        this.stats.recovers++;
        this.setLevel(this._level - 1, 'recover');
      }
    }
    return this._level;
  }
}

