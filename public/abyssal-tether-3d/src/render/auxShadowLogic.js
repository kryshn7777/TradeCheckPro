/* ABYSSAL TETHER 3D — auxShadowLogic.js
 * The pure numbers behind the SECOND real-time shadow (auxShadow.js): the one light besides the carried lantern that casts.
 *
 *   "Try to add real shadows"  (2026-11-05)
 *
 * The lantern shadow (lanternShadowLogic.js) shows the player's arms and the creature on the stone near the lantern. Two things were left out:
 *   - the LAMPS. Their light on the level is baked (lightmaps), so the level's own shadows from them are already right; what is missing is
 *     everything that MOVES (the body, the hands, the rope, a dropped cell, the creature): in a lamp's pool you cast nothing. The aux map is
 *     rendered from the nearest pooled lamp and holds only the moving things (the dynamic layer), aimed at the player;
 *   - the CREATURE. Its glow was only paint. While it hunts, one of the two pooled-lamp slots becomes its light (a dim, sickly red lit
 *     on the stone and on you, pulsing with its listening) and the aux map is rendered FROM it, with the level's boxes (the static proxy
 *     pack around the lantern) and the moving things, so it lights the stone only where nothing is in the way: a glow that sweeps round
 *     corners and throws your shadow ahead of it.
 * One map, one sampler: the creature wins when it is near, otherwise the nearest lamp. Pure here: tier table, governor reduction, which light
 * to use (with hysteresis), the aim, the creature's light plan. No three.js, no DOM.
 */
import { coneFit, shadowTierName, smoothAxis } from './lanternShadowLogic.js';

/** Tier table. `size` is the map edge in texels; the aux map is off on low (the contact blobs and the lantern shadow remain). */
export const AUX_TIERS = Object.freeze({
  low: Object.freeze({ name: 'low', enabled: false, size: 0, every: 1, fovDeg: 0, maxLampRange: 0, creatureReach: 0 }),
  quest: Object.freeze({ name: 'quest', enabled: true, size: 512, every: 2, fovDeg: 100, maxLampRange: 22, creatureReach: 15 }),
  high: Object.freeze({ name: 'high', enabled: true, size: 1024, every: 1, fovDeg: 104, maxLampRange: 30, creatureReach: 20 }),
});

/**
 * @param {string} tier   lighting tier
 * @param {{govLevel?: number, reduced?: boolean, enabled?: boolean}} o  govLevel >= 2 switches it off (the lantern shadow stays, the aux map
 *   is the first thing the frame governor gives back); level 1 / reducedEffects halve the map and slow the rate by one frame
 */
export function auxPlan(tier, o = {}) {
  const name = shadowTierName(tier) || 'quest';
  const base = AUX_TIERS[name];
  const gl = o.govLevel | 0;
  if (!base.enabled || o.enabled === false || gl >= 2) return { enabled: false, tier: name, size: 0, every: 1, fovDeg: 0, maxLampRange: 0, creatureReach: 0 };
  const reduce = gl >= 1 || !!o.reduced;
  return {
    enabled: true,
    tier: name,
    size: reduce ? Math.max(256, base.size >> 1) : base.size,
    every: reduce ? base.every + 1 : base.every,
    fovDeg: base.fovDeg,
    maxLampRange: base.maxLampRange,
    creatureReach: base.creatureReach,
  };
}

/** Is the aux map due this frame? */
export function auxDue(frame, plan) {
  return plan.enabled && (plan.every <= 1 || frame % plan.every === 0);
}

/**
 * The creature's light for this frame (pure). It is on while the Mason is out and aware of the player, within `reach`, fading in over the
 * last 30 % of the reach; brighter while it hunts or lunges, throbbing with its listening.
 * @param {{visible?: boolean, state?: string, dist?: number, listen?: number, time?: number}} c
 * @param {{enabled: boolean, creatureReach: number}} plan  auxPlan(...)
 * @returns {{on: boolean, k: number, candela: number, range: number, color: number[], flicker: number}}
 */
