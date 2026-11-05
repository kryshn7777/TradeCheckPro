/* THE LANTERN (ABYSSAL TETHER 3D) — hintWave.js
 * "If the player is confused too long in a level, the golden mark emits a blip wave that travels throughout the screen from its
 * point of origin, making the player easily find it."
 *
 * The escalation ladder above the 20 s objective hint (sim/objectiveHint.js), presentation-side (stepped by game.js with the frame
 * dt, never by the physics step: the route bots and the verify harness are untouched):
 *   stage 1   20 s without progress   the existing golden mark (ObjectiveHint)
 *   stage 2   45 s                    the first BLIP WAVE: a golden shell that starts AT the mark and sweeps the level (one more
 *                                     22 s later while still in stage 2)
 *   stage 3   90 s                    a wave every 8 s, a little stronger and thicker
 * Stuck time = HINT_AFTER + the seconds the mark has been on, so anything that hides the mark (a fixture done or a notch, the player
 * within FOUND_R of a trigger, a new section) resets the ladder; a checkpoint / warp resets it too (game.js), and a death drops it
 * back to stage 1 (the mark stays: ObjectiveHint keeps it through a death). The clock pauses (and an in-flight wave fades out over
 * 0.5 s) during a creature attack wind-up / burst, a fall, a cutscene, the hit-stop, the opening story, the menu and death.
 * One wave in flight at a time; at most CAP waves per section (it never nags); Abyss never gets it, Nightmare later (DIFF_SCALE);
 * Settings › Access › Hint wave (settings.hintWave) and `?hintwave=off` switch it off.
 *
 * The wave itself is world space (render/hintWaveView.js drives the lit surface shader's PING uniforms in render/materials.js): the
 * front radius grows at SPEED m/s up to RANGE, a soft band THICK m wide, its strength rising over RISE s (never a flash), falling with
 * the distance travelled and capped at STRENGTH_CAP. Reduced effects: slower and dimmer. When the front reaches the player the wave
 * `passed` (game.js: the blip from the mark's direction, the caption, a haptic tick).
 * Pure: no three.js, no DOM, no Math.random, no allocation per frame.
 */
import { HINT_AFTER } from './objectiveHint.js';

/** The ladder (seconds of stuck time, i.e. counted from the moment the section's clock started). */
export const LADDER = Object.freeze({
  stage2At: 45, // the first wave
  stage2Every: 22, // one more while still in stage 2 (45, 67)
  stage3At: 90, // from here a wave every stage3Every
  stage3Every: 8,
  cap: 10, // waves per section, hard
});

/** The wave (metres, seconds, 0..1). */
export const WAVE = Object.freeze({
  speed: 20, // m/s of the front
  speedReduced: 13, // m/s with Reduced effects
  range: 70, // m: then it is gone
  rise: 0.45, // s of the strength ramp at the start (no flash)
  thick0: 0.7, // m: the band's half width at the mark ...
  thick1: 2.0, // ... and at the end of its range
  thick3: 1.15, // x the width at stage 3
  wake: 4.5, // m: the ripples behind the front fade over this
  strength2: 0.8, // stage-2 strength
  strength3: 1.0, // stage-3 strength
  reducedK: 0.5, // x strength with Reduced effects
  falloff: 0.02, // 1 / (1 + falloff x radius): fainter as it travels
  fadeOut: 0.5, // s: an interrupted wave fades out over this
});
/** The strength never exceeds this (photosensitivity: one slow soft wave, never a flash). */
export const STRENGTH_CAP = 1;

/** Ladder time scale per difficulty (0 = never). Abyss: no waves. Nightmare: later. */
export const DIFF_SCALE = Object.freeze({ normal: 1, sandbox: 1, nightmare: 1.33, abyss: 0 });

export function ladderScale(diffKey) {
  const s = DIFF_SCALE[diffKey];
  return typeof s === 'number' ? s : 1;
}

/** The ladder stage (1..3) at `stuck` seconds without progress, 0 before the mark shows (scale: DIFF_SCALE; 0 = waves off: 1 max). */
export function stageAt(stuck, scale = 1) {
  if (!(stuck >= HINT_AFTER)) return 0;
  if (!(scale > 0)) return 1;
  if (stuck >= LADDER.stage3At * scale) return 3;
  if (stuck >= LADDER.stage2At * scale) return 2;
  return 1;
}

