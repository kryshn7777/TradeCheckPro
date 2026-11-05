/**
 * ABYSSAL TETHER 3D - VISTA WIND (pure: no three.js, no DOM, no Math.random).
 *
 * "I need the wind whooshing, like whoosh, the wind moving, especially in the areas where there is a scenery to be looked. For example the place
 * where we just go and see the mason for the first time, like something is awakening, and the place where we go and turn on 3 lamps ... and a
 * depth of scene with more atmospheric fog, like there are some things far."
 *
 * A VISTA is a place with something to look at: a big open cavern, a catwalk over the void. Where one is, the shaft's wind bed swells, discrete
 * WHOOSHES sweep past (a rising and falling band of air, a few seconds apart, never regular) and the haze thickens a little, so what is far
 * reads as far. Zones come from the level itself (one per section, at the section's mid height, sized from its shaft; an open cavern wind
 * is stronger) plus authored extras: the S4 catwalk where the sighting fires and the three cold lamps (the strongest place in the game).
 *
 *   buildVistaZones(level)      -> [{ id, x,y,z, rx, ry, rz, gain }]  (an ellipsoid each; gain 0..1)
 *   vistaAt(zones, x,y,z)       -> 0..1   (the strongest zone, smooth to 0 at the edge)
 *   new VistaWind(bus)          .reset(level) .update(dt, player, level) -> .k (smoothed 0..1), .gust (0..1, the whoosh envelope), events 'wind:whoosh'
 *
 * Bus: 'wind:whoosh' { strength 0..1, dir (-1 left .. 1 right), dur (s) }.
 */
import { U } from './config3d.js';

/** A deterministic 0..1 from an integer-ish index. */
function hash01(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Authored extras by section id: [x, y, z, rx, ry, rz, gain]. S4's catwalk is where the first sighting and the lamps are. */
export const VISTA_EXTRA = Object.freeze({
  s4: [
    ['catwalk', -16, -108, -19, 60, 34, 70, 1.0],
  ],
});

/** Default gain by section index (0-based): how much there is to look at. */
const SECTION_GAIN = [0.55, 0.7, 0.35, 0.45, 0.35, 0.6, 0.85, 0.4];

export function buildVistaZones(level) {
  const zones = [];
  const secs = (level && level.sections) || [];
  for (let i = 0; i < secs.length; i++) {
    const s = secs[i];
    const sh = s.shaft;
    if (!sh || !(s.yTop > s.yBottom)) continue;
    const w = sh.maxX - sh.minX;
    const d = sh.maxZ - sh.minZ;
    // an open cavern is windier: the gain grows with the shaft's width (a 60 m nave is full, a 20 m corridor a third)
    const open = U.clamp(Math.min(w, d) / 60, 0.3, 1);
    zones.push({
      id: s.id || 's' + (i + 1),
      x: (sh.minX + sh.maxX) / 2,
      y: (s.yTop + s.yBottom) / 2,
      z: (sh.minZ + sh.maxZ) / 2,
      rx: w * 0.5 + 6,
      ry: Math.min(70, (s.yTop - s.yBottom) * 0.5 + 6),
      rz: d * 0.5 + 6,
      gain: (SECTION_GAIN[i] != null ? SECTION_GAIN[i] : 0.4) * (0.55 + 0.45 * open),
    });
    const ex = VISTA_EXTRA[s.id];
    if (ex) for (const e of ex) zones.push({ id: e[0], x: e[1], y: e[2], z: e[3], rx: e[4], ry: e[5], rz: e[6], gain: e[7] });
  }
  return zones;
}

/** The strongest zone's wind at a point: gain x a smooth falloff to the ellipsoid's edge. */
export function vistaAt(zones, x, y, z) {
  let best = 0;
  for (let i = 0; i < zones.length; i++) {
    const q = zones[i];
    const dx = (x - q.x) / q.rx;
    const dy = (y - q.y) / q.ry;
    const dz = (z - q.z) / q.rz;
    const r2 = dx * dx + dy * dy + dz * dz;
    if (r2 >= 1) continue;
    const f = 1 - r2;
    const k = q.gain * f * (2 - f); // smooth: 0 at the edge, steep in
    if (k > best) best = k;
  }
  return best > 1 ? 1 : best;
}

export class VistaWind {
  constructor(bus) {
    this.bus = bus || null;
    this.zones = [];
    this.k = 0; // smoothed zone wind
    this.gust = 0; // the current whoosh's envelope 0..1
    this._t = 0;
    this._next = 3;
    this._n = 0;
    this._gustT = -1;
    this._gustDur = 0;
    this._gustAmp = 0;
    this.enabled = true;
  }

  reset(level) {
    this.zones = buildVistaZones(level);
    this.k = 0;
    this.gust = 0;
    this._t = 0;
    this._next = 3;
    this._n = 0;
    this._gustT = -1;
  }

  /** The target (unsmoothed) wind at the player. */
  target(p) {
    return this.enabled && p ? vistaAt(this.zones, p.x, p.y, p.z) : 0;
  }

  /** @param {number} dt @param {{x,y,z}} p */
  update(dt, p) {
    dt = dt > 0 ? Math.min(dt, 0.25) : 0;
    this._t += dt;
    const tgt = this.target(p);
    this.k += (tgt - this.k) * (1 - Math.exp(-dt * 0.9)); // the wind comes and goes over a few seconds
    // a whoosh every 4-10 s while there is a vista around you (slower when it is faint); deterministic from the clock
    if (this.k > 0.12 && this._t >= this._next) {
      const r1 = hash01(this._n * 1.7 + 11);
      const r2 = hash01(this._n * 2.3 + 29);
      this._gustDur = 2.2 + 2.2 * r1 + 1.2 * this.k;
      this._gustAmp = 0.45 + 0.55 * this.k;
      this._gustT = 0;
      this._next = this._t + this._gustDur + 2.5 + 5 * (1 - this.k) + 3 * r2;
      this._n++;
      if (this.bus) this.bus.emit('wind:whoosh', { strength: this._gustAmp, dir: r2 * 2 - 1, dur: this._gustDur });
    }
    if (this._gustT >= 0) {
      this._gustT += dt;
      const u = this._gustT / this._gustDur;
      // a swell: quick rise, long fall (sin^2 of a skewed phase)
      this.gust = u >= 1 ? 0 : this._gustAmp * Math.pow(Math.sin(Math.PI * Math.pow(u, 0.7)), 2);
      if (u >= 1) this._gustT = -1;
    } else this.gust = 0;
  }
}