export function creatureLightPlan(c, plan) {
  const off = { on: false, k: 0, candela: 0, range: 0, color: [0.9, 0.2, 0.1], flicker: 0 };
  if (!plan || !plan.enabled || !c || c.visible === false) return off;
  const aware = c.state === 'OBSERVING' || c.state === 'APPROACHING' || c.state === 'PURSUING' || c.state === 'BURST' || c.state === 'ATTACK' || c.state === 'RECOVERING';
  if (!aware) return off;
  const reach = plan.creatureReach;
  const d = Number.isFinite(c.dist) ? c.dist : 1e9;
  if (d >= reach) return off;
  const k = Math.max(0, Math.min(1, (reach - d) / (reach * 0.3)));
  const boost = c.state === 'ATTACK' ? 1.5 : c.state === 'BURST' ? 1.3 : c.state === 'PURSUING' ? 1.1 : c.state === 'OBSERVING' ? 0.8 : 1;
  const listen = Math.max(0, Math.min(1, c.listen || 0));
  return {
    on: k > 0.01,
    k,
    candela: 9 * boost * (1 + 0.35 * listen) * k,
    range: 11,
    color: [1.0, 0.24, 0.1],
    flicker: 0.35,
  };
}

/**
 * Which light the aux map follows. Candidates are the renderer's pooled-lamp slots: { kind: 'lamp'|'creature', slot, x, y, z, range, level }.
 * The creature wins while it is on; otherwise the lamp with the best score (distance from the head minus 0.6 of its range) among those the
 * head is inside the range of, with hysteresis so two lamps of similar score never flip-flop.
 * @returns {number} the index into `cands` (-1 = none)
 */
export function pickAuxLight(cands, head, prev, maxLampRange = 30) {
  let best = -1;
  let bestScore = Infinity;
  let prevIdx = -1;
  for (let i = 0; i < cands.length; i++) {
    const c = cands[i];
    if (!c || !(c.level > 0.05)) continue;
    if (c.kind === 'creature') return i;
    const d = Math.hypot(c.x - head.x, c.y - head.y, c.z - head.z);
    const range = Math.min(c.range || 0, maxLampRange);
    if (d > range * 1.05) continue;
    const score = d - 0.6 * range;
    if (prev && prev.kind === c.kind && prev.slot === c.slot) prevIdx = i;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  if (prevIdx >= 0 && best >= 0 && prevIdx !== best) {
    const p = cands[prevIdx];
    const pd = Math.hypot(p.x - head.x, p.y - head.y, p.z - head.z);
    const pScore = pd - 0.6 * Math.min(p.range || 0, maxLampRange);
    if (pScore < bestScore + 1.5) return prevIdx;
  }
  return best;
}

/**
 * The map's camera: apex at the light, axis toward the target (the player's torso), the frustum fit for the light's range.
 * `axis` is the smoothed axis (smoothAxis) so a turning head never wobbles the map.
 * @returns {{ax: number, ay: number, az: number, dist: number}}
 */
export function auxAim(light, target, axis, k, out = {}) {
  let dx = target.x - light.x;
  let dy = target.y - light.y;
  let dz = target.z - light.z;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (dist < 0.4) {
    dx = 0;
    dy = -1;
    dz = 0;
  } else {
    dx /= dist;
    dy /= dist;
    dz /= dist;
  }
  smoothAxis(axis, dx, dy, dz, k);
  out.ax = axis.x;
  out.ay = axis.y;
  out.az = axis.z;
  out.dist = dist;
  return out;
}

/** The map's fit: a cone of the tier's field of view out to the light's range. */
export function auxFit(plan, range, out = {}) {
  coneFit(plan.fovDeg, plan.size, Math.max(4, Math.min(range, plan.maxLampRange || range)), out);
  out.near = 0.35;
  return out;
}