/** Stuck time at which the next wave is due after one at `last` (< 0: none yet in this clock). */
export function nextWaveAt(last, scale = 1) {
  const s2 = LADDER.stage2At * scale;
  const s3 = LADDER.stage3At * scale;
  if (!(last >= 0)) return s2;
  if (last >= s3) return last + LADDER.stage3Every;
  const n = last + LADDER.stage2Every;
  return n > s3 - LADDER.stage3Every ? Math.max(s3, last + LADDER.stage3Every) : n; // (a stage-2 repeat too close to stage 3 waits for it)
}

const smooth = (a, b, x) => {
  const t = x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a);
  return t * t * (3 - 2 * t);
};

export function waveSpeed(reduced) {
  return reduced ? WAVE.speedReduced : WAVE.speed;
}

/** Front radius (m) `age` seconds after the launch. */
export function waveRadius(age, reduced) {
  return Math.max(0, age) * waveSpeed(reduced);
}

/** Half width (m) of the band at a front radius. */
export function waveThickness(radius, stage) {
  const t = WAVE.thick0 + (WAVE.thick1 - WAVE.thick0) * Math.min(1, Math.max(0, radius) / WAVE.range);
  return stage >= 3 ? t * WAVE.thick3 : t;
}

/** Strength (0..STRENGTH_CAP) of the wave at `age` s / front `radius` m; 0 at and past the range. */
export function waveStrength(age, radius, stage, reduced) {
  if (!(radius < WAVE.range) || !(age >= 0)) return 0;
  let k = stage >= 3 ? WAVE.strength3 : WAVE.strength2;
  if (reduced) k *= WAVE.reducedK;
  k *= smooth(0, WAVE.rise, age); // rise: never a flash
  k *= 1 / (1 + WAVE.falloff * radius); // fainter as it travels ...
  k *= 1 - smooth(WAVE.range * 0.6, WAVE.range, radius); // ... and gone at the range
  return k > STRENGTH_CAP ? STRENGTH_CAP : k < 0 ? 0 : k;
}

/** Seconds the front takes to cover `dist` m (the blip's arrival at the player; capped at the range). */
export function arrivalTime(dist, reduced) {
  return Math.min(Math.max(0, dist), WAVE.range) / waveSpeed(reduced);
}

/**
 * Whether the hint wave is on: settings.hintWave (default true; false or 'off' = off) and `?hintwave=off`. Pure.
 * @param {object} [settings]
 * @param {string} [search] location.search
 */
export function hintWaveEnabled(settings, search) {
  if (typeof search === 'string' && /[?&]hintwave=(off|0)\b/.test(search)) return false;
  const v = settings ? settings.hintWave : true;
  return v !== false && v !== 'off';
}

/** The clamped wave: every field preallocated (read by the view / the tests). */
function makeWave() {
  return { active: false, manual: false, id: 0, x: 0, y: 0, z: 0, origin: -1, stage: 0, age: 0, radius: 0, thickness: 0, strength: 0, fade: 1, fading: false, reduced: false, passed: false, passDist: 0 };
}

export class HintWave {
  constructor() {
    this.wave = makeWave();
    this.reset();
  }

  /** A new run / restart / warp: nothing in flight, clock and the section count zeroed. */
  reset() {
    this._t = 0; // seconds the mark has been on (stuck = HINT_AFTER + _t)
    this._last = -1; // stuck time of the last wave in this clock
    this._sec = -1;
    this.fired = 0; // waves in this section
    this.total = 0; // waves this run
    this.stage = 0;
    this.launched = false; // true on the frame a wave starts (game.js emits hint:wave)
    this.passedNow = false; // true on the frame the front reaches the player (game.js: the blip)
    this.hold = -1; // debug / captures: >= 0 freezes the front at this radius (m)
    this._kill(true);
    this.wave.id = 0;
  }

  /** Progress (a checkpoint, a fixture done): the ladder restarts; an in-flight wave fades out. */
  progress() {
    this._clock();
    this._kill(false);
  }

  _clock() {
    this._t = 0;
    this._last = -1;
    this.stage = 0;
  }

  /** A death: back to stage 1 (the mark stays on); an in-flight wave fades out. */
  onDeath() {
    this.progress();
  }

  /** Seconds without progress (0 while the mark is off). */
  get stuck() {
    return this._t > 0 ? HINT_AFTER + this._t : 0;
  }

  _kill(now) {
    const w = this.wave;
    if (now) {
      w.active = false;
      w.strength = 0;
      w.fading = false;
      return;
    }
    if (w.active) w.fading = true;
  }

