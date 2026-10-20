/* ABYSSAL TETHER 3D — uxLogic.js
 * WP-UX: the small pure rules behind the comfort, display and accessibility settings (no three.js, no DOM: unit-tested in
 * Node, imported by game.js and by ui/comfort.js / ui/ui3d.js).
 *
 * Settings keys (SETTINGS_DEFAULTS in sim/config3d.js, ranges UX_LIMITS, validation sanitizeUxSettings; all persisted
 * through Storage and the save profile):
 *   volume / musicVolume / sfxVolume   0..1   master, music (audio/music3d.js), everything else (audio/audio3d.js _sfxMul)
 *   hapticStrength                     0.25..1.5   multiplier on every pulse (input/inputManager.js haptic)
 *   captions                           bool        subtitle-style captions (ui/captions.js)
 *   colorSafe                          bool        shape + word cues next to colour (status strip on the wrist / HUD)
 *   textScale                          0.9..1.5    VR panels, notes and captions physically larger; desktop UI font larger
 *   vignette                           0..1        comfort vignette strength (0 = off, default); see vignetteLevel()
 *   turnMode / snapAngle               'smooth' | 'snap', 30|45|60|90   game.js _applyTurn uses snapTurnStep()
 *   qualityTier / renderScale          'auto'|'low'|'quest'|'high', 0.7..1.3   ui/comfort.js applyDisplay()
 *   brightness / blackLevel            0.6..1.6 exposure multiplier, 0..1 black-point lift (ui/comfort.js)
 *   reducedEffects (existing)          fog cards, dust, debris and the wet film thinned; never below governor level 3
 *   showBody, dominantHand, haptics, aimAssist, turnSpeed, mouseSensitivity, heightMode/heightOffset... (existing)
 */
import { UX_LIMITS } from '../sim/config3d.js';

