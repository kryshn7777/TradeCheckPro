/* ABYSSAL TETHER 3D — lanternShadowLogic.js
 * The pure numbers behind the carried lantern's real-time shadow (lanternShadow.js): the tier table, the governor / reducedEffects
 * reduction, the cone fit and the cache-refresh decision. No three.js, no DOM: Node-testable.
 *
 * Design (WP-SHADOWS): ONE cone-shaped depth map from the lantern, shared by both eyes (a perspective frustum from the lantern,
 * axis = where the head looks, ~120 deg, ~14 m), in two parts that the receivers multiply together:
 *   - STATIC map: level solids (+ flagged decor) near the lantern; rendered only when the lantern has moved / turned past a
 *     threshold (and at most every minInterval seconds), otherwise the cached depth is reused, with the matrix it was made with;
 *   - DYNAMIC map: creature (LOD1), player body, hands / launchers, rope, bag items and supplies; small, re-rendered every
 *     dynEvery-th frame with the current lantern pose.
 */

/** Tier table. `staticSize` / `dynSize` are map edge lengths in texels; `maxCasterCalls` caps the draw calls of both passes. */
export const SHADOW_TIERS = Object.freeze({
  low: Object.freeze({ name: 'low', enabled: false, staticSize: 0, dynSize: 0, maxCasterCalls: 0, radius: 0, fovDeg: 0, posThresh: 0, turnDeg: 0, minInterval: 0, dynEvery: 1, taps: 0 }),
  quest: Object.freeze({ name: 'quest', enabled: true, staticSize: 1024, dynSize: 512, maxCasterCalls: 24, radius: 14, fovDeg: 120, posThresh: 0.06, turnDeg: 6, minInterval: 1 / 36, dynEvery: 1, taps: 4 }),
  high: Object.freeze({ name: 'high', enabled: true, staticSize: 2048, dynSize: 1024, maxCasterCalls: 40, radius: 16, fovDeg: 120, posThresh: 0.03, turnDeg: 4, minInterval: 0, dynEvery: 1, taps: 4 }),
});

const TIER_ALIAS = { low: 'low', reduced: 'low', off: 'low', quest: 'quest', xr: 'quest', medium: 'quest', high: 'high', desktop: 'high' };

export function shadowTierName(v) {
  return typeof v === 'string' && TIER_ALIAS[v.toLowerCase()] ? TIER_ALIAS[v.toLowerCase()] : null;
}

/**
 * The effective plan for this frame.
 * @param {string} tier  lighting tier ('low' | 'quest' | 'high'); low = off (the contact blobs remain)
 * @param {{govLevel?: number, reduced?: boolean, enabled?: boolean}} o
 *   govLevel  governor level (0..3): >= 2 halves the refresh rate and the map sizes, >= 3 switches the shadow off
 *   reduced   settings.reducedEffects: same reduction as governor level 2 (when the tier itself is not already 'low')
 *   enabled   the API switch (renderer.lanternShadow.setEnabled)
 */
export function shadowPlan(tier, o = {}) {
  const name = shadowTierName(tier) || 'quest';
  const base = SHADOW_TIERS[name];
  const gl = o.govLevel | 0;
  if (!base.enabled || o.enabled === false || gl >= 3) {
    return { enabled: false, tier: name, staticSize: 0, dynSize: 0, maxCasterCalls: 0, radius: 0, fovDeg: 0, posThresh: 0, turnDeg: 0, minInterval: 0, dynEvery: 1, taps: 0 };
  }
  const reduce = gl >= 2 || !!o.reduced;
  return {
    enabled: true,
    tier: name,
    staticSize: reduce ? base.staticSize >> 1 : base.staticSize,
    dynSize: reduce ? Math.max(256, base.dynSize >> 1) : base.dynSize,
    maxCasterCalls: reduce ? Math.max(8, (base.maxCasterCalls * 2) / 3 | 0) : base.maxCasterCalls,
    radius: base.radius,
    fovDeg: base.fovDeg,
    posThresh: reduce ? base.posThresh * 2.5 : base.posThresh,
    turnDeg: reduce ? base.turnDeg * 1.5 : base.turnDeg,
    minInterval: reduce ? Math.max(base.minInterval * 2, 1 / 18) : base.minInterval,
    dynEvery: reduce ? 2 : base.dynEvery,
    taps: base.taps,
  };
}

/**
 * Cone fit: a square perspective frustum with apex at the lantern. Returns the numbers the shaders and the camera need.
 * texel = world size of one shadow texel per metre of distance along the axis (2 tan(fov/2) / size): the receivers scale their
 * normal offset and depth bias by distance x texel.
 */