  /**
   * Starts a wave at (x, y, z) now (the ladder; the debug API passes `manual`: the wave then outlives a hidden mark). Refused while one
   * is in flight unless `force`.
   * @returns {boolean}
   */
  fire(x, y, z, stage, reduced, origin = 0, force = false, manual = false) {
    const w = this.wave;
    if (w.active && !force) return false;
    if (!(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z))) return false;
    w.active = true;
    w.manual = !!manual;
    w.id++;
    w.x = x;
    w.y = y;
    w.z = z;
    w.origin = origin;
    w.stage = stage >= 3 ? 3 : 2;
    w.age = 0;
    w.radius = 0;
    w.thickness = waveThickness(0, w.stage);
    w.strength = 0;
    w.fade = 1;
    w.fading = false;
    w.reduced = !!reduced;
    w.passed = false;
    w.passDist = 0;
    this.launched = true;
    return true;
  }

  /** Clears the wave at once (debug / tests). */
  clear() {
    this._kill(true);
  }

  _step(dt, px, py, pz) {
    const w = this.wave;
    if (!w.active) return;
    w.age += dt;
    if (this.hold >= 0) w.age = this.hold / waveSpeed(w.reduced); // (captures: the front held still)
    w.radius = waveRadius(w.age, w.reduced);
    w.thickness = waveThickness(w.radius, w.stage);
    if (w.fading) w.fade -= dt / WAVE.fadeOut;
    if (w.fade <= 0 || w.radius >= WAVE.range) {
      this._kill(true);
      return;
    }
    w.strength = waveStrength(w.age, w.radius, w.stage, w.reduced) * w.fade;
    if (!w.passed && !w.fading && Number.isFinite(px)) {
      const dx = px - w.x;
      const dy = py - w.y;
      const dz = pz - w.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (w.radius >= Math.min(d, WAVE.range - 0.5)) {
        w.passed = true;
        w.passDist = d;
        this.passedNow = true;
      }
    }
  }

  /**
   * @param {number} dt seconds (frame)
   * @param {import('./objectiveHint.js').ObjectiveHint|null} hint the 20 s mark (read: on, count, targets)
   * @param {object} c context: section, px / py / pz (the player), playing (a run, not paused), dead, blocked (attack wind-up / burst,
   *                   a fall, a cutscene), enabled (setting + URL), scale (DIFF_SCALE; 0 = off), reduced (Reduced effects)
   * @returns {HintWave} this (read `wave`, `launched`, `passedNow`, `stage`)
   */
  update(dt, hint, c) {
    this.launched = false;
    this.passedNow = false;
    if (!c) return this;
    if (c.section !== this._sec) {
      this._sec = c.section;
      this.fired = 0;
      this.progress();
    }
    if (!c.playing && !c.dead) return this; // paused: everything holds
    const on = !!(hint && hint.on && hint.count > 0) && c.enabled !== false && c.scale > 0;
    if (c.dead) this.onDeath();
    else if (!on) {
      this._clock(); // the mark hidden (progress / found / a new section): the ladder restarts ...
      if (!this.wave.manual) this._kill(false); // ... and its wave fades out
    }
    else if (c.blocked) this._kill(false);
    this._step(dt, c.px, c.py, c.pz);
    if (!on || c.dead || c.blocked) return this;
    this._t += dt;
    const stuck = HINT_AFTER + this._t;
    this.stage = stageAt(stuck, c.scale);
    if (this.stage < 2 || this.wave.active || this.fired >= LADDER.cap) return this;
    if (stuck < nextWaveAt(this._last, c.scale)) return this;
    // the origin: the pending trigger nearest the player (ObjectiveHint's marks)
    let best = -1;
    let bd = Infinity;
    for (let i = 0; i < hint.count; i++) {
      const t = hint.targets[i];
      if (!t.on) continue;
      const dx = t.x - c.px;
      const dy = t.y - c.py;
      const dz = t.z - c.pz;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    if (best < 0) return this;
    const t = hint.targets[best];
    if (this.fire(t.x, t.y, t.z, this.stage, !!c.reduced, best, false, false)) {
      this._last = stuck;
      this.fired++;
      this.total++;
    }
    return this;
  }

  /** A plain snapshot for the debug API. */
  state() {
    const w = this.wave;
    return { stage: this.stage, stuck: this.stuck, fired: this.fired, total: this.total, active: w.active, id: w.id, x: w.x, y: w.y, z: w.z, waveStage: w.stage, age: w.age, radius: w.radius, thickness: w.thickness, strength: w.strength, passed: w.passed, fading: w.fading };
  }
}