const DEG = Math.PI / 180;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const smooth = (a, b, v) => {
  const t = clamp((v - a) / (b - a || 1), 0, 1);
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------------------------------------------------------------
// Snap turn
// ---------------------------------------------------------------------------------------------------------------------
/** The input module's full-deflection turn rate (rad/s, before settings.turnSpeed): inputManager.js TUNING.turnRate. */
export const SNAP_FULL_RATE = 2.6;
export const SNAP_ON = 0.6; // stick deflection (0..1) that fires a step
export const SNAP_OFF = 0.3; // deflection below which the stick is armed again

export function makeSnapState() {
  return { armed: true };
}

/**
 * One frame of snap turning. `rate` is the smooth-turn rate the input produced (rad/s, signed), `fullRate` the rate at
 * full deflection. Returns the rotation to apply NOW in radians (0 most frames): one step of `angleDeg` per stick push,
 * re-armed once the stick returns toward centre.
 */
export function snapTurnStep(st, rate, fullRate, angleDeg) {
  const n = fullRate > 0 ? rate / fullRate : 0;
  const a = Math.abs(n);
  if (st.armed) {
    if (a >= SNAP_ON) {
      st.armed = false;
      return (n > 0 ? 1 : -1) * clamp(angleDeg, 10, 120) * DEG;
    }
  } else if (a <= SNAP_OFF) {
    st.armed = true;
  }
  return 0;
}

// ---------------------------------------------------------------------------------------------------------------------
// Comfort vignette
// ---------------------------------------------------------------------------------------------------------------------
export const VIG = {
  speedLo: 7, // m/s: below this a swing or run never darkens the edges
  speedHi: 20, // m/s: full effect (a long fall reaches ~16-17 m/s, a fast swing 18-25)
  turnLo: 0.35, // smooth-turn stick deflection that starts the vignette
  turnWeight: 0.7, // turning alone reaches this much of full
  swingBoost: 1.15, // being on the rope while fast reads a little stronger (the pendulum is what upsets people)
  holeOpen: 1.9, // tan(half-angle) of the clear centre at rest (beyond the view: invisible)
  holeMin: 0.62, // ... at full effect (~32 degrees)
  soft: 0.45, // width of the fade ring, same units
  maxOpacity: 0.97,
  riseRate: 7, // 1/s: closes fast when motion starts
  fallRate: 2.2, // 1/s: opens slowly after it (an abrupt release is a visible pop)
};

/**
 * Raw 0..1 motion level for the vignette (before the strength setting): `speed` m/s of the player, `turnNorm` smooth-turn
 * stick deflection 0..1 (0 when snapping or on the desktop), `roped` whether a tether is attached.
 */
export function vignetteLevel(speed, turnNorm, roped) {
  const m = smooth(VIG.speedLo, VIG.speedHi, speed) * (roped ? VIG.swingBoost : 1);
  const t = smooth(VIG.turnLo, 1, Math.abs(turnNorm)) * VIG.turnWeight;
  return clamp(Math.max(m, t), 0, 1);
}

/** Follows `target` with separate rise / fall rates (frame-rate independent). */
export function followLevel(cur, target, dt) {
  const rate = target > cur ? VIG.riseRate : VIG.fallRate;
  return target + (cur - target) * Math.exp(-rate * dt);
}

/** Shader parameters for a vignette intensity 0..1 → out {hole, soft, opacity}. */
export function vignetteShape(intensity, out) {
  const k = clamp(intensity, 0, 1);
  out.hole = VIG.holeOpen + (VIG.holeMin - VIG.holeOpen) * smooth(0, 1, k);
  out.soft = VIG.soft;
  out.opacity = VIG.maxOpacity * smooth(0.02, 0.2, k);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------------------------------------------------
/** XR framebuffer scale per tier (mirrors render/renderer3d.js XR_RENDER_SCALE). */
export const XR_BASE_SCALE = { low: 1.0, quest: 1.15, high: 1.2 };

/** The framebuffer scale a session should start with for a tier ('auto' keeps the renderer's own pick `fallbackTier`). */
export function xrScaleFor(tier, mult, fallbackTier) {
  const t = tier === 'auto' || !(tier in XR_BASE_SCALE) ? fallbackTier : tier;
  const base = XR_BASE_SCALE[t] || 1;
  return clamp(base * clamp(mult, UX_LIMITS.renderScale[0], UX_LIMITS.renderScale[1]), 0.6, 1.5);
}

/** The additive black-point lift (display units 0..1) for settings.blackLevel 0..1: up to 6/255. */
export function blackLift(level) {
  return clamp(level, 0, 1) * (6 / 255);
}

/** Exposure multiplier for settings.brightness (clamped to the allowed range). */
export function exposureMul(brightness) {
  return clamp(typeof brightness === 'number' && isFinite(brightness) ? brightness : 1, UX_LIMITS.brightness[0], UX_LIMITS.brightness[1]);
}

/** settings.textScale clamped to its range (1 when unset). */
export function textScaleOf(settings) {
  const v = settings && typeof settings.textScale === 'number' && isFinite(settings.textScale) ? settings.textScale : 1;
  return clamp(v, UX_LIMITS.textScale[0], UX_LIMITS.textScale[1]);
}

/** Haptic pulse intensity after the strength slider (0..1). */
export function hapticIntensity(intensity, settings) {
  const s = settings && typeof settings.hapticStrength === 'number' && isFinite(settings.hapticStrength) ? settings.hapticStrength : 1;
  return clamp((Number(intensity) || 0) * s, 0, 1);
}

// ---------------------------------------------------------------------------------------------------------------------
// Formatting shared by the DOM and VR settings screens
// ---------------------------------------------------------------------------------------------------------------------
export const fmtPct = (v) => `${Math.round(v * 100)}%`;
export const fmtMul = (v) => `${v.toFixed(2)}×`;
export const fmtOff = (v) => (v <= 0.001 ? 'Off' : `${Math.round(v * 100)}%`);
export const fmtDeg = (v) => `${Math.round(v)}°`;
