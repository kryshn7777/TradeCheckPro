/* THE LANTERN (ABYSSAL TETHER 3D) — render/lookPresets.js
 * The look of the whole game as data: one preset picked by `?look=` or settings.look, read by Renderer3D (tone mapping, exposure,
 * the lit materials' grade uniforms, the lantern, the ambient floor, the haze) and by anything else that wants the same picture
 * (the opening cinematic). Pure: no three.js, no DOM (Node-testable).
 *
 * dark    (default) realistic, dark, terrifying: physically lit surfaces, a toe that presses the unlit shadow toward black, neutral-cool
 *         shadows, a warm lantern pool with an inverse-square falloff (a bright pool, a fast dark beyond it), drained colour that drains
 *         further with depth, a sickly mid-distance haze, a low non-zero ambient floor per section; desktop-only static vignette and
 *         fine grain (never in VR). Design and numbers: docs/abyssal-tether-3d/plans/DARK_REALISM_LOOK.md.
 * classic a lighter variant of the same look (no toe, no film, a higher floor): for bright rooms and displays that crush.
 * Aliases (old URLs and saved settings keep working): horror -> dark, anime -> dark (the cel look is gone), realistic -> dark.
 */

/** Section count of Chapter I; per-section arrays below are indexed by section (0-based) and clamp at the ends. */
const S = 8;

export const LOOK_PRESETS = Object.freeze({
  dark: Object.freeze({
    name: 'dark',
    toneMapping: 'aces', // ACES filmic: a real toe and shoulder (AgX was tried: flatter, greyer blacks; see the plan)
    exposure: 0.9,
    contrast: 0.14, // added to the base 1.1 contrast exponent about mid grey
    sat: -0.2, // added to the base 0.94 saturation
    depthDesat: 0.4, // extra desaturation at -300 m (0..1)
    toe: 0.5, // how hard the unlit shadow (linear luminance < 0.04 pre-tone-map) is pressed toward black
    split: 1, // split-tone strength
    splitLo: Object.freeze([0.9, 0.98, 1.06]), // shadows: neutral-cool (never violet, never green)
    splitHi: Object.freeze([1.05, 1.0, 0.93]), // the lit parts: the warm of the lantern's pool
    lift: 0.6, // black-point lift (x BLACK_LIFT_MAX of the renderer, in the haze colour): the LCD floor
    grain: 0.035, // desktop only
    vignette: 0.3, // desktop only, static
    rim: 0.55, // the haze's grazing rim on verticals (x the section's): a faint scatter edge, not a drawn line
    detail: 1, // detail normal (x the tier's)
    crev: 1.15, // crevice grime / moss / water (x the tier's): dirtier joints
    // the carried lantern: candela x, decay (2 = inverse square: a bright pool and a fast dark), and the baked-light response
    lantern: 1.45,
    lanternDecay: 2.0,
    lmExposure: 1.25, // baked lightmap exposure (lighting.js LM_TUNE.exposure was 1.5)
    lmFloor: 0.008, // baked ambient floor (was 0.012)
    lmLanternGain: 1.1,
    lmLanternFalloff: 0.55, // was 0.38: the lantern on lightmapped stone falls off with the point light's square law
    ambient: 0.72, // hemisphere fill (x the section's)
    key: 0.6, // the cold shaft key from above (x the section's)
    // the haze: a sickly, drained mid-distance (multiplier on the section fog colour, then pulled toward its own grey)
    haze: Object.freeze([0.96, 1.0, 0.9]),
    hazeDesat: 0.35,
    hazeGain: 0.85,
    // the ambient floor: minimum hemisphere intensity per section (S1 dim but readable .. S8 the lantern is the world)
    floor: Object.freeze([0.16, 0.14, 0.12, 0.1, 0.08, 0.065, 0.05, 0.04]),
  }),
  classic: Object.freeze({
    name: 'classic',
    toneMapping: 'aces',
    exposure: 1.15,
    contrast: 0.04,
    sat: -0.08,
    depthDesat: 0.25,
    toe: 0,
    split: 0.5,
    splitLo: Object.freeze([0.94, 0.99, 1.04]),
    splitHi: Object.freeze([1.03, 1.0, 0.96]),
    lift: 1,
    grain: 0,
    vignette: 0,
    rim: 0.85,
    detail: 1,
    crev: 1,
    lantern: 1.25,
    lanternDecay: 1.8,
    lmExposure: 1.5,
    lmFloor: 0.012,
    lmLanternGain: 1.05,
    lmLanternFalloff: 0.45,
    ambient: 1,
    key: 0.9,
    haze: Object.freeze([1, 1, 1]),
    hazeDesat: 0.15,
    hazeGain: 1,
    floor: Object.freeze([0.24, 0.22, 0.2, 0.18, 0.16, 0.14, 0.12, 0.1]),
  }),
});

export const LOOK_ALIASES = Object.freeze({ horror: 'dark', anime: 'dark', realistic: 'dark', default: 'dark' });
export const DEFAULT_LOOK = 'dark';

/**
 * Per quality tier, multipliers / overrides of the preset (ALU only: no tier adds a pass or a draw call). `xr` is the VR rule, whatever
 * the tier: no grain (a per-frame noise shimmers in a headset) and no vignette (a view-locked darkening is the comfort vignette's job,
 * src/ui/comfort.js, and must never move or pump).
 */
export const LOOK_TIERS = Object.freeze({
  low: Object.freeze({ grain: 0, vignette: 0, toe: 0.75, floor: 1.25 }), // the low tier has no lantern shadow and less relief: a little more floor
  quest: Object.freeze({ grain: 0, vignette: 1, toe: 1, floor: 1 }),
  high: Object.freeze({ grain: 1, vignette: 1, toe: 1, floor: 1 }),
});

/** The preset name for a raw name (a URL value or a saved setting): aliases resolved, unknown names fall back to the default. */
export function lookName(raw) {
  const n = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (LOOK_PRESETS[n]) return n;
  if (LOOK_ALIASES[n]) return LOOK_ALIASES[n];
  return DEFAULT_LOOK;
}

/** The look from settings.look and, overriding it, `?look=` in `search` (default: location.search). */
export function resolveLook(settings, search) {
  let raw = settings && typeof settings.look === 'string' ? settings.look : '';
  let q = search;
  if (q == null) {
    try {
      q = (typeof location !== 'undefined' && location.search) || '';
    } catch {
      q = '';
    }
  }
  const m = /[?&]look=([a-z]+)/i.exec(q || '');
  if (m) raw = m[1];
  return LOOK_PRESETS[lookName(raw)];
}

/** One per-section value of a preset array at a fractional section index (the renderer blends sections by height). */
export function perSection(arr, sectionF) {
  const n = arr.length || S;
  const f = sectionF > 0 ? (sectionF < n - 1 ? sectionF : n - 1) : 0;
  const i = Math.floor(f);
  const j = i + 1 < n ? i + 1 : n - 1;
  return arr[i] + (arr[j] - arr[i]) * (f - i);
}

/**
 * The film terms for a frame: { grain, vignette, toe } after the tier, the platform and the comfort settings. `xr` = presenting in a
 * headset; `reduced` = settings.reducedEffects (no grain).
 */
export function filmTerms(look, tier, xr, reduced, out = { grain: 0, vignette: 0, toe: 0 }) {
  const T = LOOK_TIERS[tier] || LOOK_TIERS.quest;
  out.grain = xr || reduced ? 0 : (look.grain || 0) * T.grain;
  out.vignette = xr ? 0 : (look.vignette || 0) * T.vignette;
  out.toe = (look.toe || 0) * T.toe;
  return out;
}