export function coneFit(fovDeg, size, radius, out = {}) {
  const half = (fovDeg * Math.PI) / 360;
  const tanHalf = Math.tan(half);
  out.fovDeg = fovDeg;
  out.tanHalf = tanHalf;
  out.near = 0.2; // anything nearer than this to the lantern (the lantern's own cage, the fingers holding it) never casts
  out.far = radius + 1.0;
  out.texel = size > 0 ? (2 * tanHalf) / size : 0;
  // the distance beyond which a point inside the frustum is faded back to "unshadowed" (the lantern's light is almost gone there)
  out.fadeFar = radius;
  return out;
}

/** Angle (radians) between two unit vectors given as components. */
export function angleBetween(ax, ay, az, bx, by, bz) {
  let d = ax * bx + ay * by + az * bz;
  if (d > 1) d = 1;
  else if (d < -1) d = -1;
  return Math.acos(d);
}

/**
 * Does the cached static map need a refresh?
 * @param {{valid: boolean, x: number, y: number, z: number, ax: number, ay: number, az: number, t: number, stamp: number}} cache
 * @param {{x: number, y: number, z: number, ax: number, ay: number, az: number}} pose  current lantern position and (unit) cone axis
 * @param {object} plan  shadowPlan(...)
 * @param {number} now   seconds
 * @param {number} stamp world-change stamp (level rebuilt, section pack changed, ...): any change forces a refresh
 * @returns {boolean}
 */
export function staticNeedsRefresh(cache, pose, plan, now, stamp = 0) {
  if (!cache.valid || cache.stamp !== stamp || cache.size !== plan.staticSize) return true;
  if (now - cache.t < plan.minInterval) return false;
  const dx = pose.x - cache.x;
  const dy = pose.y - cache.y;
  const dz = pose.z - cache.z;
  if (dx * dx + dy * dy + dz * dz > plan.posThresh * plan.posThresh) return true;
  const turn = angleBetween(pose.ax, pose.ay, pose.az, cache.ax, cache.ay, cache.az);
  return turn > (plan.turnDeg * Math.PI) / 180;
}

/** Records the pose a static map was made with. */
export function markStaticRefreshed(cache, pose, plan, now, stamp = 0) {
  cache.valid = true;
  cache.x = pose.x;
  cache.y = pose.y;
  cache.z = pose.z;
  cache.ax = pose.ax;
  cache.ay = pose.ay;
  cache.az = pose.az;
  cache.t = now;
  cache.stamp = stamp;
  cache.size = plan.staticSize;
  return cache;
}

export function makeStaticCache() {
  return { valid: false, x: 0, y: 0, z: 0, ax: 0, ay: 0, az: -1, t: -1e9, stamp: 0, size: 0 };
}

/** Is the dynamic map due this frame? (every dynEvery-th frame; frame counts from 0) */
export function dynamicDue(frame, plan) {
  return plan.enabled && (plan.dynEvery <= 1 || frame % plan.dynEvery === 0);
}

/**
 * Smooths the cone axis toward the head's forward direction (so head tremor never wobbles the cone). `k` = 1 - exp(-rate dt).
 * Writes the normalised result into `axis` ({x,y,z}).
 */
export function smoothAxis(axis, fx, fy, fz, k) {
  let x = axis.x + (fx - axis.x) * k;
  let y = axis.y + (fy - axis.y) * k;
  let z = axis.z + (fz - axis.z) * k;
  const l = Math.sqrt(x * x + y * y + z * z);
  if (l < 1e-6) {
    x = fx;
    y = fy;
    z = fz;
  } else {
    x /= l;
    y /= l;
    z /= l;
  }
  axis.x = x;
  axis.y = y;
  axis.z = z;
  return axis;
}

/**
 * Does a sphere (centre c, radius r) possibly lie in the cone (apex a, unit axis u, half-angle atan(tanHalf) widened to the square's
 * corner, range)? Conservative; used to choose the static casters.
 */
export function sphereInCone(cx, cy, cz, r, ax, ay, az, ux, uy, uz, tanHalf, range) {
  const dx = cx - ax;
  const dy = cy - ay;
  const dz = cz - az;
  const d2 = dx * dx + dy * dy + dz * dz;
  const reach = range + r;
  if (d2 > reach * reach) return false;
  const d = Math.sqrt(d2);
  if (d <= r) return true;
  // the square frustum's corner direction is sqrt(2) wider than its side
  const halfCorner = Math.atan(tanHalf * 1.4143);
  const ang = angleBetween(dx / d, dy / d, dz / d, ux, uy, uz);
  return ang <= halfCorner + Math.asin(Math.min(1, r / d));
}
